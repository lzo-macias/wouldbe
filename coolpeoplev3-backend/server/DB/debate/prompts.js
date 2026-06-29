const { client, withTransaction } = require("../index.js");
const { setPromptTags } = require("./tags");

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// ============================================================================
// This file covers TWO unrelated tables that both happen to say "prompt":
//
//   1) prompts            — debate content prompts contestants respond to.
//                           prompt_type ∈ PROMPT_KINDS. Sponsor-owned.
//   2) user_prompt_log    — soft-ask cadence ("did we ask, what did they say,
//                           when may we ask again"). prompt_type ∈ PROMPT_TYPES.
//                           Consent ITSELF lives in user_consents; this is only
//                           the cadence/deferral state.
//
// They are NOT the same enum. Keep them straight. (Worth splitting into two
// files later; kept together for now so the userRoutes import stays stable.)
// ============================================================================

// ----------------------------------------------------------------------------
// SECTION 1 — debate prompts (table: prompts)
// ----------------------------------------------------------------------------

// Allowed prompts.prompt_type values (DB CHECK). DISTINCT from PROMPT_TYPES below.
const PROMPT_KINDS = ["intro", "response", "rebuttal", "final_statement"];

// debateOwnership — resolve whether user_id is the sponsor behind a debate.
// Returns the row (so undefined = debate missing) vs { is_owner: false } = not
// the owner, letting callers pick 404 vs 403.
const debateOwnership = async (debate_id, user_id) => {
    const { rows } = await client.query(
        `SELECT (s.user_id = $2) AS is_owner
         FROM debates d
         LEFT JOIN sponsors s ON s.id = d.sponsor_id
         WHERE d.id = $1`,
        [debate_id, user_id]
    );
    return rows[0];
};

// createPrompt — add a debate prompt. Only the debate's sponsor may create one.
// user_id MUST come from the authed token at the route layer, never the body.
// No BEGIN: an ownership read + a single INSERT; the UNIQUE (debate_id,
// prompt_order) constraint handles concurrent duplicates atomically.
const createPrompt = async ({
    user_id,
    debate_id,
    prompt_order,
    prompt_type,
    title,
    body,
    image_url,
    example_video_url,
    release_at,
    response_deadline,
    category_keys, // optional: tag the prompt's subject matter at creation
}) => {
    if (!debate_id || prompt_order == null || !prompt_type || !body) {
        throw httpError(400, "debate_id, prompt_order, prompt_type and body are required");
    }
    if (!PROMPT_KINDS.includes(prompt_type)) {
        throw httpError(400, `prompt_type must be one of: ${PROMPT_KINDS.join(", ")}`);
    }
    try {
        // user_id present → enforce sponsor ownership (sponsor-facing caller).
        // user_id absent → admin-gated route already authorized; just confirm the
        // debate exists.
        if (user_id) {
            const owner = await debateOwnership(debate_id, user_id);
            if (!owner) throw httpError(404, "debate not found");
            if (!owner.is_owner) throw httpError(403, "you are not the sponsor of this debate");
        } else {
            const d = await client.query(`SELECT 1 FROM debates WHERE id = $1`, [debate_id]);
            if (!d.rows.length) throw httpError(404, "debate not found");
        }

        const SQL = `
            INSERT INTO prompts (
                debate_id,
                prompt_order,
                prompt_type,
                title,
                body,
                image_url,
                example_video_url,
                release_at,
                response_deadline
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *;
        `;
        const params = [
            debate_id,
            prompt_order,
            prompt_type,
            title,
            body,
            image_url,
            example_video_url,
            release_at,
            response_deadline,
        ];

        // No tags → single insert (no transaction needed). With tags → insert and
        // tag atomically on one connection (setPromptTags joins this tx via `db`).
        if (!Array.isArray(category_keys) || category_keys.length === 0) {
            const result = await client.query(SQL, params);
            return result.rows[0];
        }
        return await withTransaction(async (tx) => {
            const result = await tx.query(SQL, params);
            const prompt = result.rows[0];
            const tags = await setPromptTags(prompt.id, category_keys, tx);
            return { ...prompt, tags };
        });
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "23505") throw httpError(409, "a prompt with this prompt_order already exists for this debate");
        if (err.code === "23514") throw httpError(400, "a prompt field violates a check constraint");
        if (err.code === "23503") throw httpError(400, "debate_id does not exist");
        console.error(err);
        throw err;
    }
};

// getDebatePrompts — prompts for a debate, in order. Public/contestant callers
// (includeUnreleased=false) only see released prompts (release_at IS NULL or
// already passed); the sponsor view passes true to see drafts/upcoming rounds.
const getDebatePrompts = async ({ debate_id, includeUnreleased = false }) => {
    if (!debate_id) throw httpError(400, "debate_id is required");
    try {
        const SQL = `
            SELECT *
            FROM prompts
            WHERE debate_id = $1
              AND ($2::boolean = true OR release_at IS NULL OR release_at <= NOW())
            ORDER BY prompt_order ASC;
        `;
        const result = await client.query(SQL, [debate_id, includeUnreleased]);
        return result.rows;
    } catch (err) {
        console.error(err);
        throw err;
    }
};

// updatePrompt — edit a prompt (sponsor only). COALESCE keeps omitted fields;
// id/debate_id/created_at are immutable. Blocks edits once the prompt has gone
// live (release_at passed). NOTE: the schema says prompts are "built flexible so
// sponsors can adjust mid-debate" — if you DO want post-release edits, drop the
// is_released guard below.
const updatePrompt = async ({
    id,
    user_id,
    prompt_order = null,
    prompt_type = null,
    title = null,
    body = null,
    image_url = null,
    example_video_url = null,
    release_at = null,
    response_deadline = null,
}) => {
    if (!id) throw httpError(400, "id is required");
    if (prompt_type != null && !PROMPT_KINDS.includes(prompt_type)) {
        throw httpError(400, `prompt_type must be one of: ${PROMPT_KINDS.join(", ")}`);
    }
    try {
        // prompt → debate → sponsor ownership + release state, in one read.
        // user_id present → enforce ownership; absent → admin-gated route.
        const { rows } = await client.query(
            `SELECT (s.user_id = $2) AS is_owner,
                    (p.release_at IS NOT NULL AND p.release_at <= NOW()) AS is_released
             FROM prompts p
             JOIN debates d ON d.id = p.debate_id
             LEFT JOIN sponsors s ON s.id = d.sponsor_id
             WHERE p.id = $1`,
            [id, user_id ?? null]
        );
        const meta = rows[0];
        if (!meta) throw httpError(404, "prompt not found");
        if (user_id && !meta.is_owner) throw httpError(403, "you are not the sponsor of this debate");
        if (meta.is_released) throw httpError(409, "cannot edit a prompt that has already been released");

        const SQL = `
            UPDATE prompts SET
                prompt_order      = COALESCE($2, prompt_order),
                prompt_type       = COALESCE($3, prompt_type),
                title             = COALESCE($4, title),
                body              = COALESCE($5, body),
                image_url         = COALESCE($6, image_url),
                example_video_url = COALESCE($7, example_video_url),
                release_at        = COALESCE($8, release_at),
                response_deadline = COALESCE($9, response_deadline),
                updated_at        = NOW()
            WHERE id = $1
            RETURNING *;
        `;
        const result = await client.query(SQL, [
            id,
            prompt_order,
            prompt_type,
            title,
            body,
            image_url,
            example_video_url,
            release_at,
            response_deadline,
        ]);
        return result.rows[0];
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "23505") throw httpError(409, "a prompt with this prompt_order already exists for this debate");
        if (err.code === "23514") throw httpError(400, "a prompt field violates a check constraint");
        console.error(err);
        throw err;
    }
};

// deletePrompt — remove a prompt (sponsor only). Blocked once released; the
// posts.prompt_id FK blocks deletion of a prompt that already has responses.
const deletePrompt = async ({ id, user_id }) => {
    if (!id) throw httpError(400, "id is required");
    try {
        const { rows } = await client.query(
            `SELECT (s.user_id = $2) AS is_owner,
                    (p.release_at IS NOT NULL AND p.release_at <= NOW()) AS is_released
             FROM prompts p
             JOIN debates d ON d.id = p.debate_id
             LEFT JOIN sponsors s ON s.id = d.sponsor_id
             WHERE p.id = $1`,
            [id, user_id ?? null]
        );
        const meta = rows[0];
        if (!meta) throw httpError(404, "prompt not found");
        if (user_id && !meta.is_owner) throw httpError(403, "you are not the sponsor of this debate");
        if (meta.is_released) throw httpError(409, "cannot delete a prompt that has already been released");

        const result = await client.query(`DELETE FROM prompts WHERE id = $1 RETURNING *`, [id]);
        return { deleted: result.rows[0].id, prompt: result.rows[0] };
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "23503") throw httpError(409, "cannot delete a prompt that already has responses");
        console.error(err);
        throw err;
    }
};

// ----------------------------------------------------------------------------
// SECTION 2 — soft-ask cadence (table: user_prompt_log)
// ----------------------------------------------------------------------------

// Must match the prompt_type CHECK on user_prompt_log.
const PROMPT_TYPES = [
    "push_debate",
    "push_wouldbe",
    "sms_fallback",
    "address_collection",
    "citizen_attestation",
    "wouldbe_nomination",
];

// recordPromptResponse(...) — log what the user did with a soft ask. response is
// accepted|declined|dismissed|deferred. next_eligible_at = when we may re-ask
// (pass null to never re-ask; e.g. accepted/declined-for-good).
const recordPromptResponse = async ({
    user_id,
    prompt_type,
    response,
    session_number = null,
    next_eligible_at = null,
}) => {
    try {
        const SQL = `
            INSERT INTO user_prompt_log
                (user_id, prompt_type, session_number, response, next_eligible_at)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *;
        `;
        const { rows } = await client.query(SQL, [
            user_id, prompt_type, session_number, response, next_eligible_at,
        ]);
        return rows[0];
    } catch (err) {
        console.error(err);
        throw err;
    }
};

// getDuePrompts(userId) — which soft asks are currently due. A type is due if it
// has NEVER been asked, or the latest response set a next_eligible_at that has
// now passed. A latest row with next_eligible_at = NULL means "never re-ask", so
// it is excluded. Returns an array of prompt_type strings.
const getDuePrompts = async ({ user_id }) => {
    try {
        const { rows } = await client.query(
            `SELECT DISTINCT ON (prompt_type) prompt_type, response, next_eligible_at
             FROM user_prompt_log
             WHERE user_id = $1
             ORDER BY prompt_type, responded_at DESC`,
            [user_id]
        );
        const latestByType = {};
        for (const r of rows) latestByType[r.prompt_type] = r;

        const now = Date.now();
        const due = [];
        for (const t of PROMPT_TYPES) {
            const last = latestByType[t];
            if (!last) {
                due.push(t); // never asked
            } else if (last.next_eligible_at && new Date(last.next_eligible_at).getTime() <= now) {
                due.push(t); // deferred and now eligible again
            }
            // next_eligible_at IS NULL → permanent decision → not due
        }
        return due;
    } catch (err) {
        console.error(err);
        throw err;
    }
};

module.exports = {
    // debate prompts
    PROMPT_KINDS,
    createPrompt,
    getDebatePrompts,
    updatePrompt,
    deletePrompt,
    // soft-ask cadence
    PROMPT_TYPES,
    recordPromptResponse,
    getDuePrompts,
};
