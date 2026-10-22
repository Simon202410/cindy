import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createGroupWorkbenchStore } from '../groupWorkbenchStore.js';

const roots: string[] = [];

async function root(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cindy-group-workbench-'));
  roots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('group workbench store', () => {
  it('persists queued order and task lifecycle independently per group', async () => {
    const dir = await root();
    let next = 0;
    const store = createGroupWorkbenchStore({
      root: () => dir,
      createId: () => `task-${++next}`,
      now: () => next,
    });

    const created = store.create('group-a', [
      { title: 'Design', details: 'Change the UI', assigneeBotId: 'designer', assigneeName: 'LiZi', source: 'organizer' },
      { title: 'Integrate', details: '', assigneeBotId: 'pm', assigneeName: 'PM', source: 'organizer' },
    ]);
    expect(created.map((task) => task.title)).toEqual(['Design', 'Integrate']);
    expect(store.reorder('group-a', ['task-2', 'task-1'])).toBe(true);
    expect(store.snapshot('group-a').tasks.map((task) => task.title)).toEqual(['Integrate', 'Design']);

    store.setRunning('group-a', true);
    store.markRunning('group-a', 'task-2');
    expect(store.snapshot('group-a').tasks[0]).toMatchObject({ status: 'running', assigneeName: 'PM' });
    store.complete('group-a', 'task-2', 'Integrated');
    expect(store.snapshot('group-a').tasks[0]).toMatchObject({ status: 'completed', result: 'Integrated' });
    store.markActive('group-a', 'task-1');
    expect(store.pause('group-a', 'task-1')).toBe(true);
    expect(store.snapshot('group-a')).toMatchObject({
      running: false,
      tasks: [expect.anything(), expect.objectContaining({ status: 'paused' })],
    });
    expect(store.resume('group-a', 'task-1')).toBe(true);
    expect(store.snapshot('group-a')).toMatchObject({
      running: true,
      tasks: [expect.anything(), expect.objectContaining({ status: 'queued' })],
    });
    store.markActive('group-a', 'task-1');
    store.timeout('group-a', 'task-1', 'Timed out');
    expect(store.snapshot('group-a').tasks[1]).toMatchObject({ status: 'timed-out', error: 'Timed out' });
    expect(store.retry('group-a', 'task-1')).toBe(true);
    expect(store.snapshot('group-a')).toMatchObject({
      running: true,
      tasks: [expect.anything(), expect.objectContaining({ status: 'queued' })],
    });
    expect(store.cancel('group-a', 'task-1')).toBe(true);
    expect(store.snapshot('group-a').tasks[1]).toMatchObject({ status: 'canceled' });

    expect(store.snapshot('group-b')).toMatchObject({ running: false, tasks: [] });
  });

  it('fails closed on a corrupt task file instead of replacing it', async () => {
    const dir = await root();
    const groupId = 'group-corrupt';
    const file = path.join(dir, 'group-workbench', `${createHash('sha256').update(groupId).digest('hex')}.json`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, '{"version":1,"tasks":[', 'utf8');
    const store = createGroupWorkbenchStore({ root: () => dir, createId: () => 'task' });

    expect(() => store.snapshot(groupId)).toThrow('群任务列表损坏');
    expect(await readFile(file, 'utf8')).toBe('{"version":1,"tasks":[');
  });
});
