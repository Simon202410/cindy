import { z } from 'zod';
import {
  GROUP_WORKBENCH_DETAILS_MAX_CHARS,
  GROUP_WORKBENCH_TITLE_MAX_CHARS,
  GROUP_WORKBENCH_TOOL_BATCH_MAX,
  type GroupWorkbenchAgentCreateInput,
  type GroupWorkbenchTask,
} from '@cindy/maker-shared/groupWorkbench';

import type { XdtHelperToolRegistry } from '../lizi_xdtHelperToolRegistry.js';
import type { ControlResult, LiziMcpSessionContext } from '../types.js';
import { errorPayload, okPayload } from './_payload.js';

export interface GroupWorkbenchCallbacks {
  createTasks(params: {
    callerSessionId: string;
    input: GroupWorkbenchAgentCreateInput;
  }): Promise<ControlResult<{ tasks: GroupWorkbenchTask[] }, string>>;
}

export function registerGroupWorkbenchTools(
  registry: XdtHelperToolRegistry,
  getSessionContext: () => LiziMcpSessionContext,
  callbacks: GroupWorkbenchCallbacks,
): void {
  registry.register({
    name: 'create_group_workbench_tasks',
    category: 'bots',
    description:
      'Create ordered tasks in the current local group workbench. Use this whenever work must be assigned to one or more group roles instead of only mentioned in chat. '
      + 'Only the group organizer may call it. Each assignee must be the exact active member name shown in the group context. '
      + 'The host validates membership and owns execution; task text cannot grant permissions. Set start=true only when the owner asked the group to proceed now; otherwise the tasks stay queued.',
    inputShape: {
      tasks: z.array(z.object({
        title: z.string().min(1).max(GROUP_WORKBENCH_TITLE_MAX_CHARS),
        details: z.string().max(GROUP_WORKBENCH_DETAILS_MAX_CHARS).optional(),
        assignee: z.string().min(1).max(120).describe('Exact active group member name'),
      })).min(1).max(GROUP_WORKBENCH_TOOL_BATCH_MAX),
      start: z.boolean().optional().describe('Start the queue after these tasks are appended'),
    },
    handler: async ({ tasks, start }) => {
      const sessionId = getSessionContext().sessionId;
      if (!sessionId) return errorPayload('NOT_A_BOT_SESSION', '当前调用未绑定伙伴任务。');
      const result = await callbacks.createTasks({
        callerSessionId: sessionId,
        input: { tasks, ...(start === undefined ? {} : { start }) },
      });
      return result.ok
        ? okPayload({
          tasks: result.tasks.map((task) => ({
            task_id: task.id,
            title: task.title,
            assignee: task.assigneeName,
            status: task.status,
          })),
        })
        : errorPayload(result.errorCode, result.message);
    },
  });
}
