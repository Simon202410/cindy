import { describe, expect, it } from 'vitest';

import {
  findHexColors,
  formatHexColor,
  getPlaintextEditorChrome,
  hsvToRgb,
  parseHexColor,
  rgbToHsv,
} from '../components/markdown/plaintextEditorChrome';

describe('PlaintextEditor — unknown code language chrome fallback', () => {
  it('uses code chrome for non-markdown language intent regardless of parser support', () => {
    expect(getPlaintextEditorChrome('definitely-unsupported-language')).toBe('code');
    expect(getPlaintextEditorChrome('makefile')).toBe('code');
  });

  it('keeps markdown aliases on markdown chrome', () => {
    expect(getPlaintextEditorChrome('markdown')).toBe('markdown');
    expect(getPlaintextEditorChrome('md')).toBe('markdown');
  });

  it('uses plain chrome when no language is provided', () => {
    expect(getPlaintextEditorChrome(undefined)).toBe('plain');
  });
});

describe('PlaintextEditor — inline hex color previews', () => {
  it('finds standalone CSS hex colors without matching identifiers', () => {
    expect(findHexColors('Color(hex: "#ECF2F8")\nfill: #fff8;')).toEqual([
      { from: 12, to: 19, color: '#ECF2F8' },
      { from: 28, to: 33, color: '#fff8' },
    ]);
    expect(findHexColors('issue#123456 and foo#fff')).toEqual([]);
  });

  it('round-trips RGB, alpha and HSV values for the picker', () => {
    expect(parseHexColor('#ECF2F8')).toEqual({
      r: 236,
      g: 242,
      b: 248,
      a: 255,
      hasAlpha: false,
    });
    expect(parseHexColor('#fff8')).toEqual({
      r: 255,
      g: 255,
      b: 255,
      a: 136,
      hasAlpha: true,
    });
    expect(formatHexColor(parseHexColor('#fff8')!)).toBe('#ffffff88');
    expect(rgbToHsv(255, 0, 0)).toEqual({ h: 0, s: 1, v: 1 });
    expect(hsvToRgb(120, 1, 1)).toEqual({ r: 0, g: 255, b: 0 });
  });
});
