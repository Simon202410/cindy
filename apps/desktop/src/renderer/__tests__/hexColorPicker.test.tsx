// @vitest-environment jsdom

import { createElement } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { showMinimap } from '@replit/codemirror-minimap';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseMinimapMarkLabel, PlaintextEditor } from '@/components/markdown/PlaintextEditor';

vi.mock('react-i18next', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// 测试价值：现有颜色单测只验证转换函数；这里走真实 PlaintextEditor →
// CodeMirror widget → 浮动面板 → dispatch 的生产路径。最小失败输入是点击
// #ECF2F8 色块后把 hex 改成 #112233，文档未回写即失败。tier: unit。
describe('PlaintextEditor integrated decorations', () => {
  it('extracts the visible name from MARK comments', () => {
    expect(parseMinimapMarkLabel('// MARK: 色彩定义')).toBe('色彩定义');
    expect(parseMinimapMarkLabel('  //MARK：- 网络层')).toBe('网络层');
    expect(parseMinimapMarkLabel('// regular comment')).toBeNull();
  });

  it('opens from the swatch and writes the picked hex back to the document', () => {
    vi.useFakeTimers({
      toFake: ['requestAnimationFrame', 'cancelAnimationFrame'],
    });
    const source = 'const color = "#ECF2F8";';
    const { container } = render(
      createElement(PlaintextEditor, {
        initialValue: source,
        language: 'typescript',
      }),
    );
    const editorElement = container.querySelector<HTMLElement>('.cm-editor');
    const swatch = container.querySelector<HTMLElement>('.cm-hex-color-swatch');
    expect(editorElement).not.toBeNull();
    expect(swatch).not.toBeNull();

    fireEvent.click(swatch!);
    const panel = document.querySelector<HTMLElement>('.cm-hex-picker');
    const hexInput = panel?.querySelector<HTMLInputElement>('.cm-hex-picker__hex');
    expect(panel?.hidden).toBe(false);
    expect(hexInput?.value).toBe('#ECF2F8');

    act(() => {
      fireEvent.input(hexInput!, { target: { value: '#112233' } });
      vi.advanceTimersByTime(20);
    });
    const view = EditorView.findFromDOM(editorElement!)!;
    expect(view.state.doc.toString()).toBe('const color = "#112233";');

    act(() => {
      fireEvent.keyDown(view.contentDOM, {
        key: 'z',
        code: 'KeyZ',
        ctrlKey: true,
      });
    });
    expect(view.state.doc.toString()).toBe(source);
    expect(
      container.querySelector<HTMLElement>('.cm-hex-color-swatch')?.style
        .backgroundColor,
    ).toBe('rgb(236, 242, 248)');
  });

  it('marks lines changed against the Git baseline', () => {
    const { container } = render(
      createElement(PlaintextEditor, {
        initialValue: 'one\ntwo\nthree',
        language: 'typescript',
        changedLines: new Set([2]),
      }),
    );

    const changed = container.querySelectorAll('.cm-git-changed-line');
    expect(changed).toHaveLength(1);
    expect(changed[0].textContent).toBe('two');
    const view = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!)!;
    expect(view.state.facet(showMinimap)?.gutters).toEqual([{ 2: expect.any(String) }]);
  });

  it('keeps CodeMirror undo and redo shortcuts active', () => {
    const { container } = render(
      createElement(PlaintextEditor, {
        initialValue: 'original',
        language: 'typescript',
      }),
    );
    const view = EditorView.findFromDOM(
      container.querySelector<HTMLElement>('.cm-editor')!,
    )!;

    act(() => {
      view.dispatch({
        changes: { from: 0, to: 'original'.length, insert: 'edited' },
        userEvent: 'input',
      });
      fireEvent.keyDown(view.contentDOM, {
        key: 'z',
        code: 'KeyZ',
        ctrlKey: true,
      });
    });
    expect(view.state.doc.toString()).toBe('original');

    act(() => {
      fireEvent.keyDown(view.contentDOM, {
        key: 'y',
        code: 'KeyY',
        ctrlKey: true,
      });
    });
    expect(view.state.doc.toString()).toBe('edited');
  });

  it('routes the editor save shortcut through onSave', () => {
    const onSave = vi.fn();
    const { container } = render(
      createElement(PlaintextEditor, {
        initialValue: 'original',
        language: 'typescript',
        onSave,
      }),
    );
    const view = EditorView.findFromDOM(
      container.querySelector<HTMLElement>('.cm-editor')!,
    )!;

    fireEvent.keyDown(view.contentDOM, {
      key: 's',
      code: 'KeyS',
      ctrlKey: true,
    });

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('commits one drag as a single undo step', () => {
    vi.useFakeTimers({
      toFake: ['requestAnimationFrame', 'cancelAnimationFrame'],
    });
    const source = 'const color = "#ECF2F8";';
    const { container } = render(
      createElement(PlaintextEditor, {
        initialValue: source,
        language: 'typescript',
      }),
    );
    const view = EditorView.findFromDOM(
      container.querySelector<HTMLElement>('.cm-editor')!,
    )!;
    fireEvent.click(container.querySelector<HTMLElement>('.cm-hex-color-swatch')!);
    const panel = document.querySelector<HTMLElement>('.cm-hex-picker')!;
    const svArea = panel.querySelector<HTMLElement>('.cm-hex-picker__sv')!;
    const captured = new Set<number>();
    Object.defineProperties(svArea, {
      getBoundingClientRect: {
        value: () => ({
          x: 0,
          y: 0,
          left: 0,
          top: 0,
          width: 100,
          height: 100,
          right: 100,
          bottom: 100,
          toJSON: () => ({}),
        }),
      },
      setPointerCapture: { value: (pointerId: number) => captured.add(pointerId) },
      hasPointerCapture: { value: (pointerId: number) => captured.has(pointerId) },
      releasePointerCapture: {
        value: (pointerId: number) => captured.delete(pointerId),
      },
    });

    act(() => {
      fireEvent.pointerDown(svArea, {
        pointerId: 1,
        clientX: 10,
        clientY: 90,
      });
      vi.advanceTimersByTime(20);
    });
    expect(view.state.doc.toString()).toBe(source);

    act(() => {
      fireEvent.pointerMove(svArea, {
        pointerId: 1,
        clientX: 60,
        clientY: 40,
      });
      fireEvent.pointerMove(svArea, {
        pointerId: 1,
        clientX: 85,
        clientY: 20,
      });
      vi.advanceTimersByTime(20);
    });
    expect(view.state.doc.toString()).toBe(source);

    act(() => {
      fireEvent.pointerUp(svArea, { pointerId: 1, clientX: 85, clientY: 20 });
      vi.advanceTimersByTime(20);
    });
    expect(view.state.doc.toString()).not.toBe(source);

    act(() => {
      fireEvent.keyDown(view.contentDOM, {
        key: 'z',
        code: 'KeyZ',
        ctrlKey: true,
      });
    });
    expect(view.state.doc.toString()).toBe(source);
  });
});
