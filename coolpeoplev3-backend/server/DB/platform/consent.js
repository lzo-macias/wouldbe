const { client } = require("../index.js")

// recordConsent(data) — INSERT; MUST capture ip + user_agent + method.

const recordConsent = async ({
    user_id,
    legal_document_id,
    consent_type,
    ip_address,
    user_agent,
    consent_method,
    context,
}) => {
    try {
        const SQL = `
            INSERT INTO user_consents (
                user_id,
                legal_document_id,
                consent_type,
                consented_at,
                ip_address,
                user_agent,
                consent_method,
                context
            ) VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7)
            RETURNING *;
        `
        const response = await client.query(SQL, [
            user_id,
            legal_document_id,
            consent_type,
            ip_address,
            user_agent,
            consent_method,
            // [CORRECTION] was `data_subject_requests.stringify(context)` (undefined → threw whenever
            // a context was supplied). This blocks the new push_debate/push_wouldbe consents, which
            // pass a context describing where the user consented. Fixed to JSON.stringify.
            context ? JSON.stringify(context) : null,
        ])

        return response.rows[0]

    } catch (err) {
        console.error(err)
        throw err;
    }
}


// withdrawConsent(userId, type, method) — INSERT new row with withdrawn_at=NOW(). Never UPDATE.

// --- Reference implementation for comparison ---
const withdrawConsentV2 = async ({
    user_id,
    consent_type,
    ip_address,
    user_agent,
    withdrawal_method,
    context,
}) => {
    try {
        const findActiveSQL = `
            SELECT legal_document_id, consented_at
            FROM user_consents
            WHERE user_id = $1
              AND consent_type = $2
              AND withdrawn_at IS NULL
            ORDER BY created_at DESC
            LIMIT 1;
        `
        const active = await client.query(findActiveSQL, [user_id, consent_type])
        if (active.rows.length === 0) {
            return null
        }
        const { legal_document_id, consented_at } = active.rows[0]

        const SQL = `
            INSERT INTO user_consents (
                user_id,
                legal_document_id,
                consent_type,
                consented_at,
                ip_address,
                user_agent,
                consent_method,
                withdrawn_at,
                withdrawal_method,
                context
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9)
            RETURNING *;
        `
        const response = await client.query(SQL, [
            user_id,
            legal_document_id,
            consent_type,
            consented_at,
            ip_address,
            user_agent,
            withdrawal_method,
            withdrawal_method,
            context ? JSON.stringify(context) : null,
        ])

        return response.rows[0]
    } catch (err) {
        console.error(err)
        throw err
    }
}


// getUserActiveConsents(userId) — Latest per (user_id, consent_type) where withdrawn_at IS NULL.

const getUserActiveConsents = async ({
    user_id,
    consent_type,
}) => {
    try{
        const CHECK_SQL = `
            SELECT *
            FROM user_consents
            WHERE user_id = $1
                AND consent_type = $2
            ORDER BY created_at DESC 
            LIMIT 1
        `
        const result = await client.query(CHECK_SQL, [user_id, consent_type])


        if (result.rows[0] && result.rows[0].withdrawn_at === null) {
            return result.rows[0]
        }else {
            console.log("no active consents found")
            return null
        }


    }catch(err){
        console.error(err)
        throw err
    }
}

// getUserConsentHistory(userId) — All rows ORDER BY created_at DESC.

const getUserConsentHistory = async ({
    user_id
}) => {
    try{
        const SQL = `
            SELECT * 
            FROM user_consents
            WHERE user_id = $1
            ORDER BY created_at DESC
        `

        const result = await client.query(SQL, [user_id])
        return result.rows
    }catch(err){
        console.error(err)
        throw err
    }
}

// ============================================================================
// Data-sale (CCPA "Do Not Sell") — modeled on user_consents, consent_type
// 'data_sale'. The product chose an OPT-IN model: a user is sellable ONLY while
// they hold an active (non-withdrawn) data_sale consent. "Opting out" therefore
// means withdrawing that consent (append-only). NEVER sell individual political
// data — listSellableUsers deliberately omits political_lean.
// ============================================================================
const DATA_SALE = "data_sale";

// recordSaleOptOut(...) — withdraw the user's active data_sale consent. Reuses
// withdrawConsentV2 so the withdrawal row preserves the original consented_at
// (append-only). `withdrawn` is null if nothing was active (already not sellable).
// CTX: pass ip_address/user_agent from the request.
const recordSaleOptOut = async ({
    user_id,
    ip_address,
    user_agent,
    withdrawal_method = "user_request",
    context,
}) => {
    const withdrawn = await withdrawConsentV2({
        user_id,
        consent_type: DATA_SALE,
        ip_address,
        user_agent,
        withdrawal_method,
        context,
    });
    return { user_id, opted_out: true, withdrawn };
};

// getUserSaleStatus(userId) — sellable iff the LATEST data_sale row is active.
const getUserSaleStatus = async ({ user_id }) => {
    try {
        const { rows } = await client.query(
            `SELECT consented_at, withdrawn_at, created_at
             FROM user_consents
             WHERE user_id = $1 AND consent_type = $2
             ORDER BY created_at DESC
             LIMIT 1`,
            [user_id, DATA_SALE]
        )
        const latest = rows[0] || null
        const sellable = !!(latest && latest.withdrawn_at === null)
        return { user_id, sellable, opted_out: !sellable, last_data_sale_consent: latest }
    } catch (err) {
        console.error(err)
        throw err
    }
}

// isUserSellable(userId) — boolean; an active data_sale consent exists.
const isUserSellable = async ({ user_id }) => {
    const active = await getUserActiveConsents({ user_id, consent_type: DATA_SALE })
    return !!active
}

// hasOptedOutOfSale(userId) — boolean; the latest data_sale row is a withdrawal.
const hasOptedOutOfSale = async ({ user_id }) => {
    try {
        const { rows } = await client.query(
            `SELECT withdrawn_at FROM user_consents
             WHERE user_id = $1 AND consent_type = $2
             ORDER BY created_at DESC
             LIMIT 1`,
            [user_id, DATA_SALE]
        )
        return !!(rows[0] && rows[0].withdrawn_at !== null)
    } catch (err) {
        console.error(err)
        throw err
    }
}

// listSellableUsers({limit,offset}) — users whose LATEST data_sale consent is
// active. NOTE: no political_lean — never sell individual political data.
const listSellableUsers = async ({ limit = 100, offset = 0 } = {}) => {
    try {
        const { rows } = await client.query(
            `SELECT u.id, u.first_name, u.last_name, u.email, u.state, u.created_at
             FROM users u
             JOIN (
                 SELECT DISTINCT ON (user_id) user_id, withdrawn_at
                 FROM user_consents
                 WHERE consent_type = $3
                 ORDER BY user_id, created_at DESC
             ) latest ON latest.user_id = u.id
             WHERE latest.withdrawn_at IS NULL AND u.is_active = true
             ORDER BY u.created_at DESC
             LIMIT $1 OFFSET $2`,
            [limit, offset, DATA_SALE]
        )
        return rows
    } catch (err) {
        console.error(err)
        throw err
    }
}

module.exports = {
    recordConsent,
    withdrawConsentV2,
    getUserActiveConsents,
    getUserConsentHistory,
    recordSaleOptOut,
    getUserSaleStatus,
    isUserSellable,
    hasOptedOutOfSale,
    listSellableUsers,
};