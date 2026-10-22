/**
 * Local group task queue. This is intentionally separate from the Bot workbench:
 * the workbench observes Sessions, while these rows describe work owned by one group.
 */

export const GROUP_WORKBENCH_MAX_TASKS = 100;
export const GROUP_WORKBENCH_TITLE_MAX_CHARS = 120;
export const GROUP_WORKBENCH_DETAILS_MAX_CHARS = 4_000;
export const GROUP_WORKBENCH_RESULT_MAX_CHARS = 16_000;
export const GROUP_WORKBENCH_TOOL_BATCH_MAX = 20;

export type GroupWorkbenchTaskStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'timed-out'
  | 'canceled';
export type GroupWorkbenchTaskSource = 'user' | 'organizer' | 'mention';

export interface GroupWorkbenchTask {
  id: string;
  title: string;
  details: string;
  assigneeBotId: string;
  assigneeName: string;
  source: GroupWorkbenchTaskSource;
  originMessageId: string | null;
  status: GroupWorkbenchTaskStatus;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  result: string | null;
  error: string | null;
}

export interface GroupWorkbenchSnapshot {
  groupId: string;
  running: boolean;
  tasks: GroupWorkbenchTask[];
}

export type GroupWorkbenchResult<T> =
  | ({ ok: true } & T)
  | { ok: false; errorCode: string; message: string };

export type GroupWorkbenchAction =
  | {
    type: 'create';
    groupId: string;
    title: string;
    details?: string;
    assigneeBotId: string;
  }
  | { type: 'reorder'; groupId: string; taskIds: string[] }
  | { type: 'start'; groupId: string }
  | { type: 'stop'; groupId: string }
  | { type: 'retry'; groupId: string; taskId: string }
  | { type: 'pause'; groupId: string; taskId: string }
  | { type: 'resume'; groupId: string; taskId: string }
  | { type: 'cancel'; groupId: string; taskId: string };

export interface GroupWorkbenchAgentTaskInput {
  title: string;
  details?: string;
  /** Exact active member name from the group context. */
  assignee: string;
}

export interface GroupWorkbenchAgentCreateInput {
  tasks: GroupWorkbenchAgentTaskInput[];
  /** Start the queue after adding the tasks. Omit when the owner has not asked to proceed. */
  start?: boolean;
}
