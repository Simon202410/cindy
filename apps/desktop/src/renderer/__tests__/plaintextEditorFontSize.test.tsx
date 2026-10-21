// @vitest-environment jsdom

import { createElement } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlaintextEditor } from '@/components/markdown/PlaintextEditor';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty('--app-editor-font-size');
  document.body.style.removeProperty('--app-editor-font-size');
  vi.unstubAllGlobals();
});

describe('PlaintextEditor font-size shortcuts', () => {
  it('changes only the editor override and persists the new size', () => {
    const setPatch = vi.fn(async () => ({}));
    vi.stubGlobal('electronAPI', {
      appearanceSettings: { setPatch },
      logToMain: vi.fn(),
    });
    const { container } = render(
      createElement(PlaintextEditor, {
        initialValue: 'const value = 1;',
        language: 'typescript',
      }),
    );
    const editor = container.querySelector<HTMLElement>('.cm-editor')!;
    const view = EditorView.findFromDOM(editor)!;

    fireEvent.keyDown(view.contentDOM, { key: '=', code: 'Equal', ctrlKey: true });

    expect(document.documentElement.style.getPropertyValue('--app-editor-font-size')).toBe('15px');
    expect(document.body.style.getPropertyValue('--app-editor-font-size')).toBe('15px');
    expect(setPatch).toHaveBeenCalledWith({ editorFontSize: 15 });
  });
});
