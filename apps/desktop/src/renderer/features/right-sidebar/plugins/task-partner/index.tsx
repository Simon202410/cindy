import { lazy } from 'react';
import { UserRound } from 'lucide-react';

import { registerTabKind } from '../../registry';
import type { TabKindPlugin } from '../../types';

const TaskPartnerTabBody = lazy(() =>
  import('./TaskPartnerTabBody').then(module => ({ default: module.TaskPartnerTabBody })));

export interface TaskPartnerTabState {
  sessionId: string | null;
  botId: string | null;
  botName: string;
  parentSessionId: string | null;
}

function hydrateTaskPartnerState(raw: unknown): TaskPartnerTabState {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    sessionId: typeof value.sessionId === 'string' ? value.sessionId : null,
    botId: typeof value.botId === 'string' ? value.botId : null,
    botName: typeof value.botName === 'string' ? value.botName : '',
    parentSessionId: typeof value.parentSessionId === 'string' ? value.parentSessionId : null,
  };
}

const plugin: TabKindPlugin<TaskPartnerTabState> = {
  kind: 'task-partner',
  menu: {
    kind: 'task-partner',
    labelKey: 'chat.taskPartner.tabTitle',
    icon: UserRound,
    order: 20,
    enabled: true,
    hiddenFromMenu: true,
  },
  TabPillTitle: ({ t }) => <>{t('chat.taskPartner.tabTitle')}</>,
  TabPillIcon: () => <UserRound size={13} />,
  TabBody: TaskPartnerTabBody,
  defaultState: () => ({ sessionId: null, botId: null, botName: '', parentSessionId: null }),
  hydrateState: hydrateTaskPartnerState,
  serializeState: hydrateTaskPartnerState,
};

registerTabKind(plugin as unknown as TabKindPlugin, import.meta.hot);
