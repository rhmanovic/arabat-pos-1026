import { describe, expect, it } from 'vitest';
import { linkPageTheme, readableOn } from './link-page-view.js';

describe('link page colours', () => {
  it('picks readable text on the brand colour', () => {
    expect(readableOn('#ffffff')).toBe('#000000');
    expect(readableOn('#fde047')).toBe('#000000');
    expect(readableOn('#0f766e')).toBe('#ffffff');
    expect(readableOn('#000000')).toBe('#ffffff');
  });

  it('uses white buttons on a brand-coloured background', () => {
    const theme = linkPageTheme({ themeColor: '#7c2d12', background: 'brand' });
    expect(theme.page).toEqual({ backgroundColor: '#7c2d12', color: '#ffffff' });
    expect(theme.button).toEqual({ backgroundColor: '#ffffff', color: '#000000' });
  });
});
