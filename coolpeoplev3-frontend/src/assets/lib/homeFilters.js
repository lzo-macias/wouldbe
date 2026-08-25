// ============================================================================
// homeFilters — the home feed's filter shape, shared by the control that edits
// it (HomeFilter) and the grid that fetches with it (Grid2x).
//
// In its own module, not exported from HomeFilter.jsx: a file that exports both
// components and plain values breaks React Fast Refresh, so editing the filter
// UI would force a full reload instead of a hot swap.
// ============================================================================

export const DEFAULT_FILTERS = {
    type: "all",            // all | wouldbes | debates
    contentious: false,     // no scoring algorithm yet — the control is disabled
    state: "",              // '' = anywhere
    prize: "any",           // any | cash | none   (debates only)
    leanMin: 1,
    leanMax: 10,
    myJurisdiction: false,
    goalSort: "none",       // none | goal_desc | goal_asc  (campaigns only)
}

export const US_STATES = [
    "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN",
    "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH",
    "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT",
    "VT","VA","WA","WV","WI","WY",
]

// How many knobs are off their default. Shown on the button so a filtered feed
// never looks like an empty one.
export const activeCount = (f) =>
    (f.type !== "all" ? 1 : 0) +
    (f.contentious ? 1 : 0) +
    (f.state ? 1 : 0) +
    (f.prize !== "any" ? 1 : 0) +
    (f.leanMin !== 1 || f.leanMax !== 10 ? 1 : 0) +
    (f.myJurisdiction ? 1 : 0) +
    (f.goalSort !== "none" ? 1 : 0)
