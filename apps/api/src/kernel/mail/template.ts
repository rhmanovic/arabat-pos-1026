/**
 * One bilingual (Arabic RTL, then English LTR) layout for every e-mail the platform sends.
 *
 * Callers pass plain text only; everything is HTML-escaped here. The plain-text part keeps
 * the same structure as before (Arabic block, blank line, English block), with the link or
 * code on a line of its own, so tests and text-only clients read it unchanged.
 */

export interface Bilingual {
  ar: string;
  en: string;
}

export interface EmailTemplate {
  /** Heading inside the message; the subject is "ar | en". */
  title: Bilingual;
  /** Recipient's name for the greeting. */
  name: string;
  /** Main paragraph(s). */
  intro: Bilingual;
  /** A call-to-action button; the URL is repeated as text under it. */
  action?: { label: Bilingual; url: string };
  /** A confirmation code shown in a box (ownership transfer). */
  code?: string;
  /** Small closing note (expiry, "ignore if not you"). */
  note?: Bilingual;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const BRAND = 'Arabat POS';
const PRIMARY = '#17559b'; // packages/ui theme --color-primary (oklch 0.45 0.13 255)
const FONT_AR = "Tahoma, 'Segoe UI', 'Noto Naskh Arabic', Arial, sans-serif";
const FONT_EN = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderEmail(t: EmailTemplate): RenderedEmail {
  return {
    subject: `${t.title.ar} | ${t.title.en}`,
    text: renderText(t),
    html: renderHtml(t),
  };
}

function renderText(t: EmailTemplate): string {
  const extras = [...(t.code ? [t.code] : []), ...(t.action ? [t.action.url] : [])];
  return [
    `مرحباً ${t.name}،`,
    t.intro.ar,
    ...extras,
    ...(t.note ? [t.note.ar] : []),
    '',
    `Hello ${t.name},`,
    t.intro.en,
    ...extras,
    ...(t.note ? [t.note.en] : []),
  ].join('\n');
}

function block(t: EmailTemplate, lang: 'ar' | 'en'): string {
  const rtl = lang === 'ar';
  const dir = rtl ? 'rtl' : 'ltr';
  const align = rtl ? 'right' : 'left';
  const font = rtl ? FONT_AR : FONT_EN;
  const greeting = rtl ? `مرحباً ${escapeHtml(t.name)}،` : `Hello ${escapeHtml(t.name)},`;
  const fallback = rtl
    ? 'إن لم يعمل الزر فانسخ هذا الرابط إلى المتصفح:'
    : 'If the button does not work, copy this link into your browser:';
  const p = (html: string, style = '') =>
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#1f2937;${style}">${html}</p>`;

  const parts: string[] = [
    `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.4;font-weight:700;color:#111827;">${escapeHtml(t.title[lang])}</h1>`,
    p(greeting),
    p(escapeHtml(t.intro[lang])),
  ];
  if (t.code)
    parts.push(
      `<div dir="ltr" style="margin:18px 0;padding:14px 18px;text-align:center;font-family:Consolas,'Courier New',monospace;font-size:22px;letter-spacing:2px;font-weight:700;color:${PRIMARY};background:#eef3fa;border:1px dashed #b7c7e3;border-radius:8px;">${escapeHtml(t.code)}</div>`,
    );
  if (t.action) {
    const url = escapeHtml(t.action.url);
    parts.push(
      `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:20px 0 14px;"><tr><td style="border-radius:8px;background:${PRIMARY};"><a href="${url}" style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;font-family:${font};">${escapeHtml(t.action.label[lang])}</a></td></tr></table>`,
      p(
        `${fallback}<br><a href="${url}" style="color:${PRIMARY};word-break:break-all;">${url}</a>`,
        'font-size:12px;color:#6b7280;',
      ),
    );
  }
  if (t.note) parts.push(p(escapeHtml(t.note[lang]), 'font-size:13px;color:#6b7280;margin:0;'));

  return `<div dir="${dir}" lang="${lang}" style="text-align:${align};font-family:${font};">${parts.join('')}</div>`;
}

function renderHtml(t: EmailTemplate): string {
  const divider = '<hr style="border:0;border-top:1px solid #e5e7eb;margin:26px 0;">';
  const footer =
    'هذه رسالة تلقائية من Arabat POS، لا تردّ عليها.' +
    '<br>This is an automated message from Arabat POS; please do not reply.';
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(t.title.ar)} | ${escapeHtml(t.title.en)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f3f4f6;">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
<tr><td style="background:${PRIMARY};padding:18px 28px;text-align:center;font-family:${FONT_EN};font-size:18px;font-weight:700;letter-spacing:0.5px;color:#ffffff;">${BRAND}</td></tr>
<tr><td style="padding:28px 28px 24px;">
${block(t, 'ar')}
${divider}
${block(t, 'en')}
</td></tr>
<tr><td style="padding:16px 28px 22px;border-top:1px solid #e5e7eb;text-align:center;font-family:${FONT_AR};font-size:12px;line-height:1.7;color:#9ca3af;">${footer}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
