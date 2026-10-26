import { addTab, ensureHydrated, getBucket, setActiveTab } from '../store';
import { requestRightSidebarVisibility } from './sidebarCommands';

export async function openTaskPartnerTab(input: {
  parentSessionId: string;
  sessionId: string;
  botId: string;
  botName: string;
}): Promise<void> {
  await ensureHydrated(input.parentSessionId);
  const existing = getBucket(input.parentSessionId).tabs.find(tab =>
    tab.kind === 'task-partner'
    && (tab.state as { sessionId?: string } | null)?.sessionId === input.sessionId);
  if (existing) {
    await setActiveTab(input.parentSessionId, existing.id);
  } else {
    await addTab(input.parentSessionId, 'task-partner', {
      sessionId: input.sessionId,
      botId: input.botId,
      botName: input.botName,
      parentSessionId: input.parentSessionId,
    });
  }
  requestRightSidebarVisibility('open', {
    sessionId: input.parentSessionId,
    userInitiated: true,
  });
}
