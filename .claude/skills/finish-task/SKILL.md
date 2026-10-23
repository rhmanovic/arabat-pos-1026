---
name: finish-task
description: Close out any task on this repo — update the right docs, commit in the house style, merge the claude/* branch into main, and report to the owner in Arabic. Use when the code for a task is written and tests are about to be or have been run, when asked to "finish", "wrap up", "merge" or "report", or before saying a task is done.
---

# Finish a task

Order: tests green → docs → commit → merge to `main` → (release, if it applies) → Arabic report.
Never report as done before all four steps that apply are actually done (CLAUDE.md §5).

## 1. Tests first (CLAUDE.md §8, docs/TESTING.md)

- Run `pnpm verify`, `pnpm test:integration`, `pnpm test:e2e` — how, narrowing and debugging:
  skill `run-tests`; sandbox problems: skill `sandbox-setup`.
- Write down the counts each command printed (unit/web tests, integration tests and files, E2E
  tests). They go into PROGRESS.md, TESTING.md and the owner report verbatim.
- Never skip, disable or loosen a test to get green (CLAUDE.md §5.6). A failure you could not
  fix is reported as such, not hidden.

## 2. Docs — update only what the change touched (CLAUDE.md §5.7, §6)

| Change | Update |
|---|---|
| Any finished task | `docs/PROGRESS.md` log entry (format below) |
| New / changed test files or cases | `docs/TESTING.md`: a `### Results YYYY-MM-DD (<topic>, ADR-xxxx)` block listing each test file with `(+N)` and what it checks; newest block first, right after §4 |
| Migration, table, column, RLS, trigger | `docs/DATABASE.md` §8 "Implemented migrations" row — skill `new-migration` |
| Owner-confirmed rule | `docs/BUSINESS_RULES.md` `- **BR-xxx** Title (ADR-xxxx, owner YYYY-MM-DD): …`, newest first — skill `new-adr` |
| Significant technical decision | `docs/DECISIONS.md` ADR or amendment — skill `new-adr` |
| New screen path or API endpoint | `docs/ROUTES.md` (per-app section §1–§3, API sections §4+) |
| Milestone criterion met / phase finished | `docs/ROADMAP.md`: `[x]` on the criterion, `✅` on the phase/milestone heading, status paragraph |
| Something a cashier or manager sees changed | the matching `docs/user-guide/NN-*.md` chapter, written by `docs/user-guide/WRITING_RULES.md` (Arabic, labels copied from the ar i18n files); update its row in README.md §4 tracking table |
| Release config, env var, runbook | `docs/OPERATIONS.md` |
| A new service/rule every future session must know | one line in `CLAUDE.md` §10 (or §9 for a gotcha) — only then; detail lives in docs/* |

Confirmed requirements from the conversation must be written down in the same session (CLAUDE.md §6).

### PROGRESS.md log entry

- Placement: the log is not in one order. Older entries (to "2026-10-20 — Online store Phase 5")
  run oldest-first; from there on entries are **newest-first**. Insert the new entry directly after
  the Phase 5 entry, above the most recent `### 2026-10-…` heading (`grep -n "^### " docs/PROGRESS.md`).
  Also refresh "## Next step" at the end if the task changes it.
- Format, copied from the latest entries:

```
### YYYY-MM-DD — <Short title> (ADR-xxxx[ amendment N], BR-xxx)
<Owner's request / report in one or two sentences. Cause (for a fix). What was done.>
- <Area>: <what changed, by module / app>.
- Tests: <file> +N (<what>), …
- Docs: ADR-…, BR-…, ROUTES, DATABASE (00NN), ROADMAP, user guide NN.
- Not done (by design | pending owner): <…>.
- Verified (cloud sandbox): `pnpm verify` N unit/web, `pnpm test:integration` N (F files),
  `pnpm test:e2e` N.
- Released (ADR-0122): <added by the deploy-production skill, never before the release happened>.
```

## 3. Commit (style from `git log --oneline -40`)

- Conventional subject, English, imperative/lowercase after the colon, ADR in parentheses:
  `feat(store): every store at its own sub-domain {slug}.arabatapp.com (ADR-0136)`,
  `fix(online): keep the design preview on the console's origin (ADR-0136)`,
  `docs(progress): record the <change> release`, `chore(skills): …`.
  Scope = the app or module (`store`, `online`, `pos`, `manager`, `api`, `catalog`, …).
- Body: a short paragraph on what and why. End with the two attribution lines given in the
  session's system reminder (`Co-Authored-By: …` and `Claude-Session: …`).
- One feature commit (code + tests + docs); the release record is a separate
  `docs(progress)` commit made after the release (skill `deploy-production`).
- Stage explicit paths; never commit `.env`, `var/`, `infra/gcp/config.env` or secrets (CLAUDE.md §4).

## 4. Branch and merge (CLAUDE.md §8a, ADR-0110)

- The work must have started from the latest `origin/main`. Before taking a migration, ADR or BR
  number, `git fetch origin main` and use the next free one there.
- After all three test commands pass, in the same session:

```
git fetch origin main
git rebase origin/main            # on the claude/* branch; re-run tests if main moved
git push origin HEAD              # the claude/* branch
git switch main && git pull --ff-only origin main
git merge --ff-only <claude/branch>
git push origin main
```

- `main` history is linear (no merge commits): prefer fast-forward. If `--ff-only` refuses,
  rebase the branch again and re-test; resolve number clashes (migration/ADR/BR) by taking the
  next free number on `main`.
- Never `--force` push `main`; never delete a remote branch or a secret (Railway variables,
  Secret Manager) without the owner's explicit approval (CLAUDE.md §8a).
- Release: staging after tests (ADR-0088) and production from `main` (ADR-0122) — follow skill
  `deploy-production`; it also writes the "Released" line. No live payments or new paid costs
  without explicit approval (CLAUDE.md §3.13).

## 5. Report to the owner — in Arabic (CLAUDE.md §2, §5.8)

Rules:
- Only what actually happened. Mocked, stubbed, interface-only or partial work is named as such
  (e.g. "واجهة فقط، الخادم غير مفعّل"). Never present it as complete (CLAUDE.md §2).
- Test numbers are the ones printed by the commands you ran this session; a command not run is
  said to be not run.
- Ask only for business decisions, credentials, financial risk or destructive operations (§2).
- Code, paths and commands stay in English inside the Arabic text.

Template:

```
**ما تم:**
- <ما الذي تغيّر من وجهة نظر المستخدم، بنقاط قصيرة>

**الاختبارات (شُغّلت فعلًا):**
- `pnpm verify`: <N> ناجح · `pnpm test:integration`: <N> ناجح (<F> ملفًا) · `pnpm test:e2e`: <N> ناجح
- <أي اختبار فشل أو لم يُشغَّل، ولماذا>

**الدمج والنشر:**
- دُمج في `main` (<commit>) · النشر: <الإنتاج <revision> / staging / لم يُنشر، والسبب>

**ما لم يُنجز أو لم يُتحقق منه:**
- <بصراحة: ما بقي، ما هو واجهة فقط، ما لم يُجرَّب على الإنتاج>

**قرارات اتُّخذت:**
- <ADR-xxxx / BR-xxx: القرار في سطر>

**الخطوات التالية / ما يحتاج قرارك:**
- <سؤال عمل واضح إن وُجد، أو الخطوة التالية المقترحة>
```
