const { client, withTransaction } = require("../index");


// listLegalDocs(filters) — Default: superseded_by_id IS NULL.

// getLegalDocById(id) — With body_hash + body_storage_url.

// getCurrentLegalDoc(docType, jurisdiction) — Current row matching scope.

// publishNewLegalDoc(data) — INSERT new + set old.superseded_by_id.

const listLegalDocs = async ({
    docType = null,
    currentOnly = true,
} = {}) => {
    try {
        const SQL = `
            SELECT
                id,
                doc_type,
                version,
                effective_date,
                body_hash,
                body_storage_url,
                jurisdiction_scope,
                superseded_by_id,
                created_at
            FROM legal_documents
            WHERE ($1::text IS NULL OR doc_type = $1)
              AND ($2::boolean = false OR superseded_by_id IS NULL)
            ORDER BY effective_date DESC
        `;
        const { rows } = await client.query(SQL, [docType, currentOnly]);
        return rows;
    } catch (err) {
        console.error(err);
        throw err;
    }
};

const getLegalDocById = async ({ id }) => {
    try {
        const SQL = `
            SELECT
                id,
                doc_type,
                version,
                effective_date,
                body_hash,
                body_storage_url,
                jurisdiction_scope,
                superseded_by_id,
                created_at
            FROM legal_documents
            WHERE id = $1
        `;
        const { rows } = await client.query(SQL, [id]);
        if (rows.length === 0) throw new Error("no legal doc found with this ID");
        return rows[0];
    } catch (err) {
        console.error(err);
        throw err;
    }
};

const getCurrentLegalDoc = async ({ docType, jurisdiction }) => {
    try {
        // jurisdiction_scope is JSONB; we treat it as an array of jurisdiction
        // codes like ["CA","NY","TX"]. The ? operator asks "does this JSONB
        // array/object contain `$2` as a top-level string element."
        // LIMIT 1 + ORDER BY effective_date DESC makes the result deterministic
        // if (somehow) two non-superseded rows match.
        const SQL = `
            SELECT
                id,
                doc_type,
                version,
                effective_date,
                body_hash,
                body_storage_url,
                jurisdiction_scope,
                superseded_by_id,
                created_at
            FROM legal_documents
            WHERE doc_type = $1
              AND jurisdiction_scope ? $2
              AND superseded_by_id IS NULL
            ORDER BY effective_date DESC
            LIMIT 1
        `;
        const { rows } = await client.query(SQL, [docType, jurisdiction]);
        if (rows.length === 0) throw new Error("no current legal doc for this type + jurisdiction");
        return rows[0];
    } catch (err) {
        console.error(err);
        throw err;
    }
};

// ============================================================================
// v2 — for comparison with publishNewLegalDoc above. Same intent, fixes applied.
// ============================================================================
const publishNewLegalDocV2 = async ({
    doc_type,
    version,
    effective_date,
    body_hash,
    body_storage_url,
    jurisdiction_scope,
}) => {
    try {
        return await withTransaction(async (tx) => {
            // Find the CURRENT live doc of this type (not every version ever).
            // Capture its id BEFORE inserting, so the new row doesn't show up here.
            const { rows: currentRows } = await tx.query(
                `SELECT id FROM legal_documents
                 WHERE doc_type = $1 AND superseded_by_id IS NULL
                 LIMIT 1`,
                [doc_type]
            );
            const previousId = currentRows[0]?.id ?? null;

            // Insert the new doc; RETURNING * so we actually get the row back.
            const { rows: insertedRows } = await tx.query(
                `INSERT INTO legal_documents (
                    id, doc_type, version, effective_date,
                    body_hash, body_storage_url, jurisdiction_scope, created_at
                 ) VALUES (
                    uuid_generate_v4(), $1, $2, $3, $4, $5, $6, NOW()
                 ) RETURNING *`,
                [doc_type, version, effective_date, body_hash, body_storage_url, jurisdiction_scope]
            );
            const newDoc = insertedRows[0];

            // If a prior live doc existed, point it at the new one.
            // (Old.superseded_by_id = New.id — flow is OLD → NEW, never NEW → NEW.)
            if (previousId) {
                await tx.query(
                    `UPDATE legal_documents SET superseded_by_id = $1 WHERE id = $2`,
                    [newDoc.id, previousId]
                );
            }

            return newDoc;
        });
    } catch (err) {
        if (err.status) throw err;
        console.error(err);
        throw err;
    }
};


module.exports = {
    listLegalDocs,
    getLegalDocById,
    getCurrentLegalDoc,
    publishNewLegalDocV2
};
