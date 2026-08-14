const crypto = require("crypto");
const { client } = require("../index.js");

// ============================================================================
// sponsor_prize_agreements — the sponsor's signed promise to deliver the prize.
//
// WHY THIS EXISTS: a debate is a public contest with a declared prize. The
// winner is a stranger chosen by a disclosed process, and if the sponsor doesn't
// deliver, the winner comes to the platform. This table is the evidence that
// they promised: who signed, what they typed, which words were on screen, what
// the prize was at that moment, from which IP, and when.
//
// EVERY PRIZE TYPE IS SIGNED FOR — cash, non-cash, or both. A promised
// internship that never materialises is the same broken promise as unpaid money.
//
// THE TERMS LIVE IN CODE, VERSIONED, AND ARE HASHED AT SIGNING. Not in the
// database and not in the React bundle: the server must be able to say "these
// are the exact words that were signed", and the hash proves it even if the
// wording is later revised. Change the text → bump PRIZE_AGREEMENT_VERSION in
// the same commit. Old rows keep pointing at the old version and old hash.
//
// APPEND-ONLY. Re-signing writes a new row. Nothing here updates or deletes.
// ============================================================================

const httpError = (status, message) => {
    const e = new Error(message);
    e.status = status;
    return e;
};

// Bump whenever any clause below changes, in the same commit as the change.
const PRIZE_AGREEMENT_VERSION = "v2";

// The contract. Written to be defensible and readable at the same time: every
// clause is one obligation, in plain words, with no cross-references. {{prize}}
// is replaced with the prize exactly as declared, so the signed text names the
// real thing rather than a placeholder.
//
// Clause order is deliberate — what is promised, to whom, by when, that it is
// really yours to give, who is liable, what may not change, and the terms the
// platform needs to run a lawful contest.
const PRIZE_AGREEMENT_CLAUSES = [
    {
        heading: "What I am promising",
        body: "I am offering the following prize to the winner of this debate: {{prize}}. This is the complete prize. There is nothing else I am promising, and nothing here is conditional on anything not written in this agreement.",
    },
    {
        heading: "Who receives it",
        body: "The winner is whoever the judging process published on this debate's page determines, applied to the criteria disclosed there before entries opened. I do not decide the winner by any other means, and I will not withhold the prize because I disagree with the outcome.",
    },
    {
        heading: "When I will deliver it",
        body: "I will deliver the entire prize within 30 days of the results being announced. Cash is sent using the payout details the winner provides. Anything that is not cash, I arrange and deliver directly with the winner, at my own expense, including any shipping, travel, scheduling or fees needed to make it real.",
    },
    {
        heading: "The prize is mine to give",
        body: "I own the prize or have the unconditional right to award it. It is not contingent on a third party's approval, not already promised to someone else, and not subject to any lien, dispute or expiry that would stop the winner receiving it. If any part of it depends on another company honouring something, I have already secured that.",
    },
    {
        heading: "Nothing is asked of the winner",
        body: "Receiving the prize does not require the winner to buy anything, pay anything, enter another contest, sign with me, provide services, transfer any rights in their work, or give anything else of value. Their entry is the only thing required of them.",
    },
    {
        heading: "I am liable for delivery",
        body: "Delivering this prize is my responsibility alone. The platform is not a guarantor, an escrow agent, or a party to the prize itself. If I fail to deliver, the platform may (but need not) satisfy the prize in my place and recover that amount from me, and may suspend or bar me from sponsoring future debates.",
    },
    {
        heading: "I will not change it",
        body: "Once entries open, I will not reduce, withdraw, or substitute the prize. Before entries open, any change must be submitted and approved, and I will re-sign this agreement for the changed prize. A substitution is only ever permitted with the platform's written approval and only for something of equal or greater value.",
    },
    {
        heading: "Taxes and reporting",
        body: "The winner is responsible for their own taxes on what they receive. Where the law puts a reporting or withholding obligation on the party providing a prize, that obligation is mine, and I will provide any information the platform reasonably needs to meet its own.",
    },
    {
        heading: "I can sign this",
        body: "I am at least 18 and legally able to enter this agreement. If I am signing for a company or organisation, I am authorised to bind it, and \"I\" in this agreement means that organisation.",
    },
    {
        heading: "Compliance and cancellation",
        body: "Prize contests are regulated, and the rules differ by state. The platform may refuse, pause, or cancel this debate for legal or compliance reasons, and may require changes to the prize or the rules. If the debate is rejected before it opens, my host fee is refunded in full and this promise ends with it.",
    },
    {
        heading: "This is a binding agreement",
        body: "By typing my name below I am signing this agreement electronically, with the same effect as a handwritten signature. It is made between me and the platform for the benefit of the winner, and it takes effect when I sign it. My name, the time, and my IP address are recorded with it.",
    },
];

const usd = (cents) =>
    (Number(cents || 0) / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

// describePrize — the one sentence the whole contract turns on. Built server-side
// so the prize named in the signed text is the prize on the debate, never
// whatever a client claimed it was.
const describePrize = ({ prize_type, prize_cents, prize_description }) => {
    const cash = usd(prize_cents);
    const other = (prize_description || "").trim();
    if (prize_type === "both") return `${cash} in cash, plus ${other}`;
    if (prize_type === "non_cash") return other;
    return `${cash} in cash`;
};

// buildTermsText — the exact bytes shown and hashed. Heading + body per clause,
// one clause per line, so the hash is stable no matter how the client lays it out.
const buildTermsText = (prize) =>
    PRIZE_AGREEMENT_CLAUSES.map(
        (c) => `${c.heading}: ${c.body.replace("{{prize}}", describePrize(prize))}`
    ).join("\n");

const hashTerms = (text) => crypto.createHash("sha256").update(text, "utf8").digest("hex");

const loadOwnedDebate = async ({ debate_id, user_id }) => {
    if (!debate_id) throw httpError(400, "debate_id is required");
    const { rows } = await client.query(
        `SELECT d.*, s.user_id AS sponsor_user_id
         FROM debates d JOIN sponsors s ON s.id = d.sponsor_id
         WHERE d.id = $1`,
        [debate_id]
    );
    const debate = rows[0];
    if (!debate) throw httpError(404, "debate not found");
    if (user_id && debate.sponsor_user_id !== user_id) {
        throw httpError(403, "you are not the sponsor of this debate");
    }
    return debate;
};

// prizeOf — the debate's prize, in the shape every function here passes around.
const prizeOf = (debate) => ({
    prize_type: debate.prize_type || "cash",
    prize_cents: Number(debate.sponsor_contribution_cents) || 0,
    prize_description: debate.prize_description || null,
});

// getPrizeAgreementTerms — what the signing screen renders. Returns the clauses
// with the prize substituted, the version, and the hash the server will record,
// so the client never assembles or interprets the contract itself.
const getPrizeAgreementTerms = async ({ debate_id, user_id = null }) => {
    const debate = await loadOwnedDebate({ debate_id, user_id });
    const prize = prizeOf(debate);
    const prize_display = describePrize(prize);

    return {
        debate_id,
        version: PRIZE_AGREEMENT_VERSION,
        prize_type: prize.prize_type,
        prize_cents: prize.prize_cents,
        prize_description: prize.prize_description,
        prize_display,
        clauses: PRIZE_AGREEMENT_CLAUSES.map((c) => ({
            heading: c.heading,
            body: c.body.replace("{{prize}}", prize_display),
        })),
        terms_hash: hashTerms(buildTermsText(prize)),
    };
};

// signPrizeAgreement — record the signature.
//
// The PRIZE and the TERMS come from the server, never the request: the sponsor
// signs what we showed them, and a client that posts its own figure would be
// signing for a prize nobody agreed to. The client sends only the typed name;
// ip/user_agent come from the request context middleware.
const signPrizeAgreement = async ({
    debate_id,
    user_id,
    signature_name,
    ip_address = null,
    user_agent = null,
}) => {
    const debate = await loadOwnedDebate({ debate_id, user_id });
    const prize = prizeOf(debate);

    // Mirrors debates_prize_shape_chk. A prize nobody can describe is a prize
    // nobody can be held to.
    const hasCash = prize.prize_cents > 0;
    const hasOther = !!(prize.prize_description && prize.prize_description.trim());
    if (prize.prize_type === "cash" && !hasCash) {
        throw httpError(409, "this debate has no cash prize amount to sign for");
    }
    if (prize.prize_type === "non_cash" && !hasOther) {
        throw httpError(409, "this debate has no prize description to sign for");
    }
    if (prize.prize_type === "both" && !(hasCash && hasOther)) {
        throw httpError(409, "this debate's prize is incomplete — it needs both an amount and a description");
    }

    const name = signature_name != null ? String(signature_name).trim() : "";
    if (name.length < 2) throw httpError(400, "type your full name to sign");
    if (name.length > 120) throw httpError(400, "that signature is too long");

    const terms_hash = hashTerms(buildTermsText(prize));

    const { rows } = await client.query(
        `INSERT INTO sponsor_prize_agreements
            (debate_id, user_id, signature_name, agreement_version, terms_hash,
             prize_type, prize_cents, prize_description, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *;`,
        [
            debate_id, user_id, name, PRIZE_AGREEMENT_VERSION, terms_hash,
            prize.prize_type, prize.prize_cents, prize.prize_description,
            ip_address, user_agent,
        ]
    );
    return rows[0];
};

// getPrizeAgreement — the latest signature for a debate, or null.
const getPrizeAgreement = async ({ debate_id }) => {
    const { rows } = await client.query(
        `SELECT * FROM sponsor_prize_agreements
         WHERE debate_id = $1
         ORDER BY signed_at DESC
         LIMIT 1`,
        [debate_id]
    );
    return rows[0] || null;
};

// hasSignedCurrentTerms — the approval gate.
//
// Compares the HASH, not the amount. The hash covers the whole prize as it was
// rendered — type, cash, and description — so a sponsor who signs for
// "$500 plus a laptop" and then edits it to "$500 plus a sticker" fails this
// check and has to re-sign. Comparing cents alone would have missed that
// entirely. It also catches a terms REVISION: bump the version and every
// unsigned-under-the-new-text debate stops passing.
const hasSignedCurrentTerms = async ({ debate_id }) => {
    const debate = await loadOwnedDebate({ debate_id, user_id: null });
    const latest = await getPrizeAgreement({ debate_id });
    if (!latest) return false;
    return latest.terms_hash === hashTerms(buildTermsText(prizeOf(debate)));
};

module.exports = {
    PRIZE_AGREEMENT_VERSION,
    PRIZE_AGREEMENT_CLAUSES,
    describePrize,
    getPrizeAgreementTerms,
    signPrizeAgreement,
    getPrizeAgreement,
    hasSignedCurrentTerms,
};
