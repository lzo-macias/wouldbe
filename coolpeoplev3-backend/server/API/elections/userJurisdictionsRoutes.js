const express = require("express");

const {
    getUserJurisdictions,
    setUserJurisdictionsFromGeocode,
    setUserJurisdictionsFromCoords,
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

// POST /users/me/jurisdictions/resolve — the authed user resolves their OWN
// jurisdictions from an address. The address is a transient body param: geocoded
// in memory, used to derive district/state layers, then discarded (never stored;
// see setUserJurisdictionsFromGeocode, which NULLs address + coords). Returns
// { status: 'resolved' | 'pending_local' | 'needs_manual_pin', layers, council }.
router.post("/users/me/jurisdictions/resolve", authed, async (req, res, next) => {
    try {
        const result = await setUserJurisdictionsFromGeocode({
            userId: req.user.id,
            address: req.body?.address,
        });
        return res.json(result);
    } catch (err) {
        next(err);
    }
});

// POST /users/me/jurisdictions/resolve-coords — the MANUAL PIN fallback.
// Body: { lat, lng }.
//
// WHY IT EXISTS: /resolve returns 'needs_manual_pin' when a typed address
// geocodes below the accuracy floor, and the client then opens a map. Until now
// that map posted to this path and got a 404 — the only recovery route from a
// bad geocode dead-ended, leaving the user unable to resolve at all.
//
// The pin is NOT accuracy-gated: it is the user's own assertion of where they
// live, and bouncing it back would return them to the screen that sent them
// here. Layers are recorded with source='manual'.
//
// Same address policy as /resolve: the coordinates are used in-memory (they
// drive the council point-in-polygon) and never stored — the handler nulls
// users.address/latitude/longitude just as the address path does.
router.post("/users/me/jurisdictions/resolve-coords", authed, async (req, res, next) => {
    try {
        const result = await setUserJurisdictionsFromCoords({
            userId: req.user.id,
            lat: req.body?.lat,
            lng: req.body?.lng,
        });
        return res.json(result);
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
