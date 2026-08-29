// ============================================================================
// bracketSlots — the list of matches a field of N contestants produces, as the
// (round, side, position) coordinates the rest of the system already speaks.
//
// THIS IS THE SERVER'S COPY OF THE CLIENT'S BRACKET GEOMETRY, and the two MUST
// agree: Ongoing.jsx computes the same slots from the seeding to draw the board
// and to open a vote, debate_matches stores rows keyed on them, and (now) a
// typed debate hangs one prompt off each. If they disagree, a sponsor writes a
// prompt for a match that never renders.
//
// The rule, matching Ongoing.jsx exactly:
//   · the field is padded to the next power of two (a 12-person debate is a
//     16-slot bracket with 4 empty seats)
//   · the bracket is mirrored: `half` seats a side, each side playing
//     log2(half) rounds to produce one finalist
//   · round r on a side has half / 2^(r+1) matches
//   · the two finalists meet in ONE match, round log2(half), side 'final'
//
// A 16-field: 8 a side, 3 rounds a side (4 + 2 + 1 matches), plus the final —
// (4 + 2 + 1) × 2 + 1 = 15 matches, so 15 prompts.
// ============================================================================

const MIN_FIELD = 2;
// Every debate row is capped at 64 by max_contestants in practice; the guard is
// here so a nonsense number can't ask for a million prompt rows.
const MAX_FIELD = 256;

const nextPowerOfTwo = (n) => 2 ** Math.ceil(Math.log2(Math.max(n, MIN_FIELD)));

// labelFor — what the sponsor sees above the textarea. The last two rounds are
// named rather than numbered because "Semifinal" is what a person calls it, and
// a prompt written for "Round 3" of a 16-field is a prompt written blind.
const labelFor = (round, side, position, sideRounds) => {
    if (side === 'final') return 'The Final';
    const fromEnd = sideRounds - round; // 1 = semifinal, 2 = quarterfinal
    const sideWord = side === 'left' ? 'Left' : 'Right';
    const name =
        fromEnd === 1 ? 'Semifinal'
        : fromEnd === 2 ? 'Quarterfinal'
        : `Round ${round + 1}`;
    return `${name} · ${sideWord} · Match ${position + 1}`;
};

// roundHint — which bucket of the template bank a slot draws from. Derived from
// DISTANCE TO THE FINAL, not from the round number: round 1 of a 4-field is a
// semifinal and should read like one, while round 1 of a 32-field is an opener.
const hintFor = (round, side, sideRounds) => {
    if (side === 'final') return 'final';
    const fromEnd = sideRounds - round;
    return fromEnd <= 1 ? 'middle' : 'early';
};

/**
 * bracketSlots(fieldSize) -> [{ round, side, position, label, round_hint, key }]
 *
 * Ordered the way the bracket is played and the way the form should read it:
 * earliest round first, left before right, the final last.
 */
const bracketSlots = (fieldSize) => {
    const n = Number(fieldSize);
    if (!Number.isFinite(n) || n < MIN_FIELD) return [];
    const size = nextPowerOfTwo(Math.min(n, MAX_FIELD));
    const half = size / 2;
    // log2(half): 8 a side -> 3 rounds a side. A 2-person field has half === 1,
    // no side rounds at all, and goes straight to the final.
    const sideRounds = Math.round(Math.log2(half));

    const slots = [];
    for (let round = 0; round < sideRounds; round++) {
        const matches = half / 2 ** (round + 1);
        for (const side of ['left', 'right']) {
            for (let position = 0; position < matches; position++) {
                slots.push({
                    round,
                    side,
                    position,
                    label: labelFor(round, side, position, sideRounds),
                    round_hint: hintFor(round, side, sideRounds),
                    key: `${side}:${round}:${position}`,
                });
            }
        }
    }
    slots.push({
        round: sideRounds,
        side: 'final',
        position: 0,
        label: labelFor(sideRounds, 'final', 0, sideRounds),
        round_hint: 'final',
        key: `final:${sideRounds}:0`,
    });
    return slots;
};

// How many prompts a typed debate of this size needs. Always size - 1 — every
// match eliminates exactly one contestant, and the last one standing is the
// champion. Exposed separately because the form shows the number before it
// renders the fields.
const bracketMatchCount = (fieldSize) => bracketSlots(fieldSize).length;

const slotKey = (side, round, position) => `${side}:${round}:${position}`;

module.exports = { bracketSlots, bracketMatchCount, slotKey, nextPowerOfTwo };
