const express = require("express");

const {
    createSponsor,
    getSponsorById,
    updateSponsor,
    setSponsorMarketingConsent,
    verifySponsor,
    getSponsorDebates,
} = require("../../DB/debate/sponsors");
const { requireAuth, requireAdmin, recordAdminAction } = require("../../middleware");

const router = express.Router();

// Load the sponsor and confirm the caller owns it (for mutating routes).
const requireSponsorOwner = async (req, res, next) => {
    try {
        const sponsor = await getSponsorById({ id: req.params.id });
        if (!sponsor) return res.status(404).json({ error: "sponsor not found" });
        if (sponsor.user_id !== req.user.id) {
            return res.status(403).json({ error: "You can only manage your own sponsor profile" });
        }
        req.sponsor = sponsor;
        next();
    } catch (err) {
        next(err);
    }
};

// POST /api/sponsors — register a sponsor profile for the caller.
router.post("/sponsors", requireAuth, async (req, res, next) => {
    try {
        const sponsor = await createSponsor({ ...req.body, user_id: req.user.id });
        return res.status(201).json(sponsor);
    } catch (err) {
        next(err);
    }
});

// GET /api/sponsors/:id — one sponsor (public).
router.get("/sponsors/:id", async (req, res, next) => {
    try {
        const sponsor = await getSponsorById({ id: req.params.id });
        if (!sponsor) return res.status(404).json({ error: "sponsor not found" });
        return res.json(sponsor);
    } catch (err) {
        next(err);
    }
});

// PATCH /api/sponsors/:id — owner edits fields. A `marketing_consent` boolean in
// the body also stamps/clears marketing_consent_at.
router.patch("/sponsors/:id", requireAuth, requireSponsorOwner, async (req, res, next) => {
    try {
        let sponsor = await updateSponsor({ ...req.body, id: req.params.id });
        if (req.body?.marketing_consent !== undefined) {
            sponsor = await setSponsorMarketingConsent({ id: req.params.id, consented: req.body.marketing_consent });
        }
        return res.json(sponsor);
    } catch (err) {
        next(err);
    }
});

// POST /api/sponsors/:id/verify — admin verifies (or revokes) the sponsor.
router.post(
    "/sponsors/:id/verify",
    requireAuth,
    requireAdmin(),
    recordAdminAction("verify_sponsor", { resourceType: "sponsor" }),
    async (req, res, next) => {
        try {
            const verified = req.body?.verified ?? true;
            return res.json(await verifySponsor({ id: req.params.id, verified }));
        } catch (err) {
            next(err);
        }
    }
);

// GET /api/sponsors/:id/debates — debates this sponsor posted (public).
router.get("/sponsors/:id/debates", async (req, res, next) => {
    try {
        return res.json(await getSponsorDebates({ sponsor_id: req.params.id }));
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
