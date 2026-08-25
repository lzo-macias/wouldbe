const { client } = require("../index.js")

// createDSR(data) — INSERT; deadline = received_at + 30 days.

const createDSRv2 = async ({
    user_id,
    request_type,
    legal_basis,
    status,
    verification_method,
}) => {
    try{
        const SQL = `
            INSERT INTO data_subject_requests (
                id,
                user_id,
                request_type,
                legal_basis,
                status,
                verification_method,
                received_at,
                statutory_deadline
            ) VALUES (
                uuid_generate_v4(),
                $1, $2, $3,
                COALESCE($4, 'received'),
                $5,
                NOW(),
                NOW() + INTERVAL '30 days'
            )
            RETURNING *;
        `
        const result = await client.query(SQL, [user_id, request_type, legal_basis, status, verification_method])
        return result.rows[0]
    }catch(err){
        console.error(err)
        throw err
    }
}

// getUserDSRs(userId) — User's history.

const getUserDSRsV2 = async ({
    user_id,
}) => {
    try{
        const SQL = `
            SELECT *
            FROM data_subject_requests
            WHERE user_id = $1
            ORDER BY received_at DESC
        `

        const result = await client.query(SQL, [user_id])

        return result.rows
    }catch(err){
        console.error(err)
        throw err
    }
}

// listPendingDSRs(filters) — Admin queue.

const listPendingDSRV2 = async ({
    status,
} = {}) => {
    try{
        const SQL = `
            SELECT *
            FROM data_subject_requests
            WHERE status IN ('received', 'verifying_identity', 'in_progress')
                AND ($1::text IS NULL OR status = $1)
            ORDER BY received_at DESC
        `

        const result = await client.query(SQL, [status ?? null])

        return result.rows
    }catch(err){
        console.error(err)
        throw err
    }
}

// updateDSR(id, patch) — Status + systems_processed JSONB.
const updateDSRV2 = async ({
    id,
    systems_processed,
    status,
}) => {
    try{
        const SQL = `
            UPDATE data_subject_requests
                SET
                    systems_processed = COALESCE($1, systems_processed),
                    status = COALESCE($2, status),
                    completed_at = CASE
                        WHEN $2 = 'completed' THEN COALESCE(completed_at, NOW())
                        ELSE completed_at
                    END
                WHERE id = $3
                RETURNING *;
        `

        const result = await client.query(SQL, [systems_processed, status, id])

        return result.rows[0]
    }catch(err){
        console.error(err)
        throw err
    }
}

// queueDSRJob(id) — Enqueue system_jobs job_type='dsr_deletion'.
const queueDSRJob = async ({
    dsr_id,
}) => {
    try {
        const SQL = `
            INSERT INTO system_jobs (
                job_type,
                target_resource_type,
                target_resource_id
            ) VALUES (
                'dsr_deletion',
                'data_subject_request',
                $1
            )
            RETURNING *;
        `

        const result = await client.query(SQL, [dsr_id])

        return result.rows[0]
    }catch(err){
        console.error(err)
        throw err
    }
}

// generateUserExport(dsrId) — Fulfills an 'access'/'portability' DSR: gathers
// the user's own data, writes a JSON archive to R2, stores the object key on
// the DSR, and returns a short-lived signed download URL.

// Tables holding the user's OWN data, paired with the column that points at
// them. These names are hardcoded (never user input), so interpolating them
// into the query text below is injection-safe.
//
// Deliberately EXCLUDED: investigative / security / audit / third-party tables
// (moderation_events, moderation_queue, csam_reports, child_safety_records,
// user_reports, user_strikes, account_actions, rate_limit_violations,
// coordinated_behavior_signals, pii_access_log, financial_audit_log,
// user_blocks, ...). These are commonly EXEMPT from access requests and some
// must not be disclosed — get legal sign-off before adding any of them.
const EXPORTABLE_TABLES = [
    { table: 'wouldbe', column: 'user_id' },
    { table: 'plan', column: 'user_id' },
    { table: 'pledges', column: 'pledger_user_id' },
    { table: 'follows', column: 'follower_id' },
    { table: 'sponsors', column: 'user_id' },
    { table: 'contestants', column: 'user_id' },
    { table: 'posts', column: 'author_user_id' },
    { table: 'post_endorsements', column: 'endorser_user_id' },
    { table: 'user_criteria_acknowledgments', column: 'user_id' },
    { table: 'comments', column: 'author_user_id' },
    { table: 'nominations', column: 'nominator_user_id' },
    { table: 'wouldbe_recommendations', column: 'recommender_user_id' },
    { table: 'debate_entries', column: 'user_id' },
    { table: 'debate_payments', column: 'user_id' },
    { table: 'debate_votes', column: 'voter_user_id' },
    { table: 'debate_final_round_ranked_votes', column: 'voter_user_id' },
    { table: 'prize_pool_contributions', column: 'contributor_user_id' },
    { table: 'prize_distributions', column: 'recipient_user_id' },
    { table: 'conversation_participants', column: 'user_id' },
    { table: 'messages', column: 'sender_user_id' },
    { table: 'tips', column: 'user_id' },
    { table: 'post_payments', column: 'user_id' },
    { table: 'subscriptions', column: 'user_id' },
    { table: 'subscription_payments', column: 'user_id' },
    { table: 'user_consents', column: 'user_id' },
    { table: 'user_attestations', column: 'user_id' },
    { table: 'content_items', column: 'user_id' },
    { table: 'moderation_appeals', column: 'user_id' },
    { table: 'candidate_committees', column: 'user_id' },
    { table: 'compliance_checks', column: 'user_id' },
    { table: 'testing_the_waters_campaigns', column: 'user_id' },
    { table: 'fundraising_eligibility_checks', column: 'user_id' },
    { table: 'contest_winners', column: 'user_id' },
    { table: 'tax_records', column: 'recipient_user_id' },
    { table: 'data_subject_requests', column: 'user_id' },
]

// Account columns safe to disclose. `password` is intentionally omitted.
const ACCOUNT_COLUMNS = `
    id, first_name, last_name, username, date_of_birth, state, city,
    zip_code, address, phone_number, email, political_lean,
    profile_photo_url, bio, is_active, last_login_at, created_at, updated_at
`

// Walk every exportable table and assemble one object keyed by table name.
// Queries run sequentially: a single pg Client can't run them concurrently.
const collectUserData = async (user_id) => {
    const account = await client.query(
        `SELECT ${ACCOUNT_COLUMNS} FROM users WHERE id = $1`,
        [user_id],
    )
    if (account.rows.length === 0) {
        throw new Error(`No user found for id ${user_id}`)
    }

    const data = { account: account.rows[0] }
    for (const { table, column } of EXPORTABLE_TABLES) {
        const { rows } = await client.query(
            `SELECT * FROM ${table} WHERE ${column} = $1`,
            [user_id],
        )
        data[table] = rows
    }
    return data
}

// Upload the JSON archive to R2 (S3-compatible) and return a signed URL.
//
// Requires deps not yet installed:
//   npm i @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
// and env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
//
// The SDK is required lazily so this module still loads before the deps exist.
// Short-lived: this links to a full-PII archive. The stable key is stored on
// the DSR, so regenerate a fresh URL on demand rather than handing out a long
// one. Bump only with a deliberate reason.
const EXPORT_URL_TTL_SECONDS = 60 * 60 // 1 hour

// A DSR may only be exported once identity has been verified. These are the
// statuses where verification has cleared and fulfillment is legitimate.
const VERIFIED_DSR_STATUSES = ['in_progress', 'completed', 'partially_completed']

const uploadExportToR2 = async (key, json) => {
    const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3')
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')

    const s3 = new S3Client({
        region: 'auto',
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: process.env.R2_ACCESS_KEY_ID,
            secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
    })

    await s3.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: key,
        Body: json,
        ContentType: 'application/json',
    }))

    // Presigned URLs expire, so we persist the stable key on the DSR (below)
    // and return a fresh short-lived URL the caller hands to the user.
    return getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }),
        { expiresIn: EXPORT_URL_TTL_SECONDS },
    )
}

const generateUserExport = async ({
    dsr_id,
}) => {
    try{
        // 1. Load the request and confirm it's an access/portability one.
        const dsr = await client.query(
            `SELECT id, user_id, request_type, status, verification_method
                FROM data_subject_requests WHERE id = $1`,
            [dsr_id],
        )
        if (dsr.rows.length === 0) {
            throw new Error(`No DSR found for id ${dsr_id}`)
        }
        const { user_id, request_type, status, verification_method } = dsr.rows[0]
        if (!['access', 'portability'].includes(request_type)) {
            throw new Error(
                `DSR ${dsr_id} is '${request_type}', not access/portability — nothing to export`,
            )
        }

        // GATE: never disclose a full PII archive until the requester's identity
        // has been verified. Both an explicit verification_method AND a status
        // past the verification stage are required.
        if (!verification_method || !VERIFIED_DSR_STATUSES.includes(status)) {
            throw new Error(
                `DSR ${dsr_id} is not identity-verified (status='${status}', ` +
                `verification_method='${verification_method ?? 'none'}') — refusing to export`,
            )
        }

        // 2. Gather the data and serialize it.
        const data = await collectUserData(user_id)
        const archive = JSON.stringify({
            generated_at: new Date().toISOString(),
            dsr_id,
            user_id,
            data,
        }, null, 2)

        // 3. Upload to R2 and get a signed download URL.
        const key = `exports/${user_id}/${dsr_id}-${Date.now()}.json`
        const signedUrl = await uploadExportToR2(key, archive)

        // 4. Persist the STABLE object key (not the expiring URL) on the DSR and
        //    mark it complete; completed_at is stamped once via COALESCE.
        const updated = await client.query(
            `UPDATE data_subject_requests
                SET export_url = $1,
                    status = 'completed',
                    completed_at = COALESCE(completed_at, NOW())
                WHERE id = $2
                RETURNING *`,
            [key, dsr_id],
        )

        return { request: updated.rows[0], download_url: signedUrl }
    }catch(err) {
        console.error(err)
        throw err
    }
}

module.exports = {
    createDSRv2,
    getUserDSRsV2,
    listPendingDSRV2,
    updateDSRV2,
    queueDSRJob,
    generateUserExport,
}