const { client, withTransaction } = require("../index.js");
const { createCandidateCommittee } = require("./candidateCommittees.js");

// ============================================================================
// testing_the_waters_campaigns — FEC "testing the waters" lets someone explore a
// run WITHOUT registering a committee, under strict caps and while staying
// non-public. When exploration turns serious it converts into a real committee.
// Caps are enforced against cumulative_pledges_cents (soft warns, hard blocks).
// ============================================================================

// default exploration window if the caller doesn't pass an expiration (FEC ~60d)
const DEFAULT_WINDOW_DAYS = 60;

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// startTestingTheWaters — open an exploration campaign (status 'active',
// non-public). Caps default in the table ($3K soft / $4.5K hard) unless overridden.
const startTestingTheWaters = async ({
    user_id,
    office_being_explored,
    jurisdiction_id,
    start_date = null,
    expiration_date = null,
    soft_pledge_cap_cents = null,
    hard_pledge_cap_cents = null,
    disclosure_version_id = null,
    disclosure_shown_to_pledgers = false,
}) => {
    if (!user_id || !office_being_explored || !jurisdiction_id) {
        throw httpError(400, "user_id, office_being_explored and jurisdiction_id are required");
    }
    try {
        const { rows } = await client.query(
            `INSERT INTO testing_the_waters_campaigns
               (user_id, office_being_explored, jurisdiction_id, status, start_date, expiration_date,
                soft_pledge_cap_cents, hard_pledge_cap_cents, disclosure_version_id,
                disclosure_shown_to_pledgers, is_publicly_discoverable)
             VALUES ($1,$2,$3,'active',
                COALESCE($4::date, CURRENT_DATE),
                COALESCE($5::date, CURRENT_DATE + ($6 || ' days')::interval),
                COALESCE($7::bigint, 300000),
                COALESCE($8::bigint, 450000),
                $9, $10, false)
             RETURNING *`,
            [
                user_id, office_being_explored, jurisdiction_id, start_date, expiration_date,
                String(DEFAULT_WINDOW_DAYS), soft_pledge_cap_cents, hard_pledge_cap_cents,
                disclosure_version_id, disclosure_shown_to_pledgers,
            ]
        );
        return rows[0];
    } catch (err) {
        if (err.code === "23514") throw httpError(400, "a TTW field violates a check constraint");
        if (err.code === "23503") throw httpError(400, "jurisdiction_id or disclosure_version_id does not exist");
        if (err.code === "22P02") throw httpError(400, "a uuid field is malformed");
        console.error(err);
        throw err;
    }
};

// getUserTTW({ userId }) — a user's exploration campaigns, newest first.
const getUserTTW = async ({ userId }) => {
    const { rows } = await client.query(
        `SELECT t.*, j.name AS jurisdiction_name
         FROM testing_the_waters_campaigns t
         JOIN jurisdiction j ON j.id = t.jurisdiction_id
         WHERE t.user_id = $1
         ORDER BY t.created_at DESC`,
        [userId]
    );
    return rows;
};

// getTTWById({ id }) — single campaign.
const getTTWById = async ({ id }) => {
    const { rows } = await client.query(
        `SELECT t.*, j.name AS jurisdiction_name
         FROM testing_the_waters_campaigns t
         JOIN jurisdiction j ON j.id = t.jurisdiction_id
         WHERE t.id = $1`,
        [id]
    );
    return rows[0] || null;
};

// convertTTWToCommittee — exploration got serious: register a committee and link
// it back (converted_to_committee_id + status). committeeFields carry the new
// committee's details (committee_name, committee_type, cycle_year, receipt, …).
const convertTTWToCommittee = async ({ id, committeeFields = {} }) => {
    const ttw = await getTTWById({ id });
    if (!ttw) throw httpError(404, "testing-the-waters campaign not found");
    if (ttw.status === "converted_to_committee" || ttw.converted_to_committee_id) {
        throw httpError(409, "this campaign already converted to a committee");
    }
    try {
        return await withTransaction(async (tx) => {
            const committee = await createCandidateCommittee({
                user_id: ttw.user_id,
                jurisdiction_id: ttw.jurisdiction_id,
                office_sought: ttw.office_being_explored,
                ...committeeFields,
            }, tx); // run on the tx connection so the committee + status flip are atomic
            const { rows } = await tx.query(
                `UPDATE testing_the_waters_campaigns
                 SET status = 'converted_to_committee', converted_to_committee_id = $2
                 WHERE id = $1
                 RETURNING *`,
                [id, committee.id]
            );
            return { campaign: rows[0], committee };
        });
    } catch (err) {
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};

// terminateTTW({ id }) — close out an exploration (status 'terminated').
const terminateTTW = async ({ id }) => {
    const { rows } = await client.query(
        `UPDATE testing_the_waters_campaigns
         SET status = 'terminated', expired_at = now()
         WHERE id = $1
         RETURNING *`,
        [id]
    );
    if (!rows.length) throw httpError(404, "testing-the-waters campaign not found");
    return rows[0];
};

// expireDueTTWs() — bulk sweep for the §16 expiry cron. Any still-'active'
// exploration campaign whose FEC window has elapsed (expiration_date is in the
// past) flips to 'expired' and gets expired_at stamped. Single bulk UPDATE,
// idempotent (only touches 'active' rows), returns the rows that expired.
const expireDueTTWs = async () => {
    const { rows } = await client.query(
        `UPDATE testing_the_waters_campaigns
            SET status = 'expired', expired_at = now()
          WHERE status = 'active'
            AND expiration_date < CURRENT_DATE
          RETURNING id, user_id, office_being_explored, expiration_date`
    );
    return rows;
};

// incrementTTWPledgeStats — internal: roll a pledge into the running totals.
// newPledger bumps the unique-pledger count. Returns the updated cap picture.
const incrementTTWPledgeStats = async ({ id, amount_cents, newPledger = false }) => {
    const { rows } = await client.query(
        `UPDATE testing_the_waters_campaigns
         SET cumulative_pledges_cents = cumulative_pledges_cents + $2,
             unique_pledgers_count    = unique_pledgers_count + ($3::int)
         WHERE id = $1
         RETURNING *`,
        [id, amount_cents, newPledger ? 1 : 0]
    );
    if (!rows.length) throw httpError(404, "testing-the-waters campaign not found");
    return rows[0];
};

// checkTTWCaps({ id, additional_cents }) — would adding additional_cents breach a
// cap? Returns { soft_breached, hard_breached, remaining_to_hard_cents, ... }.
// Hard breach is a hard stop; soft breach is a disclosure/warning trigger.
const checkTTWCaps = async ({ id, additional_cents = 0 }) => {
    const ttw = await getTTWById({ id });
    if (!ttw) throw httpError(404, "testing-the-waters campaign not found");
    const projected = Number(ttw.cumulative_pledges_cents) + Number(additional_cents);
    const soft = Number(ttw.soft_pledge_cap_cents);
    const hard = Number(ttw.hard_pledge_cap_cents);
    return {
        cumulative_pledges_cents: Number(ttw.cumulative_pledges_cents),
        projected_cents: projected,
        soft_cap_cents: soft,
        hard_cap_cents: hard,
        soft_breached: projected > soft,
        hard_breached: projected > hard,
        remaining_to_hard_cents: Math.max(0, hard - Number(ttw.cumulative_pledges_cents)),
    };
};

module.exports = {
    startTestingTheWaters,
    getUserTTW,
    getTTWById,
    convertTTWToCommittee,
    terminateTTW,
    expireDueTTWs,
    incrementTTWPledgeStats,
    checkTTWCaps,
};
