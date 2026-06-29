/*
 * Open Civic Data (OCD) division-id helpers.
 *
 * The OCD id is THE cross-source key: geocodio, OpenStates, Census, Ballotpedia
 * and Google Civic all speak it. jurisdiction.ocd_division_id has a unique index,
 * so every jurisdiction we seed MUST carry one — that is what makes upserts
 * idempotent and lets the user→office match (user_jurisdictions ∩ office) work.
 *
 * Format: ocd-division/country:us/state:ny/cd:12
 * Layers are independent overlapping (cd / sldu / sldl / county / place / ...),
 * NOT a nesting tree — see the WouldBe-Update migration SECTION G.
 */

// slugify a free-text name into an OCD path segment ("Kings County" -> "kings")
const slug = (s) =>
    String(s)
        .toLowerCase()
        .replace(/\bcounty\b/g, '')
        .trim()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

const st = (state) => String(state).toLowerCase();

const ocd = {
    country: () => 'ocd-division/country:us',
    state: (s) => `ocd-division/country:us/state:${st(s)}`,
    // US House congressional district
    cd: (s, n) => `ocd-division/country:us/state:${st(s)}/cd:${n}`,
    // state legislature upper / lower chamber districts
    sldu: (s, n) => `ocd-division/country:us/state:${st(s)}/sldu:${n}`,
    sldl: (s, n) => `ocd-division/country:us/state:${st(s)}/sldl:${n}`,
    // county
    county: (s, name) => `ocd-division/country:us/state:${st(s)}/county:${slug(name)}`,
    // incorporated place / municipality
    place: (s, name) => `ocd-division/country:us/state:${st(s)}/place:${slug(name)}`,
    // sub-municipal council district (our convention, e.g. NYC council districts)
    councilDistrict: (s, placeName, n) =>
        `ocd-division/country:us/state:${st(s)}/place:${slug(placeName)}/council_district:${n}`,
    slug,
};

// State / territory → FIPS (also the 2-letter postal code list we seed against).
const STATE_FIPS = {
    AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09', DE: '10',
    DC: '11', FL: '12', GA: '13', HI: '15', ID: '16', IL: '17', IN: '18', IA: '19',
    KS: '20', KY: '21', LA: '22', ME: '23', MD: '24', MA: '25', MI: '26', MN: '27',
    MS: '28', MO: '29', MT: '30', NE: '31', NV: '32', NH: '33', NJ: '34', NM: '35',
    NY: '36', NC: '37', ND: '38', OH: '39', OK: '40', OR: '41', PA: '42', RI: '44',
    SC: '45', SD: '46', TN: '47', TX: '48', UT: '49', VT: '50', VA: '51', WA: '53',
    WV: '54', WI: '55', WY: '56',
};

module.exports = { ocd, slug, STATE_FIPS };
