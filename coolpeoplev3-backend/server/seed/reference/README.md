# Reference-data seeding (offices, jurisdictions, regulations, deadlines)

This subsystem loads the **real-world reference data** the WouldBe product matches
users and campaigns against: `jurisdiction`, `office`, `office_recommended_goals`,
`politicians`, `races`, `filing_authorities`, `jurisdiction_rules_versions`,
`election_date_anchors`, `deadline_offset_rules`, and the computed
`election_deadlines`. It is **separate from `server/seed.js`** (user/dev fixtures)
and from the running server — it owns its own DB connection (`db.js`) so it never
boots Express.

## The strategy (why it's built this way)

**1. Fetch is separate from write.** Each *source adapter* (`sources/…`) knows one
real-world source and produces normalized rows; the *upsert layer* (`upserts.js`)
is the only thing that touches Postgres. You can refresh a source any time without
touching the others.

**2. Every write is idempotent, keyed on a stable natural/external key** — never on
the surrogate uuid. Re-running a source **refreshes** rows, it never duplicates.
- `jurisdiction` → `ocd_division_id` (the OCD division id is the cross-source key
  shared by geocodio / OpenStates / Census; built in `ocd.js`). True `ON CONFLICT`.
- `election_date_anchors`, `office_recommended_goals` → existing unique keys. True
  `ON CONFLICT`.
- everything else → `upsertByKey()` (SELECT-by-natural-key → UPDATE or INSERT).

**3. Regulations and rules are versioned, never mutated.** `publishRulesVersion()`
is append-only: it closes the current open version (`effective_until`) and inserts
a new one. You can always reconstruct what the rules were on a past date — the
whole point of `jurisdiction_rules_versions` for compliance defense. Deadlines are
the same idea: store **anchors + offset rules** and *compute* `election_deadlines`,
so a date change is a one-row edit that re-derives every affected deadline.

**4. One transaction per run.** A mid-run failure rolls back cleanly; `--dry-run`
runs the whole thing and rolls back so you can validate before persisting.

**5. "Updatable later" is the default, not an afterthought.** Because writes are
idempotent and rules/deadlines are versioned/computed, the same scripts are your
update path. Wire them to the cron job types the migration already added
(`election_calendar_sync`, `authority_link_health`, `stage_gate_evaluate`) via
`cronSyncPoliticalData` to refresh on a schedule.

## Layout

```
server/seed/reference/
  db.js              own pg Pool + withTransaction (decoupled from the server)
  ocd.js             OCD division-id builders + STATE_FIPS
  upserts.js         idempotent writers (the only code that writes Postgres)
  run.js             CLI orchestrator (flags, one transaction per run)
  sources/
    fec.js                 Federal: President/Senate/House structure + FEC API candidates
    states/_template.js    copy → <state>.js (state leg + statewide execs + rules)
    local/nyc.js           NYC: Mayor + 51 Council districts + CFB rules (RCV/no-runoff)
```

## Run it

```bash
# 1. Federal structure (no API key needed — constitutional offices)
npm run seed:reference -- --source fec --cycle 2026

# 2. + live candidates from the FEC API (needs FEC_API_KEY in .env)
npm run seed:reference -- --source fec --cycle 2026 --with-candidates

# 3. NYC local
npm run seed:reference -- --source nyc --cycle 2025

# 4. A state (after you fill in sources/states/ny.js)
npm run seed:reference -- --source state --state ny --cycle 2026

# validate without persisting
npm run seed:reference -- --source all --cycle 2026 --dry-run
```

Add `FEC_API_KEY=...` to `.env` (free key at https://api.open.fec.gov).

## Recommended order

1. **FEC federal** — President + 50 states' Senate + 435 House districts. Deterministic.
2. **State by state** — copy `_template.js` to `ny.js`, fill district counts +
   calendar + rules; repeat per launch state.
3. **NYC local** — Mayor + 51 Council districts (point-in-polygon via your GeoJSON).

## Hardening (recommended follow-up)

`upsertByKey()` does SELECT-then-write, which is correct only when seeds run
single-threaded (the CLI does). For concurrency-safe, atomic upserts add unique
indexes and switch those writers to real `ON CONFLICT`:

- `office (jurisdiction_id, office_name, district_identifier)` — or add a stable
  `external_office_id` and make it unique.
- `politicians (fec_candidate_id)` unique where not null; same for `bioguide_id`.
- `races (office_id, election_cycle, election_type)`.
- `filing_authorities (jurisdiction_id, authority_name, applies_to_office_id)`.
- `deadline_offset_rules (jurisdiction_id, applies_to_office_id, deadline_type, effective_from)`.
- `election_deadlines (jurisdiction_id, deadline_type, election_cycle, applies_to_office_id)`.

These belong in a **new migration** (don't edit applied ones). Say the word and
I'll write it.

## Still to wire (left as clearly-marked TODOs)

- FEC candidate→office/term linkage + committee verification (`verifyCommitteeViaAPI`).
- Real election-date anchors + offset rules per state and for NYC (BOE/CFB calendars).
- City-council point-in-polygon needs your council-district GeoJSON boundary file.
