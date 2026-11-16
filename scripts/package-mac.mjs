#!/usr/bin/env node
/**
 * 本机打 macOS 安装包：一条命令从当前工作区产出可安装的 dmg。
 *
 * 和 `apps/desktop/scripts/package-desktop.mjs` 的分工：
 *   - 那个脚本是发布流水线的入口（版本号、区域、签名、公证、build-info.json），
 *     版本无关（0.0.0）构建只产出 .app 的 zip，不产 dmg。
 *   - 本脚本面向「我在本机要一个能装的包」：调它做真正的构建与签名，
 *     再把 .app 装进 dmg、校验、挂载自检、拷到下载目录并打印摘要。
 *
 * 不做：push、发布、上传 CDN、改版本号、跑单测或 typecheck。构建本身会跑
 * packaged smoke test（除非 --skip-smoke），那是产物自检，不替代验证。
 *
 * 用法：
 *   node scripts/package-mac.mjs                    # arm64 + global + 版本无关(0.0.0)
 *   node scripts/package-mac.mjs --arch x64
 *   node scripts/package-mac.mjs --version 0.1.140  # 有版本：需要 APPLE_APP_PASSWORD，否则加 --allow-unsigned
 *   node scripts/package-mac.mjs --no-copy          # 只产出到仓库内 artifacts 目录
 *   node scripts/package-mac.mjs --out-dir ~/Desktop
 *
 * 参数：--arch --region --version --out-dir --no-copy --skip-smoke --allow-unsigned --no-sign --help
 * 其余未知参数直接拒绝（避免打错字打出个意外的包）。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_SCRIPT = path.join(ROOT, 'apps', 'desktop', 'scripts', 'package-desktop.mjs');

const USAGE = [
  'node scripts/package-mac.mjs [--arch arm64|x64] [--region global|cn|dev] [--version x.y.z]',
  '                             [--out-dir <dir>] [--no-copy] [--skip-smoke]',
  '                             [--allow-unsigned] [--no-sign]',
  '',
  '  默认      arm64 + global + 版本无关（0.0.0，不参与热更新），产出 dmg 并拷到 ~/Downloads',
  '  --version 打有版本的包；mac 走 Developer ID + 公证，需要 APPLE_APP_PASSWORD',
  '  --no-copy 只留在 apps/desktop/release/artifacts/ 下，不拷到下载目录',
  '',
  '不做：push、发布、上传 CDN、跑单测或 typecheck。',
].join('\n');

function fail(message) {
  console.error(`[package] ${message}`);
  process.exitCode = 1;
  return 1;
}

function parseArgs(argv) {
  const options = {
    arch: process.arch === 'arm64' ? 'arm64' : 'x64',
    region: 'global',
    version: null,
    outDir: path.join(os.homedir(), 'Downloads'),
    copy: true,
    passthrough: [],
  };
  const valueFlags = new Set(['--arch', '--region', '--version', '--out-dir']);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help') return { help: true };
    if (arg === '--no-copy') {
      options.copy = false;
      continue;
    }
    if (['--skip-smoke', '--allow-unsigned', '--no-sign'].includes(arg)) {
      options.passthrough.push(arg);
      continue;
    }
    if (valueFlags.has(arg)) {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} 需要一个值`);
      i += 1;
      if (arg === '--arch') {
        if (!['arm64', 'x64'].includes(value)) throw new Error(`--arch 只支持 arm64 / x64，收到 ${value}`);
        options.arch = value;
      } else if (arg === '--region') {
        if (!['global', 'cn', 'dev'].includes(value)) throw new Error(`--region 只支持 global / cn / dev，收到 ${value}`);
        options.region = value;
      } else if (arg === '--version') {
        options.version = value;
      } else {
        options.outDir = value.startsWith('~') ? path.join(os.homedir(), value.slice(1)) : path.resolve(value);
      }
      continue;
    }
    throw new Error(`未知参数：${arg}`);
  }
  return options;
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function sha256(file) {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function humanSize(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

/** 打印这次包到底包含什么：HEAD、是否有未提交改动。 */
function describeWorkspace() {
  const commit = git(['rev-parse', 'HEAD']);
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const dirty = git(['status', '--porcelain']).split('\n').filter(Boolean);
  console.log(`[package] 工作区：${branch} @ ${commit.slice(0, 10)}`);
  if (dirty.length > 0) {
    console.log(`[package] 注意：有 ${dirty.length} 个未提交改动，会被打进这个包（提交号指向 ${commit.slice(0, 10)}）`);
    for (const line of dirty.slice(0, 5)) console.log(`          ${line}`);
    if (dirty.length > 5) console.log(`          …另有 ${dirty.length - 5} 项`);
  }
}

function runBuild(options) {
  const args = [PACKAGE_SCRIPT, '--platform', 'darwin', '--arch', options.arch, '--region', options.region];
  if (options.version) args.push('--version', options.version);
  args.push(...options.passthrough);
  console.log(`[package] 构建：node ${args.map((a) => (a.startsWith('/') ? path.relative(ROOT, a) : a)).join(' ')}`);
  const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`package-desktop.mjs 退出码 ${result.status ?? 'null'}`);
}

function artifactDir(options, versionless) {
  return path.join(
    ROOT,
    'apps',
    'desktop',
    'release',
    'artifacts',
    options.region,
    versionless ? 'unversioned' : options.version,
    `darwin-${options.arch}`,
  );
}

/** 在 .app 同级目录里创建 dmg（app + /Applications 软链）。 */
function createDmg(appPath, dmgPath) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-dmg-'));
  try {
    execFileSync('/bin/cp', ['-R', appPath, stage], { stdio: 'inherit' });
    fs.symlinkSync('/Applications', path.join(stage, 'Applications'));
    if (fs.existsSync(dmgPath)) fs.rmSync(dmgPath, { force: true });
    execFileSync(
      '/usr/bin/hdiutil',
      ['create', '-volname', 'Cindy', '-srcfolder', stage, '-ov', '-format', 'UDZO', '-quiet', dmgPath],
      { stdio: 'inherit' },
    );
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

/** 校验 + 挂载自检：读出 bundle id、版本与签名方式，确保这真是个能开的包。 */
function verifyDmg(dmgPath) {
  execFileSync('/usr/bin/hdiutil', ['verify', dmgPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  const mountPoint = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-dmg-check-'));
  try {
    execFileSync(
      '/usr/bin/hdiutil',
      ['attach', '-nobrowse', '-readonly', '-mountpoint', mountPoint, dmgPath, '-quiet'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const apps = fs.readdirSync(mountPoint).filter((name) => name.endsWith('.app'));
    if (apps.length !== 1) throw new Error(`dmg 里应有 1 个 .app，实际 ${apps.length} 个`);
    const appPath = path.join(mountPoint, apps[0]);
    const plist = (key) =>
      execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, path.join(appPath, 'Contents', 'Info.plist')], {
        encoding: 'utf8',
      }).trim();
    const codesign = spawnSync('/usr/bin/codesign', ['-dv', appPath], { encoding: 'utf8' });
    const signature = /Signature=(\S+)/.exec(codesign.stderr ?? '')?.[1] ?? 'unknown';
    return { appName: apps[0], bundleId: plist('CFBundleIdentifier'), appVersion: plist('CFBundleShortVersionString'), signature };
  } finally {
    spawnSync('/usr/bin/hdiutil', ['detach', mountPoint, '-quiet']);
    fs.rmSync(mountPoint, { recursive: true, force: true });
  }
}

function copyToOutDir(dmgPath, outDir, options, appVersion) {
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const versionPart = options.version ? options.version : 'unversioned';
  const name = `cindy-${versionPart}-${options.arch}-${stamp}.dmg`;
  const target = path.join(outDir, name);
  fs.copyFileSync(dmgPath, target);
  return target;
}

function readBuildInfo(dir) {
  const file = path.join(dir, 'build-info.json');
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function main(argv) {
  if (process.platform !== 'darwin') return fail('这个脚本只打 macOS 包；其它平台用 pnpm release:package');
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`[package] ${error.message}`);
    console.error(USAGE);
    return 64;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  if (!fs.existsSync(PACKAGE_SCRIPT)) return fail(`找不到 ${path.relative(ROOT, PACKAGE_SCRIPT)}`);

  describeWorkspace();
  const versionless = !options.version;

  try {
    runBuild(options);
  } catch (error) {
    return fail(`构建失败：${error.message}`);
  }

  const dir = artifactDir(options, versionless);
  const appName = options.region === 'dev' ? 'CindyDev' : 'Cindy';
  const appPath = path.join(ROOT, 'apps', 'desktop', 'out', `${appName}-darwin-${options.arch}`, `${appName}.app`);
  if (!fs.existsSync(appPath)) return fail(`构建完成但找不到 ${path.relative(ROOT, appPath)}`);

  const baseName = versionless ? 'cindy-unversioned' : `cindy-${options.version}`;
  const packagedDmg = path.join(dir, `${baseName}-${options.arch}.dmg`);
  const dmgPath = fs.existsSync(packagedDmg) ? packagedDmg : path.join(dir, `${baseName}-${options.arch}.dmg`);
  if (!fs.existsSync(dmgPath)) {
    console.log('[package] 构建只产出了 zip（版本无关包的既有行为），这里补做 dmg');
    try {
      createDmg(appPath, dmgPath);
    } catch (error) {
      return fail(`dmg 创建失败：${error.message}`);
    }
  }

  let check;
  try {
    check = verifyDmg(dmgPath);
  } catch (error) {
    return fail(`dmg 校验失败：${error.message}`);
  }

  const digest = sha256(dmgPath);
  const size = humanSize(fs.statSync(dmgPath).size);
  const buildInfo = readBuildInfo(dir);
  const delivered = options.copy ? copyToOutDir(dmgPath, options.outDir, options, check.appVersion) : null;

  console.log('\n=== 打包完成 ===');
  console.log(`  产物      ${path.relative(ROOT, dmgPath)}`);
  if (delivered) console.log(`  已拷贝    ${delivered}`);
  console.log(`  大小      ${size}`);
  console.log(`  sha256    ${digest}`);
  console.log(`  提交      ${(buildInfo?.commitSha ?? git(['rev-parse', 'HEAD'])).slice(0, 10)}`);
  console.log(`  版本      ${versionless ? `${check.appVersion}（版本无关，不参与热更新）` : check.appVersion}`);
  console.log(`  平台      darwin-${options.arch} / ${options.region}`);
  console.log(`  bundle    ${check.bundleId} / 签名 ${check.signature}`);
  console.log(
    versionless
      ? '\n  安装：打开 dmg 拖进 Applications。本机直接双击可开；拷给别人需右键「打开」或去 quarantine。'
      : '\n  安装：Developer ID + 公证版本，可正常分发。',
  );
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`[package] 失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}
