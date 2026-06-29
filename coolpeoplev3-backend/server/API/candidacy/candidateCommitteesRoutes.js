const express = require("express");

const {
    createCandidateCommittee,
    getUserCommittees,
    getCommitteeById,
    verifyCommitteeViaAPI,
    updateCommittee,
} = require("../../DB/candidacy/candidateCommittees");
const { requireAuth, requireAttestation } = require("../../middleware");

const router = express.Router();

// Ownership guard — a committee may only be read/mutated by the candidate who owns
// it. Loads the row once and stashes it on req for the handler to reuse.
const requireCommitteeOwner = async (req, res, next) => {
    try {
        const committee = await getCommitteeById({ id: req.params.id });
        if (!committee) return res.status(404).json({ error: "committee not found" });
        if (committee.user_id !== req.user.id) {
            return res.status(403).json({ error: "You can only access your own committee" });
        }
        req.committee = committee;
        next();
    } catch (err) {
        next(err);
    }
};

// POST /api/committees — file a committee (treasurer fields + filing receipt →
// registration_status='provisional_on_receipt'). Same candidate gate the WouldBe
// candidate path uses (us_citizen attestation).
router.post("/committees", requireAuth, requireAttestation("us_citizen"), async (req, res, next) => {
    try {
        const committee = await createCandidateCommittee({ ...req.body, user_id: req.user.id });
        return res.status(201).json(committee);
    } catch (err) {
        next(err);
    }
});

// GET /api/committees/me — the caller's committees.
router.get("/committees/me", requireAuth, async (req, res, next) => {
    try {
        return res.json(await getUserCommittees({ userId: req.user.id }));
    } catch (err) {
        next(err);
    }
});

// GET /api/committees/:id — one committee (owner only).
router.get("/committees/:id", requireAuth, requireCommitteeOwner, (req, res) => {
    return res.json(req.committee);
});

// POST /api/committees/:id/verify — confirm against the authority API
// (provisional → verified_active). Body may carry { verification_response,
// external_committee_id } until the live FEC/state client is wired.
router.post("/committees/:id/verify", requireAuth, requireCommitteeOwner, async (req, res, next) => {
    try {
        const out = await verifyCommitteeViaAPI({
            id: req.params.id,
            verification_response: req.body?.verification_response ?? null,
            external_committee_id: req.body?.external_committee_id ?? null,
        });
        return res.json(out);
    } catch (err) {
        next(err);
    }
});

// PATCH /api/committees/:id — update committee fields (owner only).
router.patch("/committees/:id", requireAuth, requireCommitteeOwner, async (req, res, next) => {
    try {
        return res.json(await updateCommittee({ ...req.body, id: req.params.id }));
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
