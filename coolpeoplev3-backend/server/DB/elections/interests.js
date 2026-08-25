const { client, withTransaction } = require("../index.js");

// ============================================================================
// user_areas_of_interest — the categories a user cares about. Many-to-many into
// the canonical taxonomy, so each interest is FK-validated. Used to decide what
// to surface (WouldBes/posts/prompts whose categories intersect the user's).
// ============================================================================

// getUserInterests(userId) — full category rows the user selected (joined to the
// taxonomy so the caller gets display_name/group, not just keys).
// db defaults to the pool; pass a withTransaction `tx` to read within a caller's
// transaction (e.g. setUserInterests reading back what it just wrote).
const getUserInterests = async ({ userId }, db = client) => {
    try {
        const SQL = `
            SELECT c.category_key, c.display_name, c.category_group, c.icon
            FROM user_areas_of_interest uai
            JOIN plan_component_categories c ON c.category_key = uai.category_key
            WHERE uai.user_id = $1
            ORDER BY c.category_group, c.sort_order NULLS LAST, c.display_name
        `;
        const { rows } = await db.query(SQL, [userId]);
        return rows;
    } catch (err) {
        console.error(err);
        throw err;
    }
};

// setUserInterests(userId, category_keys[]) — REPLACE the user's interest set in
// one transaction (delete-all then insert). An invalid key trips the FK and
// rolls the whole thing back as a 400, so a bad list never half-applies.
// Pass a `db` (withTransaction `tx`) to set interests as part of a caller's
// transaction (e.g. signup setting interests atomically). Standalone it opens its
// own. We must NOT nest withTransaction inside an existing tx (double BEGIN).
const setUserInterests = async ({ userId, category_keys }, db = client) => {
    if (!Array.isArray(category_keys)) {
        const e = new Error("category_keys must be an array");
        e.status = 400;
        throw e;
    }
    // de-dupe so a repeated key doesn't trip the composite PK
    const keys = [...new Set(category_keys)];
    const run = async (tx) => {
        await tx.query(`DELETE FROM user_areas_of_interest WHERE user_id = $1`, [userId]);
        if (keys.length) {
            // one multi-row insert: unnest the keys array against the fixed user_id
            await tx.query(
                `INSERT INTO user_areas_of_interest (user_id, category_key)
                 SELECT $1, k FROM unnest($2::text[]) AS k`,
                [userId, keys]
            );
        }
    };
    try {
        if (db === client) {
            await withTransaction(run);
            // Read AFTER commit (the old code read on the pool BEFORE commit and
            // returned the pre-write set — a stale read; this fixes it).
            return await getUserInterests({ userId });
        }
        await run(db);
        return await getUserInterests({ userId }, db); // read-your-writes on the tx
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "23503") {
            // foreign_key_violation — at least one key isn't a real category
            const e = new Error("one or more category_keys are not valid categories");
            e.status = 400;
            throw e;
        }
        console.error(err);
        throw err;
    }
};

module.exports = { getUserInterests, setUserInterests };
