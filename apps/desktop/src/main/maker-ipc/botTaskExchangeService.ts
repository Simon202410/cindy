import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';

import { getDbClient } from '../localDb/client/current.js';
import { botProfiles, botSessionLinks, messages, sessions } from '../localDb/schema.js';
import {
  broadcastMessageAgentMetaUpdate,
  createMessage,
  patchMessageAgentMeta,
} from '../localDb/ipc/messages.js';
import {
  BOT_TASK_EXCHANGE_MAX_CHARS,
  parseTaskPartnerRouteKey,
  readBotTaskExchangeMeta,
  type BotTaskExchangeMeta,
} from '../../shared/botTaskExchange.js';
import { companionHomes, isCompanionShadowed } from '../companion-cloud/homes.js';
import { canAssignTaskResponsibility } from './botTaskResponsibility.js';
import { resolveWorkbenchCaller } from './botWorkbenchTools.js';
import type { AgentInputFileCategory, AgentInputSerializedFile } from '../../shared/agentInputQueue.js';
import { visibleMessageText } from '../localDb/conversationSearch.pure.js';

export type BotTaskExchangeFile = AgentInputSerializedFile;

export interface BotTaskExchangeDeps {
  ensurePartnerSession(input: { botId: string; taskId: string }): Promise<
    | { ok: true; sessionId: string }
    | { ok: false; errorCode: string; message: string }
  >;
  takeResponsibility(botId: string, taskId: string): Promise<void>;
  dispatch(input: {
    botSessionId: string;
    taskId: string;
    bridgeId: string;
    userRequest: string;
    message: string;
    persistedContent: string;
    files?: BotTaskExchangeFile[];
  }): Promise<{ ok: true } | { ok: false; errorCode: string; message: string }>;
}

function requiredText(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('INVALID_ARGS');
  return value;
}

function validFiles(value: unknown): BotTaskExchangeFile[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 20) throw new Error('INVALID_ARGS');
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('INVALID_ARGS');
    const row = item as Record<string, unknown>;
    const id = requiredText(row.id, 200);
    const name = requiredText(row.name, 300);
    const path = requiredText(row.path, 4096);
    const ext = typeof row.ext === 'string' ? row.ext.slice(0, 32) : '';
    const category = requiredText(row.category, 32) as AgentInputFileCategory;
    if (!['image', 'pdf', 'text', 'office', 'file'].includes(category)) throw new Error('INVALID_ARGS');
    const mimeType = requiredText(row.mimeType, 200);
    const size = row.size;
    if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) throw new Error('INVALID_ARGS');
    return {
      id,
      name,
      ...(typeof row.originalName === 'string' && row.originalName.trim()
        ? { originalName: row.originalName.slice(0, 300) }
        : {}),
      path,
      ...(typeof row.url === 'string' && row.url.trim() ? { url: row.url.slice(0, 4096) } : {}),
      ext,
      size,
      category,
      mimeType,
      ...(row.annotated === true ? { annotated: true } : {}),
    };
  });
}

export function createBotTaskExchangeService(deps: BotTaskExchangeDeps) {
  const sentClientId = (bridgeId: string) => `bot-task-exchange:${bridgeId}:sent`;
  const replyClientId = (bridgeId: string) => `bot-task-exchange:${bridgeId}:reply`;

  const updateSentStatus = async (
    taskId: string,
    bridgeId: string,
    sent: BotTaskExchangeMeta,
    status: BotTaskExchangeMeta['status'],
  ) => {
    const meta = { ...sent, status };
    const clientId = sentClientId(bridgeId);
    if (!(await patchMessageAgentMeta(taskId, clientId, { botTaskExchange: meta }))) return;
    await broadcastMessageAgentMetaUpdate(taskId, clientId);
  };

  return {
    async send(input: { taskId: string; botId: string; message: string; files?: unknown }) {
      const taskId = requiredText(input.taskId, 256);
      const botId = requiredText(input.botId, 128);
      const body = requiredText(input.message, BOT_TASK_EXCHANGE_MAX_CHARS);
      const files = validFiles(input.files);
      const db = getDbClient().drizzle;
      const [[bot], [task], [link]] = await Promise.all([
        db.select({ name: botProfiles.displayName, status: botProfiles.status })
          .from(botProfiles).where(eq(botProfiles.id, botId)).limit(1),
        db.select({
          title: sessions.title,
          status: sessions.status,
          source: sessions.source,
          remoteHostId: sessions.remoteHostId,
          orcaRole: sessions.orcaRole,
          workingDir: sessions.workingDir,
        }).from(sessions).where(eq(sessions.id, taskId)).limit(1),
        db.select({ id: botSessionLinks.id }).from(botSessionLinks)
          .where(eq(botSessionLinks.sessionId, taskId)).limit(1),
      ]);
      if (!task || !bot?.name || !canAssignTaskResponsibility({
        botStatus: bot.status,
        botHomeHere: companionHomes.isHomeHere(botId),
        botShadowed: isCompanionShadowed(botId),
        task: task ? {
          status: task.status,
          source: task.source,
          remoteHostId: task.remoteHostId,
          orcaRole: task.orcaRole,
          botLinked: Boolean(link),
        } : null,
      })) throw new Error('TASK_PARTNER_UNAVAILABLE');

      const partnerSession = await deps.ensurePartnerSession({ botId, taskId });
      if (!partnerSession.ok) throw new Error(partnerSession.message || partnerSession.errorCode);
      await deps.takeResponsibility(botId, taskId);

      const bridgeId = randomUUID();
      const sent: BotTaskExchangeMeta = {
        v: 1,
        bridgeId,
        taskId,
        botId,
        botName: bot.name,
        partnerSessionId: partnerSession.sessionId,
        direction: 'sent',
        text: body,
        status: 'sent',
        ...(files?.length ? { attachmentCount: files.length } : {}),
      };
      await createMessage(taskId, {
        clientId: sentClientId(bridgeId),
        role: 'assistant',
        content: '',
        agentKind: null,
        agentMeta: { botTaskExchange: sent },
      });

      const context = [
        `用户在任务「${task.title || taskId}」中临时把下面这条消息交给你。`,
        `task_id: ${taskId}`,
        task.workingDir ? `working_dir: ${task.workingDir}` : '',
        '先用 get_task_digest 和 read_workbench_task 了解任务上下文；需要让原任务继续时使用 continue_workbench_task。',
        `回复会直接显示在原任务里，不需要另开任务。调用 reply_to_task，bridge_id 使用 "${bridgeId}"。`,
        '',
        body,
      ].filter(Boolean).join('\n');
      const result = await deps.dispatch({
        botSessionId: partnerSession.sessionId,
        taskId,
        bridgeId,
        userRequest: body,
        message: context,
        persistedContent: `[来自任务「${task.title || taskId}」]\n\n${body}`,
        files,
      }).catch((error) => ({
        ok: false as const,
        errorCode: 'INTERNAL',
        message: error instanceof Error ? error.message : String(error),
      }));
      if (!result.ok) {
        await updateSentStatus(taskId, bridgeId, sent, 'failed').catch(() => {});
        throw new Error(result.message);
      }
      return { bridgeId, botId, taskId };
    },

    async reply(input: { callerSessionId: string; bridgeId: string; message: string }) {
      const bridgeId = requiredText(input.bridgeId, 128);
      const body = requiredText(input.message, BOT_TASK_EXCHANGE_MAX_CHARS);
      const caller = await resolveWorkbenchCaller(requiredText(input.callerSessionId, 256));
      if (!caller.ok) throw new Error(caller.message || caller.errorCode);
      const db = getDbClient().drizzle;
      const [keeper] = await db.select({ routeKey: botSessionLinks.routeKey })
        .from(botSessionLinks)
        .where(and(
          eq(botSessionLinks.sessionId, input.callerSessionId),
          eq(botSessionLinks.botId, caller.botId),
          eq(botSessionLinks.role, 'thread'),
        ))
        .limit(1);
      const [row] = await db.select({ sessionId: messages.sessionId, agentMeta: messages.agentMeta })
        .from(messages)
        .where(and(
          eq(messages.role, 'assistant'),
          sql`json_extract(${messages.agentMeta}, '$.botTaskExchange.bridgeId') = ${bridgeId}`,
        ))
        .limit(1);
      let sentValue: unknown = null;
      if (row?.agentMeta) {
        try {
          sentValue = (JSON.parse(row.agentMeta) as { botTaskExchange?: unknown } | null)?.botTaskExchange ?? null;
        } catch {
          sentValue = null;
        }
      }
      const sent = readBotTaskExchangeMeta(sentValue);
      if (!row || !sent || sent.direction !== 'sent' || sent.botId !== caller.botId || sent.taskId !== row.sessionId
        || sent.status === 'failed' || parseTaskPartnerRouteKey(keeper?.routeKey) !== sent.taskId) {
        throw new Error('TASK_EXCHANGE_NOT_FOUND');
      }
      const received: BotTaskExchangeMeta = {
        ...sent,
        direction: 'received',
        text: body,
        status: 'replied',
        attachmentCount: undefined,
      };
      await createMessage(sent.taskId, {
        clientId: replyClientId(bridgeId),
        role: 'assistant',
        content: '',
        agentKind: null,
        agentMeta: { botTaskExchange: received },
      });
      await updateSentStatus(sent.taskId, bridgeId, sent, 'replied');
      return { bridgeId, taskId: sent.taskId, botId: sent.botId };
    },

    /** If the teammate answered without calling reply_to_task, mirror its final turn reply. */
    async mirrorTurnReply(laneSessionId: string, assistantClientId: string) {
      const db = getDbClient().drizzle;
      const [lane] = await db.select({
        botId: botSessionLinks.botId,
        routeKey: botSessionLinks.routeKey,
      }).from(botSessionLinks)
        .where(and(
          eq(botSessionLinks.sessionId, laneSessionId),
          eq(botSessionLinks.role, 'thread'),
        ))
        .limit(1);
      const taskId = parseTaskPartnerRouteKey(lane?.routeKey);
      if (!lane || !taskId) return;
      const [reply] = await db.select({
        content: messages.content,
        agentMeta: messages.agentMeta,
      }).from(messages)
        .where(and(
          eq(messages.sessionId, laneSessionId),
          eq(messages.clientId, assistantClientId),
          eq(messages.role, 'assistant'),
        ))
        .limit(1);
      if (!reply) return;
      let replyMeta: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(reply.agentMeta ?? '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          replyMeta = parsed as Record<string, unknown>;
        }
      } catch {
        return;
      }
      if (replyMeta.turnCompleted !== true || replyMeta.botPrivateReply === true
        || replyMeta.assistantPhase === 'commentary') return;
      const replyTo = typeof replyMeta.replyToClientId === 'string' ? replyMeta.replyToClientId : '';
      const bridgeId = /^bot-task-exchange:([^:]+):request$/.exec(replyTo)?.[1];
      let sentRow: { clientId: string; agentMeta: string | null } | undefined;
      if (bridgeId) {
        [sentRow] = await db.select({ clientId: messages.clientId, agentMeta: messages.agentMeta })
          .from(messages)
          .where(and(
            eq(messages.sessionId, taskId),
            eq(messages.role, 'assistant'),
            sql`json_extract(${messages.agentMeta}, '$.botTaskExchange.bridgeId') = ${bridgeId}`,
          ))
          .limit(1);
      } else {
        [sentRow] = await db.select({ clientId: messages.clientId, agentMeta: messages.agentMeta })
          .from(messages)
          .where(and(
            eq(messages.sessionId, taskId),
            eq(messages.role, 'assistant'),
            sql`json_extract(${messages.agentMeta}, '$.botTaskExchange.direction') = 'sent'`,
            sql`coalesce(json_extract(${messages.agentMeta}, '$.botTaskExchange.status'), '') != 'replied'`,
            sql`json_extract(${messages.agentMeta}, '$.botTaskExchange.botId') = ${lane.botId}`,
          ))
          .orderBy(desc(messages.createdAt))
          .limit(1);
      }
      let sentValue: unknown = null;
      try {
        sentValue = (JSON.parse(sentRow?.agentMeta ?? '{}') as { botTaskExchange?: unknown } | null)?.botTaskExchange ?? null;
      } catch {
        return;
      }
      const sent = readBotTaskExchangeMeta(sentValue);
      if (!sent || sent.direction !== 'sent' || sent.botId !== lane.botId || sent.taskId !== taskId) return;
      const [existingReply] = await db.select({ id: messages.id }).from(messages)
        .where(and(
          eq(messages.sessionId, taskId),
          eq(messages.clientId, replyClientId(sent.bridgeId)),
        ))
        .limit(1);
      if (!existingReply) {
        let content: unknown = reply.content;
        try { content = JSON.parse(reply.content); } catch { /* older plain text */ }
        const text = visibleMessageText('assistant', content)
          .replace(/^\s*\[(?:任务协作|临时协助)(?:请求)?\]\s*/, '')
          .trim()
          .slice(0, BOT_TASK_EXCHANGE_MAX_CHARS);
        if (!text) return;
        await createMessage(taskId, {
          clientId: replyClientId(sent.bridgeId),
          role: 'assistant',
          content: '',
          agentKind: null,
          agentMeta: {
            botTaskExchange: {
              ...sent,
              direction: 'received',
              text,
              status: 'replied',
              attachmentCount: undefined,
            } satisfies BotTaskExchangeMeta,
          },
        });
      }
      await updateSentStatus(taskId, sent.bridgeId, sent, 'replied');
    },
  };
}

export type BotTaskExchangeService = ReturnType<typeof createBotTaskExchangeService>;
let service: BotTaskExchangeService | null = null;

export function setBotTaskExchangeService(value: BotTaskExchangeService | null): void {
  service = value;
}

export function tryGetBotTaskExchangeService(): BotTaskExchangeService | null {
  return service;
}
