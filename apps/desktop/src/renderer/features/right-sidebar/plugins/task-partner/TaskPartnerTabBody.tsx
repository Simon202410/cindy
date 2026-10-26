import { CCAgentSessionView } from '@/features/cc-agent/CCAgentSessionView';
import { SidebarHostSessionProvider } from '../../lib/sidebarHostSession';
import type { TabKindBodyProps } from '../../types';
import type { TaskPartnerTabState } from '.';

export function TaskPartnerTabBody({
  state,
  ctx,
  active = false,
  shellVisible = true,
}: TabKindBodyProps<TaskPartnerTabState>) {
  const visible = Boolean(active && shellVisible);
  if (!state.sessionId || !state.parentSessionId || state.parentSessionId !== ctx.sessionId) {
    return null;
  }
  return (
    <SidebarHostSessionProvider sessionId={ctx.sessionId}>
      <div className="chat-rail-compact h-full min-h-0">
        <CCAgentSessionView
          key={state.sessionId}
          sessionIdProp={state.sessionId}
          compact
          compactToolbar
          readOnly
          viewVisible={visible}
          chatRealtime={visible}
          disableAutofocus
          navigationMode="sidebar-embedded"
          sidebarTargetSessionId={ctx.sessionId}
        />
      </div>
    </SidebarHostSessionProvider>
  );
}
