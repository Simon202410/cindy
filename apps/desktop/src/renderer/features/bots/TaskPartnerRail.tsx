import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageCircle } from 'lucide-react';

import { WINDOW_NO_DRAG_STYLE } from '@/components/layout/windowDrag';
import { Tip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { BotAvatar } from './BotAvatar';
import { useBotProfiles } from './botStore';
import { withoutShadowedBots } from './companionCloudPresentation';
import { useCompanionCloud } from './companionCloudStore';

/** Quiet teammate targets above a task composer; selecting one routes subsequent input to it. */
export function TaskPartnerRail({
  activeBotId,
  onSelect,
  disabled = false,
}: {
  activeBotId: string | null;
  onSelect: (botId: string | null) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const profiles = useBotProfiles();
  const cloud = useCompanionCloud();
  const bots = useMemo(
    () => withoutShadowedBots(profiles, cloud)
      .filter((bot) => (bot.status ?? 'active') === 'active' && bot.enabled && !bot.hiddenAt)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
    [cloud, profiles],
  );
  useEffect(() => {
    if (activeBotId && !bots.some((bot) => bot.id === activeBotId)) onSelect(null);
  }, [activeBotId, bots, onSelect]);
  if (bots.length === 0) return null;
  const defaultActive = activeBotId == null;

  return (
    <div
      role="group"
      aria-label={t('chat.taskPartner.railLabel')}
      className="flex min-h-6 items-center gap-0.5"
      data-testid="task-partner-rail"
    >
      <Tip text={t('chat.taskPartner.defaultTarget')} side="top" delay={0}>
        <button
          type="button"
          disabled={disabled}
          aria-pressed={defaultActive}
          aria-label={t('chat.taskPartner.defaultTarget')}
          style={WINDOW_NO_DRAG_STYLE}
          onClick={() => onSelect(null)}
          className={cn(
            'inline-flex h-6 w-6 items-center justify-center rounded-full transition-[background-color,opacity,filter] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-40',
            defaultActive
              ? 'bg-[var(--surface-chip)] text-[var(--text-primary)]'
              : 'text-[var(--text-tertiary)] opacity-45 grayscale hover:bg-[var(--surface-hover)] hover:opacity-75',
          )}
        >
          <MessageCircle size={13} strokeWidth={1.8} />
        </button>
      </Tip>
      <span aria-hidden="true" className="mx-0.5 h-3.5 w-px bg-[var(--border-default)]" />
      {bots.map((bot) => {
        const active = bot.id === activeBotId;
        return (
          <Tip key={bot.id} text={bot.name} side="top" delay={0}>
          <button
            type="button"
            disabled={disabled}
            aria-pressed={active}
            aria-label={active
              ? t('chat.taskPartner.active', { name: bot.name })
              : t('chat.taskPartner.inactive', { name: bot.name })}
            style={WINDOW_NO_DRAG_STYLE}
            onClick={() => onSelect(active ? null : bot.id)}
            className={cn(
              'inline-flex h-6 w-6 items-center justify-center rounded-full transition-[background-color,opacity,filter] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-40',
              active
                ? 'bg-[var(--surface-chip)] opacity-100'
                : 'opacity-45 grayscale hover:bg-[var(--surface-hover)] hover:opacity-75',
            )}
          >
            <BotAvatar bot={bot} size="xs" className="h-4 w-4 text-10" />
          </button>
          </Tip>
        );
      })}
    </div>
  );
}
