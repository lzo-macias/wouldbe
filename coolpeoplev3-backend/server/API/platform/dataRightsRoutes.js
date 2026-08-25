const express = require("express");

const {
    createDSRv2,
    getUserDSRsV2,
    listPendingDSRV2,
    updateDSRV2,
    queueDSRJob,
    generateUserExport,
} = require("../../DB/platform/dataRights");

const { requireAuth, requireAdmin, recordAdminAction, captureRequestContext, logPIIAccess } = require("../../middleware");

const router = express.Router();

const authed = [requireAuth];
const authedCtx = [captureRequestContext, requireAuth];
const adminAct = (action) => [requireAuth, requireAdmin(), recordAdminAction(action, { resourceType: "data_subject_request" })];

// POST /dsr — file a data-subject request (access/erasure/portability). Body:
// request_type, legal_basis, verification_method.
router.post("/dsr", authedCtx, async (req, res, next) => {
    try {
        const { request_type, legal_basis, status, verification_method } = req.body;
        const dsr = await createDSRv2({
            user_id: req.user.id,
            request_type,
            legal_basis,
            status,
            verification_method,
        });
        return res.status(201).json(dsr);
    } catch (err) {
        next(err);
    }
});

// GET /dsr/me — the authed user's requests.
router.get("/dsr/me", authed, async (req, res, next) => {
    try {
        return res.json(await getUserDSRsV2({ user_id: req.user.id }));
    } catch (err) {
        next(err);
    }
});

// GET /admin/dsr?status=open — the review queue.
router.get("/admin/dsr", [requireAuth, requireAdmin()], async (req, res, next) => {
    try {
        return res.json(await listPendingDSRV2({ status: req.query.status }));
    } catch (err) {
        next(err);
    }
});

// PATCH /admin/dsr/:id — update request state / systems processed.
router.patch("/admin/dsr/:id", adminAct("update_dsr"), async (req, res, next) => {
    try {
        const { systems_processed, status } = req.body;
        return res.json(await updateDSRV2({ id: req.params.id, systems_processed, status }));
    } catch (err) {
        next(err);
    }
});

// POST /admin/dsr/:id/process — enqueue the fulfillment job.
router.post("/admin/dsr/:id/process", adminAct("process_dsr"), async (req, res, next) => {
    try {
        return res.json(await queueDSRJob({ dsr_id: req.params.id }));
    } catch (err) {
        next(err);
    }
});

// GET /admin/dsr/:id/export — generate the user-data export (PII read → audited).
router.get(
    "/admin/dsr/:id/export",
    [requireAuth, requireAdmin(), logPIIAccess({ reason: "dsr_export", method: "dsr" })],
    async (req, res, next) => {
        try {
            return res.json(await generateUserExport({ dsr_id: req.params.id }));
        } catch (err) {
            next(err);
        }
    }
);

module.exports = { router };
