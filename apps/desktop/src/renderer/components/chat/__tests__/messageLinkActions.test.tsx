// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openExternal: vi.fn(async () => ({ success: true })),
  openPath: vi.fn(async () => ({ success: true })),
  writeText: vi.fn(async () => undefined),
  sidebar: vi.fn(async () => undefined),
  sidebarFile: vi.fn(async () => undefined),
}));
vi.mock('react-i18next', async (original) => ({
  ...(await original<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/features/right-sidebar/lib/openInSidebarBrowser', () => ({
  openUrlInSidebarBrowser: mocks.sidebar,
  pathToFileUrl: (path: string) => `file://${path}`,
}));
vi.mock('@/features/right-sidebar/lib/openInSidebarFileBrowser', () => ({
  openDirInSidebarFileBrowser: vi.fn(async () => undefined),
  openExternalFileInSidebarFileBrowser: vi.fn(async () => undefined),
  openFileInSidebarFileBrowser: mocks.sidebarFile,
}));
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { MarkdownRenderer } from '../MarkdownRenderer';
import { UserMessageImageLink } from '../UserMessageImageLink';
import { ChatSessionFileProvider } from '../ChatSessionFileContext';
import { _resetLinkOpenPreferenceForTests } from '@/hooks/useLinkOpenPreference';
import { _clearSmartResolveCache } from '@/lib/localPathResolver';

beforeEach(() => {
  vi.clearAllMocks();
  _clearSmartResolveCache();
  localStorage.clear();
  _resetLinkOpenPreferenceForTests();
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: { openExternal: mocks.openExternal, openPath: mocks.openPath },
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mocks.writeText },
  });
});
afterEach(cleanup);

describe('message link entry points', () => {
  it('uses the same preference and Shift override for assistant Markdown URLs', async () => {
    render(
      <MarkdownRenderer
        content="[Preview](http://localhost:3000)"
        currentSessionId="task"
        workingDir="/workspace"
      />,
    );
    const link = screen.getByRole('link', { name: 'Preview' });
    fireEvent.click(link);
    await waitFor(() =>
      expect(mocks.sidebar).toHaveBeenCalledWith('task', 'http://localhost:3000'),
    );
    fireEvent.click(link, { shiftKey: true });
    await waitFor(() => expect(mocks.openExternal).toHaveBeenCalledWith('http://localhost:3000'));
    expect(mocks.sidebar).toHaveBeenCalledOnce();
  });

  it('copies assistant URLs from a keyboard menu even without a task context', async () => {
    render(<MarkdownRenderer content="[Website](https://example.com)" workingDir="/workspace" />);
    fireEvent.keyDown(screen.getByRole('link', { name: 'Website' }), {
      key: 'F10',
      shiftKey: true,
    });
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'chat.markdownRenderer.copyLink' }),
    );
    await waitFor(() => expect(mocks.writeText).toHaveBeenCalledWith('https://example.com'));
    expect(mocks.openExternal).not.toHaveBeenCalled();
  });

  it('opens a resolved code link in the sidebar preview at its line', async () => {
    Object.assign(window.electronAPI, {
      resolvePathBatch: vi.fn(async ({ hrefs }: { hrefs: string[] }) =>
        Object.fromEntries(
          hrefs.map((href) => [href, {
            status: 'unique',
            candidates: ['/workspace/src/app.ts'],
            kind: 'file',
          }]),
        )),
    });
    render(
      <ChatSessionFileProvider
        value={{ sessionId: 'task', workingDir: '/workspace', origin: { kind: 'local' } }}
      >
        <MarkdownRenderer
          content="`src/app.ts:12`"
          currentSessionId="task"
          workingDir="/workspace"
        />
      </ChatSessionFileProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /src\/app\.ts/ }));
    await waitFor(() =>
      expect(mocks.sidebarFile).toHaveBeenCalledWith('task', 'src/app.ts', 12),
    );
  });

  it('provides a copy menu for in-message heading anchors', async () => {
    render(<MarkdownRenderer content="[Details](#details)" workingDir="/workspace" />);
    fireEvent.contextMenu(screen.getByRole('link', { name: 'Details' }));
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'chat.markdownRenderer.copyLink' }),
    );
    await waitFor(() => expect(mocks.writeText).toHaveBeenCalledWith('#details'));
    expect(mocks.openExternal).not.toHaveBeenCalled();
  });

  it('gives bare user image paths preview, separate-open and path-copy actions', async () => {
    const preview = vi.fn();
    render(<UserMessageImageLink path="/images/example.png" onOpen={preview} />);
    const link = screen.getByRole('button', { name: '/images/example.png' });
    fireEvent.click(link);
    expect(preview).toHaveBeenCalledOnce();
    fireEvent.click(link, { shiftKey: true });
    await waitFor(() => expect(mocks.openPath).toHaveBeenCalledWith('/images/example.png'));
    fireEvent.keyDown(link, { key: 'ContextMenu' });
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'chat.markdownRenderer.copyFilePath' }),
    );
    await waitFor(() => expect(mocks.writeText).toHaveBeenCalledWith('/images/example.png'));
  });
});
