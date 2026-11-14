#!/usr/bin/env node
/**
 * 上游同步：把「fetch upstream/main → 合进本地定制分支」固定成一条命令。
 *
 * 设计前提（2026-11-14 实测）：一次上游同步通常是上千个 commit、数千个文件，
 * 但真正吃时间的不是合并本身，而是合并之后的重装依赖与全量验证。所以本脚本
 * **只做同步**：预检、fetch、按固定策略解机械冲突、提交。它刻意不做这些，
 * 留给真正的功能任务：
 *   - 不跑 pnpm install、不重建 node_modules（依赖大版本升级时会顺带发生，脚本只提醒）
 *   - 不跑单测、typecheck 或任何门禁
 *   - 不 push、不 force、不改写历史、不开新分支
 *
 * 用法：
 *   node scripts/sync-upstream.mjs                     默认 dry-run：只读，不写仓库
 *   node scripts/sync-upstream.mjs --commit            真正 merge（无冲突时自动提交）
 *   node scripts/sync-upstream.mjs --commit --resolve-mechanical
 *                                                      同上，并按固定策略解机械冲突
 *   node scripts/sync-upstream.mjs --gc                清理中断 fetch 留下的 tmp_pack
 *
 * 冲突策略只有三类是机械的（见 MECHANICAL）；其余一律停下等人工，脚本不猜。
 * 用法说明见 docs/dev-rules/upstream-sync.md。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_BRANCH = 'local/custom-main';
const UPSTREAM_REF = 'upstream/main';
const UPSTREAM_REMOTE = 'upstream';

/** 机械冲突策略：只有这三类由脚本决定，其余人工判断。 */
const MECHANICAL = {
  lockfile: {
    id: 'lockfile',
    label: '取上游版本',
    followUp: '依赖可能已变更，构建／跑测试前先 pnpm install --frozen-lockfile',
  },
  i18n: {
    id: 'i18n',
    label: '取上游为底 + 回填本地独有词条',
    followUp: '语言包与术语产物是生成物，不手改；缺 key 时跑 pnpm check:i18n 看清单',
  },
  designAudit: {
    id: 'designAudit',
    label: '保留本地取色器例外，其余取上游',
    followUp: '改完跑 pnpm check:design-colors 与对应单测（designEffectsDiscipline / hardcoded-color-audit）',
  },
  manual: {
    id: 'manual',
    label: '人工判断',
    followUp: '脚本不猜：按 docs/dev-rules/development-workflow.md 的冲突口径人工解',
  },
};

const DESIGN_AUDIT_FILES = new Set([
  'docs/design-rules/DESIGN.md',
  'docs/design-rules/design-decision-log.md',
  'apps/desktop/src/renderer/__tests__/designEffectsDiscipline.test.ts',
  'scripts/__tests__/hardcoded-color-audit.test.mjs',
]);

const GLOSSARY_FILES = new Set(['i18n/GLOSSARY.md', 'i18n/glossary.json']);
const LOCALE_DIR = 'apps/desktop/src/renderer/i18n/locales/';
const GLOBALS_CSS = 'apps/desktop/src/renderer/styles/globals.css';

const COLOR_PICKER_ANCHOR = "'components/markdown/hexColorPicker.ts'";
const DESIGN_LOG_HEADING = '## 2026-11-09 · 取色器的两处渐变登记为功能例外';
const DESIGN_SENTENCE = "The code editor's hex colour picker keeps the two gradients";
const GRADIENT_PATTERN = /\b(?:linear|radial|conic)-gradient\(|\bbg-gradient-to-/g;

// ── git 基础 ───────────────────────────────────────────────────────────────

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

function tryGit(args) {
  try {
    return git(args).trim();
  } catch {
    return null;
  }
}

function splitLines(text) {
  return (text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function gitDir() {
  return tryGit(['rev-parse', '--git-dir']) ?? path.join(ROOT, '.git');
}

// ── 预检 ───────────────────────────────────────────────────────────────────

/**
 * 返回阻止同步的原因；空数组表示可以继续。
 * resume=true 用于「已停在冲突、要按机械策略续跑」：此时冲突文件本身就是脏的，
 * 未结束的 merge 也是预期的，所以只保留分支与远端的检查。
 */
function preflight({ resume = false } = {}) {
  const problems = [];
  const branch = tryGit(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== BASE_BRANCH) {
    problems.push(`当前分支是 ${branch ?? '(未知)'}，上游同步只在 ${BASE_BRANCH} 上做`);
  }
  const dirty = resume ? [] : splitLines(tryGit(['status', '--porcelain']));
  if (dirty.length > 0) {
    const sample = dirty.slice(0, 3).join('、');
    problems.push(
      `工作区有 ${dirty.length} 个未提交改动（${sample}${dirty.length > 3 ? ' …' : ''}）；` +
        '先提交或 stash 再同步，脚本不会替你保存这些改动',
    );
  }
  const inProgress = [
    ...(resume ? [] : [['MERGE_HEAD', '未结束的 merge']]),
    ['rebase-merge', '未结束的 rebase'],
    ['rebase-apply', '未结束的 rebase/am'],
    ['CHERRY_PICK_HEAD', '未结束的 cherry-pick'],
    ['REVERT_HEAD', '未结束的 revert'],
    ['BISECT_LOG', '正在 bisect'],
  ]
    .filter(([marker]) => fs.existsSync(path.join(ROOT, gitDir(), marker)))
    .map(([, label]) => label);
  for (const label of inProgress) problems.push(`有${label}；先收尾（git commit 或 --abort）再同步`);
  if (!tryGit(['remote', 'get-url', UPSTREAM_REMOTE])) {
    problems.push(`没有 ${UPSTREAM_REMOTE} 远端；先 git remote add ${UPSTREAM_REMOTE} <url>`);
  }
  return problems;
}

// ── 规模与冲突预估（只读） ──────────────────────────────────────────────────

function fetchUpstream() {
  git(['fetch', UPSTREAM_REMOTE, '--prune'], { stdio: ['ignore', 'pipe', 'pipe'] });
}

function compareRefs() {
  const [behind, ahead] = (tryGit(['rev-list', '--left-right', '--count', `${UPSTREAM_REF}...HEAD`]) ?? '0\t0')
    .split(/\s+/)
    .map((value) => Number.parseInt(value, 10) || 0);
  return { behind, ahead };
}

function incomingScale(base, head) {
  const shortstat = tryGit(['diff', '--shortstat', base, head]) ?? '';
  const fileCount = splitLines(tryGit(['diff', '--name-only', base, head])).length;
  return { shortstat: shortstat || '无文件变化', fileCount };
}

function parseMergeTreeConflicts(text) {
  const files = [];
  for (const line of (text ?? '').split('\n')) {
    if (!line.startsWith('CONFLICT (')) continue;
    const inFile = /Merge conflict in (.+?)\s*$/.exec(line);
    if (inFile) {
      files.push(inFile[1]);
      continue;
    }
    const afterKind = /^CONFLICT \([^)]*\): (\S+?)(?:\s|$)/.exec(line);
    if (afterKind) files.push(afterKind[1]);
  }
  return [...new Set(files)];
}

/** 用 merge-tree 预估冲突：不落盘、不改索引、不动工作区。 */
function previewConflicts() {
  try {
    const output = execFileSync(
      'git',
      ['merge-tree', '--write-tree', '--name-only', UPSTREAM_REF, 'HEAD'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { files: parseMergeTreeConflicts(output), supported: true };
  } catch (error) {
    const text = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    if (!/CONFLICT/.test(text)) return { files: [], supported: false, text };
    return { files: parseMergeTreeConflicts(text), supported: true };
  }
}

// ── 冲突策略 ───────────────────────────────────────────────────────────────

function classify(file) {
  if (file === 'pnpm-lock.yaml') return MECHANICAL.lockfile;
  if (GLOSSARY_FILES.has(file) || file.startsWith(LOCALE_DIR)) return MECHANICAL.i18n;
  if (DESIGN_AUDIT_FILES.has(file)) return MECHANICAL.designAudit;
  return MECHANICAL.manual;
}

function conflictedFiles() {
  return splitLines(tryGit(['diff', '--name-only', '--diff-filter=U']));
}

function describeConflicts(files) {
  return files.map((file) => ({ file, strategy: classify(file) }));
}

function printConflicts(entries) {
  const width = Math.max(...entries.map(({ file }) => file.length), 8);
  for (const { file, strategy, reason } of entries) {
    const suffix = reason ? `  （${reason}）` : '';
    console.log(`  ${file.padEnd(width)}  ${strategy.id.padEnd(12)} ${strategy.label}${suffix}`);
  }
  const manual = entries.filter(({ strategy }) => strategy.id === MECHANICAL.manual.id);
  if (manual.length > 0) console.log(`\n  ${manual.length} 处需要人工判断（脚本不猜）。`);
  for (const followUp of [...new Set(entries.map(({ strategy }) => strategy.followUp))]) {
    console.log(`  → ${followUp}`);
  }
}

// ── 机械策略实现：先校验结构，形状不符就交回人工 ────────────────────────────

function readAt(ref, file) {
  const text = tryGit(['show', `${ref}:${file}`]);
  // tryGit 会 trim：补回结尾换行，避免整份写回时吃掉文件末尾的 \n。
  return text === null ? null : `${text}\n`;
}

function writeFile(file, text) {
  fs.writeFileSync(path.join(ROOT, file), text);
}

function takeUpstream(file) {
  try {
    git(['checkout', '--theirs', '--', file]);
    return { note: '取上游版本' };
  } catch {
    return null;
  }
}

function flattenJson(value, prefix = '', out = new Map()) {
  for (const [key, child] of Object.entries(value)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) flattenJson(child, next, out);
    else out.set(next, child);
  }
  return out;
}

function setDeep(target, dotted, value) {
  const parts = dotted.split('.');
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts.at(-1)] = value;
}

/** 语言包：以上游为底，回填本地独有的 key（本地定制文案不能丢）。 */
function mergeLocaleFile(file) {
  const theirsRaw = readAt(UPSTREAM_REF, file);
  const oursRaw = readAt('HEAD', file);
  if (theirsRaw === null || oursRaw === null) return null;
  let theirs;
  let ours;
  try {
    theirs = JSON.parse(theirsRaw);
    ours = JSON.parse(oursRaw);
  } catch {
    return null;
  }
  if (!theirs || typeof theirs !== 'object' || Array.isArray(theirs)) return null;
  const oursFlat = flattenJson(ours);
  const theirsFlat = flattenJson(theirs);
  let restored = 0;
  for (const [key, value] of oursFlat) {
    if (theirsFlat.has(key)) continue;
    setDeep(theirs, key, value);
    restored += 1;
  }
  writeFile(file, `${JSON.stringify(theirs, null, 2)}\n`);
  return { note: `取上游为底，回填本地独有 ${restored} 个 key` };
}

/** 术语表：以上游为底，回填本地独有的术语条目（按 id）。 */
function mergeGlossaryJson(file) {
  const theirsRaw = readAt(UPSTREAM_REF, file);
  const oursRaw = readAt('HEAD', file);
  if (theirsRaw === null || oursRaw === null) return null;
  let theirs;
  let ours;
  try {
    theirs = JSON.parse(theirsRaw);
    ours = JSON.parse(oursRaw);
  } catch {
    return null;
  }
  if (!Array.isArray(theirs) || !Array.isArray(ours)) return null;
  const known = new Set(theirs.map((entry) => entry?.id).filter(Boolean));
  const extra = ours.filter((entry) => entry?.id && !known.has(entry.id));
  writeFile(file, `${JSON.stringify([...theirs, ...extra], null, 2)}\n`);
  return { note: `取上游为底，回填本地独有 ${extra.length} 条术语` };
}

/**
 * 设计审计四处冲突共用一条规则：保留本地「取色器 HSV 例外」，其余取上游。
 * 每处都按结构定位；找不到锚点就返回 null，交回人工，不做启发式改写。
 */
function keepColorPickerException(file) {
  const ours = readAt('HEAD', file);
  const theirs = readAt(UPSTREAM_REF, file);
  if (ours === null || theirs === null) return null;

  if (file === 'docs/design-rules/design-decision-log.md') {
    if (theirs.includes(DESIGN_LOG_HEADING)) return { note: '上游已含该裁决条目' };
    const start = ours.indexOf(DESIGN_LOG_HEADING);
    if (start === -1) return null;
    const next = ours.indexOf('\n## ', start + DESIGN_LOG_HEADING.length);
    const entry = ours.slice(start, next === -1 ? undefined : next).trimEnd();
    if (!entry) return null;
    writeFile(file, `${theirs.trimEnd()}\n\n${entry}\n`);
    return { note: '取上游，追加本地取色器裁决条目' };
  }

  if (file === 'docs/design-rules/DESIGN.md') {
    if (theirs.includes(DESIGN_SENTENCE)) return { note: '上游已含该例外段落' };
    const anchor = 'Apart from these and the registered exceptions below, everything else stays flat.';
    if (!theirs.includes(anchor)) return null;
    const sentence =
      "The code editor's hex colour picker keeps the two gradients that carry the HSV dimensions themselves — " +
      'the saturation/value square and the hue bar (2026-11-09) — and they may not spread to any other control. ';
    writeFile(file, theirs.replace(anchor, `${sentence}${anchor}`));
    return { note: '取上游，把取色器例外并回 §2' };
  }

  if (file === 'apps/desktop/src/renderer/__tests__/designEffectsDiscipline.test.ts') {
    const oursEntry = ours
      .split('\n')
      .find((line) => line.trimStart().startsWith(COLOR_PICKER_ANCHOR));
    if (!oursEntry) return null;
    const globalsPath = path.join(ROOT, GLOBALS_CSS);
    if (!fs.existsSync(globalsPath)) return null;
    const gradientCount = (fs.readFileSync(globalsPath, 'utf8').match(GRADIENT_PATTERN) ?? []).length;
    let text = theirs;
    let note = `按实际渐变数把 globals.css 登记校正为 ${gradientCount}`;
    if (!text.includes(COLOR_PICKER_ANCHOR)) {
      const registryLine = text
        .split('\n')
        .find((line) => line.trimStart().startsWith("'styles/globals.css':"));
      if (!registryLine) return null;
      // 沿用同组条目的缩进，别把登记项写到行首。
      const indent = /^\s*/.exec(registryLine)[0];
      text = text.replace(registryLine, `${indent}${oursEntry.trimStart()}\n${registryLine}`);
      note = `补回 hexColorPicker 登记项，并把 globals.css 计数校正为 ${gradientCount}`;
    }
    text = text.replace(/('styles\/globals\.css': \{ count: )(\d+)/, `$1${gradientCount}`);
    writeFile(file, text);
    return { note };
  }

  if (file === 'scripts/__tests__/hardcoded-color-audit.test.mjs') {
    const arrayPattern = /assert\.deepEqual\(approvedSelectors\.map\(f=>f\.value\),\s*\[[\s\S]*?\]\);/;
    const oursArray = arrayPattern.exec(ours);
    const theirsArray = arrayPattern.exec(theirs);
    if (!oursArray || !theirsArray) return null;
    writeFile(file, theirs.replace(theirsArray[0], oursArray[0]));
    return { note: '取上游，恢复 globals.css 的色相条批准值' };
  }

  return null;
}

function regenerateGlossaryDoc() {
  try {
    execFileSync('node', ['scripts/generate-glossary-doc.mjs'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

function runMechanical(entries) {
  const applied = [];
  const stuck = [];
  for (const entry of entries) {
    const { file, strategy } = entry;
    if (strategy.id === MECHANICAL.manual.id) {
      stuck.push(entry);
      continue;
    }
    let detail = null;
    if (strategy.id === MECHANICAL.lockfile.id) {
      detail = takeUpstream(file);
    } else if (strategy.id === MECHANICAL.i18n.id) {
      if (file === 'i18n/glossary.json') detail = mergeGlossaryJson(file);
      else if (file === 'i18n/GLOSSARY.md') {
        detail = takeUpstream(file);
        if (detail) regenerateGlossaryDoc();
      } else detail = mergeLocaleFile(file);
    } else if (strategy.id === MECHANICAL.designAudit.id) {
      detail = keepColorPickerException(file);
    }
    if (!detail) {
      stuck.push({ ...entry, reason: '结构与登记不符，交回人工' });
      continue;
    }
    git(['add', '--', file]);
    applied.push({ ...entry, note: detail.note });
  }
  return { applied, stuck };
}

// ── 合并提交信息（只留三行） ────────────────────────────────────────────────

function mergeMessage({ base, head, behind, shortstat, fileCount, conflicts }) {
  const conflictLine =
    conflicts.length === 0
      ? '冲突：无'
      : `冲突：${conflicts.map(({ file, strategy }) => `${file}（${strategy.id}）`).join('；')}`;
  return [
    `Merge ${UPSTREAM_REF} (${head.slice(0, 10)}) into ${BASE_BRANCH}`,
    '',
    `上游 ${base.slice(0, 10)}..${head.slice(0, 10)}，${behind} 个提交`,
    `规模：${fileCount} 个文件，${shortstat.replace(/^\s*\d+ files? changed,?\s*/, '') || '无统计'}`,
    conflictLine,
  ].join('\n');
}

// ── --gc ───────────────────────────────────────────────────────────────────

function collectGarbage() {
  const packDir = path.join(ROOT, gitDir(), 'objects', 'pack');
  if (!fs.existsSync(packDir)) {
    console.log('[sync] 没有 .git/objects/pack，跳过。');
    return;
  }
  const stale = fs
    .readdirSync(packDir)
    .filter((name) => name.startsWith('tmp_pack_') || name.startsWith('tmp_idx_'))
    .map((name) => ({ full: path.join(packDir, name), name, size: fs.statSync(path.join(packDir, name)).size }));
  if (stale.length === 0) {
    console.log('[sync] 没有残留的 tmp_pack_*，无需清理。');
    return;
  }
  const total = stale.reduce((sum, item) => sum + item.size, 0);
  for (const item of stale) fs.rmSync(item.full, { force: true });
  console.log(`[sync] 已清理 ${stale.length} 个中断 fetch 残留，释放 ${(total / 1024 / 1024).toFixed(1)} MB：`);
  for (const item of stale) console.log(`  ${item.name}  ${(item.size / 1024 / 1024).toFixed(1)} MB`);
}

// ── 主流程 ─────────────────────────────────────────────────────────────────

function configureRerere() {
  const wasEnabled = tryGit(['config', '--local', '--get', 'rerere.enabled']) === 'true';
  git(['config', '--local', 'rerere.enabled', 'true']);
  git(['config', '--local', 'rerere.autoupdate', 'true']);
  return wasEnabled;
}

function printReminders() {
  console.log(
    [
      '',
      '同步阶段到此为止。下面这些留给真正的功能任务，脚本不做：',
      '  - 依赖：pnpm-lock.yaml 变了就先 pnpm install --frozen-lockfile',
      '  - 验证：pnpm --filter desktop run typecheck，以及受影响模块的定向单测',
      '  - 推送：脚本不 push、不 force；确认后再手动推',
    ].join('\n'),
  );
}

function dryRun() {
  console.log(`[sync] fetch ${UPSTREAM_REMOTE} …`);
  fetchUpstream();
  const { behind, ahead } = compareRefs();
  console.log(`[sync] 本地 ${BASE_BRANCH} 领先 ${ahead}、落后 ${behind}`);
  if (behind === 0) {
    console.log('[sync] 没有可合并的上游提交。');
    return 0;
  }
  const base = tryGit(['merge-base', UPSTREAM_REF, 'HEAD']);
  const head = tryGit(['rev-parse', UPSTREAM_REF]);
  if (!base || !head) {
    console.error('[sync] 读不到上游 ref，无法计算规模。');
    return 2;
  }
  const { shortstat, fileCount } = incomingScale(base, head);
  console.log(
    `[sync] 上游 ${base.slice(0, 10)}..${head.slice(0, 10)}：${fileCount} 个文件，` +
      `${shortstat.replace(/^\s*\d+ files? changed,?\s*/, '')}`,
  );
  const preview = previewConflicts();
  if (!preview.supported) {
    console.log('[sync] 当前 git 不支持 merge-tree 预估（需 2.38+），冲突数未知；仍可直接 --commit。');
    return 0;
  }
  if (preview.files.length === 0) {
    console.log('[sync] 预估冲突：无。');
    return 0;
  }
  console.log(`[sync] 预估冲突：${preview.files.length} 处`);
  printConflicts(describeConflicts(preview.files));
  console.log('\n--dry-run 只报告，没有改动仓库。要真跑：node scripts/sync-upstream.mjs --commit');
  return 0;
}

/**
 * 已停在冲突时续跑：只为残余冲突里的机械文件写结果并 git add；
 * 全部解完就按三行模板提交，还剩人工项就再次停下。
 */
function resolveInProgressMerge() {
  const files = conflictedFiles();
  if (files.length === 0) {
    console.log('[sync] 当前 merge 没有未解决冲突；直接 git commit 收尾即可。');
    return 0;
  }
  const entries = describeConflicts(files);
  const { applied, stuck } = runMechanical(entries);
  if (applied.length > 0) {
    console.log('[sync] 已按固定策略解决：');
    for (const item of applied) console.log(`  ${item.file} — ${item.note}`);
  }
  if (stuck.length > 0) {
    console.log(`\n[sync] 仍有 ${stuck.length} 处需要人工判断：`);
    printConflicts(stuck);
    return 2;
  }
  const upstreamTip = tryGit(['rev-parse', 'MERGE_HEAD']) ?? '';
  const base = tryGit(['merge-base', 'MERGE_HEAD', 'HEAD']) ?? '';
  const { shortstat, fileCount } = base ? incomingScale(base, upstreamTip) : { shortstat: '', fileCount: 0 };
  git([
    'commit',
    '--no-verify',
    '-m',
    mergeMessage({
      base,
      head: upstreamTip,
      behind: Number(tryGit(['rev-list', '--count', `${base}..${upstreamTip}`]) ?? 0) || 0,
      shortstat,
      fileCount,
      conflicts: entries,
    }),
  ]);
  console.log('\n[sync] 机械冲突全部解完并提交。');
  printReminders();
  return 0;
}

function commitMergeRun({ resolveMechanical }) {
  const alreadyEnabled = configureRerere();
  console.log(
    alreadyEnabled
      ? '[sync] rerere 已在仓库级开启（.git/rr-cache 会复用解过的冲突）'
      : '[sync] 已在仓库级开启 rerere（rerere.enabled / rrere.autoupdate）',
  );
  fetchUpstream();
  const { behind } = compareRefs();
  if (behind === 0) {
    console.log('[sync] 没有可合并的上游提交。');
    return 0;
  }
  const base = tryGit(['merge-base', UPSTREAM_REF, 'HEAD']);
  const head = tryGit(['rev-parse', UPSTREAM_REF]);
  if (!base || !head) {
    console.error('[sync] 读不到上游 ref，无法合并。');
    return 2;
  }
  const { shortstat, fileCount } = incomingScale(base, head);
  // 合并前先记下冲突面：rerere 命中时合并后已经没有 U 文件，但这次到底撞了哪些
  // 文件、各自走哪条策略，仍然要写进提交信息与输出。
  const preview = previewConflicts();
  const expected = preview.supported ? describeConflicts(preview.files) : [];

  let mergeFailed = false;
  try {
    // --no-commit：干净合并时也用统一的「三行」提交信息落库。
    git(['-c', 'rerere.enabled=true', '-c', 'rerere.autoupdate=true', 'merge', '--no-ff', '--no-commit', UPSTREAM_REF], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
  } catch {
    mergeFailed = true;
  }

  const inMerge = Boolean(tryGit(['rev-parse', '-q', '--verify', 'MERGE_HEAD']));
  if (!inMerge) {
    console.error('[sync] 合并没有进入 merge 状态（检查上面的 git 输出）。');
    return 2;
  }

  let files = conflictedFiles();
  if (files.length === 0) {
    git([
      'commit',
      '--no-verify',
      '-m',
      mergeMessage({ base, head, behind, shortstat, fileCount, conflicts: expected }),
    ]);
    if (expected.length === 0) {
      console.log('[sync] 合并完成，无冲突。');
    } else {
      console.log(`[sync] 合并完成：${expected.length} 处冲突已由 rerere 复用上次解法，内容仍需扫一眼。`);
      printConflicts(expected);
    }
    printReminders();
    return 0;
  }

  const entries = describeConflicts(files);
  console.log(
    `\n[sync] 停在冲突状态：${files.length} 个文件未解决（工作区与索引保持原样，没有强合）` +
      `${mergeFailed ? '' : '；其中部分可能是 rerere 预填的，仍需逐个确认'}`,
  );

  let remaining = entries;
  if (resolveMechanical) {
    const { applied, stuck } = runMechanical(entries);
    if (applied.length > 0) {
      console.log('\n[sync] 已按固定策略解决：');
      for (const item of applied) console.log(`  ${item.file} — ${item.note}`);
    }
    remaining = stuck;
    if (remaining.length === 0) {
      git([
        'commit',
        '--no-verify',
        '-m',
        mergeMessage({ base, head, behind, shortstat, fileCount, conflicts: expected.length > 0 ? expected : entries }),
      ]);
      console.log('\n[sync] 机械冲突全部解完并提交。');
      printReminders();
      return 0;
    }
    console.log('\n[sync] 仍有需要人工判断的冲突：');
  }

  printConflicts(remaining);
  if (!resolveMechanical) {
    const mechanicalCount = entries.filter(({ strategy }) => strategy.id !== MECHANICAL.manual.id).length;
    if (mechanicalCount > 0) {
      console.log(`\n加 --resolve-mechanical 可让脚本先按固定策略解掉这 ${mechanicalCount} 处。`);
    }
  }
  console.log(
    [
      '',
      '继续的方式：',
      '  1) 解完冲突后 git add <file>，再 git commit（rerere 会记住这次解法，下次自动复用）',
      '  2) 放弃本次合并：git merge --abort',
    ].join('\n'),
  );
  return 2;
}

const USAGE = [
  'node scripts/sync-upstream.mjs [--commit] [--resolve-mechanical] [--gc]',
  '',
  '  默认                  dry-run：fetch 后只报告落后提交数、规模与预估冲突，不写仓库',
  '  --commit              真正 merge：无冲突自动提交；有冲突停下并列出各自策略',
  '  --resolve-mechanical  按固定策略解机械冲突（lockfile / i18n 产物 / 设计审计）；',
  '                       单独使用时续跑当前已停住的 merge，配合 --commit 时在同步中直接解',
  '  --gc                  清理中断 fetch 留下的 .git/objects/pack/tmp_pack_*（不默认执行）',
  '',
  '不做：pnpm install、node_modules 重建、测试、typecheck、push、force、改历史。',
].join('\n');

function main(argv) {
  const allowed = new Set(['--commit', '--resolve-mechanical', '--gc', '--help', '--dry-run']);
  const flags = argv.filter((arg) => arg.startsWith('--'));
  const unknown = flags.filter((flag) => !allowed.has(flag));
  if (unknown.length > 0) {
    console.error(`未知参数：${unknown.join(', ')}`);
    console.error(USAGE);
    return 64;
  }
  if (flags.includes('--help')) {
    console.log(USAGE);
    return 0;
  }

  const doCommit = flags.includes('--commit');
  const resolveMechanical = flags.includes('--resolve-mechanical');
  const doGc = flags.includes('--gc');

  const resuming = Boolean(tryGit(['rev-parse', '-q', '--verify', 'MERGE_HEAD']));
  if (resolveMechanical && !doCommit && !resuming) {
    console.error('[sync] --resolve-mechanical 单独使用时用于续跑已停住的 merge，当前没有未结束的 merge。');
    console.error('       要在同步里直接解机械冲突：node scripts/sync-upstream.mjs --commit --resolve-mechanical');
    return 64;
  }

  // --gc 单独使用时只删 .git 里的临时包，不要求分支与工作区干净。
  if (doGc && !doCommit) {
    collectGarbage();
    return 0;
  }

  const problems = preflight({ resume: resolveMechanical && !doCommit });
  if (problems.length > 0) {
    console.error('[sync] 拒绝执行：');
    for (const problem of problems) console.error(`  - ${problem}`);
    return 1;
  }

  if (doGc) collectGarbage();
  if (!doCommit && resolveMechanical) return resolveInProgressMerge();
  return doCommit ? commitMergeRun({ resolveMechanical }) : dryRun();
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`[sync] 失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}
