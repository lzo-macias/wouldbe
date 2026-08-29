// Shared derivations for the nomination board, which is rendered in more than
// one place across the app.
//
// Its own module because a component file that also exports a helper breaks
// React Fast Refresh — and because the rule below is read by the LIST (which
// re-ranks by points) and by the HEADER above it (which renames itself). Two
// copies of it is how a board ends up labelled "Nominations" while sorting by
// votes.

// votingStarted — has the first ballot landed on anyone in this debate?
// vote_points is the sum of the 1–5s a contestant has been given, so any value
// above zero means somebody has scored somebody.
export const votingStarted = (nominated = []) =>
    nominated.some((n) => (n.vote_points || 0) > 0)
