/*
 * userJurisdictions.js — resolve a user's overlapping jurisdiction layers from
 * their address, WITHOUT ever persisting the address.
 *
 * Address policy (locked): the address is a function PARAMETER only. We geocode
 * it in memory, write the resolved OCD-ID layers to user_jurisdictions, store
 * lat/long on the user (for later point-in-polygon backfill), and NULL out
 * users.address. The address is never logged and never written.
 *
 * The hard case is the sub-municipal (city-council / school-trustee) layer, which
 * geocodio can't resolve — it needs point-in-polygon against a GeoJSON boundary
 * file. We don't always have that file at signup, so we branch on the PLACE's
 * council_structure (see 1780200000000 migration) and, when we owe a district,
 * record an explicit pending_local_resolution row to backfill later from coords.
 *
 *   geocode returns no incorporated place        -> no council owed
 *   place.council_structure = 'none'             -> no council owed
 *                           = 'at_large'         -> matches via the place layer
 *                           = 'districted' + loaded    -> point-in-polygon now
 *                           = 'districted' + !loaded    -> enqueue pending
 *                           = NULL (unknown)            -> enqueue pending
 */
const { client } = require('../index.js');
const { upsertJurisdictionV2 } = require('./jurisdictions.js');
const { ocd } = require('../../seed/reference/ocd.js'); // pure OCD-id builders, no side effects

// Geocodes below this accuracy are unreliable for jurisdiction assignment — we
// ask the user to drop a pin instead. (Industry default; matches the spec.)
const GEOCODE_ACCURACY_MIN = 0.8;

// ---------------------------------------------------------------------------
// Geocoding (in memory). Returns a normalized result; never persists anything.
// ---------------------------------------------------------------------------
async function geocodeAddress(address) {
    const key = process.env.GEOCODIO_API_KEY;
    if (!key) throw new Error('GEOCODIO_API_KEY missing in .env');
    const url = new URL('https://api.geocod.io/v1.7/geocode');
    url.searchParams.set('q', address);
    url.searchParams.set('fields', 'cd,stateleg,census'); // appends we resolve from
    url.searchParams.set('limit', '1');
    url.searchParams.set('api_key', key);

    const res = await fetch(url);
    if (!res.ok) throw new Error(`geocodio ${res.status} ${res.statusText}`);
    const data = await res.json();
    const r = data.results?.[0];
    if (!r) return { ok: false, accuracy: 0 };
    return { ok: true, ...normalizeGeocode(r) };
}

/*
 * reverseGeocode({ lat, lng }) — the PIN path's counterpart to geocodeAddress.
 *
 * Same appends, same normalizer, so both paths produce identical layer shapes.
 * The one deliberate difference is downstream: a pin is the user's own explicit
 * assertion of where they live, so it is NOT rejected on low accuracy the way a
 * typed address is. Rejecting it would send them back to the pin screen that
 * sent them here — the exact loop this path exists to break.
 */
async function reverseGeocode({ lat, lng }) {
    const key = process.env.GEOCODIO_API_KEY;
    if (!key) throw new Error('GEOCODIO_API_KEY missing in .env');
    const url = new URL('https://api.geocod.io/v1.7/reverse');
    url.searchParams.set('q', `${lat},${lng}`);
    url.searchParams.set('fields', 'cd,stateleg,census');
    url.searchParams.set('limit', '1');
    url.searchParams.set('api_key', key);

    const res = await fetch(url);
    if (!res.ok) throw new Error(`geocodio reverse ${res.status} ${res.statusText}`);
    const data = await res.json();
    const r = data.results?.[0];
    if (!r) return { ok: false, accuracy: 0 };
    // The normalizer reads r.location for coords; a reverse result echoes the
    // matched address's location, not the pin. Override with the PIN's own
    // coordinates so the council point-in-polygon tests where the user actually
    // pointed rather than the centroid of the nearest matched address.
    const norm = normalizeGeocode(r);
    return { ok: true, ...norm, lat, lng };
}

/*
 * Map a geocodio result → { accuracy, accuracy_type, lat, lng, state, place, layers }.
 * geocodio supplies ocd_id directly on congressional + state-leg districts; for
 * state/county/place we build the OCD-id from the components. CONFIRM the exact
 * field paths against https://geocod.io/docs — they're stable but version-tagged.
 */
function normalizeGeocode(r) {
    const f = r.fields || {};
    const comp = r.address_components || {};
    const state = comp.state; // 2-letter
    const census = f.census ? Object.values(f.census)[0] : null; // latest census year block
    const layers = [];

    // state (lets statewide offices match via the same intersection, uniformly)
    if (state) layers.push({ type: 'state', ocd_division_id: ocd.state(state), name: state });

    // county
    const countyName = census?.county_name || comp.county;
    if (state && countyName) {
        layers.push({ type: 'county', ocd_division_id: ocd.county(state, countyName), name: countyName });
    }

    // congressional district (geocodio gives ocd_id)
    const cd = f.congressional_districts?.[0];
    if (cd?.ocd_id) layers.push({ type: 'congressional_district', ocd_division_id: cd.ocd_id, name: cd.name });

    // state legislature — upper (senate) + lower (house)
    const sl = f.state_legislative_districts || {};
    const sldu = Array.isArray(sl.senate) ? sl.senate[0] : sl.senate;
    const sldl = Array.isArray(sl.house) ? sl.house[0] : sl.house;
    if (sldu?.ocd_id) layers.push({ type: 'state_leg_upper', ocd_division_id: sldu.ocd_id, name: sldu.name });
    if (sldl?.ocd_id) layers.push({ type: 'state_leg_lower', ocd_division_id: sldl.ocd_id, name: sldl.name });

    // incorporated place (municipality) — the council question hangs off this.
    // No place_name => unincorporated/rural => no municipal council exists.
    let place = null;
    const placeName = census?.place_name;
    if (state && placeName) {
        place = { type: 'municipal', ocd_division_id: ocd.place(state, placeName), name: placeName, state };
    }

    return {
        accuracy: r.accuracy ?? 0,
        accuracy_type: r.accuracy_type,
        lat: r.location?.lat,
        lng: r.location?.lng,
        state,
        place,
        layers,
    };
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

// create-on-miss: ensure a jurisdiction row exists for an OCD-id, return it.
async function ensureJurisdiction({ ocd_division_id, type, name, state_code, fips_code }) {
    return upsertJurisdictionV2({ name: name || ocd_division_id, type, ocd_division_id, state_code, fips_code });
}

// idempotent link of a user to a jurisdiction layer.
async function linkUserJurisdiction({ userId, jurisdictionId, source = 'geocodio', accuracy = null }) {
    await client.query(
        `
        INSERT INTO user_jurisdictions (user_id, jurisdiction_id, source, match_accuracy, geocoded_at)
        VALUES ($1, $2, $3, $4, now())
        ON CONFLICT (user_id, jurisdiction_id) DO UPDATE SET
            source = EXCLUDED.source, match_accuracy = EXCLUDED.match_accuracy,
            geocoded_at = EXCLUDED.geocoded_at, updated_at = now()
        `,
        [userId, jurisdictionId, source, accuracy]
    );
}

async function enqueuePending({ userId, placeJurisdictionId, reason }) {
    await client.query(
        `
        INSERT INTO pending_local_resolution (user_id, place_jurisdiction_id, reason)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id) DO UPDATE SET
            place_jurisdiction_id = EXCLUDED.place_jurisdiction_id, reason = EXCLUDED.reason
        `,
        [userId, placeJurisdictionId, reason]
    );
}

async function clearPending(userId) {
    await client.query(`DELETE FROM pending_local_resolution WHERE user_id = $1`, [userId]);
}

// ---------------------------------------------------------------------------
// The resolver
// ---------------------------------------------------------------------------

/*
 * setUserJurisdictionsFromGeocode({ userId, address })
 * Geocode in memory, write the resolvable layers, run the council branch, and
 * DISCARD the address (we also NULL users.address defensively). Returns a status
 * summary; on a low-accuracy geocode it writes nothing and asks for a pin.
 *
 * NOTE: writes are individually idempotent. The codebase shares a single pg
 * Client (server/DB/index.js), so we don't open an explicit transaction here;
 * a re-run after a partial failure simply converges. (Move to a Pool + tx when
 * you do — see the seeder's db.js for the pattern.)
 */
async function setUserJurisdictionsFromGeocode({ userId, address }) {
    const geo = await geocodeAddress(address);

    if (!geo.ok || geo.accuracy < GEOCODE_ACCURACY_MIN) {
        // unreliable — do NOT assign; prompt manual pin-drop (still no address stored)
        return { status: 'needs_manual_pin', accuracy: geo.accuracy ?? 0 };
    }

    // Persist NOTHING that can re-identify the user: NULL the address AND the
    // coordinates. We keep only the derived jurisdiction links (coarse district
    // ids). geo.lat/lng live only in-memory for the rest of this request (used by
    // resolveCouncil below) and are never written to the DB.
    // NOTE: dropping stored coords disables the deferred council backfill in
    // load-boundaries (it reads users.latitude/longitude, now always NULL) —
    // pending_local users are re-resolved via the by-state re-prompt flow instead.
    // Also set users.state from the geocode: statewide offices (US Senate,
    // Governor) match on users.state, not on jurisdiction links, so without this
    // the caller resolves districts but qualifies for no statewide seats.
    // COALESCE keeps any existing value if the geocode somehow lacks a state.
    await client.query(
        `UPDATE users SET geocoded_at = now(), geocode_accuracy = $2,
                          state = COALESCE($3, state),
                          address = NULL, latitude = NULL, longitude = NULL
         WHERE id = $1`,
        [userId, geo.accuracy, geo.state ?? null]
    );

    // resolvable layers (state/county/cd/sldu/sldl) — create-on-miss + link.
    for (const layer of geo.layers) {
        const j = await ensureJurisdiction({
            ocd_division_id: layer.ocd_division_id, type: layer.type,
            name: layer.name, state_code: geo.state,
        });
        await linkUserJurisdiction({ userId, jurisdictionId: j.id, accuracy: geo.accuracy });
    }

    // sub-municipal council layer (the four-way branch).
    const council = await resolveCouncil({ userId, place: geo.place, lat: geo.lat, lng: geo.lng, accuracy: geo.accuracy, source: 'geocodio' });

    return {
        status: council.status === 'pending' ? 'pending_local' : 'resolved',
        layers: geo.layers.map((l) => l.type),
        council,
        // address intentionally absent — never stored
    };
}

/*
 * setUserJurisdictionsFromCoords({ userId, lat, lng })
 *
 * The manual pin-drop path, used when a typed address geocoded below
 * GEOCODE_ACCURACY_MIN and returned 'needs_manual_pin'. Reverse-geocodes the
 * point, then writes the SAME layers through the SAME helpers as the address
 * path — the only differences are:
 *
 *   source = 'manual'  — the mapping came from the user, not from parsing an
 *                        address string. The check constraint on
 *                        user_jurisdictions.source already allows it, and this
 *                        is the first writer to use it.
 *   no accuracy gate   — see reverseGeocode. A pin cannot be "not accurate
 *                        enough"; it is the user's assertion.
 *
 * The address policy is unchanged: nothing identifying is stored. The pin's
 * coordinates live only in this request (they drive the council PIP) and
 * users.address/latitude/longitude are nulled exactly as the address path does.
 */
async function setUserJurisdictionsFromCoords({ userId, lat, lng }) {
    const latN = Number(lat);
    const lngN = Number(lng);
    // Reject out-of-range BEFORE spending a geocodio call. Note 0,0 is a valid
    // coordinate (Gulf of Guinea) but is the classic "unset variable" pin, and
    // it resolves to no US jurisdiction anyway — it falls out below as
    // 'no_match' rather than being special-cased here.
    if (!Number.isFinite(latN) || !Number.isFinite(lngN)) {
        const e = new Error('lat and lng must be numbers'); e.status = 400; throw e;
    }
    if (latN < -90 || latN > 90 || lngN < -180 || lngN > 180) {
        const e = new Error('lat/lng out of range'); e.status = 400; throw e;
    }

    const geo = await reverseGeocode({ lat: latN, lng: lngN });
    if (!geo.ok) return { status: 'no_match', reason: 'no_jurisdiction_at_point' };

    // Same write as the address path, including nulling address + coords.
    await client.query(
        `UPDATE users SET geocoded_at = now(), geocode_accuracy = $2,
                          state = COALESCE($3, state),
                          address = NULL, latitude = NULL, longitude = NULL
         WHERE id = $1`,
        [userId, geo.accuracy ?? null, geo.state ?? null]
    );

    for (const layer of geo.layers) {
        const j = await ensureJurisdiction({
            ocd_division_id: layer.ocd_division_id, type: layer.type,
            name: layer.name, state_code: geo.state,
        });
        await linkUserJurisdiction({
            userId, jurisdictionId: j.id, source: 'manual', accuracy: geo.accuracy ?? null,
        });
    }

    const council = await resolveCouncil({
        userId, place: geo.place, lat: latN, lng: lngN,
        accuracy: geo.accuracy ?? null, source: 'manual',
    });

    return {
        status: council.status === 'pending' ? 'pending_local' : 'resolved',
        layers: geo.layers.map((l) => l.type),
        council,
        // address intentionally absent — never stored
    };
}

/*
 * resolveCouncil — the explicit four-way branch on the place's council_structure.
 * Always links the user to the place layer first (so at-large councils + place-wide
 * offices match via the intersection without any PIP).
 */
async function resolveCouncil({ userId, place, lat, lng, accuracy, source = 'geocodio' }) {
    if (!place) return { status: 'none', reason: 'no_incorporated_place' };

    const placeRow = await ensureJurisdiction({
        ocd_division_id: place.ocd_division_id, type: 'municipal',
        name: place.name, state_code: place.state,
    });
    await linkUserJurisdiction({ userId, jurisdictionId: placeRow.id, accuracy, source });

    const structure = placeRow.council_structure; // 'districted' | 'at_large' | 'none' | null
    const loaded = placeRow.boundaries_loaded;

    if (structure === 'none') return { status: 'none', reason: 'place_has_no_council' };
    if (structure === 'at_large') return { status: 'at_large', reason: 'matches_via_place_layer' };

    if (structure === 'districted') {
        if (loaded) {
            // NOTE: no `source` here on purpose — assignCouncilByPIP records
            // 'imported', because the district itself comes from an imported
            // boundary file however the point was obtained.
            const assigned = await assignCouncilByPIP({ placeRow, lat, lng, userId, accuracy });
            await clearPending(userId);
            return assigned
                ? { status: 'assigned', ocd_division_id: assigned.ocd_division_id }
                : { status: 'unmatched', reason: 'point_in_no_polygon' };
        }
        await enqueuePending({ userId, placeJurisdictionId: placeRow.id, reason: 'boundaries_not_loaded' });
        return { status: 'pending', reason: 'boundaries_not_loaded' };
    }

    // structure unknown (NULL) — we don't yet know if this place is districted.
    await enqueuePending({ userId, placeJurisdictionId: placeRow.id, reason: 'place_structure_unknown' });
    return { status: 'pending', reason: 'place_structure_unknown' };
}

// ---------------------------------------------------------------------------
// Point-in-polygon (self-contained; no dependency)
// ---------------------------------------------------------------------------

// ray-casting test for a single linear ring [[lng,lat], ...]
function inRing(lng, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        const intersect = (yi > lat) !== (yj > lat) &&
            lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
        if (intersect) inside = !inside;
    }
    return inside;
}

// GeoJSON Polygon = [outerRing, hole1, ...]; point is in if in outer and in no hole.
function inPolygon(lng, lat, polygon) {
    if (!polygon.length || !inRing(lng, lat, polygon[0])) return false;
    for (let h = 1; h < polygon.length; h++) if (inRing(lng, lat, polygon[h])) return false;
    return true;
}

function pointInGeometry(lng, lat, geometry) {
    if (!geometry) return false;
    if (geometry.type === 'Polygon') return inPolygon(lng, lat, geometry.coordinates);
    if (geometry.type === 'MultiPolygon') return geometry.coordinates.some((p) => inPolygon(lng, lat, p));
    return false;
}

/*
 * Load a place's council-district boundaries from its GeoJSON file and return
 * [{ ocd_division_id, geometry }]. The file lives outside Postgres (R2/source);
 * boundary_source_url points at it. ASSUMPTION: each GeoJSON feature carries a
 * district number we can turn into an OCD-id; adjust the property name to your
 * file. Cache this in production (Redis) — it's per-place, not per-user.
 */
async function loadCouncilBoundaries(placeRow) {
    if (!placeRow.boundary_source_url) throw new Error(`place ${placeRow.id} has no boundary_source_url`);
    const res = await fetch(placeRow.boundary_source_url);
    if (!res.ok) throw new Error(`boundary fetch ${res.status} for place ${placeRow.id}`);
    const gj = await res.json();
    return (gj.features || []).map((feat) => {
        const p = feat.properties || {};
        // District number property — NYC Open Data (dataset 872g-cjhh) exposes it
        // as `coundist` (Socrata lowercases field names). Fallbacks for other cities.
        const districtNo = p.coundist ?? p.council_district ?? p.CounDist ?? p.district ?? p.DISTRICT;
        // Build the council OCD-id by APPENDING to the PLACE's own ocd_division_id —
        // NOT by re-slugifying placeRow.name. Re-slugifying the name diverges from the
        // seeded ids (e.g. name 'New York City' → 'new_york_city' ≠ seeded 'place:nyc'),
        // which would create duplicate jurisdictions instead of matching the seeded
        // council office. Appending to the place id guarantees the runtime id == the
        // seeded id, and generalizes to every future city.
        const ocdId = p.ocd_id || `${placeRow.ocd_division_id}/council_district:${districtNo}`;
        return { ocd_division_id: ocdId, district_no: districtNo, geometry: feat.geometry };
    });
}

// run PIP for one user's coords, link the containing council district.
async function assignCouncilByPIP({ placeRow, lat, lng, userId, accuracy, boundariesCache }) {
    const polys = boundariesCache || (await loadCouncilBoundaries(placeRow));
    const hit = polys.find((d) => pointInGeometry(lng, lat, d.geometry));
    if (!hit) return null;
    const j = await ensureJurisdiction({
        ocd_division_id: hit.ocd_division_id, type: 'city_council_district',
        name: `${placeRow.name} Council District ${hit.district_no}`, state_code: placeRow.state_code,
    });
    await linkUserJurisdiction({ userId, jurisdictionId: j.id, source: 'imported', accuracy });
    return { ocd_division_id: hit.ocd_division_id, jurisdiction_id: j.id };
}

// ---------------------------------------------------------------------------
// Retroactive backfill — run after ops loads a place's council boundaries.
// ---------------------------------------------------------------------------

/*
 * backfillLocalJurisdictions({ placeJurisdictionId })
 * For every user we owe a council district in this place, PIP their stored coords
 * → assign the district → delete the pending row (self-cleaning). No address,
 * no re-geocode — coordinates are all PIP needs.
 *
 * Precondition: the place must be marked 'districted' + boundaries_loaded
 * (use markPlaceCouncilStructure first).
 */
async function backfillLocalJurisdictions({ placeJurisdictionId }) {
    const { rows: [place] } = await client.query(`SELECT * FROM jurisdiction WHERE id = $1`, [placeJurisdictionId]);
    if (!place) throw new Error(`place ${placeJurisdictionId} not found`);
    if (place.council_structure !== 'districted' || !place.boundaries_loaded) {
        throw new Error(`place ${placeJurisdictionId} is not districted+loaded; mark it first`);
    }

    const polys = await loadCouncilBoundaries(place); // load once, reuse for all users
    const { rows: pending } = await client.query(
        `SELECT p.user_id, u.latitude, u.longitude
         FROM pending_local_resolution p
         JOIN users u ON u.id = p.user_id
         WHERE p.place_jurisdiction_id = $1`,
        [placeJurisdictionId]
    );

    let assigned = 0;
    let unmatched = 0;
    for (const row of pending) {
        if (row.longitude == null || row.latitude == null) { unmatched++; continue; }
        const hit = await assignCouncilByPIP({
            placeRow: place, lat: Number(row.latitude), lng: Number(row.longitude),
            userId: row.user_id, accuracy: null, boundariesCache: polys,
        });
        if (hit) { await clearPending(row.user_id); assigned++; }
        else unmatched++; // leave pending; coords didn't land in any district (investigate)
    }
    return { processed: pending.length, assigned, unmatched };
}

// ops setter: record a place's council structure (+ flip boundaries_loaded).
async function markPlaceCouncilStructure({ placeJurisdictionId, structure, boundariesLoaded, boundarySourceUrl }) {
    const { rows: [row] } = await client.query(
        `UPDATE jurisdiction SET
            council_structure = $2,
            boundaries_loaded = COALESCE($3, boundaries_loaded),
            boundaries_loaded_at = CASE WHEN $3 THEN now() ELSE boundaries_loaded_at END,
            boundary_source_url = COALESCE($4, boundary_source_url)
         WHERE id = $1 RETURNING *`,
        [placeJurisdictionId, structure ?? null, boundariesLoaded ?? null, boundarySourceUrl ?? null]
    );
    return row;
}

// worklist: who in this place are we still owing a council district?
async function getPendingLocalForPlace(placeJurisdictionId) {
    const { rows } = await client.query(
        `SELECT * FROM pending_local_resolution WHERE place_jurisdiction_id = $1 ORDER BY created_at`,
        [placeJurisdictionId]
    );
    return rows;
}

// getUserJurisdictions({ userId }) — the jurisdictions a user belongs to, joined
// to the jurisdiction reference so each row carries the three identifiers the UI
// queries by: id, name, state_code (+ type, ocd id, and how it was matched).
async function getUserJurisdictions({ userId }) {
    const { rows } = await client.query(
        `SELECT
            j.id,
            j.name,
            j.type,
            j.state_code,
            j.ocd_division_id,
            uj.source,
            uj.match_accuracy
         FROM user_jurisdictions uj
         JOIN jurisdiction j ON j.id = uj.jurisdiction_id
         WHERE uj.user_id = $1
         ORDER BY j.type`,
        [userId]
    );
    return rows;
}

// hasUserJurisdictions({ userId }) — cheap boolean source of truth: has this user
// completed the address→district resolution? True iff they have ANY
// user_jurisdictions row. Used to expose has_jurisdictions on the profile (/me)
// so the app can tell "resolved" from "not yet" without loading the full layers.
async function hasUserJurisdictions({ userId }) {
    const { rows } = await client.query(
        `SELECT EXISTS (SELECT 1 FROM user_jurisdictions WHERE user_id = $1) AS has`,
        [userId]
    );
    return rows[0].has;
}

// ---------------------------------------------------------------------------
// Notifier fan-out — who do we reach for an event scoped to a jurisdiction?
// The resolver links a user to EVERY layer they belong to (state→county→cd→
// place→council district), so a direct jurisdiction match usually suffices;
// the tree walk is for rolling a leaf-linked population up to an ancestor event.
// ---------------------------------------------------------------------------

// Minimal user fields a notifier needs (kept lean — no PII beyond contact).
const NOTIFY_USER_COLS = "u.id, u.email, u.username, u.first_name, u.last_name";

// findUsersInJurisdiction({ jurisdictionId }) — users linked directly to exactly
// this jurisdiction layer.
async function findUsersInJurisdiction({ jurisdictionId }) {
    const { rows } = await client.query(
        `SELECT DISTINCT ${NOTIFY_USER_COLS}
         FROM user_jurisdictions uj
         JOIN users u ON u.id = uj.user_id
         WHERE uj.jurisdiction_id = $1`,
        [jurisdictionId]
    );
    return rows;
}

// findUsersInJurisdictionTree({ jurisdictionId }) — users linked to this
// jurisdiction OR any of its descendants (recursive walk down parent_jurisdiction_id).
// Use for an event at a parent level when some users are only linked to child layers.
async function findUsersInJurisdictionTree({ jurisdictionId }) {
    const { rows } = await client.query(
        `WITH RECURSIVE tree AS (
            SELECT id FROM jurisdiction WHERE id = $1
            UNION ALL
            SELECT j.id FROM jurisdiction j
            JOIN tree t ON j.parent_jurisdiction_id = t.id
         )
         SELECT DISTINCT ${NOTIFY_USER_COLS}
         FROM user_jurisdictions uj
         JOIN tree t  ON t.id = uj.jurisdiction_id
         JOIN users u ON u.id = uj.user_id`,
        [jurisdictionId]
    );
    return rows;
}

// findUsersInState({ state }) — statewide fan-out straight off users.state
// (2-letter code), no jurisdiction join. Used for statewide offices/measures.
async function findUsersInState({ state }) {
    if (!state) return [];
    const { rows } = await client.query(
        `SELECT id, email, username, first_name, last_name
         FROM users
         WHERE state = $1`,
        [state.trim().toUpperCase()]
    );
    return rows;
}

// findJurisdictionsNearPoint({ lat, lng, radius }) — jurisdictions whose centroid
// (jurisdiction.latitude/longitude) lies within `radius` km of the point, nearest
// first. Haversine over stored centroids — an approximation pending real PostGIS
// boundary geometry; rows without coordinates are skipped.
async function findJurisdictionsNearPoint({ lat, lng, radius = 50 }) {
    if (lat == null || lng == null) return [];
    const { rows } = await client.query(
        `SELECT * FROM (
            SELECT
                j.*,
                6371 * acos(LEAST(1, GREATEST(-1,
                    cos(radians($1)) * cos(radians(j.latitude)) * cos(radians(j.longitude) - radians($2))
                    + sin(radians($1)) * sin(radians(j.latitude))
                ))) AS distance_km
            FROM jurisdiction j
            WHERE j.latitude IS NOT NULL AND j.longitude IS NOT NULL
         ) d
         WHERE d.distance_km <= $3
         ORDER BY d.distance_km ASC`,
        [lat, lng, radius]
    );
    return rows;
}

module.exports = {
    setUserJurisdictionsFromGeocode,
    setUserJurisdictionsFromCoords,
    backfillLocalJurisdictions,
    markPlaceCouncilStructure,
    getPendingLocalForPlace,
    getUserJurisdictions,
    hasUserJurisdictions,
    // notifier fan-out
    findUsersInJurisdiction,
    findUsersInJurisdictionTree,
    findUsersInState,
    findJurisdictionsNearPoint,
    // exposed for tests / reuse
    geocodeAddress,
    resolveCouncil,
    pointInGeometry,
};
