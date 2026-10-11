# Progress

Only record what has actually been done and verified. Mocked or partial work
must be labeled as such.

## Current state (2026-10-11, after session 2)

| Area                     | Status        | Notes                                    |
|--------------------------|---------------|------------------------------------------|
| Documentation foundation | Done          | `CLAUDE.md` + `docs/*` created           |
| Architecture design      | Done (design) | Stack verified, modules, ERD, auth, routes, milestones — not implemented |
| Monorepo scaffold        | Not started   |                                          |
| Backend                  | Not started   |                                          |
| Database / migrations    | Not started   |                                          |
| Frontends                | Not started   |                                          |
| Automated tests          | Not started   | No code to test yet                      |
| Deployment               | Not planned   | Requires owner approval                  |

## Log

### 2026-10-11 — Session 1: Project foundation
- Created `CLAUDE.md` with permanent requirements and working procedure.
- Created `docs/ARCHITECTURE.md`, `DATABASE.md`, `BUSINESS_RULES.md`,
  `DECISIONS.md`, `ROADMAP.md`, `PROGRESS.md`, `TESTING.md`.
- Recorded ADR-0001 (separate Manager / POS / Platform interfaces) through ADR-0008.
- Recorded open business questions OQ-001..OQ-010.
- No business modules built (by instruction).
- Environment observed: Node.js 22 and pnpm 10 available locally, PostgreSQL 16
  cluster present (stopped). Target Node.js line is confirmed at scaffold time.

### 2026-10-11 — Session 2: System architecture
- Verified stable versions (npm registry, nodejs.org, postgresql.org) and
  recorded the stack in `ARCHITECTURE.md` §2 and ADR-0009/0010.
- Rewrote `ARCHITECTURE.md`: app boundaries, 19 domain modules + dependency
  graph, shared-service pattern, API design, i18n/RTL, KWD precision, local
  environment, deployment design (not deployed), scalability path.
- Added `AUTH.md` (sessions, realms, branch-scoped roles, guard pipeline,
  manager override) and `ROUTES.md` (all three apps + API namespaces).
- `DATABASE.md`: renamed tenant → merchant, ERDs for identity/access,
  catalog/inventory, registers/sales/payments/refunds; later-module entities.
- `ROADMAP.md`: milestones M0–M10 with acceptance criteria.
- `BUSINESS_RULES.md`: BR-016..BR-019 confirmed, BR-024..BR-027 defaults,
  OQ-011..OQ-013 added.
- ADR-0011..ADR-0018 recorded.
- Nothing implemented; no tests exist yet (no code).

## Next step
Milestone M0 — engineering foundation (see `ROADMAP.md`).
