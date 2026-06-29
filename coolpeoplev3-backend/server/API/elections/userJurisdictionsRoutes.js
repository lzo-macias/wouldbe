const express = require("express");

const {
    getUserJurisdictions,
    setUserJurisdictionsFromGeocode,
    markPlaceCouncilStructure,
    backfillLocalJurisdictions,
} = require("../../DB/elections/userJurisdictions");

const { requireAuth, requireAdmin, requireInternal } = require("../../middleware");

const router = express.Router();

const authed = [requireAuth];
const adminOnly = [requireAuth, requireAdmin()];

// GET /users/me/jurisdictions — the authed user's resolved jurisdiction layers.
router.get("/users/me/jurisdictions", authed, async (req, res, next) => {
    try {
        const rows = await getUserJurisdictions({ userId: req.user.id });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// GET /users/:id/jurisdictions — admin view of any user's layers.
router.get("/users/:id/jurisdictions", adminOnly, async (req, res, next) => {
    try {
        const rows = await getUserJurisdictions({ userId: req.params.id });
        return res.json(rows);
    } catch (err) {
        next(err);
    }
});

// POST /internal/users/:id/regeocode — re-run the address→jurisdiction resolver.
// The address is a transient body param (geocoded in memory, never persisted).
router.post("/internal/users/:id/regeocode", requireInternal, async (req, res, next) => {
    try {
        const result = await setUserJurisdictionsFromGeocode({
            userId: req.params.id,
            address: req.body?.address,
        });
        return res.json(result);
    } catch (err) {
        next(err);
    }
});

// POST /internal/places/:placeId/load-boundaries — the reusable per-city ops step.
// Marks the place 'districted' + boundaries_loaded and points it at the council
// GeoJSON, then PIPs every pending user's stored coords (self-cleaning queue).
// Body: { boundarySourceUrl }. After this, NEW signups resolve their council
// district immediately at signup; pending users are backfilled here.
router.post("/internal/places/:placeId/load-boundaries", requireInternal, async (req, res, next) => {
    try {
        await markPlaceCouncilStructure({
            placeJurisdictionId: req.params.placeId,
            structure: "districted",
            boundariesLoaded: true,
            boundarySourceUrl: req.body?.boundarySourceUrl,
        });
        const result = await backfillLocalJurisdictions({ placeJurisdictionId: req.params.placeId });
        return res.json(result);
    } catch (err) {
        next(err);
    }
});

module.exports = { router };
