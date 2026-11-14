# 上游同步：一条命令把 upstream 合进定制分支

> **状态**：操作说明（authoritative）
> **读取时机**：要把 `upstream/main` 的新提交合进 `local/custom-main`，或判断「现在能不能同步」之前

本仓的 `local/custom-main` 是在 `upstream/main` 之上叠定制提交的分支。同步 = 把上游新提交
合进来，**不是**一次功能开发。`scripts/sync-upstream.mjs` 把这件事固定成一条命令，只做
「预检 → fetch → 合并 → 按固定策略解机械冲突 → 提交」。

## 什么时候用

- `local/custom-main` 需要跟上上游，且手上没有正在改的代码。
- 想要先看「这次会进来多少东西、有没有冲突」而不动仓库。

## 什么时候不要用

- **正在改代码时**：脚本要求工作区干净，它不会替你保存未提交改动。先把改动提交或 stash，
  否则直接拒绝执行。
- 想顺手改业务代码、修冲突里的语义分歧：那是功能任务，按
  [开发工作流](development-workflow.md) 的口径处理，同步阶段只负责把上游搬进来。
- 想顺便装依赖、跑测试、打包：不在同步阶段做（原因见下）。

## 用法

```bash
# 默认 dry-run：只 fetch 并报告，不写仓库
node scripts/sync-upstream.mjs          # 等价于 pnpm sync:upstream

# 真跑：无冲突直接提交；有冲突停下并列出各自策略
node scripts/sync-upstream.mjs --commit

# 真跑，并且按固定策略先解掉机械冲突
node scripts/sync-upstream.mjs --commit --resolve-mechanical

# 已经停在冲突上，只想让脚本再解一遍机械项（不改动人工项）
node scripts/sync-upstream.mjs --resolve-mechanical

# 清理中断 fetch 留下的临时包（不默认执行）
node scripts/sync-upstream.mjs --gc
```

| 参数 | 做什么 |
| --- | --- |
| 无参数 | `fetch upstream --prune`，报「本地领先 N、落后 M」、上游进来的提交数、文件数与增删行数、预估冲突文件（`git merge-tree`，不落盘）；不写仓库 |
| `--commit` | `git merge --no-ff --no-commit upstream/main`，无冲突时用统一的提交信息落库；有冲突时停下，工作区与索引保持原样 |
| `--resolve-mechanical` | 只为机械冲突写文件并 `git add`：配合 `--commit` 是在同步里直接解；单独用是**续跑**当前已停住的 merge。仍有需要人判断的冲突就继续停住 |
| `--gc` | 删除 `.git/objects/pack/tmp_pack_*` / `tmp_idx_*`（fetch 被中断时的残留，实测能占上百 MB）。单独使用时不要求分支或工作区状态 |
| `--help` | 打印用法 |

退出码：`0` 完成或无需同步，`1` 预检拒绝，`2` 停在冲突或 git 失败，`64` 参数错误。

dry-run 的冲突预估走 `git merge-tree --write-tree`：不改 ref、不改索引、不动工作区，
但会向对象库写入一棵不可达的 tree（后续 `git gc` 会回收）。除此之外 dry-run 不写仓库。

## 冲突策略

只有三类由脚本决定，其余停下等人：

| 冲突文件 | 策略 |
| --- | --- |
| `pnpm-lock.yaml` | 取上游版本，并提醒「构建／跑测试前先 `pnpm install --frozen-lockfile`」 |
| `apps/desktop/src/renderer/i18n/locales/**`、`i18n/glossary.json` | 以上游为底，回填本地独有的 key／术语条目（本地定制文案不能丢） |
| `i18n/GLOSSARY.md` | 取上游后跑 `node scripts/generate-glossary-doc.mjs` 重生成，不手改 |
| `docs/design-rules/DESIGN.md`、`design-decision-log.md`、`designEffectsDiscipline.test.ts`、`hardcoded-color-audit.test.mjs` | 保留本地「取色器 HSV 例外」（`hexColorPicker` 两处渐变 + `globals.css` 色相条），其余取上游；`globals.css` 的登记数按文件实际渐变数校正 |
| 其它任何文件 | 停下，脚本不猜。按开发工作流的冲突口径人工解 |

每个机械策略在写文件前都校验结构（JSON 能否解析、登记项的锚点行是否存在、断言形状是否匹配）。
形状不符时**不做启发式改写**，该文件转成人工处理。

## 出冲突后怎么继续

1. 按脚本列出的策略逐个处理；机械项重跑 `node scripts/sync-upstream.mjs --resolve-mechanical` 即可。
2. 人工项解完后 `git add <file>`。
3. `git commit` 收尾。仓库级 `rerere` 已开启，解过的同类冲突下次会自动复用
   （见下节）。
4. 想放弃本次合并：`git merge --abort`。

## rerere：让同一处冲突只解一次

脚本在第一次 `--commit` 时把 `rerere.enabled=true`、`rerere.autoupdate=true` 写进
**仓库级** `.git/config`（不是全局），解法缓存在 `.git/rr-cache`。定制分支与上游长期在
几张固定文件上反复冲突（取色器例外、本地字号覆盖、i18n 语言包、设计审计文档），
缓存命中后这些文件会预填上次的解法，仍需人扫一眼再提交。

2026-11-14 那次合并的 10 处冲突已按这种方式回放并作为种子写进 `.git/rr-cache`，
所以同样的冲突下次会直接复用当时的解法；提交信息仍然列出这次撞到的文件与策略。

## 同步阶段不做的事

明确不做，避免一次同步把「搬上游」变成「重建整个工作区」：

- 不跑 `pnpm install`、不重建 `node_modules`。上游若升级 pnpm／Node 版本（例如 2026-11-14
  把 pnpm 升到 11），第一次构建或测试时会话会要求重建，那是功能任务的时间，不是同步的。
- 不跑单测、typecheck 或任何门禁。
- 不 push、不 force、不改写历史、不开新分支。推送由维护者确认后手动做。

## 同步之后

```bash
pnpm install --frozen-lockfile      # pnpm-lock.yaml 变了才需要
pnpm --filter desktop run typecheck # 以及受影响模块的定向单测
```

验证范围按 [开发工作流](development-workflow.md) 的提交前验证口径决定；同步本身不产生
「已验证」的结论。
