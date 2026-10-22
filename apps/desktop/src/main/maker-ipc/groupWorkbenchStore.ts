import { createHash } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import {
  GROUP_WORKBENCH_DETAILS_MAX_CHARS,
  GROUP_WORKBENCH_MAX_TASKS,
  GROUP_WORKBENCH_RESULT_MAX_CHARS,
  GROUP_WORKBENCH_TITLE_MAX_CHARS,
  type GroupWorkbenchSnapshot,
  type GroupWorkbenchTask,
  type GroupWorkbenchTaskSource,
} from '@cindy/maker-shared/groupWorkbench';
import { atomicWriteFileSync, readAtomicFileSync } from '../utils/atomicWriteFile.js';

export interface StoredGroupWorkbench {
  version: 1;
  running: boolean;
  workspace?: { workDir: string; branch: string | null; ownerSessionId: string | null };
  tasks: GroupWorkbenchTask[];
}

const empty = (): StoredGroupWorkbench => ({ version: 1, running: false, tasks: [] });

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function timestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function parseTask(value: unknown): GroupWorkbenchTask | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = text(row.id, 128);
  const title = text(row.title, GROUP_WORKBENCH_TITLE_MAX_CHARS);
  const assigneeBotId = text(row.assigneeBotId, 128);
  const assigneeName = text(row.assigneeName, 120);
  const status = row.status;
  const source = row.source;
  if (!id || !title || !assigneeBotId || !assigneeName) return null;
  if (status !== 'queued' && status !== 'running' && status !== 'paused' && status !== 'completed'
    && status !== 'failed' && status !== 'timed-out' && status !== 'canceled') return null;
  if (source !== 'user' && source !== 'organizer' && source !== 'mention') return null;
  return {
    id,
    title,
    details: text(row.details, GROUP_WORKBENCH_DETAILS_MAX_CHARS),
    assigneeBotId,
    assigneeName,
    source,
    originMessageId: text(row.originMessageId, 128) || null,
    status,
    createdAt: timestamp(row.createdAt) ?? Date.now(),
    startedAt: timestamp(row.startedAt),
    finishedAt: timestamp(row.finishedAt),
    result: text(row.result, GROUP_WORKBENCH_RESULT_MAX_CHARS) || null,
    error: text(row.error, 1_000) || null,
  };
}

function parse(data: unknown): StoredGroupWorkbench | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  if (row.version !== 1 || !Array.isArray(row.tasks)) return null;
  const tasks = row.tasks.map(parseTask).filter((task): task is GroupWorkbenchTask => task !== null);
  if (tasks.length !== row.tasks.length) return null;
  const workspace = row.workspace && typeof row.workspace === 'object' && !Array.isArray(row.workspace)
    ? row.workspace as Record<string, unknown>
    : null;
  const workDir = text(workspace?.workDir, 4_096);
  return {
    version: 1,
    running: row.running === true,
    ...(workDir ? {
      workspace: {
        workDir,
        branch: text(workspace?.branch, 512) || null,
        ownerSessionId: text(workspace?.ownerSessionId, 128) || null,
      },
    } : {}),
    tasks,
  };
}

export interface GroupWorkbenchStore {
  read(groupId: string): StoredGroupWorkbench;
  snapshot(groupId: string): GroupWorkbenchSnapshot;
  create(groupId: string, input: Array<{
    title: string;
    details: string;
    assigneeBotId: string;
    assigneeName: string;
    source: GroupWorkbenchTaskSource;
    originMessageId?: string;
  }>): GroupWorkbenchTask[];
  reorder(groupId: string, taskIds: string[]): boolean;
  setRunning(groupId: string, running: boolean): void;
  markRunning(groupId: string, taskId: string): void;
  markActive(groupId: string, taskId: string): void;
  markQueued(groupId: string, taskId: string): void;
  complete(groupId: string, taskId: string, result: string): void;
  fail(groupId: string, taskId: string, error: string, pauseQueue?: boolean): void;
  pause(groupId: string, taskId: string): boolean;
  resume(groupId: string, taskId: string): boolean;
  cancel(groupId: string, taskId: string): boolean;
  timeout(groupId: string, taskId: string, error: string): void;
  retry(groupId: string, taskId: string): boolean;
  setWorkspace(groupId: string, workspace: { workDir: string; branch: string | null; ownerSessionId: string | null }): void;
  remove(groupId: string): void;
}

export function createGroupWorkbenchStore(deps: {
  root: () => string;
  createId: () => string;
  now?: () => number;
}): GroupWorkbenchStore {
  const now = deps.now ?? Date.now;
  const file = (groupId: string) => path.join(
    deps.root(),
    'group-workbench',
    `${createHash('sha256').update(groupId).digest('hex')}.json`,
  );

  const read = (groupId: string): StoredGroupWorkbench => {
    const raw = readAtomicFileSync(file(groupId));
    if (raw === null) return empty();
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      throw new Error('群任务列表损坏，已停止读取以保护原数据');
    }
    const parsed = parse(decoded);
    if (!parsed) throw new Error('群任务列表损坏，已停止读取以保护原数据');
    return parsed;
  };

  const write = (groupId: string, state: StoredGroupWorkbench) => {
    const target = file(groupId);
    mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    atomicWriteFileSync(target, JSON.stringify(state));
  };

  return {
    read,
    snapshot(groupId) {
      const state = read(groupId);
      return { groupId, running: state.running, tasks: state.tasks };
    },
    create(groupId, input) {
      const state = read(groupId);
      if (state.tasks.length + input.length > GROUP_WORKBENCH_MAX_TASKS) throw new Error('群任务最多保留 100 条');
      const added = input.map((task) => ({
        id: deps.createId(),
        title: task.title.trim().slice(0, GROUP_WORKBENCH_TITLE_MAX_CHARS),
        details: task.details.trim().slice(0, GROUP_WORKBENCH_DETAILS_MAX_CHARS),
        assigneeBotId: task.assigneeBotId,
        assigneeName: task.assigneeName,
        source: task.source,
        originMessageId: task.originMessageId ?? null,
        status: 'queued' as const,
        createdAt: now(),
        startedAt: null,
        finishedAt: null,
        result: null,
        error: null,
      }));
      write(groupId, { ...state, tasks: [...state.tasks, ...added] });
      return added;
    },
    reorder(groupId, taskIds) {
      const state = read(groupId);
      const queued = state.tasks.filter((task) => task.status === 'queued');
      if (taskIds.length !== queued.length || new Set(taskIds).size !== taskIds.length) return false;
      const byId = new Map(queued.map((task) => [task.id, task]));
      if (taskIds.some((id) => !byId.has(id))) return false;
      let next = 0;
      const tasks = state.tasks.map((task) => task.status === 'queued' ? byId.get(taskIds[next++])! : task);
      write(groupId, { ...state, tasks });
      return true;
    },
    setRunning(groupId, running) {
      const state = read(groupId);
      write(groupId, { ...state, running });
    },
    markRunning(groupId, taskId) {
      const state = read(groupId);
      const at = now();
      write(groupId, {
        ...state,
        running: true,
        tasks: state.tasks.map((task) => task.id === taskId
          ? { ...task, status: 'running', startedAt: at, finishedAt: null, result: null, error: null }
          : task),
      });
    },
    markActive(groupId, taskId) {
      const state = read(groupId);
      const at = now();
      write(groupId, {
        ...state,
        tasks: state.tasks.map((task) => task.id === taskId
          ? { ...task, status: 'running', startedAt: at, finishedAt: null, result: null, error: null }
          : task),
      });
    },
    markQueued(groupId, taskId) {
      const state = read(groupId);
      write(groupId, {
        ...state,
        tasks: state.tasks.map((task) => task.id === taskId && task.status === 'running'
          ? { ...task, status: 'queued', startedAt: null }
          : task),
      });
    },
    complete(groupId, taskId, result) {
      const state = read(groupId);
      const at = now();
      write(groupId, {
        ...state,
        tasks: state.tasks.map((task) => task.id === taskId
          ? { ...task, status: 'completed', finishedAt: at, result: result.slice(0, GROUP_WORKBENCH_RESULT_MAX_CHARS), error: null }
          : task),
      });
    },
    fail(groupId, taskId, error, pauseQueue = true) {
      const state = read(groupId);
      const at = now();
      write(groupId, {
        ...state,
        running: pauseQueue ? false : state.running,
        tasks: state.tasks.map((task) => task.id === taskId
          ? { ...task, status: 'failed', finishedAt: at, result: null, error: error.slice(0, 1_000) }
          : task),
      });
    },
    pause(groupId, taskId) {
      const state = read(groupId);
      const task = state.tasks.find((candidate) => candidate.id === taskId);
      if (!task || task.status !== 'running') return false;
      write(groupId, {
        ...state,
        running: false,
        tasks: state.tasks.map((candidate) => candidate.id === taskId
          ? { ...candidate, status: 'paused' }
          : candidate),
      });
      return true;
    },
    resume(groupId, taskId) {
      const state = read(groupId);
      const task = state.tasks.find((candidate) => candidate.id === taskId);
      if (!task || task.status !== 'paused') return false;
      write(groupId, {
        ...state,
        running: true,
        tasks: state.tasks.map((candidate) => candidate.id === taskId
          ? { ...candidate, status: 'queued', startedAt: null, finishedAt: null, error: null }
          : candidate),
      });
      return true;
    },
    cancel(groupId, taskId) {
      const state = read(groupId);
      const task = state.tasks.find((candidate) => candidate.id === taskId);
      if (!task || task.status === 'completed' || task.status === 'canceled') return false;
      write(groupId, {
        ...state,
        tasks: state.tasks.map((candidate) => candidate.id === taskId
          ? { ...candidate, status: 'canceled', finishedAt: now(), result: null }
          : candidate),
      });
      return true;
    },
    timeout(groupId, taskId, error) {
      const state = read(groupId);
      const at = now();
      write(groupId, {
        ...state,
        running: false,
        tasks: state.tasks.map((candidate) => candidate.id === taskId
          ? { ...candidate, status: 'timed-out', finishedAt: at, result: null, error: error.slice(0, 1_000) }
          : candidate),
      });
    },
    retry(groupId, taskId) {
      const state = read(groupId);
      const task = state.tasks.find((candidate) => candidate.id === taskId);
      if (!task || (task.status !== 'failed' && task.status !== 'timed-out')) return false;
      write(groupId, {
        ...state,
        running: true,
        tasks: state.tasks.map((candidate) => candidate.id === taskId
          ? { ...candidate, status: 'queued', startedAt: null, finishedAt: null, result: null, error: null }
          : candidate),
      });
      return true;
    },
    setWorkspace(groupId, workspace) {
      const state = read(groupId);
      write(groupId, { ...state, workspace });
    },
    remove(groupId) {
      rmSync(file(groupId), { force: true });
    },
  };
}
