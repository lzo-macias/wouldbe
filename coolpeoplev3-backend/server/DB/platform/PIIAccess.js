const { client } = require("../index.js")


// logPIIAccess({accessedUserId,accessorUserId,role,fields,reason,method,ip,sessionId}) — Called by middleware on every admin PII read.

const logPIIAccess = async ({
    accessed_user_id,
    accessor_user_id,
    accessor_role,
    fields_accessed,
    access_reason,
    access_method,
    session_id,
    ip_address,
}) => {
    try{
        // id and accessed_at fall to their column defaults (uuid_generate_v4(),
        // now()). fields_accessed is jsonb, so stringify it — a raw JS array
        // would otherwise bind as a Postgres array, not JSON.
        const SQL = `
            INSERT INTO pii_access_log (
                accessed_user_id,
                accessor_user_id,
                accessor_role,
                fields_accessed,
                access_reason,
                access_method,
                session_id,
                ip_address
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8
            )
            RETURNING *;
        `

        const result = await client.query(SQL, [
            accessed_user_id,
            accessor_user_id,
            accessor_role,
            fields_accessed ? JSON.stringify(fields_accessed) : null,
            access_reason,
            access_method,
            session_id,
            ip_address,
        ])

        return result.rows[0]
    }catch(err){
        console.error(err)
        throw err
    }
}

// listPIIAccessEvents(filters) — By accessor, date, fields.
const listPIIAccessEventsV2 = async ({
    accessor_user_id,
    accessed_user_id,
    access_date_start,
    access_date_end,
    field,
    limit,
} = {}) => {
    try{
        const SQL = `
            SELECT *
            FROM pii_access_log
            WHERE ($1::uuid        IS NULL OR accessor_user_id = $1)
                AND ($2::uuid        IS NULL OR accessed_user_id = $2)
                AND ($3::timestamptz IS NULL OR accessed_at >= $3)
                AND ($4::timestamptz IS NULL OR accessed_at <= $4)
                AND ($5::text        IS NULL OR fields_accessed ? $5)
            ORDER BY accessed_at DESC
            LIMIT $6
        `

        const result = await client.query(SQL, [
            accessor_user_id ?? null,
            accessed_user_id ?? null,
            access_date_start ?? null,
            access_date_end ?? null,
            field ?? null,
            limit ?? 100,
        ])

        return result.rows
    }catch(err){
        console.error(err)
        throw err
    }
}

// getPIIAccessForUser(userId) — Per-user transparency.
const getPIIAccessForUser = async ({
    accessed_user_id
}) => {
    try{
        const SQL = `
            SELECT *
            FROM pii_access_log
            WHERE accessed_user_id = $1
            ORDER BY accessed_at DESC
        `

        const result = await client.query(SQL, [accessed_user_id])

        return result.rows

    }catch(err){
        console.error(err)
        throw err
    }
}

module.exports = {
    logPIIAccess,
    listPIIAccessEventsV2,
    getPIIAccessForUser
}
