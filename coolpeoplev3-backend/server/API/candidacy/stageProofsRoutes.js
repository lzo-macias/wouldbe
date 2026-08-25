const express = require("express");

const { client } = require("../../DB/index");
const { submitStageProof, verifyStageProof, getProofsForComponent, listPendingProofs } = require("../../DB/candidacy/stageProofs");
const { requireAuth, requireAdmin, recordAdminAction } = require("../../middleware");

const router = express.Router();

// POST /api/stages/:componentId/proof — the WouldBe owner submits proof for a
// stage (committee acceptance, candidate filing, …). Owner-only.
// Body: { proof_tier, source?, milestone_type?, verify_method?,
//         uploaded_document_url?, extracted_fields?, attestation_statement? }
router.post("/stages/:componentId/proof", requireAuth, async (req, res, next) => {
    try {
        const own = await client.query(
            `SELECT w.user_id FROM plan_timeline_components c
             JOIN plan_timeline pt ON pt.id = c.plan_timeline_id
             JOIN plan p ON p.id = pt.plan_id
             JOIN wouldbe w ON w.id = p.wouldbe_id
             WHERE c.id = $1`,
            [req.params.componentId]
        );
        if (!own.rows.length) return res.status(404).json({ error: "stage not found" });
        if (own.rows[0].user_id !== req.user.id) {
            return res.status(403).json({ error: "You can only submit proof for your own WouldBe" });
        }
        const proof = await submitStageProof({
            ...req.body,
            componentId: req.params.componentId,
            submitterUserId: req.user.id,
        });
        return res.status(201).json(proof);
    } catch (err) {
        next(err);
    }
});

// GET /api/stages/:componentId/proofs — proofs submitted for a stage.
router.get("/stages/:componentId/proofs", requireAuth, async (req, res, next) => {
    try {
        return res.json(await getProofsForComponent(req.params.componentId));
    } catch (err) {
        next(err);
    }
});

// GET /api/admin/stage-proofs?wouldbe_id=&limit= — the pending-proof review queue.
router.get("/admin/stage-proofs", requireAuth, requireAdmin(), async (req, res, next) => {
    try {
        return res.json(await listPendingProofs({ wouldbe_id: req.query.wouldbe_id, limit: req.query.limit }));
    } catch (err) {
        next(err);
    }
});

// POST /api/admin/stage-proofs/:id/verify — admin verifies/rejects a proof.
// 'verified' clears that gate and auto-opens the next stage. Body: { decision, notes?, cross_check_result? }
router.post(
    "/admin/stage-proofs/:id/verify",
    requireAuth,
    requireAdmin(),
    recordAdminAction("verify_stage_proof", { resourceType: "stage_proof" }),
    async (req, res, next) => {
        try {
            const out = await verifyStageProof({
                proofId: req.params.id,
                decision: req.body?.decision,
                verified_by: "admin_review",
                notes: req.body?.notes,
                cross_check_result: req.body?.cross_check_result,
            });
            return res.json(out);
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
