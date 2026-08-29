const express = require("express");

const { withTransaction } = require("../../DB/index.js");
const {
    listDebateMatches,
    getMatchById,
    getMatchTally,
    getOpenMatch,
    openMatchVoting,
    closeMatchVoting,
    setMatchWinner,
    castMatchVote,
} = require("../../DB/debate/debateMatches");
const { requireAuth } = require("../../middleware");
const { findUserByToken } = require("../../DB/platform/auth");

const router = express.Router();

// ============================================================================
// Bracket-match voting — the screen the host puts up mid-debate, and the ballot
// the room fills in.
//
// Host-only writes are gated inside the DB layer (assertHostCanRunVotes), not
// here: the same three checks — you are the sponsor, this debate is decided by
// the room, and it is live — apply to every one of them, and a gate that lives
// next to the SQL cannot be skipped by a new route that forgets to add it.
// ============================================================================

// _viewer — optional auth. A token widens the answer (your own ballot, the
// host's tally); no token still gets the public view, so the vote screen paints
// for a logged-out viewer who is then asked to sign in to actually vote.
const _viewer = async (req) => {
    if (!req.headers.authorization) return null;
    try {
        const user = await findUserByToken(req.headers.authorization);
        return user?.id ?? null;
    } catch {
        return null;
    }
};

// GET /api/debates/:debateId/matches — every match on record. This is what the
// bracket reads: winners are persisted, so a refresh shows the same board.
router.get("/debates/:debateId/matches", async (req, res, next) => {
    try {
        return res.json(await listDebateMatches({ debate_id: req.params.debateId }));
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        if (err.code === "22P02") return res.status(400).json({ error: "debateId must be a valid uuid" });
        next(err);
    }
});

// GET /api/debates/:debateId/matches/open — the ballot currently up, if any.
// Polled by every open page, so it stays one query per shape and returns
// { match: null } rather than a 404 when nothing is up — "no vote right now" is
// the normal answer, not an error.
router.get("/debates/:debateId/matches/open", async (req, res, next) => {
    try {
        return res.json(
            await getOpenMatch({
                debate_id: req.params.debateId,
                viewer_user_id: await _viewer(req),
            })
        );
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        if (err.code === "22P02") return res.status(400).json({ error: "debateId must be a valid uuid" });
        next(err);
    }
});

// POST /api/debates/:debateId/matches/open — HOST: put the vote screen up.
// Body: { round, side, position, contestant_a_id, contestant_b_id }.
//
// The bracket coordinates come from the client because the bracket's layout is
// computed there from the seeding; the contestants are re-checked server-side
// against this debate's roster, so a crafted body cannot seat a stranger.
router.post("/debates/:debateId/matches/open", requireAuth, async (req, res, next) => {
    try {
        const out = await withTransaction((tx) =>
            openMatchVoting(
                {
                    debate_id: req.params.debateId,
                    host_user_id: req.user.id,
                    round: req.body?.round,
                    side: req.body?.side,
                    position: req.body?.position,
                    contestant_a_id: req.body?.contestant_a_id,
                    contestant_b_id: req.body?.contestant_b_id,
                },
                tx
            )
        );
        return res.status(201).json(out);
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        // The partial unique index is the real enforcement of "one open ballot
        // per debate"; translate it into the same 409 the code path uses.
        if (err.code === "23505") {
            return res.status(409).json({ error: "a vote is already open for another match" });
        }
        next(err);
    }
});

// POST /api/debates/:debateId/matches/:matchId/close — HOST: take it down and
// decide. Body: { winner_contestant_id? } to break a tie in the same call.
//
// Closing the FINAL also crowns the debate (debate_results + the winner's
// contestant status + the debate closing), all inside this one transaction.
router.post("/debates/:debateId/matches/:matchId/close", requireAuth, async (req, res, next) => {
    try {
        const out = await withTransaction((tx) =>
            closeMatchVoting(
                {
                    match_id: req.params.matchId,
                    host_user_id: req.user.id,
                    winner_contestant_id: req.body?.winner_contestant_id ?? null,
                },
                tx
            )
        );
        // The tally goes back with it: the host closed the vote to see the
        // result, so making them fetch it separately is a round trip for nothing.
        const tally = await getMatchTally({ match_id: req.params.matchId });
        return res.json({ ...out, tally });
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        next(err);
    }
});

// POST /api/debates/:debateId/matches/:matchId/winner — HOST: break a tie, or
// correct a call, on a match that is already closed.
//
// In a transaction because settling the FINAL also crowns the debate: the result
// row, the contestant statuses and the debate's own status all move with it, and
// a half-applied crowning would leave a champion nobody is recorded as beating.
router.post("/debates/:debateId/matches/:matchId/winner", requireAuth, async (req, res, next) => {
    try {
        return res.json(
            await withTransaction((tx) =>
                setMatchWinner(
                    {
                        match_id: req.params.matchId,
                        host_user_id: req.user.id,
                        winner_contestant_id: req.body?.winner_contestant_id,
                    },
                    tx
                )
            )
        );
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        next(err);
    }
});

// POST /api/debates/:debateId/matches/:matchId/votes — the ballot.
// Body: { scores: [{ contestant_id, criterion_id, score }], comment?,
//         rules_version_seen?, voter_device_fingerprint? }
//
// The vote row and its scores are written in ONE transaction: a pick with no
// scores behind it would be a verdict with no stated reason, which is the thing
// this ballot exists to prevent. voter_ip comes from the request, never the body.
router.post("/debates/:debateId/matches/:matchId/votes", requireAuth, async (req, res, next) => {
    try {
        const out = await withTransaction((tx) =>
            castMatchVote(
                {
                    match_id: req.params.matchId,
                    voter_user_id: req.user.id,
                    scores: req.body?.scores,
                    // Typed debates send the pick; live ones derive it. The DB
                    // layer decides which rule applies from the debate's format,
                    // so sending this on a live debate changes nothing.
                    winner_contestant_id: req.body?.winner_contestant_id ?? null,
                    comment: req.body?.comment ?? null,
                    rules_version_seen: req.body?.rules_version_seen ?? null,
                    voter_ip: req.ip,
                    voter_device_fingerprint: req.body?.voter_device_fingerprint ?? null,
                },
                tx
            )
        );
        return res.status(201).json(out);
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        next(err);
    }
});

// GET /api/debates/:debateId/matches/:matchId/tally — the result.
//
// PUBLIC ONLY ONCE THE VOTE IS CLOSED. A running count on screen tells people
// which way the room is going before they score, which is precisely the pressure
// a per-criterion ballot is meant to remove. The host sees the live count
// through /matches/open, because they are the one deciding when it has run long
// enough.
router.get("/debates/:debateId/matches/:matchId/tally", async (req, res, next) => {
    try {
        const match = await getMatchById({ match_id: req.params.matchId });
        if (!match) return res.status(404).json({ error: "match not found" });
        if (match.voting_state !== "closed") {
            const viewerId = await _viewer(req);
            const { is_host } = await getOpenMatch({
                debate_id: match.debate_id,
                viewer_user_id: viewerId,
            });
            if (!is_host) {
                return res.status(403).json({ error: "the result is published when the host closes the vote" });
            }
        }
        return res.json({ match, ...(await getMatchTally({ match_id: req.params.matchId })) });
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        if (err.code === "22P02") return res.status(400).json({ error: "matchId must be a valid uuid" });
        next(err);
    }
});

module.exports = { router };
