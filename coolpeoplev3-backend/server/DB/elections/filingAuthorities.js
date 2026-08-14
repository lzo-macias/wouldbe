const { client } = require("../index.js")

// getFilingAuthorityFor({ jurisdictionId, officeId }) — the single authority a
// candidate should file with. officeId optional.
//
// WHY IT WALKS UP: authorities exist per STATE (50) plus the FEC and the NYC CFB —
// 52 rows total. Districts don't have their own; there is no "Assembly District 74
// filing office", you file with the NY State BOE. Matching jurisdiction_id exactly
// therefore returned nothing for all ~7,400 district jurisdictions, which is every
// office a candidate can actually run for.
//
// Seeding a row per district would mean ~7,400 duplicates pointing at the same 50
// portals, and a URL change would need 148 edits instead of one. So we resolve up
// the hierarchy instead.
//
// RESOLUTION ORDER (nearest wins):
//   depth 0   the jurisdiction itself
//   depth 1+  each parent, so a NYC council district finds the CFB (depth 1)
//             BEFORE the state BOE (depth 2) — which is correct, a council
//             candidate files with the CFB, not Albany
//   depth 999 the state matching state_code, as a last resort
//
// That last rung is not redundant: parent_jurisdiction_id is null on a handful of
// district rows (Assembly District 74 among them), and a broken link would
// otherwise leave a candidate with no filing instructions at all. state_code is
// populated on 100% of district rows, so it always resolves.
//
// Within one jurisdiction an office-specific row still beats a jurisdiction-wide
// one, as before — it's the secondary sort.
const getFilingAuthorityFor = async ({ jurisdictionId, officeId = null } = {}) => {
    try {
        const SQL = `
            WITH RECURSIVE chain AS (
                SELECT id, parent_jurisdiction_id, 0 AS depth
                  FROM jurisdiction
                 WHERE id = $1
                UNION ALL
                SELECT j.id, j.parent_jurisdiction_id, c.depth + 1
                  FROM jurisdiction j
                  JOIN chain c ON j.id = c.parent_jurisdiction_id
                 WHERE c.depth < 10          -- cycle guard: a self-referencing row would loop forever
            ),
            candidates AS (
                SELECT id, depth FROM chain
                UNION ALL
                SELECT s.id, 999
                  FROM jurisdiction s
                 WHERE s.type = 'state'
                   AND s.state_code = (SELECT state_code FROM jurisdiction WHERE id = $1)
            )
            SELECT
                fa.*,
                j.name       AS jurisdiction_name,
                j.state_code,
                j.type       AS jurisdiction_type,
                (c.depth > 0) AS inherited      -- so callers can say "you file at the state level"
            FROM filing_authorities fa
            JOIN candidates c   ON c.id = fa.jurisdiction_id
            JOIN jurisdiction j ON j.id = fa.jurisdiction_id
            WHERE fa.is_active = true
                AND ($2::uuid IS NULL OR fa.applies_to_office_id = $2 OR fa.applies_to_office_id IS NULL)
            ORDER BY c.depth ASC, (fa.applies_to_office_id IS NOT NULL) DESC
            LIMIT 1
        `
        const result = await client.query(SQL, [jurisdictionId, officeId ?? null])
        return result.rows[0]
    } catch (err) {
        console.error(err)
        throw err
    }
}

// listFilingAuthorities(filters) — admin/list view. All filters optional and AND
// together; omit everything for "all". Defaults to active-only unless is_active
// is explicitly passed.
const listFilingAuthorities = async ({
    jurisdiction_id,
    applies_to_office_id,
    authority_level,
    link_status,
    is_active = true,
    limit = 100,
} = {}) => {
    try {
        const SQL = `
            SELECT
                fa.*,
                j.name       AS jurisdiction_name,
                j.state_code
            FROM filing_authorities fa
            JOIN jurisdiction j ON j.id = fa.jurisdiction_id
            WHERE ($1::uuid    IS NULL OR fa.jurisdiction_id = $1)
                AND ($2::uuid    IS NULL OR fa.applies_to_office_id = $2)
                AND ($3::text    IS NULL OR fa.authority_level = $3)
                AND ($4::text    IS NULL OR fa.link_status = $4)
                AND ($5::boolean IS NULL OR fa.is_active = $5)
            ORDER BY j.name, fa.authority_name
            LIMIT $6
        `
        const result = await client.query(SQL, [
            jurisdiction_id ?? null,
            applies_to_office_id ?? null,
            authority_level ?? null,
            link_status ?? null,
            is_active ?? null,
            Math.min(Number(limit) || 100, 500),
        ])
        return result.rows
    } catch (err) {
        console.error(err)
        throw err
    }
}

// getFilingAuthorityById({ id }) — single row.
const getFilingAuthorityById = async ({ id }) => {
    try {
        const SQL = `
            SELECT
                fa.*,
                j.name       AS jurisdiction_name,
                j.state_code
            FROM filing_authorities fa
            JOIN jurisdiction j ON j.id = fa.jurisdiction_id
            WHERE fa.id = $1
        `
        const result = await client.query(SQL, [id])
        return result.rows[0]
    } catch (err) {
        console.error(err)
        throw err
    }
}

// upsertFilingAuthority({...}) — admin writer. id given → partial UPDATE (COALESCE
// keeps existing when a field is omitted); else INSERT. jurisdiction_id,
// authority_name, authority_level and registration_portal_url are required on
// insert (NOT NULL in the table).
const upsertFilingAuthority = async ({
    id = null,
    jurisdiction_id,
    applies_to_office_id = null,
    authority_name,
    authority_level,
    registration_portal_url,
    how_to_file_url = null,
    how_to_file_guide = null,
    treasurer_guide = null,
    candidate_may_self_treasure = null,
    committee_id_format = null,
    is_active = null,
    source_url = null,
}) => {
    try {
        const cols = [
            jurisdiction_id, applies_to_office_id, authority_name, authority_level,
            registration_portal_url, how_to_file_url, how_to_file_guide, treasurer_guide,
            candidate_may_self_treasure, committee_id_format, is_active, source_url,
        ]

        if (id) {
            const SQL = `
                UPDATE filing_authorities SET
                    jurisdiction_id             = COALESCE($2, jurisdiction_id),
                    applies_to_office_id        = COALESCE($3, applies_to_office_id),
                    authority_name              = COALESCE($4, authority_name),
                    authority_level             = COALESCE($5, authority_level),
                    registration_portal_url     = COALESCE($6, registration_portal_url),
                    how_to_file_url             = COALESCE($7, how_to_file_url),
                    how_to_file_guide           = COALESCE($8, how_to_file_guide),
                    treasurer_guide             = COALESCE($9, treasurer_guide),
                    candidate_may_self_treasure = COALESCE($10, candidate_may_self_treasure),
                    committee_id_format         = COALESCE($11, committee_id_format),
                    is_active                   = COALESCE($12, is_active),
                    source_url                  = COALESCE($13, source_url),
                    updated_at = NOW()
                WHERE id = $1
                RETURNING *;
            `
            const result = await client.query(SQL, [id, ...cols])
            if (!result.rows.length) throw new Error("no filing authority with this id")
            return result.rows[0]
        }

        const SQL = `
            INSERT INTO filing_authorities (
                id, jurisdiction_id, applies_to_office_id, authority_name, authority_level,
                registration_portal_url, how_to_file_url, how_to_file_guide, treasurer_guide,
                candidate_may_self_treasure, committee_id_format, is_active, source_url
            ) VALUES (
                uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, true), $12
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

// recordLinkHealth({ id, status }) — the §8 link-health cron's writer. Stamps the
// automated check result + when it ran. status ∈ healthy|broken|redirected|unknown.
const recordLinkHealth = async ({ id, status }) => {
    try {
        const SQL = `
            UPDATE filing_authorities
            SET link_status = $2, link_last_checked_at = NOW(), updated_at = NOW()
            WHERE id = $1
            RETURNING id, authority_name, link_status, link_last_checked_at;
        `
        const result = await client.query(SQL, [id, status])
        if (!result.rows.length) throw new Error("no filing authority with this id")
        return result.rows[0]
    } catch (err) {
        console.error(err)
        throw err
    }
}

module.exports = {
    getFilingAuthorityFor,
    listFilingAuthorities,
    getFilingAuthorityById,
    upsertFilingAuthority,
    recordLinkHealth,
}
