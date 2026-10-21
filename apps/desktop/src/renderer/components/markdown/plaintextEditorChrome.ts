export type PlaintextEditorChrome = 'code' | 'markdown' | 'plain';

export interface HexColorValue {
  r: number;
  g: number;
  b: number;
  a: number;
  hasAlpha: boolean;
}

const HEX_COLOR_RE =
  /(^|[^0-9A-Za-z_#])(#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8}))(?![\w])/g;

export function findHexColors(text: string): Array<{ from: number; to: number; color: string }> {
  return Array.from(text.matchAll(HEX_COLOR_RE), (match) => {
    const from = (match.index ?? 0) + match[1].length;
    return { from, to: from + match[2].length, color: match[2] };
  });
}

export function parseHexColor(value: string): HexColorValue | null {
  const hex = value.trim().replace(/^#/, '');
  if (!/^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) return null;
  const expanded = hex.length <= 4 ? [...hex].map((char) => char + char).join('') : hex;
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
    a: expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) : 255,
    hasAlpha: hex.length === 4 || hex.length === 8,
  };
}

export function formatHexColor(
  color: Pick<HexColorValue, 'r' | 'g' | 'b' | 'a' | 'hasAlpha'>,
  uppercase = false,
): string {
  const byte = (value: number) =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, '0');
  const hex = `#${byte(color.r)}${byte(color.g)}${byte(color.b)}${
    color.hasAlpha ? byte(color.a) : ''
  }`;
  return uppercase ? hex.toUpperCase() : hex;
}

export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let h = 0;
  if (delta > 0) {
    if (max === red) h = ((green - blue) / delta) % 6;
    else if (max === green) h = (blue - red) / delta + 2;
    else h = (red - green) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const chroma = v * s;
  const sector = (((h % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((sector % 2) - 1));
  const [red, green, blue] =
    sector < 1
      ? [chroma, x, 0]
      : sector < 2
        ? [x, chroma, 0]
        : sector < 3
          ? [0, chroma, x]
          : sector < 4
            ? [0, x, chroma]
            : sector < 5
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const match = v - chroma;
  return {
    r: Math.round((red + match) * 255),
    g: Math.round((green + match) * 255),
    b: Math.round((blue + match) * 255),
  };
}

export function getPlaintextEditorChrome(language: string | undefined): PlaintextEditorChrome {
  const normalizedLanguage = language?.toLowerCase();
  const isMarkdown = normalizedLanguage === 'markdown' || normalizedLanguage === 'md';
  if (isMarkdown) return 'markdown';
  if (normalizedLanguage) return 'code';
  return 'plain';
}
