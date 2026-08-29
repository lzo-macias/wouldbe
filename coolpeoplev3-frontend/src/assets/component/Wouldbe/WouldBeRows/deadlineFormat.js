// Shared deadline/currency formatting helpers used by both WouldBeRows and its
// DeadlineTimeline child. Lives in its own module so DeadlineTimeline can import
// these without pulling in WouldBeRows (which imports DeadlineTimeline —
// importing back would be a circular dependency).

// Human-readable label for each deadline_type, for the hover breakdown.
export const DEADLINE_LABELS = {
    petition_circulation_start: "Petitioning opens",
    petition_filing_deadline: "Petition due",
    filing_close: "Filing closes",
    primary_date: "Primary",
    general_date: "General election",
    fec_quarterly_q1: "FEC Q1 report",
    fec_quarterly_q2: "FEC Q2 report",
    fec_quarterly_q3: "FEC Q3 report",
    fec_pre_primary_report: "FEC pre-primary report",
    fec_pre_general_report: "FEC pre-general report",
    fec_post_general_report: "FEC post-general report",
    fec_year_end: "FEC year-end report",
};

// Format a bare YYYY-MM-DD as "Mar 15, 2026". Appending T00:00:00 forces LOCAL
// time so a date-only value doesn't slip a day backward in a negative-offset TZ.
export function formatDeadlineDate(iso) {
    const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// Recommended-goal cents -> "$30,000". No fractional dollars — goals are round.
export function formatUSD(cents) {
    return (cents / 100).toLocaleString("en-US", {
        style: "currency", currency: "USD", maximumFractionDigits: 0,
    });
}

// The milestones that gate candidacy, in chronological order. The FEC financial
// report dates above are deliberately NOT here: they'd crowd a timeline and
// none of them is a candidacy gate. Lives beside DEADLINE_LABELS because every
// consumer of one wants the other.
export const CANDIDACY_MILESTONES = [
    "petition_circulation_start",
    "petition_filing_deadline",
    "filing_close",
    "primary_date",
    "general_date",
];
