---
name: user-guide-writing
description: Write, review or update a chapter of the Arabic end-user guide in docs/user-guide (NN-*.md), its glossary, code findings or the printed booklets. Use when a change alters what a cashier or manager sees (labels, buttons, messages, permissions, flows), when asked to document a screen for merchants, or to regenerate the POS / manager booklets and PDFs.
---

# User guide writing (docs/user-guide)

The guide trains merchant staff on `/pos` and `/manager` (plus the `/online` console, chapter 24).
Version 1.0 (2026-10-14): 34 chapters approved, two booklets printed (`README.md` header, §7, §8).
Planning files (`README.md`, `WRITING_RULES.md`, `SECTION_TEMPLATE.md`, `GLOSSARY.md`, `CODE_FINDINGS.md`)
may show paths, permission keys and BR numbers; chapter bodies never do (`README.md` note at top).

## When the guide must change

- Any change a cashier or manager sees: label, button, message, permission, default, flow
  (`.claude/skills/finish-task/SKILL.md` docs table; `vertical-slice` skill). Find the chapter in the
  index `README.md` §3 (columns: file, screens, permission keys, BRs) and update its row in §4.
- A code fix that closes a `CODE_FINDINGS.md` item: re-check the chapter against the new code, close the
  item «مغلق (أُصلح)» with the commit, and re-release the booklet holding it as 1.1, 1.2… (`README.md` §8).
- Out of scope: `/platform`, the public `/store` storefront (`README.md` §1).

## Source of truth (WRITING_RULES §1)

1. Every on-screen text comes verbatim from the Arabic locale files; search the text, never write from
   memory (rules 1, 4):
   `packages/i18n/src/locales/ar.ts` (shared, errors), `apps/pos-web/src/i18n/ar.ts`,
   `apps/manager-web/src/i18n/ar.ts`; for chapter 24 also `apps/online-web/src/i18n/ar.ts`.
2. Behaviour (who sees a button, what happens after) is verified in the screen's code and the API
   service, plus `docs/BUSINESS_RULES.md`. On conflict, **write what the code does**, report the conflict,
   fix neither code nor docs (rule 2). Record each verified fact in the hidden card as
   `file → function: behaviour` (see `09-pos-cancel-sale.md`, `14-manager-my-account.md`).
3. Not in the code = not in the guide (rule 3). Roles come from `packages/permissions/src/templates.ts`,
   permission keys from `packages/permissions/src/catalog.ts`; name them by their Arabic label from
   «الأدوار والصلاحيات» (`README.md` §2, rule 19).
4. Do not run anything to "check" a flow unless needed; if you do, use the `run-api-locally` skill.

## Language and tone (WRITING_RULES §2, §8)

- **Arabic only** (simple Modern Standard Arabic) for chapters; English only for file names (rule 40).
  Engineering docs stay English (CLAUDE.md §2).
- Second person singular masculine imperative: «اضغط»، «اكتب»، «اختر» (rule 6). Short sentences,
  ≤15 words, one idea each (7). One step = one verb, starting with the verb (8, 9). Passive only for
  what the system does: «يُخصم المخزون» (10). Split «إذا… وإلا…» into two points (11).
- Never in the body: tables, columns, routes, file names, permission keys, i18n keys, error codes,
  BR/ADR numbers, real people or customer data (rules 18–22). Reach a screen by its UI path:
  «من القائمة الجانبية اختر «الورديات»» (21).

## UI text, numbers (WRITING_RULES §3, §5)

- Quote every UI text in «» exactly, error messages with their punctuation: «افتح وردية أولًا.»
  (12, 14). No «زر» unless ambiguous (13). Variables by example (15). Role-dependent buttons name the role (16).
- Money: Latin digits, 3 decimals, comma thousands, then «د.ك»: `1,250.000 د.ك` (23, 24). Re-compute
  every example to the fils (25). Percent `10%` (26). Company settings are «حسب إعداد شركتك» with the
  code default (39). Sandbox gateway is «تجريبية (مدفوعات اختبار فقط)» (36). Promise no effect
  (e-mail, audit entry) the code does not perform (37).

## Glossary (GLOSSARY.md, WRITING_RULES rule 17)

- Use only terms in `GLOSSARY.md` §1–§9 (UI term · i18n key + English · one-line definition).
- §10: requested terms that do not exist in the UI and the wording chosen instead.
- §11 (ت-1…ت-29, approved by ق-5, ق-8, ق-34): where the UI is inconsistent, explain with «الصيغة في الدليل»
  but quote the button / title as it actually appears.
- New term? Add a row (mark ★, update the "آخر تحديث" line) or list it in the session report (rule 43).
  The booklet glossary picks rows whose every form appears in «» in its chapters (`build.mjs`).

## Structure (SECTION_TEMPLATE.md, WRITING_RULES §6)

- File `NN-<interface>-<topic>.md`; first line exactly `# NN — <title as in README §3>` (`build.mjs`
  throws otherwise). Numbering follows the training order in `README.md` §3; a new chapter takes the
  next number, is added to §3/§4 and to `BOOKLETS` in `booklets/build.mjs` (POS 01–12, manager 13–34 in five parts).
- Hidden card `<!-- -->` right after the title: file, target role, screens, permission keys, BRs and
  decisions (ق-n), i18n keys used, verified behaviour, `رُوجع على الالتزام`, `الحالة`. Comments are
  stripped from booklets.
- Headings, all and in this order (only «تنبيهات» may be dropped; otherwise write «لا ينطبق على هذه الشاشة.»):
  «الهدف من الشاشة» (2 lines) · «من يستطيع استخدامها» (role table + «الصلاحية المطلوبة») ·
  «قبل أن تبدأ» · «الخطوات» (+ `### إذا أردت …` sub-tasks) · «ماذا يحدث بعد التنفيذ» (table: المخزون،
  النقدية، سجل التدقيق، ما يراه العميل; «لا يتأثر.» if none) · «حالات تحتاج شخصًا ثانيًا أو اعتمادًا» ·
  «رسائل الخطأ الشائعة» (message · meaning · what to do) · «تنبيهات» · «أسئلة تدريب» (3–6 with answers).
- Happy path first, then sub-tasks, then special cases (31); approvals only in their own heading (32);
  ≤4 table columns, no nested tables (33). Desktop vs phone steps in separate numbered lists under
  «على الحاسوب:» / «على الجوال:» (35).
- One chapter per session; cross-reference as «انظر قسم «<title prefix>»» (30) — `build.mjs` resolves it by
  title prefix (or `REFERENCE_ALIASES`) and prints unresolved ones.
- **No screenshots** for now: put `<!-- صورة مقترحة: ... -->` instead (34).

## Open questions and code findings

- Case open in `README.md` §6 → stop writing the affected part until decided (38). Any other unsettled
  case (incl. OQ-xxx in BUSINESS_RULES): describe current behaviour, not as policy, and add it to §6.
  Decisions ق-1…ق-42 in §6 bind the wording (e.g. ق-9 lock warning text).
- Bug found while verifying: add a row to `CODE_FINDINGS.md` (next #, chapters, description with
  file/function, severity عالية/متوسطة/منخفضة, status مفتوح) and update both summary tables. Never fix
  it in this task; the chapter documents current behaviour with a practical workaround.

## After writing (WRITING_RULES §9, template checklist)

1. Run the checklist at the end of `SECTION_TEMPLATE.md` (every «» text found verbatim; no keys/paths in
   body; amounts with 3 decimals; audit/stock/cash rows explicit; BRs exist; glossary only).
2. Update `README.md` §4 row: status (لم يبدأ · مسودة · مراجع · معتمد), date, commit reviewed, notes.
3. Regenerate booklets from the repo root (Node ≥20, no deps; never edit booklet outputs by hand):
   `node docs/user-guide/booklets/build.mjs` → `booklets/{pos,manager}-booklet.{md,html}`.
   Check its output line (chapters, references, glossary terms, unresolved references). Rebuild after
   committing so the cover shows the commit instead of «مع تعديلات لاحقة».
4. If a chapter changed, review the hand-written sheets/intro in `booklets/pos/` and `booklets/manager/`.
5. Release PDFs only for a new approved version: `BOOKLET_RELEASE="1.1 (YYYY-MM-DD)"` build, then headless
   Chromium (`/opt/pw-browsers/chromium` here) to `booklets/pdf/<b>-booklet-<ver>.pdf`, check with
   `pdfinfo`, add a row to the release log (`README.md` §7–§8).
6. Report: texts not found in code, doc/code conflicts, new glossary terms (rule 43). Then the
   `run-tests` / `finish-task` skills (`pnpm format:check` covers the `.md`; booklet HTML is Prettier-ignored).
