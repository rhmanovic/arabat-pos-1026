import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AssistantMarkup, parseAssistantMarkup } from './assistant-markup.js';

describe('assistant markup', () => {
  it('parses paragraphs, bullets and numbered steps', () => {
    const blocks = parseAssistantMarkup(
      'للتعليق: اضغط **Hold**.\n\n- أول نقطة\n- ثانية\n  تكملة\n\n**طريقة الإضافة:**\n1. افتح **المنتجات**\n2. اضغط `New product`\n\nانتهى.',
    );
    expect(blocks).toEqual([
      { kind: 'paragraph', lines: ['للتعليق: اضغط **Hold**.'] },
      { kind: 'bullets', items: ['أول نقطة', 'ثانية تكملة'] },
      { kind: 'paragraph', lines: ['**طريقة الإضافة:**'] },
      { kind: 'steps', start: 1, items: ['افتح **المنتجات**', 'اضغط `New product`'] },
      { kind: 'paragraph', lines: ['انتهى.'] },
    ]);
  });

  it('renders bold, code and lists as elements and never as HTML', () => {
    render(
      <AssistantMarkup
        text={'اضغط **Pay (F12)** ثم `cash`.\n- <b>raw</b> stays text\n1. step one'}
      />,
    );
    expect(screen.getByText('Pay (F12)').tagName).toBe('STRONG');
    expect(screen.getByText('cash').tagName).toBe('CODE');
    expect(screen.getAllByRole('list').map((l) => l.tagName)).toEqual(['UL', 'OL']);
    expect(screen.getByText('<b>raw</b> stays text')).toBeInTheDocument();
    expect(document.querySelector('b')).toBeNull();
    expect(screen.getByText('step one').closest('ol')).not.toBeNull();
  });

  it('keeps stray asterisks and single line breaks readable', () => {
    render(<AssistantMarkup text={'2 * 3 = 6\nسطر ثانٍ\n### عنوان'} />);
    expect(screen.getByText(/2 \* 3 = 6/)).toBeInTheDocument();
    expect(document.querySelectorAll('br')).toHaveLength(2);
    expect(screen.getByText(/عنوان/).textContent).not.toContain('#');
  });
});

describe('assistant input focus', () => {
  it('reports no fine pointer where matchMedia says so (phones) and in jsdom', async () => {
    const { hasFinePointer } = await import('./assistant.js');
    expect(hasFinePointer()).toBe(false);
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q === '(pointer: fine)' })) as never;
    expect(hasFinePointer()).toBe(true);
    window.matchMedia = original;
  });
});
