const crypto = require("crypto");
const express = require("express");

const {
    createCandidateCommittee,
    getUserCommittees,
    getCommitteeById,
    verifyCommitteeViaAPI,
    updateCommittee,
} = require("../../DB/candidacy/candidateCommittees");
const { client } = require("../../DB/index");
const { requireAuth, requireAttestation } = require("../../middleware");
const r2 = require("../../services/r2");

const router = express.Router();

// ============================================================================
// Filing-receipt uploads.
//
// A receipt is EVIDENCE, not content. It carries the candidate's legal name,
// committee details and often a home address, and its only audience is the
// candidate plus whoever reviews the filing. So this deliberately differs from
// the avatar / plan-image flows in three ways:
//
//   1. The object KEY is stored, not a public URL. Reads go through a
//      short-lived presigned GET (see the /receipt-url route), so there is no
//      permanent world-readable link to a legal document.
//   2. PDFs are allowed — most authorities email a PDF confirmation.
//   3. It does NOT enter the moderation pipeline. Running a nudity classifier
//      over a filing receipt is meaningless; the reviewer here is the admin
//      looking at the launch gate.
// ============================================================================
const RECEIPT_TYPES = {
    "application/pdf": "pdf",
    "image/webp": "webp",
    "image/jpeg": "jpg",
    "image/png": "png",
};
const MAX_RECEIPT_BYTES = 15 * 1024 * 1024;   // PDFs of scanned pages get large

// POST /api/committees/receipt-upload-url — presigned PUT for a filing receipt.
// Body: { contentType }. Declared BEFORE /committees/:id so "receipt-upload-url"
// isn't captured as an id.
//
// No :committeeId in the path: the receipt is usually uploaded while filling in
// the committee form, before the row exists. The key is scoped to the caller and
// bound to a committee when it's created or patched.
router.post("/committees/receipt-upload-url", requireAuth, async (req, res, next) => {
    try {
        const contentType = String(req.body?.contentType || "").toLowerCase();
        const ext = RECEIPT_TYPES[contentType];
        if (!ext) {
            return res.status(400).json({
                error: `contentType must be one of: ${Object.keys(RECEIPT_TYPES).join(", ")}`,
            });
        }
        const objectKey = `committee-receipts/${req.user.id}/${crypto.randomUUID()}.${ext}`;
        const uploadUrl = await r2.getUploadUrl({ key: objectKey, contentType });
        // NOTE: no publicUrl is returned, on purpose. Send objectKey back as
        // filing_receipt_object_key when you POST/PATCH the committee.
        return res.json({ uploadUrl, objectKey, maxBytes: MAX_RECEIPT_BYTES });
    } catch (err) {
        next(err);
    }
});

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

// GET /api/committees/:id/receipt-url — a short-lived link to VIEW the uploaded
// receipt. Owner or admin only.
//
// Issued per request rather than stored: a presigned GET expires, so a link that
// leaks (a shared screenshot, a logged URL, a forwarded email) stops working
// instead of exposing a legal document forever. This is the whole reason the
// column holds a key rather than a public URL.
router.get("/committees/:id/receipt-url", requireAuth, async (req, res, next) => {
    try {
        const committee = await getCommitteeById({ id: req.params.id });
        if (!committee) return res.status(404).json({ error: "committee not found" });

        // req.user carries no admin flag (findUserByToken selects 5 columns), so
        // check admin_users directly — the same source requireAdmin uses. We can't
        // just mount requireAdmin here because the OWNER must also pass.
        const isOwner = committee.user_id === req.user.id;
        let isAdmin = false;
        if (!isOwner) {
            const { rows } = await client.query(
                `SELECT 1 FROM admin_users
                  WHERE user_id = $1 AND status = 'active' AND terminated_at IS NULL`,
                [req.user.id]
            );
            isAdmin = rows.length > 0;
        }
        if (!isOwner && !isAdmin) {
            return res.status(403).json({ error: "You can only view your own filing receipt" });
        }
        if (!committee.filing_receipt_object_key) {
            return res.status(404).json({ error: "no uploaded receipt on this committee" });
        }

        const url = await r2.getDownloadUrl({
            key: committee.filing_receipt_object_key,
            expiresSeconds: 900,
        });
        return res.json({ url, expires_in_seconds: 900 });
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
