const { client, withTransaction } = require("../index.js");

// ============================================================================
// STANDING ARROWS — the app's one earned currency, and what it buys.
//
// TWO WAYS TO EARN ONE, deliberately unlike each other:
//
//   WINNING A DEBATE      one arrow, streamed or written, once per debate. The
//                         obvious one, and the one that means you beat people.
//
//   TOPPING A FOR-FUN     one arrow to whoever has the most likes on a for-fun
//   PROMPT                prompt a month after it opened — AND one to anybody
//                         who held the top spot and was dethroned along the
//                         way. Capped at one per person per for-fun debate.
//
// WHY THE DETHRONED KEEP THEIRS. The month is a window, not a race to the last
// second: an answer that led for three weeks and lost on the final day was read
// and liked by more people than most winners ever reach. Awarding only the
// survivor would make the sensible move "post late", which is the opposite of
// what the window is for. The cap is what stops that generosity becoming a
// farm — you can be dethroned and retake the lead ten times and still have one.
//
// WHAT A HUNDRED BUYS: the right to answer ANY typed match that has written
// responses, including matches you are not in. That is the backdoor, and it is
// priced high on purpose — a hundred arrows is a long history of winning
// debates and writing answers people liked, which is exactly the person whose
// uninvited argument is worth reading.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// THE GATE IS NOT ONE NUMBER — it scales with what is at stake.
//
// A hundred arrows is the right price for walking into a debate with nothing on
// it. It is plainly the wrong price for walking into one with five thousand
// dollars on it and forty people nominated, where a seat is worth real money and
// the two contestants earned theirs by being nominated more than anybody else.
// A flat threshold means the backdoor is cheapest exactly where it costs the
// most to be displaced through.
//
// So the floor is the base, and two things raise it:
//
//   THE PRIZE     — what the seat is worth. Money is why a displacement stings,
//                   so money is what the door costs.
//   THE FIELD     — how many separate people were nominated. A debate forty
//                   people were put forward for is one the room cared about
//                   selecting; arriving sideways past all of them should cost
//                   more than arriving past three.
//
// FOR FUN IS FREE. Nothing is at stake, the debate is open to everyone anyway,
// and anybody who wanted in could simply have entered — a toll on the back door
// of an unlocked building is just an annoyance.
//
// The numbers are constants rather than a formula buried in a query precisely
// because they are a product decision and will be tuned. Changing one here
// changes the door, the UI's "you need N", and the price quote together.
const OPEN_RESPONSE_THRESHOLD = 100;     // the floor, for a debate with no cash
const ARROWS_PER_100_DOLLARS = 5;        // + per $100 of prize pool
const ARROWS_PER_NOMINEE = 2;            // + per separately-nominated person
const OPEN_RESPONSE_CEILING = 1000;      // however rich, the door has a top

// ---------------------------------------------------------------------------
// what a bought arrow costs
// ---------------------------------------------------------------------------
//
// PROGRESSIVE TIERS, not brackets. The rate falls as you buy more, but each
// tier prices only the arrows INSIDE it — like a tax band, not like a discount
// code.
//
// The difference is not academic. Priced by flat bracket, 24 arrows at $2.00 is
// $48.00 and 25 at $1.75 is $43.75: buying MORE costs LESS, and a calculator
// built on that would keep telling people to add arrows they did not want. A
// price that falls as the quantity rises is a bug, and progressive tiers make
// it structurally impossible — every additional arrow costs something, and
// never more than the one before it.
//
// The first tier is deliberately steep against the earn rate: an arrow is a
// whole debate won, and buying is meant to be a shortcut for somebody
// impatient, not a cheaper path than competing.
const ARROW_TIERS = [
    { upto: 24, cents: 200 },    // the first two dozen
    { upto: 99, cents: 175 },    // 25–99
    { upto: 249, cents: 150 },   // 100–249
    { upto: Infinity, cents: 125 },
];

// The headline rate, still exported because it is what a UI quotes before
// anybody has chosen a quantity.
const ARROW_PRICE_CENTS = ARROW_TIERS[0].cents;

// priceArrows — what N arrows cost, and how that total was reached.
//
// Returns the per-tier breakdown as well as the total, because a calculator
// that shows only a number cannot explain why 100 costs less per arrow than 20,
// and "it's cheaper in bulk" is the one thing about this price worth knowing.
const priceArrows = (quantity) => {
    const n = Math.max(0, Math.floor(Number(quantity) || 0));
    const lines = [];
    let total = 0;
    let counted = 0;
    for (const tier of ARROW_TIERS) {
        if (counted >= n) break;
        const capacity = tier.upto === Infinity ? Infinity : tier.upto - counted;
        const take = Math.min(n - counted, capacity);
        if (take <= 0) continue;
        lines.push({
            quantity: take,
            unit_price_cents: tier.cents,
            subtotal_cents: take * tier.cents,
            from: counted + 1,
            to: counted + take,
        });
        total += take * tier.cents;
        counted += take;
    }
    return {
        quantity: n,
        amount_cents: total,
        // The blended rate — what each arrow actually cost on average. This is
        // the number that makes bulk legible.
        effective_unit_cents: n ? Math.round(total / n) : 0,
        // What the NEXT arrow would cost, so a calculator can say "8 more and
        // the rate drops".
        next_unit_cents: (ARROW_TIERS.find((t) => n < t.upto) || ARROW_TIERS.at(-1)).cents,
        lines,
    };
};

// arrowsForBudget — the calculator run backwards: how many arrows does $X buy?
//
// Walks the same tiers rather than dividing by an average, because dividing by
// the headline rate under-counts and dividing by the blended rate is circular —
// the blend depends on the quantity you are trying to find.
const arrowsForBudget = (budget_cents) => {
    let remaining = Math.max(0, Math.floor(Number(budget_cents) || 0));
    let bought = 0;
    for (const tier of ARROW_TIERS) {
        const capacity = tier.upto === Infinity ? Infinity : tier.upto - bought;
        if (capacity <= 0) continue;
        const affordable = Math.floor(remaining / tier.cents);
        const take = Math.min(affordable, capacity);
        bought += take;
        remaining -= take * tier.cents;
        if (take < capacity) break;   // ran out of money inside this tier
    }
    return { ...priceArrows(bought), budget_cents: Number(budget_cents) || 0, change_cents: remaining };
};

// computeResponseThreshold — the door price for one debate.
//
// Pure and exported so the route, the UI quote and any test all read the same
// arithmetic. Takes the debate's own numbers rather than an id, so it can be
// called from inside a query's result without a second round trip.
const computeResponseThreshold = ({
    is_for_fun = false,
    prize_is_cash = false,
    prize_pool_cents = 0,
    nominee_count = 0,
} = {}) => {
    if (is_for_fun) {
        return { threshold: 0, base: 0, from_prize: 0, from_field: 0, is_for_fun: true };
    }
    const dollars = prize_is_cash ? Math.max(0, Number(prize_pool_cents) || 0) / 100 : 0;
    const from_prize = Math.floor(dollars / 100) * ARROWS_PER_100_DOLLARS;
    const from_field = Math.max(0, Number(nominee_count) || 0) * ARROWS_PER_NOMINEE;
    const raw = OPEN_RESPONSE_THRESHOLD + from_prize + from_field;
    return {
        threshold: Math.min(raw, OPEN_RESPONSE_CEILING),
        base: OPEN_RESPONSE_THRESHOLD,
        from_prize,
        from_field,
        capped: raw > OPEN_RESPONSE_CEILING,
        is_for_fun: false,
    };
};

// thresholdForDebate — the same thing, looked up.
const thresholdForDebate = async ({ debate_id }, db = client) => {
    const { rows } = await db.query(
        `SELECT d.is_for_fun, d.prize_is_cash, COALESCE(d.prize_pool_cents, 0) AS prize_pool_cents,
                (SELECT COUNT(DISTINCT n.nominee_user_id)::int
                   FROM nominations n WHERE n.debate_id = d.id) AS nominee_count
           FROM debates d WHERE d.id = $1`,
        [debate_id]
    );
    if (!rows.length) throw httpError(404, "debate not found");
    return { ...computeResponseThreshold(rows[0]), ...rows[0] };
};

// How long a for-fun prompt collects likes before its arrow is awarded.
const FOR_FUN_WINDOW_DAYS = 30;

const TROPHY_KINDS = ["debate_win", "for_fun_response", "purchased"];

// ---------------------------------------------------------------------------
// awarding
// ---------------------------------------------------------------------------

// award — one arrow, idempotently.
//
// The unique index (user, debate, kind) is the cap, so a repeat is a no-op
// rather than an error: the monthly job re-running, or a debate being crowned
// twice, must not fail and must not double-award. ON CONFLICT DO NOTHING is
// the whole enforcement; the count trigger only fires on a real insert.
const award = async ({ user_id, kind, debate_id = null, response_id = null, note = null }, db = client) => {
    if (!user_id) throw httpError(400, "user_id is required");
    if (!TROPHY_KINDS.includes(kind)) {
        throw httpError(400, `kind must be one of: ${TROPHY_KINDS.join(", ")}`);
    }
    const { rows } = await db.query(
        `INSERT INTO user_trophies (user_id, kind, debate_id, response_id, note)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, debate_id, kind) WHERE debate_id IS NOT NULL
         DO NOTHING
         RETURNING *`,
        [user_id, kind, debate_id, response_id, note]
    );
    return { awarded: rows.length > 0, trophy: rows[0] || null };
};

// awardDebateWin — called when a debate is crowned. The winner is a contestant;
// the arrow belongs to the person behind it.
const awardDebateWin = async ({ debate_id, winner_contestant_id }, db = client) => {
    if (!winner_contestant_id) return { awarded: false, trophy: null };
    const { rows } = await db.query(
        `SELECT c.user_id, d.title, d.format
           FROM contestants c JOIN debates d ON d.id = c.debate_id
          WHERE c.id = $1`,
        [winner_contestant_id]
    );
    if (!rows.length) return { awarded: false, trophy: null };
    return award(
        {
            user_id: rows[0].user_id,
            kind: "debate_win",
            debate_id,
            note: `Won "${rows[0].title}"`,
        },
        db
    );
};

// ---------------------------------------------------------------------------
// the for-fun leaderboard
// ---------------------------------------------------------------------------

// forFunLeaderboard — every answer on a for-fun debate's prompt, by likes.
//
// Public, and public DURING the month rather than only at the end: the whole
// mechanic is that you can see you have been overtaken and write something
// better. A leaderboard revealed only at the close is a lottery.
const forFunLeaderboard = async ({ debate_id, limit = 50 }, db = client) => {
    const { rows } = await db.query(
        `SELECT r.id AS response_id, r.body, r.submitted_at, r.user_id,
                u.first_name, u.last_name, u.username, u.profile_photo_url,
                u.trophy_count,
                COALESCE(e.like_count, 0)    AS like_count,
                COALESCE(e.comment_count, 0) AS comment_count,
                EXISTS (SELECT 1 FROM user_trophies t
                         WHERE t.user_id = r.user_id AND t.debate_id = r.debate_id
                           AND t.kind = 'for_fun_response') AS has_arrow
           FROM match_responses r
           JOIN users u ON u.id = r.user_id
           LEFT JOIN response_engagement e ON e.response_id = r.id
          WHERE r.debate_id = $1 AND r.removed_at IS NULL
          ORDER BY COALESCE(e.like_count, 0) DESC, r.submitted_at ASC
          LIMIT $2`,
        [debate_id, Math.min(Number(limit) || 50, 200)]
    );
    return rows;
};

// recordForFunLead — the dethroning half.
//
// Called after a like lands on a for-fun response. If the leader has changed,
// the NEW leader gets their arrow immediately — that is what makes "anyone who
// dethrones them gets one too" true without having to store a history of who
// led when. The award is capped and idempotent, so a lead that changes hands
// forty times mints at most one arrow per person.
//
// The final award at the end of the window is the same call: whoever is top
// then is either already holding an arrow or gets one now.
const recordForFunLead = async ({ debate_id }, db = client) => {
    const { rows: dbt } = await db.query(
        `SELECT id, title, is_for_fun FROM debates WHERE id = $1`,
        [debate_id]
    );
    if (!dbt.length || !dbt[0].is_for_fun) return { awarded: false, leader: null };

    const board = await forFunLeaderboard({ debate_id, limit: 1 }, db);
    const leader = board[0];
    // Nobody has a like yet, so nobody has led. Awarding the first person to
    // post would be awarding them for posting.
    if (!leader || Number(leader.like_count) <= 0) return { awarded: false, leader: null };

    const result = await award(
        {
            user_id: leader.user_id,
            kind: "for_fun_response",
            debate_id,
            response_id: leader.response_id,
            note: `Top answer on "${dbt[0].title}"`,
        },
        db
    );
    return { ...result, leader };
};

// closeForFunWindows — the monthly job.
//
// Finds every for-fun debate whose window has closed and makes sure its current
// leader holds an arrow. Everyone who led earlier already got theirs when they
// took the lead, so this is only ever catching the final holder — but it is
// what makes the rule true for a debate nobody liked until the last day.
//
// Idempotent by construction, so running it hourly, daily or twice is the same.
const closeForFunWindows = async ({ window_days = FOR_FUN_WINDOW_DAYS } = {}, db = client) => {
    const { rows: due } = await db.query(
        `SELECT id FROM debates
          WHERE is_for_fun = TRUE
            AND start_at IS NOT NULL
            AND start_at <= NOW() - ($1 || ' days')::interval
            AND status <> 'cancelled'`,
        [Number(window_days)]
    );
    const results = [];
    for (const d of due) {
        try {
            results.push({ debate_id: d.id, ...(await recordForFunLead({ debate_id: d.id }, db)) });
        } catch (err) {
            // One bad debate must not stop the rest of the month's awards.
            console.error("[trophies] for-fun close failed", d.id, err);
            results.push({ debate_id: d.id, awarded: false, error: err.message });
        }
    }
    return { checked: due.length, awarded: results.filter((r) => r.awarded).length, results };
};

// ---------------------------------------------------------------------------
// what it buys
// ---------------------------------------------------------------------------

// canRespondOpenly — may this user answer a match they are not in?
//
// Reads the denormalised count, which the trigger keeps true. Returns the
// numbers as well as the verdict because the UI shows "34 of 100" — a locked
// door with no indication of how far off you are is not a goal, it is a wall.
const canRespondOpenly = async ({ user_id, debate_id = null }, db = client) => {
    // Without a debate this answers the general question ("am I past the
    // floor?"), which is what a profile shows. With one it answers the real
    // question, which is the only one the write path may use.
    const door = debate_id
        ? await thresholdForDebate({ debate_id }, db)
        : { ...computeResponseThreshold({}), nominee_count: 0 };

    if (!user_id) {
        return { allowed: false, trophy_count: 0, ...door, remaining: door.threshold };
    }
    const { rows } = await db.query(`SELECT trophy_count FROM users WHERE id = $1`, [user_id]);
    const count = rows[0]?.trophy_count ?? 0;
    const remaining = Math.max(0, door.threshold - count);
    return {
        allowed: count >= door.threshold,
        trophy_count: count,
        remaining,
        // What closing the gap would cost, quoted here so the paywall and the
        // door can never disagree about the number.
        price_cents: priceArrows(remaining).amount_cents,
        arrow_price_cents: ARROW_PRICE_CENTS,
        arrow_tiers: ARROW_TIERS.map((t) => ({
            upto: t.upto === Infinity ? null : t.upto,
            cents: t.cents,
        })),
        ...door,
    };
};

// getUserTrophies — the case, for a profile.
const getUserTrophies = async ({ user_id, limit = 100 }, db = client) => {
    const { rows } = await db.query(
        `SELECT t.id, t.kind, t.note, t.awarded_at, t.debate_id,
                d.title AS debate_title, d.is_for_fun
           FROM user_trophies t
           LEFT JOIN debates d ON d.id = t.debate_id
          WHERE t.user_id = $1
          ORDER BY t.awarded_at DESC
          LIMIT $2`,
        [user_id, Math.min(Number(limit) || 100, 500)]
    );
    const { rows: c } = await db.query(`SELECT trophy_count FROM users WHERE id = $1`, [user_id]);
    return {
        trophy_count: c[0]?.trophy_count ?? 0,
        threshold: OPEN_RESPONSE_THRESHOLD,
        trophies: rows,
    };
};

// ---------------------------------------------------------------------------
// buying arrows
// ---------------------------------------------------------------------------

// quoteArrows — what it costs this user to reach a given debate's door.
//
// Quoted from the SAME canRespondOpenly the write path uses, so the price on
// the paywall and the number at the door cannot disagree. Quoting from a
// separately-computed threshold is how somebody pays for 40 and is refused at 41.
const quoteArrows = async ({ user_id, debate_id = null, quantity = null }, db = client) => {
    const gate = await canRespondOpenly({ user_id, debate_id }, db);
    // Default to exactly the shortfall — the amount that opens the door and not
    // one arrow more. A prefilled basket bigger than the need is a dark pattern.
    const qty = Math.max(1, Number(quantity) || gate.remaining || 1);
    const priced = priceArrows(qty);
    return {
        ...priced,
        // The blended rate is what a receipt should show as the unit price —
        // there is no single tier price once a purchase spans two of them.
        unit_price_cents: priced.effective_unit_cents,
        ...gate,
        // priced last for the fields gate also carries, so the quote's own
        // quantity and total win over the gate's shortfall.
        quantity: priced.quantity,
        amount_cents: priced.amount_cents,
    };
};

// startArrowPurchase — a pending purchase and a PaymentIntent to pay it with.
//
// The arrows are NOT granted here. They are granted when Stripe says the money
// arrived (finishArrowPurchase), because a purchase row is a request and a
// payment is a fact — granting on the request would let anyone with a browser
// mint the currency that opens other people's debates.
const startArrowPurchase = async ({ user_id, debate_id = null, quantity = null }, db = client) => {
    if (!user_id) throw httpError(401, "must be signed in");
    const quote = await quoteArrows({ user_id, debate_id, quantity }, db);
    if (quote.quantity > 1000) throw httpError(400, "that is more arrows than anyone needs at once");

    const { rows } = await db.query(
        `INSERT INTO arrow_purchases
            (user_id, quantity, unit_price_cents, amount_cents, debate_id, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         RETURNING *`,
        [user_id, quote.quantity, quote.unit_price_cents, quote.amount_cents, debate_id]
    );
    const purchase = rows[0];

    // Stripe is adapter-stubbed until STRIPE_SECRET_KEY is set — it throws 503.
    // The purchase row is left PENDING rather than rolled back: an operator
    // turning Stripe on wants to see what people tried to buy while it was off.
    let client_secret = null;
    try {
        const stripe = require("../../services/stripe");
        const intent = await stripe.createPaymentIntent({
            amount_cents: purchase.amount_cents,
            metadata: { kind: "standing_arrows", purchase_id: purchase.id, user_id, debate_id: debate_id || "" },
        });
        await db.query(
            `UPDATE arrow_purchases SET payment_intent_id = $2, updated_at = NOW() WHERE id = $1`,
            [purchase.id, intent.id]
        );
        client_secret = intent.client_secret;
        purchase.payment_intent_id = intent.id;
    } catch (err) {
        if (err.status !== 503) throw err;
        // 503 surfaces to the caller so the UI can say "not available yet"
        // rather than showing a card form that cannot take a card.
        return { purchase, client_secret: null, payments_configured: false, quote };
    }
    return { purchase, client_secret, payments_configured: true, quote };
};

// finishArrowPurchase — the money landed, so the arrows exist.
//
// Confirms with STRIPE, never with the browser: the client saying "it worked" is
// a claim, and this is the function that mints standing. Idempotent on the
// purchase's status, so a webhook delivered twice grants one batch.
const finishArrowPurchase = async ({ purchase_id, payment_intent_id = null }) => {
    return withTransaction(async (tx) => {
        const { rows } = await tx.query(
            `SELECT * FROM arrow_purchases WHERE id = $1 FOR UPDATE`,
            [purchase_id]
        );
        const purchase = rows[0];
        if (!purchase) throw httpError(404, "purchase not found");
        if (purchase.status === "paid") {
            return { granted: 0, already: true, purchase };
        }

        const intentId = payment_intent_id || purchase.payment_intent_id;
        if (!intentId) throw httpError(409, "this purchase has no payment to confirm");
        const stripe = require("../../services/stripe");
        const intent = await stripe.retrievePaymentIntent({ payment_intent_id: intentId });
        if (intent.status !== "succeeded") {
            throw httpError(402, `payment has not succeeded (${intent.status})`);
        }
        if (Number(intent.amount) !== Number(purchase.amount_cents)) {
            // The amount was tampered with, or the intent belongs to something
            // else. Either way this is not the payment for these arrows.
            throw httpError(409, "the payment does not match this purchase");
        }

        // One row per arrow. They are individually revocable that way, which is
        // what a refund needs, and the count trigger fires once each so the
        // denormalised total stays true without a special case.
        for (let i = 0; i < purchase.quantity; i++) {
            await tx.query(
                `INSERT INTO user_trophies (user_id, kind, source, purchase_id, note)
                 VALUES ($1, 'purchased', 'purchased', $2, $3)`,
                [purchase.user_id, purchase.id, "Bought"]
            );
        }
        const { rows: done } = await tx.query(
            `UPDATE arrow_purchases
                SET status = 'paid', paid_at = NOW(), payment_intent_id = $2, updated_at = NOW()
              WHERE id = $1 RETURNING *`,
            [purchase.id, intentId]
        );
        return { granted: purchase.quantity, already: false, purchase: done[0] };
    });
};

// refundArrowPurchase — take them back.
//
// Deletes exactly the arrows this purchase minted, which the purchase_id makes
// unambiguous; the trigger decrements the count per row. Arrows already SPENT
// (used to post an answer) are not clawed back from the answer — the answer
// stays, because unpublishing an argument somebody read is a bigger harm than
// an unpaid-for arrow.
const refundArrowPurchase = async ({ purchase_id }) => {
    return withTransaction(async (tx) => {
        const { rowCount } = await tx.query(
            `DELETE FROM user_trophies WHERE purchase_id = $1`,
            [purchase_id]
        );
        const { rows } = await tx.query(
            `UPDATE arrow_purchases
                SET status = 'refunded', refunded_at = NOW(), updated_at = NOW()
              WHERE id = $1 RETURNING *`,
            [purchase_id]
        );
        return { revoked: rowCount, purchase: rows[0] || null };
    });
};

// ---------------------------------------------------------------------------
// the backdoor
// ---------------------------------------------------------------------------

// evaluateBackdoor — has an outsider out-liked one of the two contestants?
//
// THE RULE: on a typed match whose round has closed, compare every OPEN response
// (contestant_id IS NULL — written by someone who is not in the debate) against
// the two contestants' answers by like count. An open answer with more likes
// than a contestant's takes that contestant's seat.
//
// THE DISPLACER BECOMES A CONTESTANT. A contestants row is created for them and
// swapped into the match, so every query downstream — the bracket, the vote, the
// crowning — carries on unchanged. Only debate_matches.backdoor_* remembers
// that the seat changed hands, which is exactly what the board captions.
//
// TIES DO NOT DISPLACE. Equal likes leaves the contestant in place: the person
// who was actually in the bracket keeps the seat unless they were beaten, and a
// draw is not being beaten.
const evaluateBackdoor = async ({ match_id }, db = client) => {
    const { rows: mrows } = await db.query(
        `SELECT m.*, d.format, d.id AS debate_id
           FROM debate_matches m JOIN debates d ON d.id = m.debate_id
          WHERE m.id = $1`,
        [match_id]
    );
    const match = mrows[0];
    if (!match) throw httpError(404, "match not found");
    if (match.format !== "typed") return { displaced: false, reason: "not a typed match" };
    // One backdoor per match. A seat changing hands twice would mean the second
    // displacer beat somebody who was never really in the bracket.
    if (match.backdoor_at) return { displaced: false, reason: "already used" };

    const { rows: prompts } = await db.query(
        `SELECT id, response_deadline FROM prompts
          WHERE debate_id = $1 AND bracket_round = $2
            AND bracket_side = $3 AND bracket_position = $4`,
        [match.debate_id, match.round, match.side, match.position]
    );
    const prompt = prompts[0];
    if (!prompt) return { displaced: false, reason: "no prompt" };
    // Only once the answers are public. Displacing on likes collected while the
    // answers were sealed would be displacing on nothing.
    if (!prompt.response_deadline || new Date(prompt.response_deadline) > new Date()) {
        return { displaced: false, reason: "round is still open" };
    }

    const { rows: responses } = await db.query(
        `SELECT r.id, r.user_id, r.contestant_id, COALESCE(e.like_count, 0) AS like_count
           FROM match_responses r
           LEFT JOIN response_engagement e ON e.response_id = r.id
          WHERE r.prompt_id = $1 AND r.removed_at IS NULL`,
        [prompt.id]
    );

    const seats = [match.contestant_a_id, match.contestant_b_id];
    const seated = responses.filter((r) => seats.includes(r.contestant_id));
    // An open response is one with no contestant row behind it.
    const outsiders = responses
        .filter((r) => r.contestant_id == null)
        .sort((a, b) => Number(b.like_count) - Number(a.like_count));

    if (!outsiders.length || !seated.length) {
        return { displaced: false, reason: "nobody to displace" };
    }

    const best = outsiders[0];
    // The weaker of the two seats is the one at risk.
    const weakest = seated.reduce((lo, r) =>
        Number(r.like_count) < Number(lo.like_count) ? r : lo
    );
    if (Number(best.like_count) <= Number(weakest.like_count)) {
        return { displaced: false, reason: "no outsider beat a contestant" };
    }

    return withTransaction(async (tx) => {
        // The displacer joins the debate. `seed` is left NULL — they did not
        // earn one, and a seed would put them in a first-round pairing they
        // never played.
        const { rows: cRows } = await tx.query(
            `INSERT INTO contestants (debate_id, user_id, status, entered_via_backdoor_at)
             VALUES ($1, $2, 'active', NOW())
             ON CONFLICT (debate_id, user_id) DO UPDATE
                SET entered_via_backdoor_at = COALESCE(contestants.entered_via_backdoor_at, NOW()),
                    updated_at = NOW()
             RETURNING id`,
            [match.debate_id, best.user_id]
        );
        const newContestantId = cRows[0].id;

        // The response is theirs as a contestant now, so it counts where every
        // other answer in this match counts.
        await tx.query(
            `UPDATE match_responses SET contestant_id = $2, updated_at = NOW() WHERE id = $1`,
            [best.id, newContestantId]
        );

        const seatColumn =
            match.contestant_a_id === weakest.contestant_id ? "contestant_a_id" : "contestant_b_id";
        await tx.query(
            `UPDATE debate_matches
                SET ${seatColumn} = $2,
                    backdoor_response_id = $3,
                    backdoor_user_id = $4,
                    displaced_contestant_id = $5,
                    backdoor_at = NOW(),
                    updated_at = NOW()
              WHERE id = $1`,
            [match_id, newContestantId, best.id, best.user_id, weakest.contestant_id]
        );

        await tx.query(
            `UPDATE contestants SET displaced_at = NOW(), updated_at = NOW() WHERE id = $1`,
            [weakest.contestant_id]
        );

        return {
            displaced: true,
            match_id,
            backdoor_user_id: best.user_id,
            backdoor_response_id: best.id,
            new_contestant_id: newContestantId,
            displaced_contestant_id: weakest.contestant_id,
            likes: { backdoor: Number(best.like_count), displaced: Number(weakest.like_count) },
        };
    });
};

module.exports = {
    OPEN_RESPONSE_THRESHOLD,
    ARROW_TIERS,
    priceArrows,
    arrowsForBudget,
    ARROWS_PER_100_DOLLARS,
    ARROWS_PER_NOMINEE,
    OPEN_RESPONSE_CEILING,
    ARROW_PRICE_CENTS,
    computeResponseThreshold,
    thresholdForDebate,
    FOR_FUN_WINDOW_DAYS,
    TROPHY_KINDS,
    award,
    awardDebateWin,
    forFunLeaderboard,
    recordForFunLead,
    closeForFunWindows,
    canRespondOpenly,
    quoteArrows,
    startArrowPurchase,
    finishArrowPurchase,
    refundArrowPurchase,
    getUserTrophies,
    evaluateBackdoor,
};
