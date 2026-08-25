const { client, withTransaction } = require("../index.js");

// ============================================================================
// post_tags / prompt_tags — categories attached to a post or a debate prompt.
// Same controlled vocabulary as user interests, so "show me content about X"
// and "this user cares about X" intersect on category_key.
//
// post and prompt tagging are identical mechanics, so they share one engine.
// The table/id-column are chosen from a fixed allowlist (NEVER from input) so
// the dynamic SQL identifiers can't be injected.
// ============================================================================

const ENTITIES = {
    post: { table: "post_tags", idCol: "post_id" },
    prompt: { table: "prompt_tags", idCol: "prompt_id" },
};

// db defaults to the pool; pass a withTransaction `tx` to read within a caller's
// transaction (e.g. a create-flow reading back the tags it just set).
const getTags = async (entity, id, db = client) => {
    const { table, idCol } = ENTITIES[entity];
    try {
        const { rows } = await db.query(
            `SELECT c.category_key, c.display_name, c.category_group, c.icon
             FROM ${table} t
             JOIN plan_component_categories c ON c.category_key = t.category_key
             WHERE t.${idCol} = $1
             ORDER BY c.category_group, c.sort_order NULLS LAST, c.display_name`,
            [id]
        );
        return rows;
    } catch (err) {
        console.error(err);
        throw err;
    }
};

// REPLACE the tag set for one entity (delete-all then insert); a bad key rolls
// back as a 400. Pass a `db` (a withTransaction `tx`) to run as PART OF a caller's
// transaction — e.g. createPost/createPrompt tagging atomically with the insert.
// Standalone it opens its own transaction. We must NOT nest withTransaction inside
// an existing tx (double BEGIN), hence the branch.
const setTags = async (entity, id, category_keys, db = client) => {
    if (!Array.isArray(category_keys)) {
        const e = new Error("category_keys must be an array");
        e.status = 400;
        throw e;
    }
    if (!ENTITIES[entity]) {
        const e = new Error(`unknown tag entity: ${entity}`);
        e.status = 400;
        throw e;
    }
    const { table, idCol } = ENTITIES[entity];
    const keys = [...new Set(category_keys)];
    const run = async (tx) => {
        await tx.query(`DELETE FROM ${table} WHERE ${idCol} = $1`, [id]);
        if (keys.length) {
            await tx.query(
                `INSERT INTO ${table} (${idCol}, category_key)
                 SELECT $1, k FROM unnest($2::text[]) AS k`,
                [id, keys]
            );
        }
    };
    try {
        if (db === client) {
            await withTransaction(run);
            return await getTags(entity, id); // after commit, on the pool
        }
        // Composed in a caller's tx: run on it and read back on the SAME
        // connection (read-your-writes before the caller commits).
        await run(db);
        return await getTags(entity, id, db);
    } catch (err) {
        if (err.status) throw err;
        if (err.code === "23503") {
            const e = new Error("one or more category_keys are not valid categories");
            e.status = 400;
            throw e;
        }
        console.error(err);
        throw err;
    }
};

module.exports = {
    setTags, // raw engine — create-flows pass a tx to tag atomically with the insert
    getPostTags: (postId, db) => getTags("post", postId, db),
    setPostTags: (postId, category_keys, db) => setTags("post", postId, category_keys, db),
    getPromptTags: (promptId, db) => getTags("prompt", promptId, db),
    setPromptTags: (promptId, category_keys, db) => setTags("prompt", promptId, category_keys, db),
};
