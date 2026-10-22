import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Ban,
  CheckCircle2,
  Circle,
  CircleAlert,
  ListTodo,
  Pause,
  Play,
  Plus,
  RotateCcw,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { getDataOwnerGeneration, isDataOwnerGenerationCurrent } from '@/contexts/dataOwnerGeneration';
import {
  GROUP_WORKBENCH_DETAILS_MAX_CHARS,
  GROUP_WORKBENCH_TITLE_MAX_CHARS,
  type GroupWorkbenchAction,
  type GroupWorkbenchSnapshot,
  type GroupWorkbenchTask,
} from '@cindy/maker-shared/groupWorkbench';
import type { BotGroupMemberView } from '../../../shared/botGroupChat';
import { BotAvatar } from './BotAvatar';
import { isActiveBotGroupMember } from './botGroupPresentation';
import { botGroupApi } from './botGroupStore';

export function GroupWorkbenchPanel({
  groupId,
  members,
  onClose,
}: {
  groupId: string;
  members: readonly BotGroupMemberView[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const activeMembers = useMemo(
    // Local groups contain Bots only; local member projections may omit actorKind.
    () => members.filter(isActiveBotGroupMember),
    [members],
  );
  const memberById = useMemo(() => new Map(members.map((member) => [member.botId, member])), [members]);
  const [snapshot, setSnapshot] = useState<GroupWorkbenchSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [assignee, setAssignee] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const generation = useRef(0);
  const detailsId = useId();

  const load = useCallback(async () => {
    const api = botGroupApi();
    const request = ++generation.current;
    if (!api?.getBotGroupWorkbench) {
      setError(t('bots.groupChat.workbench.unavailable'));
      return;
    }
    try {
      const result = await api.getBotGroupWorkbench(groupId);
      if (request !== generation.current) return;
      if (!result.ok) {
        setError(result.message || t('bots.groupChat.workbench.loadFailed'));
        return;
      }
      setSnapshot(result.workbench);
      setError(null);
      setAssignee((current) => current || result.workbench.tasks[0]?.assigneeBotId || activeMembers[0]?.botId || '');
    } catch {
      if (request === generation.current) setError(t('bots.groupChat.workbench.loadFailed'));
    }
  }, [activeMembers, groupId, t]);

  useEffect(() => {
    setSnapshot(null);
    setError(null);
    setAdding(false);
    setShowCompleted(false);
    void load();
    return () => { generation.current += 1; };
  }, [groupId, load]);

  useEffect(() => {
    const api = botGroupApi();
    if (!api?.onBotGroupChanged) return;
    return api.onBotGroupChanged((payload) => {
      if (payload.groupId === groupId && payload.change === 'workbench') void load();
    });
  }, [groupId, load]);

  const act = async (action: GroupWorkbenchAction, key: string): Promise<boolean> => {
    const api = botGroupApi();
    if (!api?.actBotGroupWorkbench || busy) return false;
    const owner = getDataOwnerGeneration();
    setBusy(key);
    setError(null);
    try {
      const result = await api.actBotGroupWorkbench(action);
      if (!isDataOwnerGenerationCurrent(owner)) return false;
      if (!result.ok) {
        setError(result.message || t('bots.groupChat.workbench.actionFailed'));
        return false;
      }
      setSnapshot(result.workbench);
      return true;
    } catch {
      if (isDataOwnerGenerationCurrent(owner)) setError(t('bots.groupChat.workbench.actionFailed'));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const createTask = async () => {
    const trimmed = title.trim();
    if (!trimmed || !assignee) return;
    const created = await act({
      type: 'create',
      groupId,
      title: trimmed,
      details: details.trim(),
      assigneeBotId: assignee,
    }, 'create');
    if (created) {
      setTitle('');
      setDetails('');
      setAdding(false);
    }
  };

  const queued = snapshot?.tasks.filter((task) => task.status === 'queued') ?? [];
  const running = snapshot?.tasks.find((task) => task.status === 'running') ?? null;
  const paused = snapshot?.tasks.filter((task) => task.status === 'paused') ?? [];
  const failed = snapshot?.tasks.filter((task) => task.status === 'failed' || task.status === 'timed-out') ?? [];
  const history = snapshot?.tasks
    .filter((task) => task.status === 'completed' || task.status === 'canceled')
    .slice()
    .reverse() ?? [];

  const move = (task: GroupWorkbenchTask, direction: -1 | 1) => {
    const index = queued.findIndex((candidate) => candidate.id === task.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= queued.length) return;
    const ids = queued.map((candidate) => candidate.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    void act({ type: 'reorder', groupId, taskIds: ids }, `move:${task.id}`);
  };

  return (
    <aside
      data-testid="group-workbench"
      aria-label={t('bots.groupChat.workbench.title')}
      className="flex h-full w-[min(360px,42vw)] min-w-[300px] shrink-0 flex-col border-l border-[var(--border-default)] bg-[var(--surface)]"
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--border-default)] px-4">
        <span className="flex size-7 items-center justify-center rounded-lg bg-[var(--surface-chip)] text-[var(--text-secondary)]">
          <ListTodo size={15} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-14 font-medium text-[var(--text-primary)]">{t('bots.groupChat.workbench.title')}</h2>
          <p className="truncate text-11 text-[var(--text-tertiary)]">{t('bots.groupChat.workbench.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('bots.close')}
          className="flex size-8 items-center justify-center rounded-full text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
        >
          <X size={15} />
        </button>
      </header>

      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-default)] px-4 py-3">
        <Button
          type="button"
          size="sm"
          variant={snapshot?.running ? 'secondary' : 'cta'}
          compact
          disabled={!snapshot || busy !== null || (!snapshot.running && !running && queued.length === 0)}
          onClick={() => void act({ type: snapshot?.running ? 'stop' : 'start', groupId }, 'queue')}
        >
          {snapshot?.running ? <Pause size={13} /> : <Play size={13} />}
          {snapshot?.running
            ? t('bots.groupChat.workbench.pause')
            : t('bots.groupChat.workbench.start')}
        </Button>
        <span
          title={snapshot?.running
            ? t('bots.groupChat.workbench.runningHint')
            : t('bots.groupChat.workbench.queuedCount', { count: queued.length })}
          className="min-w-0 flex-1 truncate text-11 text-[var(--text-tertiary)]"
        >
          {snapshot?.running
            ? t('bots.groupChat.workbench.runningHint')
            : t('bots.groupChat.workbench.queuedCount', { count: queued.length })}
        </span>
        <Button type="button" size="sm" variant="secondary" compact onClick={() => setAdding((value) => !value)}>
          <Plus size={13} />
          {t('bots.groupChat.workbench.add')}
        </Button>
      </div>

      {adding ? (
        <section className="shrink-0 space-y-3 border-b border-[var(--border-default)] bg-[var(--surface-elevated)] p-4">
          <FormField label={t('bots.groupChat.workbench.taskTitle')}>
            {(control) => (
              <Input
                {...control}
                size="md"
                value={title}
                maxLength={GROUP_WORKBENCH_TITLE_MAX_CHARS}
                onChange={setTitle}
                autoFocus
              />
            )}
          </FormField>
          <div>
            <label htmlFor={detailsId} className="mb-1.5 block text-12 font-medium text-[var(--settings-section-title)]">
              {t('bots.groupChat.workbench.taskDetails')}
            </label>
            <Textarea
              id={detailsId}
              value={details}
              maxLength={GROUP_WORKBENCH_DETAILS_MAX_CHARS}
              onChange={setDetails}
              rows={3}
              className="resize-none leading-5"
            />
          </div>
          <FormField label={t('bots.groupChat.workbench.assignee')}>
            {(control) => (
              <Select
                {...control}
                label={t('bots.groupChat.workbench.assignee')}
                value={assignee}
                options={activeMembers.map((member) => ({ value: member.botId, label: member.name }))}
                onValueChange={setAssignee}
              />
            )}
          </FormField>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="secondary" compact onClick={() => setAdding(false)}>
              {t('bots.cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="cta"
              compact
              loading={busy === 'create'}
              disabled={!title.trim() || !assignee}
              onClick={() => void createTask()}
            >
              {t('bots.groupChat.workbench.create')}
            </Button>
          </div>
        </section>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {error ? <p role="alert" className="mb-3 rounded-lg bg-[var(--surface-elevated)] p-2.5 text-12 text-[var(--text-danger)]">{error}</p> : null}
        {!snapshot && !error ? (
          <p className="py-8 text-center text-12 text-[var(--text-tertiary)]">{t('bots.groupChat.workbench.loading')}</p>
        ) : null}
        {snapshot && !running && queued.length === 0 && paused.length === 0 && failed.length === 0 && history.length === 0 ? (
          <div className="py-10 text-center">
            <ListTodo size={20} className="mx-auto text-[var(--text-tertiary)]" aria-hidden />
            <p className="mt-2 text-13 font-medium text-[var(--text-secondary)]">{t('bots.groupChat.workbench.emptyTitle')}</p>
            <p className="mt-1 text-12 text-[var(--text-tertiary)]">{t('bots.groupChat.workbench.emptyDescription')}</p>
          </div>
        ) : null}

        {running ? (
          <WorkbenchSection title={t('bots.groupChat.workbench.inProgress')}>
            <TaskRow
              task={running}
              member={memberById.get(running.assigneeBotId)}
              running
              action={(
                <span className="flex items-center gap-1">
                  <Button
                    size="xs"
                    variant="secondary"
                    compact
                    loading={busy === `pause:${running.id}`}
                    onClick={() => void act({ type: 'pause', groupId, taskId: running.id }, `pause:${running.id}`)}
                  >
                    <Pause size={12} />
                    {t('bots.groupChat.workbench.pauseTask')}
                  </Button>
                  <TaskCancelButton
                    title={running.title}
                    busy={busy === `cancel:${running.id}`}
                    onCancel={() => void act({ type: 'cancel', groupId, taskId: running.id }, `cancel:${running.id}`)}
                  />
                </span>
              )}
            />
          </WorkbenchSection>
        ) : null}
        {paused.length > 0 ? (
          <WorkbenchSection title={t('bots.groupChat.workbench.paused')}>
            {paused.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                member={memberById.get(task.assigneeBotId)}
                action={(
                  <span className="flex items-center gap-1">
                    <Button
                      size="xs"
                      variant="secondary"
                      compact
                      loading={busy === `resume:${task.id}`}
                      onClick={() => void act({ type: 'resume', groupId, taskId: task.id }, `resume:${task.id}`)}
                    >
                      <Play size={12} />
                      {t('bots.groupChat.workbench.resumeTask')}
                    </Button>
                    <TaskCancelButton
                      title={task.title}
                      busy={busy === `cancel:${task.id}`}
                      onCancel={() => void act({ type: 'cancel', groupId, taskId: task.id }, `cancel:${task.id}`)}
                    />
                  </span>
                )}
              />
            ))}
          </WorkbenchSection>
        ) : null}
        {failed.length > 0 ? (
          <WorkbenchSection title={t('bots.groupChat.workbench.needsAttention')}>
            {failed.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                member={memberById.get(task.assigneeBotId)}
                action={(
                  <span className="flex items-center gap-1">
                    <Button
                      size="xs"
                      variant="secondary"
                      compact
                      loading={busy === `retry:${task.id}`}
                      onClick={() => void act({ type: 'retry', groupId, taskId: task.id }, `retry:${task.id}`)}
                    >
                      <RotateCcw size={12} />
                      {t('bots.groupChat.workbench.retry')}
                    </Button>
                    <TaskCancelButton
                      title={task.title}
                      busy={busy === `cancel:${task.id}`}
                      onCancel={() => void act({ type: 'cancel', groupId, taskId: task.id }, `cancel:${task.id}`)}
                    />
                  </span>
                )}
              />
            ))}
          </WorkbenchSection>
        ) : null}
        {queued.length > 0 ? (
          <WorkbenchSection title={t('bots.groupChat.workbench.queued')}>
            {queued.map((task, index) => (
              <TaskRow
                key={task.id}
                task={task}
                member={memberById.get(task.assigneeBotId)}
                action={(
                  <span className="flex items-center gap-0.5">
                    <button
                      type="button"
                      disabled={index === 0 || busy !== null}
                      aria-label={t('bots.groupChat.workbench.moveUp', { title: task.title })}
                      onClick={() => move(task, -1)}
                      className="flex size-7 items-center justify-center rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)] disabled:opacity-30"
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      type="button"
                      disabled={index === queued.length - 1 || busy !== null}
                      aria-label={t('bots.groupChat.workbench.moveDown', { title: task.title })}
                      onClick={() => move(task, 1)}
                      className="flex size-7 items-center justify-center rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)] disabled:opacity-30"
                    >
                      <ArrowDown size={13} />
                    </button>
                    <button
                      type="button"
                      disabled={busy !== null}
                      aria-label={t('bots.groupChat.workbench.cancelNamed', { title: task.title })}
                      onClick={() => void act({ type: 'cancel', groupId, taskId: task.id }, `cancel:${task.id}`)}
                      className="flex size-7 items-center justify-center rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-danger)] disabled:opacity-30"
                    >
                      <Ban size={13} />
                    </button>
                  </span>
                )}
              />
            ))}
          </WorkbenchSection>
        ) : null}
        {history.length > 0 ? (
          <section className="mt-6 border-t border-[var(--border-default)] pt-3">
            <button
              type="button"
              aria-expanded={showCompleted}
              onClick={() => setShowCompleted((value) => !value)}
              className="flex w-full items-center justify-between rounded-lg py-1 text-left text-12 text-[var(--text-secondary)]"
            >
              <span>{t('bots.groupChat.workbench.history')}</span>
              <span className="tabular-nums text-[var(--text-tertiary)]">{history.length}</span>
            </button>
            {showCompleted ? (
              <div className="mt-2 space-y-2">
                {history.map((task) => (
                  <TaskRow key={task.id} task={task} member={memberById.get(task.assigneeBotId)} compact />
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </aside>
  );
}

function TaskCancelButton({
  title,
  busy,
  onCancel,
}: {
  title: string;
  busy: boolean;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      size="xs"
      variant="secondary"
      compact
      loading={busy}
      aria-label={t('bots.groupChat.workbench.cancelNamed', { title })}
      onClick={onCancel}
      className="px-2 text-[var(--text-danger)]"
    >
      <Ban size={12} />
    </Button>
  );
}

function WorkbenchSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5 last:mb-0">
      <h3 className="mb-2 text-11 font-medium uppercase tracking-wide text-[var(--text-tertiary)]">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function TaskRow({
  task,
  member,
  running = false,
  compact = false,
  action,
}: {
  task: GroupWorkbenchTask;
  member?: BotGroupMemberView;
  running?: boolean;
  compact?: boolean;
  action?: ReactNode;
}) {
  const { t } = useTranslation();
  const statusIcon = task.status === 'completed'
    ? <CheckCircle2 size={14} className="text-[var(--text-secondary)]" />
    : task.status === 'failed' || task.status === 'timed-out'
      ? <CircleAlert size={14} className="text-[var(--text-danger)]" />
      : task.status === 'canceled'
        ? <Ban size={14} className="text-[var(--text-tertiary)]" />
        : task.status === 'paused'
          ? <Pause size={14} className="text-[var(--text-secondary)]" />
      : running
        ? <span className="session-status-breathing flex size-3.5 items-center justify-center"><Circle size={9} fill="currentColor" className="text-[var(--status-bar-accent)]" /></span>
        : <Circle size={12} className="text-[var(--text-tertiary)]" />;
  return (
    <article
      data-testid="group-workbench-task"
      data-status={task.status}
      className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-2.5"
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">{statusIcon}</span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-13 font-medium leading-5 text-[var(--text-primary)]">{task.title}</p>
          <div className="mt-2 flex min-w-0 items-center gap-2 rounded-lg bg-[var(--surface)] px-2 py-1.5">
            {member ? <BotAvatar bot={member} size="xs" /> : (
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--surface-chip)] text-10 font-medium text-[var(--text-secondary)]">
                {task.assigneeName.slice(0, 1)}
              </span>
            )}
            <span className="shrink-0 text-11 text-[var(--text-tertiary)]">{t('bots.groupChat.workbench.owner')}</span>
            <span
              title={task.assigneeName}
              className="min-w-0 truncate text-11 font-medium text-[var(--text-primary)]"
            >
              {task.assigneeName}
            </span>
            <span
              className="ml-auto shrink-0 rounded-full bg-[var(--surface-elevated)] px-1.5 py-0.5 text-10 text-[var(--text-secondary)]"
              data-status={task.status}
            >
              {t(`bots.groupChat.workbench.status.${task.status}`)}
            </span>
          </div>
          {!compact && task.details ? <p className="mt-1.5 line-clamp-2 text-11 leading-4 text-[var(--text-secondary)]">{task.details}</p> : null}
          {task.error ? <p className="mt-1.5 text-11 leading-4 text-[var(--text-danger)]">{task.error}</p> : null}
          {task.result && !running ? <p className="mt-1.5 line-clamp-2 text-11 leading-4 text-[var(--text-secondary)]">{task.result}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </article>
  );
}
