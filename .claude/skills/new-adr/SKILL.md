---
name: new-adr
description: Record an architecture decision (new ADR-xxxx or an amendment in docs/DECISIONS.md) and/or a new business rule BR-xxx in docs/BUSINESS_RULES.md, taking the next free number from origin/main. Use whenever a significant technical decision or an owner-confirmed business rule must be written down.
---

# Recording an ADR or a business rule (BR)

## When it is required
- **ADR:** any significant decision: new module / app / identity realm, schema or ledger design,
  a "single path" invariant (e.g. "stock changes only through X"), security, money, deployment,
  external providers, or reversing an earlier ADR. Routine library / naming choices need none.
- **Permanent requirements (CLAUDE.md §3)** change only with the owner's explicit approval, plus a
  new ADR, plus the §3 text itself (see item 13's "Exceptions: ADR-0088 …; ADR-0122 …").
- **BR:** every business rule the owner confirms in conversation, in the same session (§6 rule).
  Engineering defaults awaiting the owner are marked **Default (engineering)**; open questions go
  to the `OQ-xxx` table in BUSINESS_RULES.md §6.
- Never delete an ADR; supersede it. Never reuse a number, and never fill a gap (ADR-0120 is
  intentionally unused; parallel branches once collided, ADR-0110).

## 1. Take the next free number from `main`
```bash
git fetch origin main
git show origin/main:docs/DECISIONS.md | grep -oE '^## ADR-[0-9]{4}' | sort -u | tail -1
git show origin/main:docs/BUSINESS_RULES.md | grep -oE 'BR-[0-9]{3}' | sort -u | tail -1
# also check your own branch, in case it already took one:
grep -oE '^## ADR-[0-9]{4}' docs/DECISIONS.md | sort -u | tail -1
```
Use max + 1 (4 digits for ADRs, 3 for BRs). Merge to `main` in the same session (§8a).

## 2. Write the ADR (docs/DECISIONS.md)
There is no index table. Recent entries run **newest first**: insert the new entry directly
**above** the current highest ADR's `## ADR-…` heading, with a blank line between entries.
Status values: `Accepted`, `Proposed`, `Superseded by ADR-xxxx` (older entries may add a
parenthesis, e.g. `Accepted (owner requirement)`). Write past/present facts, name files in
backticks, keep bullets wrapped at ~100 columns.

```markdown
## ADR-0137 — <Short decision title>
- **Status:** Accepted (YYYY-MM-DD). <Who asked / why: "Owner's request: …" or engineering reason.>
- **Context:** <what is true today and the problem; optional for small decisions>.
- **Decision:**
  - **<Topic>:** <rule, with the file / table / endpoint that implements it (`path/file.ts`,
    migration 00NN, `POST /api/v1/...`, permission `x.y`)>.
  - <…>
- **Consequences:** <what changes for merchants / operators, what is deliberately not done,
  follow-ups (OQ-xxx, later phase)>.
```
- Superseding: set the old entry's status to `Superseded by ADR-0137` (keep its text) and say
  "Supersedes ADR-00NN" in the new Context.
- A very long ADR goes to `docs/adr/ADR-0137-<slug>.md` (`# ADR-0137 — Title`, then `- **Date:** …
  · **Status:** …`, `- **Related:** ADR-…`, `## Context`, `## Decision` with `### 1. …`,
  `## Consequences`); DECISIONS.md keeps a short entry with
  `- Full text: [\`docs/adr/ADR-0137-<slug>.md\`](adr/ADR-0137-<slug>.md): <one-sentence summary>.`
  (pattern: ADR-0112).

## 3. Amendments to an existing ADR
- Small or same-day change: append a bullet at the end of that ADR's own entry
  (and in its `docs/adr/` file if it has one):
  `- **Amendment N (YYYY-MM-DD) — <title>.** Owner's request: … Decision: …`
  (unnumbered `- **Amendment (YYYY-MM-DD, owner decision):** …` exists in older entries; number
  them when the ADR already has numbered ones).
- A large later amendment gets its own entry in the newest-first block, same placement as a new ADR:
  ```markdown
  ## ADR-0128 amendment 9 — <Title> (YYYY-MM-DD)
  - **Owner's requests:** <…>
  - **Decision:**
    - <…>
  ```
  Refer to it everywhere as "ADR-0128 amendment 9". An amendment takes no new ADR number.

## 4. Write the BR (docs/BUSINESS_RULES.md)
Place it in the thematic section it belongs to; the recent rules sit in §3 right after
`BR-203`, **newest first** (BR-242, BR-241, …). Plain business language, no code:
```markdown
- **BR-243** <Rule name> (ADR-0137, owner YYYY-MM-DD): <the rule as the owner stated it: who may
  do what, limits, what is never allowed, what is kept for the record>.
```
Reference the BR from the ADR (`BR-243`) and from tests / code comments where it is enforced.
Resolving an open question: strike it in the OQ table (`~~question~~ **Resolved (ADR-0137):** …`).

## 5. Cross-references in the same session
- `docs/PROGRESS.md` `## Log`: a `### YYYY-MM-DD — <Title> (ADR-0137)` entry next to the newest
  entries (newest at the top of that day's group), with what was built, "Not done", and
  "Verified" counts from `pnpm verify` / `pnpm test:integration` / `pnpm test:e2e` actually run.
- `docs/ROADMAP.md`: mark the milestone / phase with `✅ (ADR-0137)` or add it to the milestone text.
- `docs/DATABASE.md`, `docs/AUTH.md`, `docs/ROUTES.md`, `docs/OPERATIONS.md` when tables,
  permissions, routes or operations change.
- **CLAUDE.md §10:** add or extend **one short line** only when the decision creates something
  every future session must respect (a single write path, a new app / realm / host rule, a
  deployment fact, a new "never do X" guard), e.g. "Stores answer at `{slug}.arabatapp.com`
  (ADR-0136, `STORE_DOMAIN`): …". Feature details stay in the ADR. A new §9 gotcha is one bullet.
- Report the decision to the owner in Arabic; the documents stay in English.
