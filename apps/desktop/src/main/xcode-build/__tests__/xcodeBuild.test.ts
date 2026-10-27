import { describe, expect, it, vi } from 'vitest';

import {
  parseXcodeAppBuildSettings,
  parseXcodeBuildDestinations,
  XcodeBuildManager,
  type XcodeBuildDependencies,
} from '../index';

/**
 * 测试价值
 *
 * - 被测生产入口：Xcode 工程发现、Scheme/目标解析及 Debug 构建/安装/启动。
 * - Bug / 规则依据：本地运行必须使用 Xcode 的 Debug 构建，不依赖 macOS UI 自动化。
 * - 现有覆盖缺口：仓库此前没有原生 Xcode 运行入口。
 * - 最小失败输入：包含 macOS 和占位目标的 destinations 输出。
 * - tier：unit。
 * - 实测耗时：< 1s（新增文件单独运行）。
 */
describe('xcode build', () => {
  it('discovers the preferred Xcode workspace, scheme, and destinations', async () => {
    const execFile = vi.fn(async (_command: string, args: readonly string[]) => {
      if (args.includes('-list')) {
        return {
          stdout: JSON.stringify({ workspace: { schemes: ['Recipes', 'App'] } }),
          stderr: '',
        };
      }
      return {
        stdout: '{ platform:iOS Simulator, arch:arm64, id:SIM-1, OS:18.2, name:iPhone 16 Pro }',
        stderr: '',
      };
    });
    const directory = (name: string) => ({ name, isDirectory: () => true });
    const readdir = vi.fn(async (directoryPath: string) => {
      if (directoryPath === '/repo') return [directory('apps')] as never;
      if (directoryPath === '/repo/apps') return [directory('mobile')] as never;
      if (directoryPath === '/repo/apps/mobile') return [directory('ios')] as never;
      if (directoryPath === '/repo/apps/mobile/ios') {
        return [directory('Recipes.xcworkspace'), directory('Recipes.xcodeproj')] as never;
      }
      return [] as never;
    });
    const manager = new XcodeBuildManager({
      dependencies: managerDependencies({
        execFile,
        readdir: readdir as unknown as XcodeBuildDependencies['readdir'],
      }),
      emit: vi.fn(),
    });

    await expect(
      manager.discover({ sessionId: 'session-1', workdir: '/repo' }),
    ).resolves.toMatchObject({
      status: 'available',
      selectedContainerPath: 'apps/mobile/ios/Recipes.xcworkspace',
      schemes: ['App', 'Recipes'],
      selectedScheme: 'Recipes',
      destinations: [expect.objectContaining({ id: 'SIM-1', kind: 'simulator' })],
    });
  });

  it('parses concrete iOS simulator and physical-device destinations', () => {
    const destinations = parseXcodeBuildDestinations(`
Available destinations for the "Recipes" scheme:
    { platform:macOS, arch:arm64, variant:Designed for [iPad,iPhone], id:MAC-1, name:My Mac }
    { platform:iOS, id:dvtdevice-DVTiPhonePlaceholder-iphoneos:placeholder, name:Any iOS Device }
    { platform:iOS Simulator, arch:arm64, id:11111111-1111-1111-1111-111111111111, OS:18.2, name:iPhone 16 Pro }
    { platform:iOS, arch:arm64, id:00008110-000A1A2A3A4A3A2E, OS:18.1, name:Simon’s iPhone }
`);

    expect(destinations).toEqual([
      expect.objectContaining({
        id: '00008110-000A1A2A3A4A3A2E',
        kind: 'device',
        name: 'Simon’s iPhone',
        osVersion: '18.1',
      }),
      expect.objectContaining({
        id: '11111111-1111-1111-1111-111111111111',
        kind: 'simulator',
        name: 'iPhone 16 Pro',
        osVersion: '18.2',
      }),
    ]);
  });

  it('builds and runs Debug on a simulator, then stops the app', async () => {
    const execFile = vi.fn(async (_command: string, args: readonly string[]) => {
      if (args.includes('-showBuildSettings')) {
        return { stdout: buildSettings('com.example.recipes', '/build/Recipes.app'), stderr: '' };
      }
      if (args[0] === 'simctl' && args[1] === 'launch') {
        return { stdout: 'com.example.recipes: 42\n', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });
    const emit = vi.fn();
    const manager = new XcodeBuildManager({
      dependencies: managerDependencies({ execFile }),
      emit,
    });

    const state = await manager.start({
      sessionId: 'session-1',
      ownerId: 7,
      workdir: '/repo',
      containerPath: 'ios/Recipes.xcworkspace',
      containerKind: 'workspace',
      scheme: 'Recipes',
      destinationId: 'SIM-1',
      destinationPlatform: 'iOS Simulator',
      destinationName: 'iPhone 16 Pro',
      destinationOsVersion: '18.2',
    });

    expect(state).toMatchObject({ status: 'running', phase: 'building' });
    await vi.waitFor(() => {
      expect(manager.status('/repo', 7).state).toMatchObject({
        status: 'running',
        phase: 'launched',
      });
    });
    expect(execFile).toHaveBeenCalledWith(
      '/usr/bin/xcrun',
      expect.arrayContaining([
        'xcodebuild',
        '-configuration',
        'Debug',
        '-destination',
        'id=SIM-1',
        'build',
      ]),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(execFile).toHaveBeenCalledWith(
      '/usr/bin/xcrun',
      ['simctl', 'install', 'SIM-1', '/build/Recipes.app'],
      expect.any(Object),
    );
    expect(execFile).toHaveBeenCalledWith(
      '/usr/bin/xcrun',
      ['simctl', 'launch', '--terminate-running-process', 'SIM-1', 'com.example.recipes'],
      expect.any(Object),
    );
    expect(
      execFile.mock.calls.some(
        ([command, args]) =>
          command === '/usr/bin/osascript' ||
          (command === '/usr/bin/open' && args.includes('Xcode')),
      ),
    ).toBe(false);
    expect(emit).toHaveBeenCalledWith(7, {
      type: 'state',
      state: expect.objectContaining({ phase: 'installing' }),
    });
    expect(emit).toHaveBeenCalledWith(7, {
      type: 'state',
      state: expect.objectContaining({ phase: 'launching' }),
    });

    await manager.stop(state.buildId, 7);
    expect(execFile).toHaveBeenCalledWith(
      '/usr/bin/xcrun',
      ['simctl', 'terminate', 'SIM-1', 'com.example.recipes'],
      expect.any(Object),
    );
    expect(manager.status('/repo', 7).state).toMatchObject({ status: 'cancelled' });
  });

  it('installs, launches, and stops a physical-device Debug build through devicectl', async () => {
    const execFile = vi.fn(async (_command: string, args: readonly string[]) => {
      if (args.includes('-showBuildSettings')) {
        return { stdout: buildSettings('com.example.recipes', '/build/Recipes.app'), stderr: '' };
      }
      if (args[0] === 'devicectl' && args[3] === 'launch') {
        return {
          stdout: `Launched application.\n${JSON.stringify({
            result: { process: { processIdentifier: 73 } },
          })}`,
          stderr: '',
        };
      }
      return { stdout: '', stderr: '' };
    });
    const manager = new XcodeBuildManager({
      dependencies: managerDependencies({ execFile }),
      emit: vi.fn(),
    });

    const state = await manager.start({
      sessionId: 'session-1',
      ownerId: 7,
      workdir: '/repo',
      containerPath: 'ios/Recipes.xcworkspace',
      containerKind: 'workspace',
      scheme: 'Recipes',
      destinationId: 'DEVICE-1',
      destinationPlatform: 'iOS',
      destinationName: 'Simon’s iPhone',
      destinationOsVersion: null,
    });
    await vi.waitFor(() => {
      expect(manager.status('/repo', 7).state?.phase).toBe('launched');
    });
    expect(execFile).toHaveBeenCalledWith(
      '/usr/bin/xcrun',
      [
        'devicectl',
        'device',
        'install',
        'app',
        '--device',
        'DEVICE-1',
        '/build/Recipes.app',
      ],
      expect.any(Object),
    );
    expect(execFile).toHaveBeenCalledWith(
      '/usr/bin/xcrun',
      expect.arrayContaining([
        'devicectl',
        'device',
        'process',
        'launch',
        '--terminate-existing',
        'com.example.recipes',
      ]),
      expect.any(Object),
    );

    await manager.stop(state.buildId, 7);
    expect(execFile).toHaveBeenCalledWith(
      '/usr/bin/xcrun',
      ['devicectl', 'device', 'process', 'terminate', '--device', 'DEVICE-1', '--pid', '73'],
      expect.any(Object),
    );
  });

  it('uses the Debug app bundle reported by Xcode build settings', () => {
    expect(parseXcodeAppBuildSettings(buildSettings('com.example.recipes', '/build/Recipes.app')))
      .toEqual({
        appPath: '/build/Recipes.app',
        bundleId: 'com.example.recipes',
      });
  });
});

function buildSettings(bundleId: string, appPath: string): string {
  return JSON.stringify([
    {
      target: 'Recipes',
      buildSettings: {
        WRAPPER_EXTENSION: 'app',
        TARGET_BUILD_DIR: appPath.slice(0, -'/Recipes.app'.length),
        FULL_PRODUCT_NAME: 'Recipes.app',
        PRODUCT_BUNDLE_IDENTIFIER: bundleId,
        CONFIGURATION: 'Debug',
      },
    },
  ]);
}

function managerDependencies(
  overrides: Partial<XcodeBuildDependencies>,
): Partial<XcodeBuildDependencies> {
  const directory = (name: string) => ({ name, isDirectory: () => true });
  return {
    platform: 'darwin',
    realpath: (async (value: string) => value) as XcodeBuildDependencies['realpath'],
    stat: async () => ({ isDirectory: () => true }) as never,
    readdir: (async (directoryPath: string) => {
      if (directoryPath === '/repo') return [directory('ios')] as never;
      if (directoryPath === '/repo/ios') {
        return [directory('Recipes.xcworkspace')] as never;
      }
      return [] as never;
    }) as XcodeBuildDependencies['readdir'],
    createBuildId: () => 'build-1',
    now: () => 100,
    ...overrides,
  };
}
