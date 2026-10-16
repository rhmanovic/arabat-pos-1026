import { describe, expect, it } from 'vitest';
import { escapeHtml, renderEmail } from './template.js';

describe('renderEmail', () => {
  const rendered = renderEmail({
    title: { ar: 'إعادة تعيين كلمة المرور', en: 'Reset your password' },
    name: 'سلطان <Owner>',
    intro: { ar: 'اضغط الزر خلال 30 دقيقة.', en: 'Use the button within 30 minutes.' },
    action: {
      label: { ar: 'إعادة التعيين', en: 'Reset password' },
      url: 'https://example.com/manager/reset-password?token=abc_DEF-123&x=1',
    },
    note: { ar: 'إن لم تطلب ذلك فتجاهل الرسالة.', en: 'If this was not you, ignore it.' },
  });

  it('builds a bilingual subject', () => {
    expect(rendered.subject).toBe('إعادة تعيين كلمة المرور | Reset your password');
  });

  it('keeps the plain-text layout: Arabic block, blank line, English block, link on its own line', () => {
    const lines = rendered.text.split('\n');
    expect(lines[0]).toBe('مرحباً سلطان <Owner>،');
    expect(lines).toContain('https://example.com/manager/reset-password?token=abc_DEF-123&x=1');
    expect(lines).toContain('');
    expect(lines).toContain('Hello سلطان <Owner>,');
    expect(/token=([\w-]+)/.exec(rendered.text)![1]).toBe('abc_DEF-123');
  });

  it('renders an RTL Arabic block and an LTR English block with an escaped button link', () => {
    expect(rendered.html).toContain('<div dir="rtl" lang="ar"');
    expect(rendered.html).toContain('<div dir="ltr" lang="en"');
    expect(rendered.html).toContain('سلطان &lt;Owner&gt;');
    expect(rendered.html).not.toContain('<Owner>');
    expect(rendered.html).toContain(
      'href="https://example.com/manager/reset-password?token=abc_DEF-123&amp;x=1"',
    );
    expect(rendered.html).toContain('>إعادة التعيين</a>');
    expect(rendered.html).toContain('>Reset password</a>');
    expect(rendered.html).toContain('Arabat POS');
  });

  it('shows a confirmation code in both languages and omits the button without an action', () => {
    const r = renderEmail({
      title: { ar: 'ملكية الشركة', en: 'Company ownership' },
      name: 'Noor',
      intro: { ar: 'أدخل الرمز.', en: 'Enter the code.' },
      code: 'AbCdEfGhIjKlMnOpQrStUv',
    });
    expect(r.text.split('\n').filter((l) => l === 'AbCdEfGhIjKlMnOpQrStUv')).toHaveLength(2);
    expect(r.html.split('AbCdEfGhIjKlMnOpQrStUv')).toHaveLength(3);
    expect(r.html).not.toContain('<a href');
  });

  it('escapes HTML', () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;',
    );
  });
});
