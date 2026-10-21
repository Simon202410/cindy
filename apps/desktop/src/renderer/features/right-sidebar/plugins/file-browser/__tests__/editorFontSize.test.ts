import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '..', 'FileBrowserBody.css'), 'utf8');

describe('right sidebar editor font size', () => {
  it('lets the compact code content consume the editor font-size override', () => {
    const contentRule = css.match(
      /\.rsb-fbody-compact \.cm-editor \.cm-content\s*\{([\s\S]*?)\}/,
    )?.[1];

    expect(contentRule).toContain('font-size: var(--app-editor-font-size, 14px) !important;');
    expect(contentRule).not.toContain('font-size: 14px !important;');
  });
});
