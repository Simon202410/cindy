// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ReviewData, ReviewFileTarget } from '@/lib/gitReview.types';
import { ChangedFilesList } from '../ChangedFilesList';
import type { WorkdirGitFileChange } from '../lib/workdirGitStatus';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/components/ui/confirm-dialog-provider', () => ({
  useConfirmDialog: () => ({ confirm: async () => true }),
}));
vi.mock('@/components/ui/tooltip', () => ({
  Tip: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/lib/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const discardFile = vi.fn(
  async (_params: { sessionId: string; targets: ReviewFileTarget[] }) => {
    void _params;
    return {
      data: {} as ReviewData,
      operation: { succeeded: ['a.ts'], failed: [], partial: false, action: 'discard' },
    };
  },
);
const unstageAll = vi.fn(
  async (_params: { sessionId: string; targets: ReviewFileTarget[] }) => {
    void _params;
    return {
      data: {
        status: {
          files: [
            {
              path: 'src/a.ts',
              oldPath: null,
              sources: ['unstaged'],
            },
            {
              path: 'new.ts',
              oldPath: null,
              sources: ['unstaged'],
            },
          ],
        },
      } as ReviewData,
      operation: { succeeded: ['a.ts'], failed: [], partial: false, action: 'unstage' },
    };
  },
);
const discardAll = vi.fn(
  async (_params: { sessionId: string; targets: ReviewFileTarget[] }) => {
    void _params;
    return {
      data: {} as ReviewData,
      operation: {
        succeeded: ['a.ts', 'new.ts'],
        failed: [],
        partial: false,
        action: 'discard',
      },
    };
  },
);

function renderList() {
  const changes = new Map<string, WorkdirGitFileChange>([
    [
      'src/a.ts',
      {
        path: 'src/a.ts',
        oldPath: null,
        kind: 'modified',
        staged: true,
        unstaged: true,
      },
    ],
    [
      'new.ts',
      {
        path: 'new.ts',
        oldPath: null,
        kind: 'untracked',
        staged: false,
        unstaged: true,
      },
    ],
  ]);
  const onReverted = vi.fn();
  render(
    <ChangedFilesList
      sessionId="session-1"
      deviceId={null}
      data={{
        scope: {
          sessionId: 'session-1',
          workdir: '/repo',
          worktreePath: '/repo',
          workingDir: '/repo',
          repoRoot: '/repo',
          branch: 'main',
          headOid: null,
          isDetached: false,
          isUnborn: false,
          source: 'worktree',
          aheadBehind: { ahead: 0, behind: 0, upstream: null, stale: false },
          disabledReason: null,
          disabledMessage: null,
          resolutionChain: [],
        },
        status: {
          scope: {} as never,
          files: [],
          stagedCount: 1,
          unstagedCount: 2,
          untrackedCount: 1,
          unmergedCount: 0,
          inProgress: [],
          writeDisabledReasons: [],
          dirty: true,
        },
        diffs: { staged: [], unstaged: [] },
        summary: {} as never,
      }}
      changes={changes}
      query=""
      selectedPath={null}
      loading={false}
      error={null}
      onSelectFile={vi.fn()}
      onReverted={onReverted}
    />,
  );
  return { changes, onReverted };
}

describe('ChangedFilesList', () => {
  it('shows aggregated changes and reverts one file or all files', async () => {
    vi.stubGlobal('electronAPI', {
      gitReview: { discardFile, discardAll, unstageAll },
    });

    const { onReverted } = renderList();
    expect(screen.getByText('rightSidebar.fileBrowser.changes')).toBeTruthy();
    const row = screen.getByRole('button', { name: /a\.ts/ });
    await act(async () => {
      fireEvent.click(
        within(row).getByRole('button', {
          name: 'rightSidebar.review.actions.discard',
        }),
      );
    });
    expect(unstageAll).toHaveBeenCalledTimes(1);
    expect(unstageAll.mock.calls[0][0].targets).toEqual([
      { path: 'src/a.ts', oldPath: null, source: 'staged' },
    ]);
    expect(discardAll).toHaveBeenCalledTimes(1);
    expect(discardAll.mock.calls[0][0].targets).toEqual([
      { path: 'src/a.ts', oldPath: null, source: 'unstaged' },
    ]);
    expect(discardFile).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'rightSidebar.review.actions.discardAll' }),
      );
    });
    expect(unstageAll).toHaveBeenCalledTimes(2);
    expect(discardAll).toHaveBeenCalledTimes(2);
    expect(discardAll.mock.calls[1][0].targets).toEqual([
      { path: 'src/a.ts', oldPath: null, source: 'unstaged' },
      { path: 'new.ts', oldPath: null, source: 'unstaged' },
    ]);
    expect(onReverted).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});
