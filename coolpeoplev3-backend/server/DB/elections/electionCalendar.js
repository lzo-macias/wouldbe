const { client } = require("../index.js")

// getAnchors({jurisdiction_id, cycle}) — the cycle's anchor dates (primary,
// general, runoff, early-voting) for a jurisdiction. Drives offset math.
const getAnchors = async ({
    jurisdiction_id,
    cycle
}) => {
    try{
        const SQL = `
            SELECT *
            FROM election_date_anchors
            WHERE jurisdiction_id = $1
                AND election_cycle = $2
        `

        const result = await client.query(SQL, [jurisdiction_id, cycle])

        return result.rows
    }catch(err){
        console.error(err)
        throw err
    }
}

// upsertElectionAnchor({...}) — admin writer. The table has a unique key on
// (jurisdiction_id, election_cycle, anchor_type), so this is a single atomic
// ON CONFLICT upsert (no select-then-write race).
const upsertElectionAnchor = async ({
    jurisdiction_id,
    election_cycle,
    anchor_type,
    anchor_date,
    source_url = null,
}) => {
    try{
        const SQL = `
            INSERT INTO election_date_anchors (
                id, jurisdiction_id, election_cycle, anchor_type, anchor_date, source_url
            ) VALUES (
                uuid_generate_v4(), $1, $2, $3, $4, $5
            )
            ON CONFLICT (jurisdiction_id, election_cycle, anchor_type)
            DO UPDATE SET
                anchor_date = EXCLUDED.anchor_date,
                source_url  = EXCLUDED.source_url,
                updated_at  = NOW()
            RETURNING *;
        `

        const result = await client.query(SQL, [
            jurisdiction_id,
            election_cycle,
            anchor_type,
            anchor_date,
            source_url ?? null,
        ])

        return result.rows[0]
    }catch(err){
        console.error(err)
        throw err
    }
}

// getOffsetRules({jurisdictionId, officeId, deadlineType}) — offset rules for a
// jurisdiction. officeId/deadlineType are optional filters; passing null for an
// argument leaves that dimension unfiltered (and matches office-agnostic rules).
const getOffsetRules = async ({
    jurisdictionId,
    officeId = null,
    deadlineType = null,
} = {}) => {
    try{
        const SQL = `
            SELECT *
            FROM deadline_offset_rules
            WHERE jurisdiction_id = $1
                AND ($2::uuid IS NULL OR applies_to_office_id = $2)
                AND ($3::text IS NULL OR deadline_type = $3)
            ORDER BY effective_from DESC
        `

        const result = await client.query(SQL, [jurisdictionId, officeId ?? null, deadlineType ?? null])

        return result.rows
    }catch(err){
        console.error(err)
        throw err
    }
}

// upsertOffsetRule({...}) — admin writer. The table is effective-dated with no
// natural unique key, so: id given → partial UPDATE (COALESCE keeps existing
// when a field is omitted); else INSERT. jurisdiction_id, deadline_type and
// effective_from are required on insert (NOT NULL in the table).
const upsertOffsetRule = async ({
    id = null,
    jurisdiction_id,
    applies_to_office_id = null,
    deadline_type,
    anchor_type = null,
    offset_days = null,
    fixed_date = null,
    is_fixed_date = null,
    effective_from = null,
    effective_until = null,
    source_url = null,
    notes = null,
}) => {
    try {
        const cols = [
            jurisdiction_id, applies_to_office_id, deadline_type, anchor_type,
            offset_days, fixed_date, is_fixed_date, effective_from,
            effective_until, source_url, notes,
        ]

        if (id) {
            const SQL = `
                UPDATE deadline_offset_rules SET
                    jurisdiction_id      = COALESCE($2, jurisdiction_id),
                    applies_to_office_id = COALESCE($3, applies_to_office_id),
                    deadline_type        = COALESCE($4, deadline_type),
                    anchor_type          = COALESCE($5, anchor_type),
                    offset_days          = COALESCE($6, offset_days),
                    fixed_date           = COALESCE($7, fixed_date),
                    is_fixed_date        = COALESCE($8, is_fixed_date),
                    effective_from       = COALESCE($9, effective_from),
                    effective_until      = COALESCE($10, effective_until),
                    source_url           = COALESCE($11, source_url),
                    notes                = COALESCE($12, notes)
                WHERE id = $1
                RETURNING *;
            `
            const result = await client.query(SQL, [id, ...cols])
            if (!result.rows.length) throw new Error("no offset rule with this id")
            return result.rows[0]
        }

        const SQL = `
            INSERT INTO deadline_offset_rules (
                id, jurisdiction_id, applies_to_office_id, deadline_type, anchor_type,
                offset_days, fixed_date, is_fixed_date, effective_from, effective_until,
                source_url, notes
            ) VALUES (
                uuid_generate_v4(), $1, $2, $3, $4, $5, $6, COALESCE($7, false), $8, $9, $10, $11
            )
            RETURNING *;
        `
        const result = await client.query(SQL, cols)
        return result.rows[0]
    } catch (err) {
        console.error(err)
        throw err
    }
}

// computeDeadlinesForOffice({officeId, cycle}) — §6 auto-scoped-timeline engine.
// Resolves the office's jurisdiction, loads the cycle's anchors and the office's
// in-effect offset rules, then for each rule writes an election_deadlines row:
//   deadline_date = fixed_date            (when the rule is a fixed statutory date)
//                 = anchor_date + offset  (when anchored & the anchor is encoded)
//                 = NULL, is_tbd = true   (when neither is encodable yet)
// Upsert is keyed by (offset_rule_id, applies_to_office_id, election_cycle) so a
// recompute is idempotent and preserves row identity (stage FKs stay valid).
const computeDeadlinesForOffice = async ({ officeId, cycle }) => {
    try {
        if (!officeId || cycle == null) {
            throw new Error("officeId and cycle are required")
        }

        // 1) Resolve the office → its jurisdiction.
        const officeRes = await client.query(
            `SELECT id, jurisdiction_id FROM office WHERE id = $1`,
            [officeId]
        )
        if (!officeRes.rows.length) throw new Error("no office with this id")
        const { jurisdiction_id } = officeRes.rows[0]

        // 2) Load this cycle's anchors, keyed by anchor_type. Select dates as text
        //    so they round-trip to SQL without JS timezone drift.
        const anchorsRes = await client.query(
            `SELECT anchor_type, anchor_date::text AS anchor_date
             FROM election_date_anchors
             WHERE jurisdiction_id = $1 AND election_cycle = $2`,
            [jurisdiction_id, cycle]
        )
        const anchorDateByType = {}
        for (const a of anchorsRes.rows) anchorDateByType[a.anchor_type] = a.anchor_date

        // 3) Load the offset rules that apply to this office (office-specific or
        //    office-agnostic) and are currently in effect.
        const rulesRes = await client.query(
            `SELECT id, deadline_type, anchor_type, offset_days,
                    fixed_date::text AS fixed_date, is_fixed_date, source_url
             FROM deadline_offset_rules
             WHERE jurisdiction_id = $1
               AND (applies_to_office_id = $2 OR applies_to_office_id IS NULL)
               AND effective_from <= CURRENT_DATE
               AND (effective_until IS NULL OR effective_until >= CURRENT_DATE)`,
            [jurisdiction_id, officeId]
        )

        // 4) Manual upsert per rule (election_deadlines has no unique key): UPDATE
        //    the existing computed row if present, else INSERT. The date is
        //    computed in SQL so anchor + offset arithmetic stays in the DB.
        const UPSERT_SQL = `
            WITH calc AS (
                SELECT
                    CASE
                        WHEN $8::boolean AND $9::date IS NOT NULL
                            THEN $9::date
                        WHEN $10::date IS NOT NULL AND $11::int IS NOT NULL
                            THEN ($10::date + ($11::int * INTERVAL '1 day'))::date
                        ELSE NULL
                    END AS deadline_date
            ),
            updated AS (
                UPDATE election_deadlines ed SET
                    deadline_type = $4,
                    deadline_date = calc.deadline_date,
                    anchor_type   = $5,
                    is_tbd        = (calc.deadline_date IS NULL),
                    source_url    = $7,
                    updated_at    = NOW()
                FROM calc
                WHERE ed.offset_rule_id = $6
                    AND ed.applies_to_office_id = $2
                    AND ed.election_cycle = $3
                RETURNING ed.id, ed.deadline_type, ed.deadline_date, ed.is_tbd, 'updated'::text AS op
            ),
            inserted AS (
                INSERT INTO election_deadlines (
                    id, jurisdiction_id, election_cycle, deadline_type, deadline_date,
                    applies_to_office_id, anchor_type, offset_rule_id, is_tbd, source_url
                )
                SELECT
                    uuid_generate_v4(), $1, $3, $4, calc.deadline_date,
                    $2, $5, $6, (calc.deadline_date IS NULL), $7
                FROM calc
                WHERE NOT EXISTS (SELECT 1 FROM updated)
                RETURNING id, deadline_type, deadline_date, is_tbd, 'inserted'::text AS op
            )
            SELECT id, deadline_type, deadline_date, is_tbd, op FROM updated
            UNION ALL
            SELECT id, deadline_type, deadline_date, is_tbd, op FROM inserted;
        `

        const computed = []
        for (const rule of rulesRes.rows) {
            const anchorDate = anchorDateByType[rule.anchor_type] ?? null
            const result = await client.query(UPSERT_SQL, [
                jurisdiction_id,        // $1
                officeId,               // $2
                cycle,                  // $3
                rule.deadline_type,     // $4
                rule.anchor_type,       // $5
                rule.id,                // $6  (offset_rule_id)
                rule.source_url,        // $7
                rule.is_fixed_date,     // $8
                rule.fixed_date,        // $9
                anchorDate,             // $10
                rule.offset_days,       // $11
            ])
            computed.push(result.rows[0])
        }

        return computed
    } catch (err) {
        console.error(err)
        throw err
    }
}

module.exports = {
    getAnchors,
    upsertElectionAnchor,
    getOffsetRules,
    upsertOffsetRule,
    computeDeadlinesForOffice,
}
