import type { BotGroupChatService } from './botGroupChatService.js';

let active: BotGroupChatService | null = null;

export function setGroupWorkbenchToolService(service: BotGroupChatService | null): void {
  active = service;
}

export function getGroupWorkbenchToolService(): BotGroupChatService | null {
  return active;
}
