const { client, withTransaction } = require("../index.js");

// ============================================================================
// Tax records — per-recipient, per-year 1099 lifecycle (§14).
//
// WHY THIS EXISTS:
//  - Winners who receive > $600 in a tax year require an IRS information return
//    (1099-MISC / 1099-NEC). This table tracks the W-9 → form-generated →
//    form-sent → form-filed lifecycle for each recipient/year/form.
//  - Tax records have a 7-year retention and are EXEMPT from CCPA/GDPR deletion,
//    so this is a deliberately separate, durable record (NOT derived on the fly).
//
// SOURCES for computing taxable gross:
//   prize_distributions (the taxable disbursements), and — for completeness when
//   summing what a user received/paid — debate_payments, tips,
//   subscription_payments. NOTE: of these, only prize_distributions is income TO
//   the user; tips/debate_payments/subscription_payments are money the user PAID
//   (expenses), so computeUserYearGross treats prize_distributions as the
//   taxable gross and reports the others as informational context only.
//
// FORM/PDF GENERATION IS EXTERNAL. generate1099() records the intent + stamps
// form_generated_at, and leaves the actual PDF render as a TODO. We do not
// invent a PDF library.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// Mirrors the tax_records.form_type CHECK.
const FORM_TYPES = ["1099-MISC", "1099-NEC", "1099-K", "W-2"];

const TAX_COLS = `
    id, tax_year, recipient_user_id, form_type, gross_amount_cents,
    w9_received, w9_storage_url,
    form_generated_at, form_sent_at, form_filed_at, irs_acknowledgment, created_at
`;

const mapDbError = (err) => {
    if (err.status) return err;
    if (err.code === "23505") return httpError(409, "duplicate tax record");
    if (err.code === "23503") return httpError(400, "referenced row does not exist");
    if (err.code === "23514") return httpError(400, "invalid tax record (check constraint)");
    if (err.code === "22P02") return httpError(400, "invalid id/value format");
    return err;
};

// ---- writers ---------------------------------------------------------------

// upsertTaxRecord — create or update the record for a (recipient, year, form).
//
// NOTE: the table has no unique constraint on (recipient_user_id, tax_year,
// form_type), so we implement upsert manually inside a transaction: look for an
// existing matching row and UPDATE it, else INSERT. This keeps a single logical
// record per recipient/year/form without depending on a DB constraint we cannot
// add here.
//
//   { tax_year, recipient_user_id, form_type, gross_amount_cents,
//     w9_received?, w9_storage_url? }
const upsertTaxRecord = async ({
    tax_year,
    recipient_user_id,
    form_type,
    gross_amount_cents,
    w9_received,
    w9_storage_url,
} = {}) => {
    if (!tax_year || !Number.isInteger(Number(tax_year))) {
        throw httpError(400, "tax_year (integer) is required");
    }
    if (!recipient_user_id) throw httpError(400, "recipient_user_id is required");
    if (!form_type || !FORM_TYPES.includes(form_type)) {
        throw httpError(400, `form_type must be one of: ${FORM_TYPES.join(", ")}`);
    }
    if (gross_amount_cents === undefined || gross_amount_cents === null ||
        !Number.isFinite(Number(gross_amount_cents)) || Number(gross_amount_cents) < 0) {
        throw httpError(400, "gross_amount_cents (>= 0) is required");
    }

    try {
        return await withTransaction(async (tx) => {
            const existing = await tx.query(
                `SELECT id FROM tax_records
                  WHERE recipient_user_id = $1 AND tax_year = $2 AND form_type = $3
                  FOR UPDATE`,
                [recipient_user_id, tax_year, form_type]
            );

            if (existing.rows.length) {
                const upd = await tx.query(
                    `UPDATE tax_records
                        SET gross_amount_cents = $2,
                            w9_received = COALESCE($3, w9_received),
                            w9_storage_url = COALESCE($4, w9_storage_url)
                      WHERE id = $1
                      RETURNING ${TAX_COLS}`,
                    [
                        existing.rows[0].id,
                        String(gross_amount_cents),
                        w9_received === undefined ? null : !!w9_received,
                        w9_storage_url ?? null,
                    ]
                );
                return upd.rows[0];
            }

            const ins = await tx.query(
                `INSERT INTO tax_records
                   (tax_year, recipient_user_id, form_type, gross_amount_cents,
                    w9_received, w9_storage_url)
                 VALUES ($1,$2,$3,$4, COALESCE($5, false), $6)
                 RETURNING ${TAX_COLS}`,
                [
                    tax_year,
                    recipient_user_id,
                    form_type,
                    String(gross_amount_cents),
                    w9_received === undefined ? null : !!w9_received,
                    w9_storage_url ?? null,
                ]
            );
            return ins.rows[0];
        });
    } catch (err) {
        throw mapDbError(err);
    }
};

// attachW9ToTaxRecord — record that a W-9 was received + where it's stored.
//   { id, w9_storage_url }
const attachW9ToTaxRecord = async ({ id, w9_storage_url } = {}) => {
    if (!id) throw httpError(400, "id is required");
    if (!w9_storage_url) throw httpError(400, "w9_storage_url is required");
    try {
        const { rows } = await client.query(
            `UPDATE tax_records
                SET w9_received = true, w9_storage_url = $2
              WHERE id = $1
              RETURNING ${TAX_COLS}`,
            [id, w9_storage_url]
        );
        if (!rows.length) throw httpError(404, "tax record not found");
        return rows[0];
    } catch (err) {
        throw mapDbError(err);
    }
};

// generate1099 — record the intent to generate the form for a tax record and
// stamp form_generated_at. The actual PDF render is EXTERNAL.
//
// Requires a W-9 on file (you can't issue a 1099 without the recipient's TIN).
//   { id }
const generate1099 = async ({ id } = {}) => {
    if (!id) throw httpError(400, "id is required");
    try {
        return await withTransaction(async (tx) => {
            const cur = await tx.query(
                `SELECT ${TAX_COLS} FROM tax_records WHERE id = $1 FOR UPDATE`,
                [id]
            );
            const row = cur.rows[0];
            if (!row) throw httpError(404, "tax record not found");
            if (!row.w9_received) {
                throw httpError(409, "cannot generate 1099 without a W-9 on file");
            }

            // TODO: render the actual 1099 PDF from this row's data and upload it
            // to R2; persist the resulting storage url. No PDF library is wired
            // here — we only record the intent + the generated-at timestamp.

            const upd = await tx.query(
                `UPDATE tax_records
                    SET form_generated_at = now()
                  WHERE id = $1
                  RETURNING ${TAX_COLS}`,
                [id]
            );

            // TODO: emit 'tax_form_ready' so the recipient/notification + filing
            // pipeline can pick up the freshly generated form.

            return upd.rows[0];
        });
    } catch (err) {
        throw mapDbError(err);
    }
};

// mark1099Filed — stamp form_filed_at (and optionally the IRS acknowledgment).
//   { id, irs_acknowledgment? }
const mark1099Filed = async ({ id, irs_acknowledgment } = {}) => {
    if (!id) throw httpError(400, "id is required");
    try {
        const { rows } = await client.query(
            `UPDATE tax_records
                SET form_filed_at = now(),
                    irs_acknowledgment = COALESCE($2, irs_acknowledgment)
              WHERE id = $1
              RETURNING ${TAX_COLS}`,
            [id, irs_acknowledgment ?? null]
        );
        if (!rows.length) throw httpError(404, "tax record not found");
        return rows[0];
    } catch (err) {
        throw mapDbError(err);
    }
};

// ---- reads -----------------------------------------------------------------

// listTaxRecords — admin view. All filters optional.
//   { tax_year, recipient_user_id, form_type, w9_received, filed (bool),
//     limit (default 100, max 500), offset }
const listTaxRecords = async ({
    tax_year = null,
    recipient_user_id = null,
    form_type = null,
    w9_received = null,
    filed = null,
    limit = 100,
    offset = 0,
} = {}) => {
    if (form_type && !FORM_TYPES.includes(form_type)) {
        throw httpError(400, `form_type must be one of: ${FORM_TYPES.join(", ")}`);
    }
    const lim = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
    const off = Math.max(parseInt(offset, 10) || 0, 0);

    try {
        const { rows } = await client.query(
            `SELECT ${TAX_COLS}
               FROM tax_records
              WHERE ($1::integer IS NULL OR tax_year = $1)
                AND ($2::uuid IS NULL OR recipient_user_id = $2)
                AND ($3::text IS NULL OR form_type = $3)
                AND ($4::boolean IS NULL OR w9_received = $4)
                AND ($5::boolean IS NULL OR (form_filed_at IS NOT NULL) = $5)
              ORDER BY tax_year DESC, created_at DESC
              LIMIT $6 OFFSET $7`,
            [tax_year, recipient_user_id, form_type, w9_received, filed, lim, off]
        );
        return rows;
    } catch (err) {
        throw mapDbError(err);
    }
};

// computeUserYearGross — sum the user's taxable income for a year across the
// source tables. Income TO the user is prize_distributions; the other tables are
// money the user PAID, so they're returned as informational context (not added
// to taxable_gross). Only SUCCEEDED/PAID/disbursed rows count.
//   { user_id, year }
const computeUserYearGross = async ({ user_id, year } = {}) => {
    if (!user_id) throw httpError(400, "user_id is required");
    if (!year || !Number.isInteger(Number(year))) {
        throw httpError(400, "year (integer) is required");
    }

    try {
        // Taxable income: prizes actually disbursed in the year.
        const prizes = await client.query(
            `SELECT COALESCE(SUM(amount_cents), 0)::bigint AS total, COUNT(*)::int AS n
               FROM prize_distributions
              WHERE recipient_user_id = $1
                AND disbursed_at IS NOT NULL
                AND EXTRACT(YEAR FROM disbursed_at) = $2`,
            [user_id, year]
        );

        // Informational: money the user PAID in the year (not taxable income).
        const tips = await client.query(
            `SELECT COALESCE(SUM(tip_amount_cents), 0)::bigint AS total, COUNT(*)::int AS n
               FROM tips
              WHERE user_id = $1 AND status = 'succeeded'
                AND charged_at IS NOT NULL AND EXTRACT(YEAR FROM charged_at) = $2`,
            [user_id, year]
        );
        const debatePayments = await client.query(
            `SELECT COALESCE(SUM(amount_cents), 0)::bigint AS total, COUNT(*)::int AS n
               FROM debate_payments
              WHERE user_id = $1 AND status = 'succeeded'
                AND charged_at IS NOT NULL AND EXTRACT(YEAR FROM charged_at) = $2`,
            [user_id, year]
        );
        const subPayments = await client.query(
            `SELECT COALESCE(SUM(amount_cents), 0)::bigint AS total, COUNT(*)::int AS n
               FROM subscription_payments
              WHERE user_id = $1 AND status = 'paid'
                AND paid_at IS NOT NULL AND EXTRACT(YEAR FROM paid_at) = $2`,
            [user_id, year]
        );

        const num = (r) => Number(r.rows[0].total);

        return {
            user_id,
            year: Number(year),
            // The figure that drives the 1099 threshold ($600).
            taxable_gross_cents: num(prizes),
            prize_distributions: { total_cents: num(prizes), count: prizes.rows[0].n },
            // Money paid by the user — informational, NOT part of taxable_gross.
            payments_made: {
                tips: { total_cents: num(tips), count: tips.rows[0].n },
                debate_payments: { total_cents: num(debatePayments), count: debatePayments.rows[0].n },
                subscription_payments: { total_cents: num(subPayments), count: subPayments.rows[0].n },
            },
        };
    } catch (err) {
        throw mapDbError(err);
    }
};

module.exports = {
    FORM_TYPES,
    upsertTaxRecord,
    listTaxRecords,
    attachW9ToTaxRecord,
    generate1099,
    mark1099Filed,
    computeUserYearGross,
};
