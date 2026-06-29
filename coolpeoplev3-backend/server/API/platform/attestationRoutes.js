const express = require("express")

const {
    recordAttestation,
    getUserActiveAttestations,
    getMissingAttestations,
    isAttestationCurrent,
    // isPledgeEligible
} = require("../../DB/platform/attestation")

const { requireAuth, captureRequestContext } = require("../../middleware")

const router = express.Router();

// POST /attestations — A, CTX. user_id + ip come from the session/request (never
// the body) and attested_at is stamped server-side — these are legal evidence.
router.post("/attestations", captureRequestContext, requireAuth, async (req, res, next) => {
    const {
        attestation_type,
        attested_value,
        attestation_version,
        context,
        expires_at,
        superseded_by_id
    } = req.body

    try{

        const attestation = await recordAttestation({
            user_id: req.user.id,
            attestation_type,
            attested_value,
            attestation_version,
            attested_at: new Date().toISOString(),
            ip_address: req.context.ip_address,
            context,
            expires_at,
            superseded_by_id
        })

        return res.status(201).json(attestation)

    }catch(err){
        console.error(err)
        next(err)
    }
})

router.get("/attestations/me", requireAuth, async (req, res, next) => {
    try {
        const myattestation = await getUserActiveAttestations({ user_id: req.user.id })

        return res.json(myattestation)
    }catch(err){
        console.error(err)
        next(err)
    }
})

router.get("/attestations/me/required/:context", requireAuth, async (req, res, next) => {
    const { context } = req.params

    try {
        const requiredattestation = await getMissingAttestations({ user_id: req.user.id, context })

        return res.json(requiredattestation)
    }catch(err){
        console.error(err)
        next(err)
    }
})

//(gate helpers) isAttestationCurrent ✅ · isPledgeEligible 🔲— 🔲

module.exports = { router }