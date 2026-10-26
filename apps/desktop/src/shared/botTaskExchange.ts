export const BOT_TASK_EXCHANGE_MAX_CHARS = 4_000;
export const TASK_PARTNER_ROUTE_PREFIX = 'task-partner:';

export function taskPartnerRouteKey(taskId: string): string {
  if (!/^[^:\s]{1,256}$/.test(taskId)) throw new Error('Invalid task id');
  return `${TASK_PARTNER_ROUTE_PREFIX}${taskId}`;
}

export function parseTaskPartnerRouteKey(routeKey: string | null | undefined): string | null {
  if (!routeKey?.startsWith(TASK_PARTNER_ROUTE_PREFIX)) return null;
  const taskId = routeKey.slice(TASK_PARTNER_ROUTE_PREFIX.length);
  return /^[^:\s]{1,256}$/.test(taskId) ? taskId : null;
}

export interface BotTaskExchangeMeta {
  v: 1;
  bridgeId: string;
  taskId: string;
  botId: string;
  botName: string;
  partnerSessionId?: string;
  direction: 'sent' | 'received';
  text: string;
  status?: 'sending' | 'sent' | 'failed' | 'replied';
  attachmentCount?: number;
}

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() && value.length <= max ? value : null;
}

/** Host-written metadata only; malformed or foreign values never become a card. */
export function readBotTaskExchangeMeta(value: unknown): BotTaskExchangeMeta | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const bridgeId = text(raw.bridgeId, 128);
  const taskId = text(raw.taskId, 256);
  const botId = text(raw.botId, 128);
  const botName = text(raw.botName, 200);
  const body = text(raw.text, BOT_TASK_EXCHANGE_MAX_CHARS);
  if (raw.v !== 1 || !bridgeId || !taskId || !botId || !botName || !body) return null;
  if (raw.direction !== 'sent' && raw.direction !== 'received') return null;
  const status = raw.status === 'sending' || raw.status === 'sent' || raw.status === 'failed' || raw.status === 'replied'
    ? raw.status
    : undefined;
  const attachmentCount = typeof raw.attachmentCount === 'number'
    && Number.isInteger(raw.attachmentCount) && raw.attachmentCount >= 0
      ? raw.attachmentCount
      : undefined;
  const partnerSessionId = text(raw.partnerSessionId, 256) ?? undefined;
  return {
    v: 1,
    bridgeId,
    taskId,
    botId,
    botName,
    ...(partnerSessionId ? { partnerSessionId } : {}),
    direction: raw.direction,
    text: body,
    ...(status ? { status } : {}),
    ...(attachmentCount !== undefined ? { attachmentCount } : {}),
  };
}
