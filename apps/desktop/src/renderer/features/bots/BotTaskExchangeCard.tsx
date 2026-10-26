import { ArrowRight, SquareArrowOutUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { MarkdownRenderer } from '@/components/chat/MarkdownRenderer';
import { openTaskPartnerTab } from '@/features/right-sidebar/lib/openTaskPartnerTab';
import { useAgentIslandActivity } from '@/state/agentIslandActivity';
import { readBotTaskExchangeMeta } from '../../../shared/botTaskExchange';
import { BotAvatar } from './BotAvatar';
import { useBotProfiles } from './botStore';

export function BotTaskExchangeCard({
  data,
  sessionId,
  workingDir = '',
}: {
  data?: Record<string, unknown>;
  sessionId?: string;
  workingDir?: string;
}) {
  const meta = readBotTaskExchangeMeta(data);
  return meta ? <BotTaskExchangeCardBody meta={meta} sessionId={sessionId} workingDir={workingDir} /> : null;
}

function BotTaskExchangeCardBody({
  meta,
  sessionId,
  workingDir,
}: {
  meta: NonNullable<ReturnType<typeof readBotTaskExchangeMeta>>;
  sessionId?: string;
  workingDir: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const activity = useAgentIslandActivity(meta.partnerSessionId ?? '');
  const openPartner = async () => {
    const partnerSessionId = meta.partnerSessionId
      ?? (sessionId
        ? await window.electronAPI.localDb.bots.workbench
          .getTaskPartner(meta.botId, sessionId)
          .catch(() => null)
        : null);
    if (sessionId && partnerSessionId) {
      void openTaskPartnerTab({
        parentSessionId: sessionId,
        sessionId: partnerSessionId,
        botId: meta.botId,
        botName: meta.botName,
      });
      return;
    }
    navigate(`/bots/${encodeURIComponent(meta.botId)}`);
  };
  const profile = useBotProfiles().find((bot) => bot.id === meta.botId);
  const bot = profile ?? {
    id: meta.botId,
    name: meta.botName,
    avatar: '',
    avatarColor: 'violet',
  };
  const sent = meta.direction === 'sent';
  const liveStatus = sent && meta.status !== 'replied' && meta.status !== 'failed' && activity?.currentTurnActive
    ? activity.currentActionSummary
      ? `${meta.botName} · ${activity.currentActionSummary}`
      : t('chat.taskPartner.working', { name: meta.botName })
    : null;
  const status = meta.status === 'failed'
    ? t('chat.taskPartner.failed')
    : liveStatus ?? (sent && meta.status !== 'replied'
      ? t('chat.taskPartner.waiting')
      : null);

  return (
    <div
      className={sent ? 'my-2 ml-auto w-full max-w-[600px]' : 'my-2 w-full max-w-[600px]'}
      data-bot-task-exchange={meta.direction}
      data-session-id={sessionId}
    >
      <div className="flex items-center gap-2 px-1 text-12 text-[var(--text-secondary)]">
        {sent ? <span className="shrink-0">{t('chat.taskPartner.sent')}</span> : null}
        <BotAvatar bot={bot} size="xs" className={sent ? 'h-4 w-4 text-10' : 'h-5 w-5 text-10'} />
        <span className={sent ? 'min-w-0 flex-1 truncate' : 'min-w-0 flex-1 truncate font-medium text-[var(--text-primary)]'}>
          {sent
            ? meta.botName
            : t('chat.taskPartner.replyFrom', { name: meta.botName })}
        </span>
        <button
          type="button"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--text-tertiary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
          aria-label={t('chat.taskPartner.open', { name: meta.botName })}
          title={t('chat.taskPartner.open', { name: meta.botName })}
          onClick={() => void openPartner()}
        >
          <SquareArrowOutUpRight size={13} aria-hidden="true" />
        </button>
      </div>
      <div
        className={sent
          ? 'mt-1.5 rounded-xl bg-[var(--msg-user-bg)] px-4 py-3 text-14 leading-[1.65] text-[var(--msg-user-text)]'
          : 'mt-1.5 rounded-xl border border-[var(--msg-tool-card-border)] bg-[var(--msg-tool-card-bg)] px-4 py-3 text-14 leading-[1.65] text-[var(--text-primary)]'}
      >
        {sent ? (
          <p className="whitespace-pre-wrap break-words">{meta.text}</p>
        ) : (
          <MarkdownRenderer
            workingDir={workingDir}
            content={meta.text}
            allowPrivilegedLinks={false}
            allowManagedMedia
          />
        )}
        {meta.attachmentCount ? (
          <p className="mt-2 text-11 text-[var(--text-tertiary)]">
            {t('chat.taskPartner.attachments', { count: meta.attachmentCount })}
          </p>
        ) : null}
      </div>
      {status ? (
        <button
          type="button"
          onClick={() => void openPartner()}
          className="mt-1.5 ml-auto flex items-center justify-end gap-1 rounded-full px-1 text-11 text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
        >
          {status}
          {sent && meta.status !== 'failed' ? <ArrowRight size={11} aria-hidden="true" /> : null}
        </button>
      ) : null}
    </div>
  );
}
