import { Check, ChevronDown, UsersRound } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { WINDOW_NO_DRAG_STYLE } from '@/components/layout/windowDrag';
import { BotAvatar } from '@/features/bots/BotAvatar';
import { useBotProfiles } from '@/features/bots/botStore';
import { withoutShadowedBots } from '@/features/bots/companionCloudPresentation';
import { useCompanionCloud } from '@/features/bots/companionCloudStore';

const key = (name: string) => `newChat.botResponsibility.${name}`;

/** Optional teammate ownership for the task being drafted; it does not change the task runtime. */
export function BotResponsibilityPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string | null;
  onChange: (botId: string | null) => void;
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
  if (bots.length === 0) return null;

  const selected = bots.find((bot) => bot.id === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="create-agent-bot-responsibility"
          disabled={disabled}
          aria-label={selected
            ? t(key('selected'), { name: selected.name })
            : t(key('choose'))}
          title={selected
            ? t(key('selected'), { name: selected.name })
            : t(key('choose'))}
          style={WINDOW_NO_DRAG_STYLE}
          className="inline-flex h-[30px] min-w-20 max-w-[220px] items-center justify-center gap-1.5 rounded-full border border-[var(--create-agent-control-border)] bg-[var(--create-agent-control-bg)] px-3 text-12 font-medium leading-[1.167] text-[var(--create-agent-control-text)] transition-colors hover:bg-[var(--create-agent-control-bg-hover)] active:bg-[var(--create-agent-control-bg-pressed)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--create-agent-focus-ring)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {selected
            ? <BotAvatar bot={selected} size="xs" className="h-3.5 w-3.5 text-10" />
            : <UsersRound size={12} strokeWidth={2} className="shrink-0 text-[var(--create-agent-control-icon)]" />}
          <span className="min-w-0 truncate">{selected?.name ?? t(key('label'))}</span>
          <ChevronDown size={12} strokeWidth={2} className="shrink-0 text-[var(--create-agent-control-icon)]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 w-64 overflow-y-auto">
        <DropdownMenuLabel className="whitespace-normal px-2 py-1.5 text-12 font-normal leading-5 text-[var(--text-secondary)]">
          {t(key('hint'))}
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onChange(null)}>
          <span className="min-w-0 flex-1 truncate">{t(key('none'))}</span>
          {value == null ? <Check size={14} /> : null}
        </DropdownMenuItem>
        {bots.map((bot) => (
          <DropdownMenuItem key={bot.id} onSelect={() => onChange(bot.id)}>
            <BotAvatar bot={bot} size="xs" className="mr-2 h-4 w-4 text-10" />
            <span className="min-w-0 flex-1 truncate">{bot.name}</span>
            {bot.id === value ? <Check size={14} /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
