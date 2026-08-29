# Gold ramp — the version before 2026-08-28

Every file in here is the copy that was live **before** the gold tokens were
unified onto one ramp. Restoring is a straight copy back over `src/`:

    cd coolpeoplev3-frontend/src
    cp -R styles-backup-gold-2026-08-28/index.css .
    cp -R styles-backup-gold-2026-08-28/assets .

## What changed, so you can judge whether you want it back

`--gold-deep` was three different colours depending on which file won the
cascade, and it is the token that carries gold TEXT:

| value     | where it lived                          | contrast on white |
|-----------|-----------------------------------------|-------------------|
| `#a9861d` | index.css                               | 3.43:1 — fails AA |
| `#b48f22` | Header.css, WouldBeNavHeader, StartAWouldBe | 3.05:1 — fails AA |
| `#8a6a12` | PreExistingDebates, MyWouldBeShare, the debate forms | **5.06:1 — passes** |

`#8a6a12` is now canonical, declared once in `index.css`, and the local copies
are deleted (custom properties inherit, so every component still resolves it).
The visible effect is that gold text on the home page and the WouldBe page is
darker than it was — which is the point: at `#b48f22` it was failing contrast.

`--gold-soft` also had two values (`#f6eccf` / `#f5ecd0`); the first won.
Added: `--gold-hi` (hover), `--gold-pale`, `--gold-line`.

Nothing else — no layout, no spacing, no component markup.

## How these copies were made

The five component files had no other uncommitted work, so they are byte-exact
copies from git HEAD — verified with `diff`, zero differences.

`index.css` DID have other work in it already (a `--muted` contrast fix and the
`.routeFallback` rule). Copying it from HEAD would have thrown that away, so it
is the live file with only the gold block reverted — everything else preserved.

---

## What this backup does and does not cover

**Covered:** the token unification (one `--gold-*` ramp in `index.css`, local
copies deleted). Restoring the files here puts that back exactly.

**NOT covered:** the `--wb-*` gold system added afterwards, and the components
repointed at it. Those files (`HomeGrid2x.css`, `PledgeCardOverview.css`,
`Grid2x.jsx`, plus the appended block in `index.css`) had uncommitted work in
them before any of this started, so there is no clean "before" copy to take —
git's HEAD is older than the state you were working from.

To undo the gold-system pass by hand, these are the only places it touched:

| file | selector | what changed |
|---|---|---|
| `index.css` | end of file | the whole `WOULD BE — GOLD SYSTEM` block. Deleting it reverts everything below to the older `--gold-*` ramp. |
| `HomeGrid2x.css` | `.smallgridcomponentDebate` | flat `--gold` fill → `--wb-brushed` plate + streak pseudo + hover slide |
| | `.DebateTitle` | white → `--wb-on-gold`, drop shadow → specular lift |
| | `.totalcashprizecontainer` | dark plaque → inline line; coin `img` hidden |
| | `.amt`, `.smalltexttotalcashprize` | prize figure + micro label restyled |
| `PledgeCardOverview.css` | `.pledge` | flat `--gold` → plate |
| | `.aon`, `.aon .tag` | outlined → wash + hairline; tag → plate |
| | `.debHead` | gold text → `--wb-gold-ink` + hairline rule |
| | `.pill` | `--gold-soft` → `--wb-gold-wash` + hairline |
| `Grid2x.jsx` | `timeLabel()` | "0 days" → "Ends today" / "N days left" |
