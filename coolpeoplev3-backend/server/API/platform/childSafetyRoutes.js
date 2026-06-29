const express = require("express")

const {
    getChildSafetyRecord,
    featuresRestrictedFor,
    recordParentalConsent,
    submitAgeVerification,
} = require("../../DB/platform/childSafety")

const { requireAuth, captureRequestContext } = require("../../middleware")

const router = express.Router()

const authed = [requireAuth]
const authedCtx = [captureRequestContext, requireAuth]

// GET /child-safety/me — the authed user's child-safety record + the features
// currently restricted for their age band.
router.get("/child-safety/me", authed, async (req, res, next) => {
    try {
        const [record, restricted] = await Promise.all([
            getChildSafetyRecord({ user_id: req.user.id }),
            featuresRestrictedFor({ user_id: req.user.id }),
        ])
        return res.json({ record: record ?? null, features_restricted: restricted ?? null })
    } catch (err) {
        next(err)
    }
})

// POST /child-safety/parental-consent — record guardian consent for a minor.
router.post("/child-safety/parental-consent", authedCtx, async (req, res, next) => {
    try {
        const { parental_consent_method, parental_email, features_restricted, verified_at, verified_by } = req.body
        const record = await recordParentalConsent({
            user_id: req.user.id,
            parental_consent_method,
            parental_email,
            features_restricted,
            verified_at,
            verified_by,
        })
        if (!record) return res.status(404).json({ error: "no child-safety record for this user" })
        return res.json(record)
    } catch (err) {
        next(err)
    }
})

// POST /child-safety/verify-age — submit an age-verification result.
router.post("/child-safety/verify-age", authed, async (req, res, next) => {
    try {
        const { age_verification_method, age_verified_value } = req.body
        const record = await submitAgeVerification({
            user_id: req.user.id,
            age_verification_method,
            age_verified_value,
        })
        if (!record) return res.status(404).json({ error: "no child-safety record for this user" })
        return res.json(record)
    } catch (err) {
        next(err)
    }
})

module.exports = { router }
