// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import {
  readTeammatesGroupSource,
  readTeammatesSectionCollapsed,
  writeTeammatesGroupSource,
  writeTeammatesSectionCollapsed,
} from '../teammatesSectionPrefs';

beforeEach(() => localStorage.clear());

describe('teammates section collapse preference', () => {
  it('defaults to expanded and keeps each account separate', () => {
    expect(readTeammatesSectionCollapsed('owner-a')).toBe(false);
    writeTeammatesSectionCollapsed('owner-a', true);
    expect(readTeammatesSectionCollapsed('owner-a')).toBe(true);
    expect(readTeammatesSectionCollapsed('owner-b')).toBe(false);
    writeTeammatesSectionCollapsed('owner-a', false);
    expect(readTeammatesSectionCollapsed('owner-a')).toBe(false);
  });

  it('stays expanded without an account and never persists for it', () => {
    writeTeammatesSectionCollapsed(null, true);
    expect(readTeammatesSectionCollapsed(null)).toBe(false);
    expect(localStorage.length).toBe(0);
  });

  it('treats unknown stored values as the expanded default', () => {
    localStorage.setItem('sidebar.teammatesSection.v1.owner.owner-a', 'sideways');
    expect(readTeammatesSectionCollapsed('owner-a')).toBe(false);
  });
});

describe('teammates section group source preference', () => {
  it('defaults to local and keeps server mode separate per account', () => {
    expect(readTeammatesGroupSource('owner-a')).toBe('local');
    writeTeammatesGroupSource('owner-a', 'server');
    expect(readTeammatesGroupSource('owner-a')).toBe('server');
    expect(readTeammatesGroupSource('owner-b')).toBe('local');
  });

  it('treats unknown stored values as local and does not persist without an account', () => {
    localStorage.setItem('sidebar.teammatesSection.groupSource.v1.owner.owner-a', 'online');
    expect(readTeammatesGroupSource('owner-a')).toBe('local');
    writeTeammatesGroupSource(null, 'server');
    expect(readTeammatesGroupSource(null)).toBe('local');
  });
});
