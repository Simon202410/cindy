import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Undo2 } from 'lucide-react';

import { Tip } from '@/components/ui/tooltip';
import { useConfirmDialog } from '@/components/ui/confirm-dialog-provider';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import type {
  ReviewData,
  ReviewFileTarget,
  ReviewStageOperationResult,
} from '@/lib/gitReview.types';
import { toast } from '@/lib/toast';
import { extractIpcError } from '@/utils/ipcError';
import { filterFiles } from './lib/filterFiles';
import { pickFileIcon } from './lib/fileIcon';
import {
  WORKDIR_GIT_STATUS_VISUAL,
  type WorkdirGitFileChange,
} from './lib/workdirGitStatus';

export function ChangedFilesList({
  sessionId,
  deviceId,
  data,
  changes,
  query,
  selectedPath,
  loading,
  error,
  onSelectFile,
  onReverted,
}: {
  sessionId: string | null | undefined;
  deviceId: string | null;
  data: ReviewData | null;
  changes: ReadonlyMap<string, WorkdirGitFileChange>;
  query: string;
  selectedPath: string | null;
  loading: boolean;
  error: string | null;
  onSelectFile: (relPath: string) => void;
  onReverted: () => void;
}) {
  const { t } = useTranslation();
  const { confirm } = useConfirmDialog();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const paths = useMemo(() => [...changes.keys()].sort(), [changes]);
  const visiblePaths = useMemo(
    () => (query.trim() ? filterFiles(query, paths, 1_000) : paths),
    [paths, query],
  );
  const canRevert = Boolean(
    sessionId &&
      !deviceId &&
      data &&
      data.status?.writeDisabledReasons.length === 0,
  );

  const revert = async (targets: ReviewFileTarget[], key: string, scope: 'file' | 'section') => {
    if (!sessionId || targets.length === 0 || !canRevert) return;
    const count = scope === 'file' ? 1 : changes.size;
    const untrackedCount = targets.filter(
      (target) => changes.get(target.path)?.kind === 'untracked',
    ).length;
    const confirmed = await confirm({
      title: t(`rightSidebar.review.discard.confirm.${scope}.title`, {
        count,
      }),
      description:
        untrackedCount > 0
          ? t(`rightSidebar.review.discard.confirm.${scope}.descWithUntracked`, {
              count,
              untrackedCount,
            })
          : t(`rightSidebar.review.discard.confirm.${scope}.desc`, {
              count,
            }),
      confirmText: t('rightSidebar.review.discard.confirm.confirm'),
      cancelText: t('rightSidebar.review.discard.confirm.cancel'),
    });
    if (!confirmed) return;

    setPendingKey(key);
    try {
      const result = await discardFileChanges(sessionId, targets);
      if (result.operation.failed.length > 0) {
        toast.error(
          t('rightSidebar.review.actions.partialFailure', {
            succeeded: result.operation.succeeded.length,
            failed: result.operation.failed.length,
          }),
        );
      }
      onReverted();
    } catch (err) {
      const message = extractIpcError(err)?.message ?? String(err);
      toast.error(message);
    } finally {
      setPendingKey(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1.5 px-3 text-12">
        <span className="font-medium text-[var(--text-primary)]">
          {t('rightSidebar.fileBrowser.changes')}
        </span>
        <span className="rounded-full bg-[var(--surface-chip)] px-1.5 py-0.5 text-10 text-[var(--text-secondary)]">
          {visiblePaths.length}
        </span>
        {loading && <Spinner size={11} />}
        <Tip text={t('rightSidebar.review.actions.discardAll')}>
          <button
            type="button"
            aria-label={t('rightSidebar.review.actions.discardAll')}
            disabled={!canRevert || changes.size === 0 || pendingKey !== null}
            onClick={() => {
              const targets = [...changes.values()].flatMap(targetsForChange);
              void revert(targets, 'all', 'section');
            }}
            className="ml-auto flex size-6 items-center justify-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:pointer-events-none disabled:opacity-40"
          >
            {pendingKey === 'all' ? <Spinner size={12} /> : <Undo2 size={12} />}
          </button>
        </Tip>
      </div>

      {error && (
        <div className="px-3 py-2 text-11 text-[var(--destructive)]">{error}</div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {visiblePaths.map((path) => {
          const change = changes.get(path);
          if (!change) return null;
          const slash = path.lastIndexOf('/');
          const name = slash < 0 ? path : path.slice(slash + 1);
          const directory = slash < 0 ? '' : path.slice(0, slash);
          const Icon = pickFileIcon(name);
          const visual = WORKDIR_GIT_STATUS_VISUAL[change.kind];
          const rowKey = `file:${path}`;
          return (
            <div
              key={path}
              role="button"
              tabIndex={0}
              onClick={() => onSelectFile(path)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                onSelectFile(path);
              }}
              className={cn(
                'group/changed-file relative flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left',
                'text-12 text-[var(--text-primary)] hover:bg-[var(--sidebar-item-hover)]',
                selectedPath === path && 'bg-[var(--sidebar-item-active)]',
              )}
            >
              <Icon size={14} strokeWidth={1.75} className="shrink-0 text-[var(--text-secondary)]" />
              <span className="min-w-0 truncate">{name}</span>
              {directory && (
                <span className="min-w-0 truncate text-10 text-[var(--text-tertiary)]">
                  {directory}
                </span>
              )}
              <span
                className="ml-auto shrink-0 text-11 font-medium"
                style={{ color: visual.color }}
              >
                {visual.code}
              </span>
              <span className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-[var(--surface-elevated)] pl-1 group-hover/changed-file:flex group-focus-within/changed-file:flex">
                <Tip text={t('rightSidebar.review.actions.discard')}>
                  <button
                    type="button"
                    aria-label={t('rightSidebar.review.actions.discard')}
                    disabled={!canRevert || pendingKey !== null}
                    onClick={(event) => {
                      event.stopPropagation();
                      void revert(targetsForChange(change), rowKey, 'file');
                    }}
                    className="flex size-6 items-center justify-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:pointer-events-none disabled:opacity-40"
                  >
                    {pendingKey === rowKey ? <Spinner size={12} /> : <Undo2 size={12} />}
                  </button>
                </Tip>
              </span>
            </div>
          );
        })}
        {!loading && !error && visiblePaths.length === 0 && (
          <div className="flex h-full items-center justify-center px-4 text-center text-12 text-[var(--text-tertiary)]">
            {t('rightSidebar.fileBrowser.changedOnlyEmpty')}
          </div>
        )}
      </div>
    </div>
  );
}

async function discardFileChanges(
  sessionId: string,
  targets: ReviewFileTarget[],
): Promise<ReviewStageOperationResult> {
  const stagedTargets = targets.filter((target) => target.source === 'staged');
  const unstaged = stagedTargets.length
    ? await window.electronAPI.gitReview.unstageAll({ sessionId, targets: stagedTargets })
    : null;
  const touchedPaths = new Set<string>();
  for (const target of targets) {
    touchedPaths.add(target.path);
    if (target.oldPath) touchedPaths.add(target.oldPath);
  }
  const unstagedTargets: ReviewFileTarget[] = unstaged
    ? (unstaged.data.status?.files ?? []).flatMap((file) =>
        file.sources.includes('unstaged') &&
        (touchedPaths.has(file.path) || (file.oldPath && touchedPaths.has(file.oldPath)))
          ? [{ path: file.path, oldPath: file.oldPath, source: 'unstaged' as const }]
          : [],
      )
    : targets.filter((target) => target.source === 'unstaged');

  if (unstagedTargets.length === 0) {
    if (!unstaged) throw new Error('no file changes to discard');
    return unstaged;
  }
  const discarded = await window.electronAPI.gitReview.discardAll({
    sessionId,
    targets: unstagedTargets,
  });
  if (!unstaged) return discarded;

  const failed = [...unstaged.operation.failed, ...discarded.operation.failed];
  return {
    data: discarded.data,
    operation: {
      action: 'discard',
      succeeded: Array.from(
        new Set([...unstaged.operation.succeeded, ...discarded.operation.succeeded]),
      ),
      failed,
      partial: failed.length > 0,
    },
  };
}

function targetsForChange(change: WorkdirGitFileChange): ReviewFileTarget[] {
  const targets: ReviewFileTarget[] = [];
  if (change.unstaged) {
    targets.push({ path: change.path, oldPath: change.oldPath, source: 'unstaged' });
  }
  if (change.staged) {
    targets.push({ path: change.path, oldPath: change.oldPath, source: 'staged' });
  }
  return targets;
}
