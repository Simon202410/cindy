# Cindy 客户端仓：Agent 工作入口

Cindy 是面向大众用户的开源 AI 助手，连接模型、工具与设备，帮助用户在自己的文件和
应用中完成工作。

## 仓库边界与安全底线

- 本仓库只负责 desktop、mobile 及其共享 packages。
- 服务端位于独立仓库；除非用户明确要求，不要跨仓修改服务端。
- 开始工作前先检查工作区状态，不覆盖、不回退用户已有改动。
- 先读实际代码和测试，再决定实现；不要只依赖文档猜测现状。
- 用户凭证、令牌、授权文件和密钥不得写入仓库或任何可能被 Git 跟踪的路径。
- 未经用户明确授权，不执行删除数据、覆盖改动、推送、发布、合并等外部或难以
  恢复的操作。
- 发现任务会触及系统提示词、更新器、协议兼容、数据库历史 migration、权限边界
  或用户数据安全时，必须先停下来核对专项规则，并在动手前向用户说明风险或
  请求确认。

## 产品方向

Cindy 面向大众用户，让人以简单高效的方式用 AI 完成工作。我们追求极致的体验：
用户面前的每一分简单，都是产品在背后承担的复杂和匠心。产品、UI 与架构的取舍，以
[产品原则](docs/product-rules/core-product-principles.md)、[设计规范](docs/design-rules/DESIGN.md)
与[架构原则](docs/dev-rules/architecture-invariants.md)为准。

## 按模块进入

开发、启动、调试或验证对应模块前，先读下表入口，再按改动触发条件读专题；根级规则始终适用。
跨模块行为先从[仓库地图的行为导航](docs/dev-rules/repo-map.md#按用户行为定位)查找公共入口与测试，
不要只修改最先找到的页面或渠道。

| 修改范围 | 模块规则入口 | 开发与架构正本 |
| --- | --- | --- |
| Desktop：main、renderer、preload、数据库、个人 IM / 官方 hook | [apps/desktop/AGENTS.md](apps/desktop/AGENTS.md) | [Desktop 开发](docs/dev-rules/desktop-development.md) |
| Mobile：Expo 页面、远程调用、原生配置与模块；在手机上查看效果 | [apps/mobile/AGENTS.md](apps/mobile/AGENTS.md) | [Mobile 开发与冷更边界](docs/dev-rules/mobile-development.md) |
| maker-core：Agent 编排、prompt、工具、translator、用量 | [packages/maker-core/AGENTS.md](packages/maker-core/AGENTS.md) | [Agent 行为](docs/dev-rules/maker-core-and-agent-behavior.md) |

## 找到要读的规则

专题规则在各自文档的开头声明读取时机与适用路径，[规则索引](docs/dev-rules/rule-index.md)由这些
声明生成。动手前按要改的路径运行 `pnpm rules:for <路径…>` 或直接查索引，提交前运行
`pnpm rules:changed`，把列出的规则读完；索引里判定为「主题」的规则不能由路径判定，按读取时机
判断。没有 pnpm 时用 `node scripts/rule-index.mjs for <路径…>`。产品、设计、工程的完整导航
分别见 [产品规则](docs/product-rules/README.md)、[设计规则](docs/design-rules/README.md)、
[开发规则](docs/dev-rules/README.md)。新增规则不在本文件登记，写法见
`docs/dev-rules/development-workflow.md` §4、§5。

下列规则多数任务都会碰到，始终适用；涉及多个主题时同时适用。

- 首次接触本仓、需要定位功能代码位置或判断新代码归属模块时，先读仓库地图
  `docs/dev-rules/repo-map.md`。
- 首次安装、修复依赖或准备新 worktree 时，必须先读
  `docs/dev-rules/environment-setup.md`。
- 修改凭证或授权信息处理、文件落盘位置、用户持久数据、临时文件或测试目录前，必须
  先读 `docs/dev-rules/credentials-and-local-storage.md`。
- 新增或调整产品功能、判断能力应进入 Core / Skill / 插件、设计人机交互或多端体验
  前，必须先读 `docs/product-rules/core-product-principles.md`。
- 新增或修改任何界面、组件、布局、样式、动效或 UI 文案前，必须先读权威设计规范
  `docs/design-rules/DESIGN.md` 开头的「阅读路由」，再按路由读相关章节与专题，不需要
  通读全文。Light／Dark 双模式交付门槛、圆角与点击目标、术语表、「任务／对话／消息」
  的叫法、Token 与标准组件的治理都从这张路由进入。
- 修改任何进入模型 system 段的提示词前（无论文件位于哪个模块），必须先读
  `docs/dev-rules/maker-core-and-agent-behavior.md`。
- 新增或修改 Desktop 日志、IPC 错误处理、main 侧业务逻辑与测试、客户端本地或远程数据读取／
  扫描、变化通知后的刷新、界面频繁触发的持久化写入、缓存与轮询性能、跨平台（macOS／Windows）
  行为、每个功能都要登记的列表或版本号，或任何 UI 文案的 i18n 落地前，必须先读
  `docs/dev-rules/engineering-conventions.md`。
- 新增或改写任一测试前，必须先读该文件 §3.2「新增测试的价值门槛」与其中的「性能预算」：
  测试经真实生产入口验证可观察结果，写明依据、覆盖缺口、最小失败输入和 tier；
  `pnpm check:test-hygiene` 在 CI 阻断违规，基线只减不增。
- 修改本地协议 package、插件分发来源边界或 device-link 协议／relay／隧道
  payload／IPC allowlist，或任何改动跨端 wire protocol 前，必须先读
  `docs/dev-rules/protocol-compatibility.md`；影响自建中转的改动要在同一次改动里完成同步
  适配与互通验证。
- 新增或修改直接／间接的服务器请求、订阅、推送、同步、轮询或重试（包括界面调用方）前，
  必须先读 `docs/dev-rules/server-channel-review.md`：结合通道用途、共享容量与累计压力
  检查调用方式及次数频率；自审与 AI review 按实际严重程度报告问题，不排除 P2 缺陷。
- 修改 package 依赖方向、main 进程模块加载方式、桌面与 Node Host（`apps/host`）共用的业务主体
  （`*.desktop.ts` 装配、工厂端口注入），或主界面布局树结构前，必须先读
  `docs/dev-rules/architecture-invariants.md`；改共用主体后还要跑 Host 的测试和类型检查（§5）。
- 新增或修改涉及 workdir 文件、agent 进程、会话数据的功能，新增 IPC channel／推送事件，
  或修改 device-link 的重试／超时／断链恢复逻辑前，必须先读
  `docs/dev-rules/remote-and-mobile-adaptation.md`；其中恢复路径改动必须回答该文件的
  「故障半径三问」。
- 在 Cindy 内嵌 worktree 会话里工作、准备提交或直推、或做 code review 前，必须先读
  `docs/dev-rules/development-workflow.md`。

### 红线

漏读会造成难以挽回的后果。改到对应路径时规则索引同样会列出它们。

- **存量插件兼容**：修改插件（`.cindy`）运行时、沙箱、权限、能力 slot、批准状态、manifest、
  安装布局、包格式或插件市场前，必须先读 `docs/dev-rules/plugin-security-and-authoring.md`。
  用户升级后什么都不做，已装、已批准、已启用的插件必须照旧可用，不得要求重新安装、重新确认
  权限或重新配置；漏迁移 = P0。改到插件基座的 PR 需放行人明确 Approve 才能合并。
- **Pi 原生能力非退化**：修改 PI harness 集成、PI 会话权限／配置／system prompt／桥接或上线
  判断前，必须先读 `docs/dev-rules/pi-harness.md`。Pi 原生允许的安装、更新、扩展加载与 Agent
  自助修复，Cindy 不得拒绝、停用或变成不可逆流程，不能让 Cindy Pi 比同版本原生 Pi 更难用。
- **自动更新链路**：修改 `cindy-updater` 或 Electron 侧更新服务前，必须先读
  `docs/dev-rules/cindy-updater.md`，并先取得仓库维护者确认。
- **日志脱敏**：修改客户端日志采集／脱敏／上报链路、main 日志行格式、崩溃判定或待补传标记
  前，必须先读 `docs/dev-rules/log-upload-and-redaction.md`。记录边界、白名单方向、标记代次
  三条不变量不得破坏，脱敏规则只增不减。

## Git 与交付

- 本仓默认 PR-first。代码和文档通常从非默认分支通过 PR 进入 `main`；只有仓库
  维护者明确选择例外时才允许直推主干。
- commit、push 和创建 PR 的执行时机由开发者或 Codex、Claude Code、Cindy 等宿主
  工作流决定；仓库规则本身不额外授权外部写操作。
- 提交 PR 时遵循 `.github/PULL_REQUEST_TEMPLATE.md`，如实说明改动、验证和风险。
- 非 fork 的非 draft PR 会触发自动 code review（`.github/workflows/pr-code-review.yml`），
  审阅口径见根目录 `REVIEW.md`。它是**建议性**检查，不替代人工 review，也不替代
  `client-ci` 的机器门禁；改动上述两份文件前先读 `REVIEW.md` 开头的说明。
- **DCO 签名（硬性要求）**：本仓每个 commit 都必须带 `Signed-off-by` trailer，且其中的
  名字与邮箱都要与 commit 的 author（或 committer）一致，用 `git commit -s` 生成；
  agent 的自动提交同样适用。PR 上的 DCO check（DCO GitHub App，配置见
  `.github/dco.yml`）会拦下漏签的 commit。`git commit` 没有自动签名的配置项，一次配好
  可跑 `pnpm dco:install-hook` 装 `.githooks/prepare-commit-msg`；提交前自查用
  `pnpm check:dco`。DCO 全文见根目录 `DCO`，贡献者说明见 `CONTRIBUTING.md`。
  对自动 code review 环境的说明：review 沙箱 checkout 出的 HEAD 可能是平台合成的
  瞬时 commit（不存在于本仓库、GitHub 上查不到该 SHA）；对这类合成 SHA 跑
  `check:dco` 的失败结果不构成缺签证据，不要据此报告 DCO 问题。判定 DCO 是否通过，
  一律以 PR 上的 DCO App check 与真实提交范围（`origin/main..PR head`）的结果为准。
- **提交前验证**：提交前必须完成与改动风险匹配的测试和相关 package 的类型检查。
  默认使用根 `pnpm test:unit:related` 选测；已按影响面完成等效定向验证时，不要求为了
  commit 重跑整仓测试；纯文档运行 `pnpm check:dev-docs`。相关 package 运行
  `pnpm --filter <包名> run --if-present typecheck`（包名以该 package 的 `package.json`
  为准）。已执行检查的失败必须修复或明确说明既有故障，未执行项和原因须如实记录。
  本机资源预算、并发与跨任务排队由使用者或宿主决定，仓库不强制多个 session 串行。
  GitHub CI 保留完整单测与合并门禁；细则见 `docs/dev-rules/development-workflow.md`。
- 按风险追加验证：跨模块、高风险或基础设施改动追加更广泛验证（如
  `pnpm test:all`），最终以 CI 门禁为准。不得通过跳过、删除或弱化测试制造通过。

可复用的项目知识写进仓库；个人路径、设备标识、账号偏好、凭据和私聊原文留在本地。
整理文档只改组织与索引，Cindy 特有的信息不得丢失或弱化；细则见
[开发工作流](docs/dev-rules/development-workflow.md) §4、§5。

## 效率基线

- 只回答、只排查、只出方案的只读任务：不改文件、不构建、不跑测试；检索
  （grep／sed／find 浏览源码）合计控制在 5 次以内。先用根 `README`、`docs/dev-rules/`
  索引与 `.github/workflows/` 判断结论，再决定是否需要深入具体文件。用户说"不用
  全扫描""只看某个点"时，按其给的范围收窄，不扩展到相邻模块。
- 默认不验证：用户没有要求时，不主动构建、不启动模拟器、不截图、不跑测试，改完直接收口。
  只有用户明确说「编译」「看效果」「截图」「跑一下」时才验证，且用最小可见手段
  （一次构建 + 一张截图），不要为了取图反复跑整套 UI 测试并手工解析 `xcresult`。
- 静态结论不要靠跑构建或整套测试取得；为回答"支持不支持／在哪定义"打断构建是白费时间。
- 验证按改动复杂度定档，不要无差别跑测试：文案／颜色／间距／布局／动画 → 不验证；
  单页状态机或计算逻辑 → 只跑相关那一个单测；持久化／网络／并发／迁移 → 相关模块测试；
  跨模块／协议／发布签名 → 更大范围并说明理由。不要在回复里写"要不要验证"的判断过程。
- 一次改动最多一轮自查修正；第二轮仍不对，停下来说明期望与实际差异并询问，
  不要连续盲试。
- 收口只讲三件事：改了什么、在哪个文件／哪个值、怎么验证的。不写推理过程、
  不列备选方案清单、不加长尾提议；需要用户决策时只问一个具体问题。

## 绝对安全底线

- 用户凭证、令牌、授权文件和密钥不得写入仓库或任何可能被 Git 跟踪的路径。
- 未经用户明确授权，不执行删除数据、覆盖改动、推送、发布、合并等外部或难以
  恢复的操作。
- 发现任务会触及系统提示词、更新器、协议兼容、数据库历史 migration、权限边界
  或用户数据安全时，必须先停下来核对专项规则，并在动手前向用户说明风险或
  请求确认。
