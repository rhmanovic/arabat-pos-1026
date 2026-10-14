#!/usr/bin/env node
// Builds the user-guide booklets (Markdown + printable HTML) from the user-guide sections.
//
//   node docs/user-guide/booklets/build.mjs
//
// Two booklets, each from its sections and its hand-written parts (intro, one-page sheets):
// - POS booklet:     sections 01..10, parts in booklets/pos/     → pos-booklet.md / .html
// - Manager booklet: sections 13..29, 31..34 in five parts, parts in booklets/manager/
//                                                                → manager-booklet.md / .html
// Sources are never modified: the sections, GLOSSARY.md (short glossary), README.md (index).
// No dependencies beyond Node and git.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const guide = join(here, '..');

// Short names used in «انظر قسم «…»» that are not the start of the target's title.
const REFERENCE_ALIASES = {};

const read = (path) => readFileSync(path, 'utf8');
const stripComments = (text) => text.replace(/<!--[\s\S]*?-->\n?/g, '');
const toArabicDigits = (n) => String(Number(n));
const git = (...args) => execFileSync('git', args, { cwd: guide, encoding: 'utf8' }).trim();
const files = readdirSync(guide);

// README index: section number → title, to resolve references outside a booklet.
const indexTitles = {};
for (const line of read(join(guide, 'README.md')).split('\n')) {
  const m = /^\| (\d\d) [^|]*\| `[^`]+\.md` \| ([^|]+) \|/.exec(line);
  if (m && !indexTitles[m[1]]) indexTitles[m[1]] = m[2].trim().replace(/[«»]/g, '');
}

const BOOKLETS = [
  {
    name: 'pos',
    title: 'دليل نقطة البيع',
    subtitle: 'دليل المستخدم — الجزء الخاص بالكاشير والمشرف في «نقطة البيع».',
    parts: [{ sections: ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'] }],
    sheets: [
      { file: 'cashier-sheet.md', title: 'ورقة الكاشير في صفحة واحدة' },
      { file: 'supervisor-sheet.md', title: 'ورقة المشرف في صفحة واحدة' },
    ],
  },
  {
    name: 'manager',
    title: 'دليل المدير',
    subtitle:
      'دليل المستخدم — الجزء الخاص بـ«الإدارة»: المالك، ومدير الشركة، ومدير الفرع، وأمين الخزينة.',
    parts: [
      { title: 'الباب الأول — البداية', sections: ['13', '14'] },
      { title: 'الباب الثاني — إعداد الشركة', sections: ['25', '26', '27', '28', '31'] },
      {
        title: 'الباب الثالث — العمل اليومي',
        sections: ['15', '16', '17', '18', '19', '20', '21', '22', '24'],
      },
      { title: 'الباب الرابع — المال والرقابة', sections: ['29', '23', '33', '32'] },
      { title: 'الباب الخامس — الملكية', sections: ['34'] },
    ],
    sheets: [
      { file: 'owner-sheet.md', title: 'ورقة المالك في صفحة واحدة' },
      { file: 'branch-manager-sheet.md', title: 'ورقة مدير الفرع في صفحة واحدة' },
      { file: 'treasurer-sheet.md', title: 'ورقة أمين الخزينة في صفحة واحدة' },
    ],
  },
];

function buildMarkdown(cfg) {
  const partsDir = join(here, cfg.name);
  // ---------------------------------------------------------------- sources
  let n = 0;
  const parts = cfg.parts.map((p) => ({
    title: p.title,
    chapters: p.sections.map((num) => {
      const file = files.find((f) => f.startsWith(`${num}-`) && f.endsWith('.md'));
      if (!file) throw new Error(`Section ${num} not found`);
      const body = stripComments(read(join(guide, file))).trim();
      const [first, ...rest] = body.split('\n');
      const match = /^# \d+ — (.+)$/.exec(first);
      if (!match) throw new Error(`${file}: first line must be "# NN — title"`);
      return { num, file, chapter: ++n, title: match[1].trim(), body: rest.join('\n').trim() };
    }),
  }));
  const chapters = parts.flatMap((p) => p.chapters);

  const sourceFiles = chapters.map((c) => join(guide, c.file));
  const commit = git('log', '-1', '--format=%h', '--', ...sourceFiles);
  const commitDate = git('log', '-1', '--format=%cs', '--', ...sourceFiles);
  // Sections edited after that commit: say so instead of claiming the commit's text.
  const dirty = git('status', '--porcelain', '--', ...sourceFiles) !== '';
  const sourceLabel = dirty
    ? `نصوص الفصول من الالتزام \`${commit}\` مع تعديلات لاحقة عليه (بُني في ${new Date().toISOString().slice(0, 10)}).`
    : `نصوص الفصول من الالتزام \`${commit}\` بتاريخ ${commitDate}.`;

  // ---------------------------------------------------------------- references table
  const references = new Map();
  for (const c of chapters) {
    for (const m of c.body.matchAll(/(?:انظر|راجع) (?:قسم|القسم) «((?:[^«»]|«[^«»]*»)*)»/g)) {
      const name = m[1];
      if (!references.has(name)) references.set(name, new Set());
      references.get(name).add(c.chapter);
    }
  }
  const resolve = (name) => {
    const inBooklet = chapters.find((c) => c.title.replace(/[«»]/g, '').startsWith(name.replace(/[«»]/g, '')));
    if (inBooklet) return { chapter: inBooklet.chapter };
    const alias = REFERENCE_ALIASES[name];
    const aliased = alias && chapters.find((c) => c.num === alias);
    if (aliased) return { chapter: aliased.chapter };
    const section =
      alias ?? Object.keys(indexTitles).find((k) => indexTitles[k].startsWith(name.replace(/[«»]/g, '')));
    return { section };
  };
  const unresolved = [];
  const referenceRows = [...references.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'ar'))
    .map(([name, from]) => {
      const target = resolve(name);
      if (!target.chapter && !target.section) unresolved.push(name);
      const where = target.chapter
        ? `الفصل ${target.chapter}`
        : target.section
          ? `خارج هذا الكتيب: القسم ${target.section} من دليل المستخدم الكامل`
          : 'خارج هذا الكتيب';
      return `| «${name}» | ${where} | ${[...from].join('، ')} |`;
    });

  // ---------------------------------------------------------------- glossary appendix
  const bookletText = chapters.map((c) => c.body).join('\n');
  const glossaryRows = [];
  let inScope = false;
  for (const line of read(join(guide, 'GLOSSARY.md')).split('\n')) {
    const heading = /^## (\d+)\./.exec(line);
    if (heading) inScope = Number(heading[1]) <= 9; // §10 and §11 are notes for writers
    if (!inScope || !line.startsWith('| ') || line.startsWith('| المصطلح') || line.startsWith('|---'))
      continue;
    const cells = line.split(' | ');
    if (cells.length < 3) continue;
    const term = cells[0].replace(/^\| /, '').replace('★', '').trim();
    const definition = cells[cells.length - 1].replace(/ \|$/, '').trim();
    const variants = term.split(' / ').map((v) => v.replace(/[«»]/g, '').trim());
    // A row counts when the chapters quote each of its forms as on screen («term»); a form with a
    // placeholder ({{count}}) counts by the text before the placeholder.
    const quoted = (v) =>
      v.includes('{{') ? bookletText.includes(`«${v.split('{{')[0]}`) : bookletText.includes(`«${v}»`);
    if (variants.every(quoted))
      glossaryRows.push(`| ${term.replace(/\{\{\w+\}\}/g, '…')} | ${definition} |`);
  }

  // ---------------------------------------------------------------- markdown
  const part = (name) => stripComments(read(join(partsDir, name))).trim();
  const md = [];
  md.push(`# ${cfg.title}`, '');
  md.push(cfg.subtitle, '');
  md.push(sourceLabel, '');
  md.push('# كيف تقرأ هذا الدليل', '', part('intro.md'), '');
  md.push('### الإحالات', '');
  md.push('| الإحالة في النص | أين تجدها | ترد في الفصول |', '|---|---|---|', ...referenceRows, '');
  md.push('# الفهرس', '');
  for (const p of parts) {
    if (p.title) md.push('', `**${p.title}**`, '');
    for (const c of p.chapters) md.push(`${c.chapter}. ${c.title}`);
  }
  let k = chapters.length;
  if (parts.some((p) => p.title)) md.push('');
  for (const sh of cfg.sheets) md.push(`${++k}. ملحق: ${sh.title}`);
  md.push(`${++k}. ملحق: قاموس مختصر`, '');
  for (const p of parts) {
    if (p.title)
      md.push(`# ${p.title}`, '', ...p.chapters.map((c) => `- الفصل ${toArabicDigits(c.chapter)} — ${c.title}`), '');
    for (const c of p.chapters) md.push(`# الفصل ${toArabicDigits(c.chapter)} — ${c.title}`, '', c.body, '');
  }
  for (const sh of cfg.sheets) md.push(`# ملحق: ${sh.title}`, '', part(sh.file), '');
  md.push('# ملحق: قاموس مختصر', '');
  md.push('المصطلحات الواردة في فصول هذا الكتيب فقط، منقولة من قاموس الدليل.', '');
  md.push('| المصطلح | معناه |', '|---|---|', ...glossaryRows, '');
  const markdown = md.join('\n').replace(/\n{3,}/g, '\n\n');
  writeFileSync(join(here, `${cfg.name}-booklet.md`), markdown);
  const partTitles = new Set(parts.map((p) => p.title).filter(Boolean));
  return { markdown, partTitles, chapters, commit, dirty, commitDate, referenceRows, glossaryRows, unresolved };
}

// ------------------------------------------------------------------ html
const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) =>
  escape(s)
    .replace(/`([^`]+)`/g, '<code dir="ltr">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

function blocksToHtml(text) {
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  const isList = (l) => /^\s*(\d+\.|-) /.test(l);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = /^(#{2,3}) (.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length + 1; // ## → h3, ### → h4 inside a chapter
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }
    if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const [head, , ...body] = rows;
      out.push('<table><thead><tr>');
      out.push(cells(head).map((c) => `<th>${inline(c)}</th>`).join(''));
      out.push('</tr></thead><tbody>');
      for (const r of body) out.push(`<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`);
      out.push('</tbody></table>');
      continue;
    }
    if (isList(line)) {
      const items = [];
      while (i < lines.length && lines[i].trim() && (isList(lines[i]) || /^\s+\S/.test(lines[i]))) {
        const m = /^(\s*)(\d+\.|-) (.*)$/.exec(lines[i]);
        if (m) items.push({ indent: m[1].length, ordered: m[2] !== '-', num: parseInt(m[2]), text: m[3] });
        else items[items.length - 1].text += ' ' + lines[i].trim();
        i++;
      }
      out.push(listToHtml(items));
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{2,3} |\|)/.test(lines[i]) && !isList(lines[i]))
      para.push(lines[i++].trim());
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}

function listToHtml(items) {
  const html = [];
  const stack = [];
  const open = (item) => {
    const tag = item.ordered ? 'ol' : 'ul';
    const start = item.ordered && item.num !== 1 ? ` start="${item.num}"` : '';
    html.push(`<${tag}${start}>`);
    stack.push({ tag, indent: item.indent });
  };
  for (const item of items) {
    if (!stack.length) open(item);
    else if (item.indent > stack[stack.length - 1].indent) {
      html[html.length - 1] = html[html.length - 1].replace(/<\/li>$/, '');
      open(item);
    } else {
      while (stack.length > 1 && item.indent < stack[stack.length - 1].indent) {
        html.push(`</${stack.pop().tag}></li>`);
      }
      const top = stack[stack.length - 1];
      if (top.tag !== (item.ordered ? 'ol' : 'ul')) {
        html.push(`</${stack.pop().tag}>${stack.length ? '' : ''}`);
        open(item);
      }
    }
    html.push(`<li>${inline(item.text)}</li>`);
  }
  while (stack.length) html.push(`</${stack.pop().tag}>${stack.length ? '</li>' : ''}`);
  return html.join('\n');
}

const css = `
@page { size: A4; margin: 16mm 15mm 18mm; }
:root { --ink: #1b1b1b; --muted: #555; --line: #c9c9c9; --soft: #f3f3f3; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0 auto; max-width: 180mm; padding: 8mm 0; color: var(--ink); background: #fff;
  font-family: "Noto Naskh Arabic", "Noto Sans Arabic", "Segoe UI", Tahoma, "Arial", sans-serif;
  font-size: 11.5pt; line-height: 1.75; overflow-wrap: anywhere; }
h1, h2, h3, h4 { line-height: 1.4; break-after: avoid; page-break-after: avoid; }
h2 { font-size: 19pt; border-bottom: 2px solid var(--ink); padding-bottom: 2mm; margin: 0 0 4mm; }
h3 { font-size: 14pt; margin: 6mm 0 2mm; }
h4 { font-size: 12pt; margin: 4mm 0 1.5mm; }
p, li { orphans: 3; widows: 3; }
ol, ul { padding-inline-start: 7mm; margin: 1.5mm 0; }
li { margin: 0.6mm 0; }
code { font-family: "DejaVu Sans Mono", Consolas, monospace; font-size: 0.92em; background: var(--soft);
  padding: 0 1mm; border-radius: 1mm; unicode-bidi: isolate; }
table { width: 100%; border-collapse: collapse; margin: 2.5mm 0; font-size: 10pt; table-layout: auto; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
th, td { border: 1px solid var(--line); padding: 1.2mm 1.8mm; text-align: start; vertical-align: top; }
th { background: var(--soft); }
.cover { min-height: 240mm; display: flex; flex-direction: column; justify-content: center; text-align: center; }
.cover h1 { font-size: 34pt; margin: 0 0 8mm; }
.cover p { font-size: 13pt; color: var(--muted); }
.chapter { break-before: page; page-break-before: always; }
.toc { font-size: 12.5pt; } .toc a { color: inherit; text-decoration: none; }
.sheet { font-size: 10.5pt; line-height: 1.55; } .sheet h2 { font-size: 15pt; margin-bottom: 2mm; }
.sheet p { margin: 2mm 0 0.5mm; } .sheet ol, .sheet ul { margin: 0.5mm 0; }
@media screen { body { padding: 10mm 12mm; } .chapter { border-top: 1px dashed var(--line); margin-top: 12mm; padding-top: 8mm; } }
`;

// Booklets divided into parts (أبواب) get a divider page per part.
const partCss = `.part { break-before: page; page-break-before: always; min-height: 200mm; display: flex;
  flex-direction: column; justify-content: center; }
.part h1 { font-size: 26pt; margin: 0 0 6mm; }
.toc-parts { list-style: none; padding-inline-start: 0; } .toc-parts li { padding-inline-start: 6mm; }
.toc-parts .toc-part { font-weight: 700; margin-top: 3mm; padding-inline-start: 0; }
`;

function buildHtml(cfg, { markdown, partTitles }) {
  const sectionsHtml = [];
  const toc = [];
  for (const block of markdown.split(/^# /m).slice(1)) {
    const [title, ...rest] = block.split('\n');
    const id = `s${sectionsHtml.length}`;
    const kind =
      sectionsHtml.length === 0
        ? 'cover'
        : partTitles.has(title)
          ? 'part'
          : title.startsWith('ملحق: ورقة')
            ? 'chapter sheet'
            : 'chapter';
    if (kind === 'part') toc.push(`<li class="toc-part"><a href="#${id}">${inline(title)}</a></li>`);
    else if (kind !== 'cover' && title !== 'الفهرس') toc.push(`<li><a href="#${id}">${inline(title)}</a></li>`);
    sectionsHtml.push({ id, kind, title, body: rest.join('\n') });
  }
  const renderSection = (s) => {
    if (s.kind === 'cover')
      return `<section class="cover" id="${s.id}"><h1>${inline(s.title)}</h1>${blocksToHtml(s.body)}</section>`;
    if (s.title === 'الفهرس')
      return partTitles.size
        ? `<section class="chapter" id="${s.id}"><h1>الفهرس</h1><ul class="toc toc-parts">${toc.join('')}</ul></section>`
        : `<section class="chapter" id="${s.id}"><h1>الفهرس</h1><ol class="toc">${toc.join('')}</ol></section>`;
    if (s.kind === 'part')
      return `<section class="part" id="${s.id}"><h1>${inline(s.title)}</h1>${blocksToHtml(s.body)}</section>`;
    return `<section class="${s.kind}" id="${s.id}"><h2>${inline(s.title)}</h2>${blocksToHtml(s.body)}</section>`;
  };
  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${cfg.title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;700&display=swap">
<style>${css}${partTitles.size ? partCss : ''}</style>
</head>
<body>
${sectionsHtml.map(renderSection).join('\n')}
</body>
</html>
`;
  writeFileSync(join(here, `${cfg.name}-booklet.html`), html);
}

for (const cfg of BOOKLETS) {
  const built = buildMarkdown(cfg);
  buildHtml(cfg, built);
  const { chapters, commit, dirty, commitDate, referenceRows, glossaryRows, unresolved } = built;
  console.log(
    `${cfg.name}-booklet: ${chapters.length} chapters from ${commit}${dirty ? ' + edits' : ''} (${commitDate}), ` +
      `${referenceRows.length} references, ${glossaryRows.length} glossary terms`,
  );
  if (unresolved.length) console.log(`  unresolved references: ${unresolved.join(' | ')}`);
}
