// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GroupWorkbenchSnapshot } from '@cindy/maker-shared/groupWorkbench';
import type { BotGroupMemberView } from '../../../../shared/botGroupChat';
import { GroupWorkbenchPanel } from '../GroupWorkbenchPanel';

const mocks = vi.hoisted(() => ({
  snapshot: null as GroupWorkbenchSnapshot | null,
  get: vi.fn(),
  act: vi.fn(),
  onChange: vi.fn(),
}));

vi.mock('react-i18next', () => {
  const t = (key: string, options?: Record<string, unknown>) => {
      if (options && 'count' in options) return `${key}:${String(options.count)}`;
      if (options && 'title' in options) return `${key}:${String(options.title)}`;
      return key;
  };
  return { useTranslation: () => ({ t }) };
});

vi.mock('@/contexts/dataOwnerGeneration', () => ({
  getDataOwnerGeneration: () => 1,
  isDataOwnerGenerationCurrent: () => true,
}));

vi.mock('../botGroupStore', () => ({
  botGroupApi: () => ({
    getBotGroupWorkbench: mocks.get,
    actBotGroupWorkbench: mocks.act,
    onBotGroupChanged: mocks.onChange,
  }),
}));

const members: BotGroupMemberView[] = [
  { botId: 'pm', name: '产品经理', avatar: '', avatarColor: 'blue', status: 'active' },
  { botId: 'designer', name: '设计师', avatar: '', avatarColor: 'pink', status: 'active' },
];

function snapshot(): GroupWorkbenchSnapshot {
  return {
    groupId: 'g1',
    running: false,
    tasks: [
      {
        id: 't1',
        title: '拆解需求',
        details: '',
        assigneeBotId: 'pm',
        assigneeName: '产品经理',
        source: 'organizer',
        originMessageId: null,
        status: 'queued',
        createdAt: 1,
        startedAt: null,
        finishedAt: null,
        result: null,
        error: null,
      },
      {
        id: 't2',
        title: '修改 UI',
        details: '',
        assigneeBotId: 'designer',
        assigneeName: '设计师',
        source: 'user',
        originMessageId: null,
        status: 'queued',
        createdAt: 2,
        startedAt: null,
        finishedAt: null,
        result: null,
        error: null,
      },
    ],
  };
}

function renderPanel() {
  return render(<GroupWorkbenchPanel groupId="g1" members={members} onClose={vi.fn()} />);
}

beforeEach(() => {
  mocks.snapshot = snapshot();
  mocks.get.mockReset().mockImplementation(async () => ({ ok: true, workbench: mocks.snapshot }));
  mocks.act.mockReset().mockImplementation(async (action: { type: string }) => ({
    ok: true,
    workbench: action.type === 'create'
      ? {
        ...mocks.snapshot!,
        tasks: [...mocks.snapshot!.tasks, {
          id: 't3',
          title: '验收',
          details: '',
          assigneeBotId: 'pm',
          assigneeName: '产品经理',
          source: 'user',
          originMessageId: null,
          status: 'queued',
          createdAt: 3,
          startedAt: null,
          finishedAt: null,
          result: null,
          error: null,
        }],
      }
      : mocks.snapshot,
  }));
  mocks.onChange.mockReset().mockReturnValue(undefined);
});

afterEach(cleanup);

describe('GroupWorkbenchPanel', () => {
  it('shows unstarted tasks and persists an explicit queue order', async () => {
    renderPanel();
    expect(await screen.findByText('拆解需求')).toBeTruthy();
    expect(screen.getAllByText('bots.groupChat.workbench.owner')).toHaveLength(2);
    expect(screen.getByText('产品经理')).toBeTruthy();
    expect(screen.getByText('设计师')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'bots.groupChat.workbench.moveDown:拆解需求' }));
    await waitFor(() => expect(mocks.act).toHaveBeenCalledWith({
      type: 'reorder',
      groupId: 'g1',
      taskIds: ['t2', 't1'],
    }));
  });

  it('creates a task for the selected member from the panel', async () => {
    renderPanel();
    await screen.findByText('拆解需求');
    fireEvent.click(screen.getByRole('button', { name: 'bots.groupChat.workbench.add' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'bots.groupChat.workbench.taskTitle' }), {
      target: { value: '验收' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'bots.groupChat.workbench.create' }));
    await waitFor(() => expect(mocks.act).toHaveBeenCalledWith({
      type: 'create',
      groupId: 'g1',
      title: '验收',
      details: '',
      assigneeBotId: 'pm',
    }));
  });

  it('offers local group members even when actorKind is omitted', async () => {
    mocks.snapshot = { groupId: 'g1', running: false, tasks: [] };
    mocks.get.mockResolvedValue({ ok: true, workbench: mocks.snapshot });
    renderPanel();
    await screen.findByText('bots.groupChat.workbench.emptyTitle');
    fireEvent.click(screen.getByRole('button', { name: 'bots.groupChat.workbench.add' }));
    expect(screen.getByRole('combobox', { name: 'bots.groupChat.workbench.assignee' }).title).toBe('产品经理');
    fireEvent.change(screen.getByRole('textbox', { name: 'bots.groupChat.workbench.taskTitle' }), {
      target: { value: '新任务' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'bots.groupChat.workbench.create' }));
    await waitFor(() => expect(mocks.act).toHaveBeenCalledWith({
      type: 'create',
      groupId: 'g1',
      title: '新任务',
      details: '',
      assigneeBotId: 'pm',
    }));
  });

  it('exposes resume, retry, and cancel actions for paused and timed-out tasks', async () => {
    const base = snapshot().tasks[0]!;
    mocks.snapshot = {
      groupId: 'g1',
      running: false,
      tasks: [
        { ...base, id: 'paused', status: 'paused' },
        { ...base, id: 'timeout', status: 'timed-out', error: 'Timed out' },
      ],
    };
    mocks.get.mockResolvedValue({ ok: true, workbench: mocks.snapshot });
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'bots.groupChat.workbench.resumeTask' }));
    await waitFor(() => expect(mocks.act).toHaveBeenCalledWith({
      type: 'resume',
      groupId: 'g1',
      taskId: 'paused',
    }));
    fireEvent.click(screen.getByRole('button', { name: 'bots.groupChat.workbench.retry' }));
    await waitFor(() => expect(mocks.act).toHaveBeenCalledWith({
      type: 'retry',
      groupId: 'g1',
      taskId: 'timeout',
    }));
    expect(screen.getAllByRole('button', { name: /bots.groupChat.workbench.cancelNamed/ })).toHaveLength(2);
  });
});
