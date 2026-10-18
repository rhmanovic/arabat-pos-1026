import { describe, expect, it } from 'vitest';
import { linkPageTheme, readableOn } from './link-page-view.js';

const style = {
  themeColor: '#7c2d12',
  background: 'light' as const,
  backgroundColor: null,
  backgroundColor2: null,
  textColor: null,
  buttonTextColor: null,
  buttonVariant: 'fill' as const,
};

describe('link page colours', () => {
  it('picks readable text on the brand colour', () => {
    expect(readableOn('#ffffff')).toBe('#000000');
    expect(readableOn('#fde047')).toBe('#000000');
    expect(readableOn('#0f766e')).toBe('#ffffff');
    expect(readableOn('#000000')).toBe('#ffffff');
  });

  it('uses white buttons on a brand-coloured background', () => {
    const theme = linkPageTheme({ ...style, background: 'brand' });
    expect(theme.page).toEqual({ backgroundColor: '#7c2d12', color: '#ffffff' });
    expect(theme.button).toEqual({ backgroundColor: '#ffffff', color: '#000000' });
  });

  it('draws a gradient and picks the text colour against its first colour', () => {
    const theme = linkPageTheme({
      ...style,
      background: 'gradient',
      backgroundColor: '#fde68a',
      backgroundColor2: '#f472b6',
    });
    expect(theme.page).toEqual({
      backgroundImage: 'linear-gradient(160deg, #fde68a, #f472b6)',
      backgroundColor: '#fde68a',
      color: '#000000',
    });
  });

  it('keeps the colours the merchant chose', () => {
    const theme = linkPageTheme({
      ...style,
      background: 'custom',
      backgroundColor: '#111827',
      textColor: '#fbbf24',
      buttonTextColor: '#fbbf24',
    });
    expect(theme.page).toEqual({ backgroundColor: '#111827', color: '#fbbf24' });
    expect(theme.button).toEqual({ backgroundColor: '#7c2d12', color: '#fbbf24' });
    // The placeholder letter always contrasts with its circle.
    expect(theme.avatar).toEqual({ backgroundColor: '#7c2d12', color: '#ffffff' });
  });

  it('styles outline, soft and shadow buttons', () => {
    expect(linkPageTheme({ ...style, buttonVariant: 'outline' }).button).toEqual({
      backgroundColor: 'transparent',
      border: '2px solid #7c2d12',
      color: '#000000',
    });
    expect(linkPageTheme({ ...style, buttonVariant: 'soft' }).button).toEqual({
      backgroundColor: '#7c2d122e',
      color: '#000000',
    });
    expect(linkPageTheme({ ...style, buttonVariant: 'shadow' }).button).toEqual({
      backgroundColor: '#7c2d12',
      color: '#ffffff',
      border: '2px solid #000000',
      boxShadow: '4px 4px 0 #000000',
    });
  });
});
