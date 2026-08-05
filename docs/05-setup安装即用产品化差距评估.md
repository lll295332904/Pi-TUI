# PiDesk 安装即用产品化差距评估

> 目标标准：一台干净 Windows 电脑只运行 `PiDesk_0.2.0_x64-setup.exe`，安装后即可启动 PiDesk，并完成登录/配置/创建会话/发送指令/执行工具/恢复历史等核心流程。
>
> 评估日期：2026-08-05
> 评估范围：当前工作区源码、Tauri 配置、release 构建产物、既有文档与未提交改动。

## 1. 总体结论

当前 PiDesk 已经从“本机开发环境可运行”推进到“release 包具备自带 Pi runtime 的基础”。刚修复后，NSIS/MSI release 产物已经包含：

- `pi-bundle/node.exe`
- `pi-bundle/package.json`
- `pi-bundle/dist/index.js`
- `pi-bundle/dist/rpc-entry.js`
- `pi-bundle/node_modules/...`

这解决了此前 release 安装后弹 cmd、Pi RPC 没有真实响应的关键阻断问题。

但距离“干净电脑 setup.exe 安装即用”的产品标准，还差一轮系统化产品化工作。核心差距不是单个 bug，而是首次启动、凭据配置、错误恢复、资源体积、文档一致性、运行时可观测性、UI 完成度这些工程闭环。

### 当前成熟度判断

| 维度 | 当前状态 | 距离安装即用标准 |
|---|---|---|
| 安装包完整性 | 已自带 Pi runtime，基础链路已补齐 | 中等差距，仍需干净机安装验证 |
| 首次启动体验 | 缺少真正 onboarding | 较大差距 |
| Provider/API Key 配置 | 有模型管理 UI，但依赖用户理解 Pi 配置 | 较大差距 |
| Agent 核心通信 | Tauri Rust JSONL 客户端可用，已避开 `.cmd` | 小到中等差距 |
| 会话/历史 | 功能较多，但状态恢复和异常场景仍需验证 | 中等差距 |
| 工具审批/安全 | UI 有 `ApprovalDialog`，但内置审批扩展链路未形成可交付闭环 | 较大差距 |
| 代码整洁度 | 可工作，但部分文件过大、文档滞后、错误处理不统一 | 中等差距 |
| 性能/体积 | setup.exe 约 35.8MB，MSI 约 69.4MB，bundle 源目录约 247MB | 中等差距 |
| 对标 Codex/Hermes 桌面端 | 主框架接近，产品细节和恢复能力不足 | 中等到较大差距 |

结论：

- 如果标准是“开发者本人电脑安装后能用”，目前接近 70%。
- 如果标准是“干净电脑、无 Pi/Node/npm 环境、只装 setup.exe 后普通用户能配置并稳定使用”，目前约 55%-60%。
- 阻断级剩余工作主要集中在首次配置、凭据引导、安装包干净机验证、审批扩展、安全错误提示、自动恢复。

## 2. 已经达成的基础能力

### 2.1 Tauri release 构建已可产出安装包

当前 `npm run tauri -- build` 已产出：

- `src-tauri/target/release/bundle/nsis/PiDesk_0.2.0_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/PiDesk_0.2.0_x64_en-US.msi`

已验证构建命令通过：

```text
npm run build
cargo check
npm run tauri -- build
```

### 2.2 Pi runtime 已被打入 release 资源

`tauri.conf.json` 目前显式打包：

```json
"resources": {
  "pi-bundle/node.exe": "pi-bundle/node.exe",
  "pi-bundle/package.json": "pi-bundle/package.json",
  "pi-bundle/dist/": "pi-bundle/dist/",
  "pi-bundle/node_modules/": "pi-bundle/node_modules/"
}
```

这比原先 `pi-bundle/*` 安全，因为原配置只带第一层文件，漏掉 `dist/` 和 `node_modules/`。

### 2.3 后端已改为直接启动 bundled RPC 入口

当前 Rust 后端不再把 bundled Pi 当作 `.cmd` 运行，而是定位：

```text
pi-bundle/node.exe + pi-bundle/dist/rpc-entry.js
```

并设置：

```text
PI_PACKAGE_DIR=<pi-bundle 原生 Windows 路径>
```

这解决了 Pi 自身 `getPackageDir()` 在 bundle 环境中错误向上找到 PiDesk 项目 `package.json`，进而去 `C:\Git\Pi-TUI\src\...` 找 theme 的问题。

### 2.4 UI 主体已经具备桌面 Agent 外壳雏形

已有功能包括：

- 多会话侧栏
- 对话流渲染
- 工具调用卡片
- Inspector 面板
- Console 面板
- Settings 面板
- 模型配置和新增模型
- MCP 页面雏形
- 快捷键面板
- ErrorBoundary
- 会话导出相关入口已有部分实现
- 本地用户数据持久化机制

整体方向符合 Codex/Hermes 桌面端的基本结构：左侧会话/项目，中间对话，顶部模型/状态，右侧详情/调试面板。

## 3. 距离“干净电脑安装即用”的关键缺口

### P0 缺口：必须补齐，否则不能称为安装即用

| 编号 | 缺口 | 当前风险 | 建议动作 |
|---|---|---|---|
| P0-1 | 缺少干净 Windows 机器安装验证 | 本机 build 成功不等于安装包在干净环境可用 | 用无 Node/npm/Pi 的 Windows 环境安装 NSIS，验证首次启动、发消息、工具执行 |
| P0-2 | 首次启动没有 onboarding | 用户不知道该配哪个 provider、API key、默认工作目录 | 增加首次启动向导：选择 Provider、填写 API Key、验证模型、选择默认工作区 |
| P0-3 | API Key/Provider 配置闭环不足 | 干净机没有 `~/.pi/agent/auth.json` / `models-store.json` 时，模型列表可能为空 | Settings 中提供“添加 Provider -> 测试连接 -> 保存 -> 设为默认”的完整流程 |
| P0-4 | 缺少“安装包内 Pi runtime 自检” | 资源缺失时只在启动 session 时失败，用户难以理解 | 启动时检查 `node.exe/package.json/dist/rpc-entry.js/node_modules`，失败显示明确修复建议 |
| P0-5 | 工具审批链路未产品化 | 当前 UI 有审批弹窗，但没有确认随 Pi RPC 加载内置审批扩展 | 打包 approval extension，启动 RPC 时加 `-e <extension>`，Settings 提供审批策略 |
| P0-6 | 进程异常恢复不足 | Pi 进程崩溃/退出后只能显示退出事件，不能一键恢复 | 增加 session 级“重启 Pi 内核/重连当前会话”按钮和自动恢复策略 |
| P0-7 | 文档与实现严重不一致 | README 仍写“尚未开始编码”，技术方案仍推荐 Electron | 更新 README 和技术方案到 Tauri 实现现状 |

### P1 缺口：影响稳定性和产品感

| 编号 | 缺口 | 当前风险 | 建议动作 |
|---|---|---|---|
| P1-1 | 错误处理大量 `console.error` | 用户看不到可操作错误，开发者也缺少日志文件 | 引入用户可见 toast + 后端日志文件 |
| P1-2 | SettingsPanel 过大 | 803 行单组件，后续维护成本高 | 拆成 ModelTab / BehaviorTab / ProviderTab / ConfigTab / McpTab |
| P1-3 | Rust command 返回 `Result<_, String>` | 错误类型丢失，不利于前端区分配置错误/网络错误/进程错误 | 定义统一 error code，前端按 code 展示行动建议 |
| P1-4 | MCP 管理页面仍偏雏形 | 表单和真实保存/测试链路不足 | 补 MCP server CRUD、连接测试、错误提示 |
| P1-5 | 资源体积和安装包大小未优化 | `pi-bundle` 源目录约 247MB，安装包约 35.8MB/69.4MB | 分析 node_modules 可裁剪项，考虑只打生产依赖和必要文档/资产 |
| P1-6 | 没有自动更新/版本迁移策略 | 后续 Pi runtime 和 PiDesk 版本不一致时难维护 | 明确版本绑定策略：内置 Pi 版本、升级入口、兼容检查 |
| P1-7 | 缺少 crash report 和诊断包 | 用户反馈“没响应”时无法快速定位 | 增加“导出诊断信息”：app version、Pi version、资源检查、最近日志 |

### P2 缺口：体验优化和对标提升

| 编号 | 缺口 | 当前风险 | 建议动作 |
|---|---|---|---|
| P2-1 | 全局搜索不足 | 当前更接近当前会话搜索，不是跨历史索引 | 建 JSONL 历史索引，支持跨项目/会话搜索 |
| P2-2 | loading/empty state 不够产品化 | 新建/恢复/加载模型时可能空白或弱反馈 | Skeleton、进度文案、重试按钮 |
| P2-3 | 拖拽文件/图片体验不足 | Codex/Hermes 类产品通常支持自然添加上下文 | Composer 接入 Tauri drag-drop 和附件预览 |
| P2-4 | 快捷键体系需要统一 | 有 ShortcutsPanel，但命令面板/快捷键冲突需要整理 | 建统一 command registry，UI、快捷键、菜单共用 |
| P2-5 | 暗色主题缺失 | 对开发工具用户影响明显 | 建 token 化主题，先做跟随系统/手动切换 |
| P2-6 | 会话树/分支可视化不足 | Pi 原生支持 fork/tree，UI 尚未充分表达 | Inspector 加分支树，支持切换 leaf/fork |

## 4. 代码整洁度评估

### 4.1 当前规模

源码粗略规模（不含 node_modules、dist、target、pi-bundle）：

```text
TypeScript/TSX/Rust 源码约 6306 行
SettingsPanel.tsx 约 803 行
prompt_cmds.rs 约 608 行
store/pidesk.ts 约 510 行
Sidebar.tsx 约 454 行
session.rs 约 407 行
pi_kernel.rs 约 361 行
```

这个规模还不算大，但已经出现“大文件承担多个职责”的趋势。

### 4.2 主要代码问题

| 问题 | 位置/表现 | 影响 |
|---|---|---|
| SettingsPanel 过大 | 单文件覆盖模型、行为、Provider、配置文件、MCP | 后续改动容易互相影响 |
| Rust command 聚合过多 | `prompt_cmds.rs` 同时处理模型、配置、文件、HTTP fetch、session command | 模块边界不清晰 |
| 错误处理不统一 | 前端大量 `console.error`，后端多为 `String` | 用户不可见、不可诊断 |
| 文档滞后 | README/技术方案仍描述 Electron/未编码阶段 | 新接手者容易误判架构 |
| 资源脚本鲁棒性不足 | `bundle-pi.bat` 的 `robocopy` 静默，缺少错误码处理 | 打包缺资源时可能直到运行才暴露 |
| UI 直接使用 `confirm()` | Settings 中删除模型/关闭确认 | 与桌面应用体验不一致，难统一样式 |

### 4.3 整洁度建议

优先级建议：

1. 拆 `SettingsPanel.tsx`。
2. 拆 `prompt_cmds.rs`：`models.rs`、`pi_files.rs`、`rpc_commands.rs`、`userdata.rs`。
3. 定义统一 `AppError { code, message, details }`。
4. 将 confirm/alert 替换为统一 Dialog/Toast。
5. 更新 README 与 docs，标注当前实际技术路线为 Tauri。
6. 加 `eslint` 和 `react-hooks/exhaustive-deps`，目前 `package.json` 没有 lint 脚本。

## 5. 性能与体积评估

### 5.1 当前体积

已观察到：

```text
src-tauri/pi-bundle 源资源目录约 247MB
NSIS setup.exe 约 37,521,757 bytes，约 35.8MB
MSI 约 72,734,179 bytes，约 69.4MB
```

安装包体积对个人开发工具可以接受，但需要关注两个点：

1. `node_modules` 全量打包，未来 Pi 版本膨胀会直接影响 setup 体积。
2. Tauri 的优势是轻壳，但内置 Node + Pi dependencies 后，体积优势明显下降；不过仍比 Electron 常见 100MB+ 安装包轻。

### 5.2 运行性能风险

| 风险 | 原因 | 建议 |
|---|---|---|
| 流式 token 频繁触发 React render | `message_update` 逐事件更新状态 | 使用 requestAnimationFrame/节流批量更新 |
| timeline 长会话内存增长 | 当前前端持有 session timeline | 长会话虚拟列表，历史懒加载 |
| 同步文件 I/O 阻塞 | Rust 命令里多处 `std::fs::read_to_string/write` | 对大文件/配置操作改 async 或后台任务 |
| 多 session 多 Pi 子进程 | 每个会话一个子进程 | 限制并行 session 数、空闲 session 休眠 |
| Console raw event 无限增长 | `consoleLogs` 按 session 累积 | 限制最大行数和导出日志功能 |

## 6. 功能完整度评估

### 6.1 核心 Agent 工作流

| 功能 | 当前判断 | 安装即用要求 |
|---|---|---|
| 新建会话 | 已实现 | 需干净机验证 Pi runtime + provider 配置后可用 |
| 发送 prompt | 已实现 | 需确认失败时错误可见 |
| 流式回复 | 已实现基础事件处理 | 需长输出、工具输出压力测试 |
| 工具调用显示 | 已实现工具卡片 | 需补 diff/edit/write 更专业渲染 |
| abort | 已接入 | 需验证中止后状态恢复 |
| compact | 已有入口 | 需验证 UI 状态和错误处理 |
| 图片输入 | bridge 支持 images，UI 有 inputImages | 需实际端到端验证 |
| 会话恢复 | 有 JSONL 加载与 switchSession | 需验证跨重启、跨 cwd、多分支 |
| 会话导出 | 后端命令/部分 UI 已有 | 需形成稳定入口和完成提示 |

### 6.2 配置和 Provider

这是“干净电脑安装即用”的最大产品缺口。

当前更像是给已经熟悉 Pi 配置的人使用。真正产品化需要：

1. 首次启动检测 `~/.pi/agent/auth.json`、`models-store.json`、`settings.json` 是否存在。
2. 不存在时自动进入 Setup Wizard。
3. Wizard 至少包括：
   - 选择 Provider：OpenAI-compatible / DeepSeek / OpenRouter / Gemini / Anthropic 等。
   - 填 API Key 和 Base URL。
   - 拉取模型列表或手动输入模型。
   - 选择默认模型和 thinking level。
   - 选择默认工作目录。
   - 点击“测试连接”。
4. 测试通过后再进入主界面。
5. 测试失败给出明确原因：网络、401、模型不存在、Base URL 格式错误等。

参考 Codex/Hermes：首次可用性的关键不是功能多，而是用户在第一分钟内知道下一步该做什么。

## 7. 体验对标：Codex / Hermes 桌面端

### 7.1 已接近的地方

- 单一主对话流。
- 左侧会话/项目导航。
- 顶部模型/角色/状态栏。
- 工具调用卡片化。
- 右侧 Inspector/Console 辅助面板。
- 快捷键面板雏形。
- Tauri 原生安装包，启动负担比 Electron 轻。

### 7.2 明显落后的地方

| 体验点 | Codex/Hermes 类产品通常表现 | PiDesk 当前差距 |
|---|---|---|
| First-run onboarding | 引导用户选模型、登录、创建项目 | 需要用户理解 Pi 配置文件 |
| 错误可恢复 | 错误消息带操作按钮/重试 | 多数错误只进 console 或 system-info |
| 诊断可见性 | 有日志/任务状态/进程状态 | 后端日志和诊断包不足 |
| 文件/项目上下文 | 项目切换清晰，当前 cwd 明确 | 有 workspace，但需要更强视觉表达和安全确认 |
| 工具审批 | 危险操作确认和策略清晰 | 扩展链路需落地 |
| 长任务状态 | 明确 running/queued/idle/failed | 状态类型较少，失败恢复不足 |
| 配置体验 | Provider 配置闭环 | 目前偏配置文件编辑器 + 模型表单 |
| 文档一致性 | README 对应当前实现 | 当前 README 明显过时 |

## 8. 推荐路线图

### 第 1 阶段：安装即用闭环（必须先做）

目标：干净电脑只装 setup.exe，用户能完成首次配置并跑通第一条 prompt。

建议任务：

1. 做干净机安装测试清单。
2. 增加启动自检：Pi runtime、WebView2、资源文件、用户配置目录权限。
3. 增加首次启动 Setup Wizard。
4. Provider/API Key/模型测试闭环。
5. 完成内置审批扩展打包和启动参数接入。
6. Pi 进程崩溃后显示“重启内核/重新连接”按钮。
7. 更新 README：安装、首次配置、构建、打包、故障排查。

验收标准：

- 干净 Windows 用户无 Node/npm/Pi，也能安装并打开。
- 首次启动能完成 Provider 配置。
- 能创建会话并收到模型回复。
- 不弹 cmd 窗口。
- 关闭重启后会话历史存在。
- Pi 进程失败时 UI 给出明确错误和重试入口。

### 第 2 阶段：稳定性和工程化

目标：从“能用”到“稳定、可诊断”。

建议任务：

1. 后端日志文件：`%APPDATA%/PiDesk/logs/app.log`。
2. 诊断导出：版本、资源检查、Pi version、最近 stderr、配置摘要。
3. 统一错误类型和前端 toast/dialog。
4. `bundle-pi.bat` 增加 robocopy 错误码检查。
5. 引入 lint 和格式化脚本。
6. 拆大文件，尤其 `SettingsPanel.tsx` 和 `prompt_cmds.rs`。
7. 长会话虚拟列表和 console 日志上限。

### 第 3 阶段：体验和能力对标

目标：从“桌面壳”到“日常主力 Agent 客户端”。

建议任务：

1. 暗色主题和跟随系统主题。
2. 全局历史搜索。
3. 拖拽文件/图片到 Composer。
4. 更专业的 diff/edit/write 工具渲染。
5. 会话树/分支视图。
6. 命令面板统一所有动作。
7. 自动更新或至少版本检查。

## 9. 建议的干净机测试清单

需要你测试或准备干净环境测试。建议用 Windows Sandbox / 新虚拟机 / 一台未安装 Node 和 Pi 的电脑。

测试步骤：

1. 确认机器未安装 Node/npm/Pi。
2. 安装 `PiDesk_0.2.0_x64-setup.exe`。
3. 从开始菜单启动 PiDesk。
4. 观察是否弹出任何 cmd 窗口。
5. 首次打开是否有清晰的配置入口。
6. 配置一个 OpenAI-compatible Provider。
7. 选择默认模型。
8. 创建一个新会话。
9. 输入简单 prompt：`你好，回复一句话。`
10. 验证是否有流式回复。
11. 让它执行一个只读工具，例如读取当前目录文件列表。
12. 关闭应用，再打开，验证历史会话还在。
13. 删除会话，验证 UI 和磁盘状态一致。
14. 断网/填错 key，验证错误提示是否可理解。

当前最需要人工确认的是第 2-10 步，因为这决定“setup.exe 安装即用”是否真正成立。

## 10. 优先级总结

最短路径不是继续加功能，而是先补产品闭环：

1. **干净机安装验证**。
2. **首次启动 Setup Wizard**。
3. **Provider/API Key 测试和保存闭环**。
4. **Pi runtime 自检 + 诊断日志**。
5. **审批扩展随包加载**。
6. **README/文档更新到当前 Tauri 实现**。

完成这 6 项后，PiDesk 才基本符合“只通过 setup.exe 安装就可以使用”的产品标准。之后再进入性能、主题、全局搜索、命令面板等体验优化。