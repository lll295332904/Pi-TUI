# PiDesk Agent 产品开发执行文档

> 用途：给后续 Pi Agent / Codex / Hermes 类 coding agent 直接参考开发。本文不是评估报告，而是可执行产品文档：包含目标、范围、模块拆分、开发顺序、验收标准和测试方案。
>
> 来源：基于 `docs/05-setup安装即用产品化差距评估.md` 的差距结论整理。
>
> 当前技术路线：Tauri 2 + React + TypeScript + Rust JSONL RPC bridge + bundled Pi runtime。

## 1. 产品目标

PiDesk 的产品目标是：

> 一台干净 Windows 电脑，无 Node/npm/Pi 预装环境，只运行 `PiDesk_0.2.0_x64-setup.exe`，安装后即可通过图形界面完成 Provider 配置、创建会话、发送指令、查看工具调用、恢复历史，并在错误时得到可理解的恢复入口。

## 2. 开发原则

后续 agent 开发必须遵守以下原则：

1. 先补闭环，再加新功能。优先保证 setup.exe 安装即用。
2. 修 bug 必须定位到根因，不能只改 UI 状态掩盖后端失败。
3. 所有涉及 Pi RPC 的改动必须验证：不弹 cmd、进程存活、stdout JSONL 事件正常、stderr 可诊断。
4. UI 改动保持最小有效改动，避免大面积视觉重做。
5. 新增功能必须有明确验收标准和测试方案。
6. 文档必须跟随实现更新，禁止保留误导性旧方案。
7. 不自动提交 git，除非用户明确要求。

## 3. 当前基线

当前已经完成：

- Tauri release 构建可产出 NSIS/MSI。
- release 包已包含 `pi-bundle/node.exe`、`package.json`、`dist/`、`node_modules/`。
- 后端 bundled 模式直接启动 `node.exe dist/rpc-entry.js`，不再走 `.cmd`。
- 后端为 bundled Pi 设置 `PI_PACKAGE_DIR`。
- 前端已有多会话、对话流、工具卡片、Settings、Inspector、Console、快捷键面板等基础功能。

当前主要差距：

- 首次启动 onboarding 缺失。
- Provider/API Key 配置闭环不足。
- Pi runtime 自检和诊断日志不足。
- 工具审批扩展未形成随包加载闭环。
- Pi 进程异常恢复不足。
- SettingsPanel / prompt_cmds.rs 文件过大。
- 错误处理不统一。
- 全局搜索、拖拽附件、暗色主题、会话树等体验功能未完成。

## 4. 版本路线图

### V0.3 安装即用闭环

目标：干净 Windows 电脑只装 setup.exe，可以完成首次配置并跑通第一条 prompt。

必须完成：

- 启动自检。
- 首次启动 Setup Wizard。
- Provider/API Key/模型测试与保存。
- 内置审批扩展打包和加载。
- Pi 进程失败后的重启/重连入口。
- README 和故障排查文档。

### V0.4 稳定性与工程化

目标：可诊断、可维护、错误可恢复。

必须完成：

- 后端日志文件。
- 诊断包导出。
- 统一错误结构。
- SettingsPanel 拆分。
- prompt_cmds.rs 拆分。
- bundle 脚本错误码处理。
- 长会话性能保护。

### V0.5 体验补齐

目标：接近 Codex/Hermes 桌面端日常主力体验。

建议完成：

- 全局历史搜索。
- 拖拽文件/图片到 Composer。
- 暗色主题。
- 会话树/分支视图。
- 命令面板统一 action registry。
- diff/edit/write 专业渲染。

## 5. 模块一：安装即用与首次启动

### 5.1 启动自检

#### 目标

应用启动后，在创建任何 Pi session 之前，确认当前安装包可运行。

#### 需要检查

- `pi-bundle/node.exe` 存在。
- `pi-bundle/package.json` 存在。
- `pi-bundle/dist/rpc-entry.js` 存在。
- `pi-bundle/dist/index.js` 存在。
- `pi-bundle/node_modules/` 存在且至少包含关键依赖，例如 `openai/package.json`。
- `PI_PACKAGE_DIR` 可被设置为 Windows 原生路径。
- 用户配置目录可读写：`%USERPROFILE%\.pi\agent`。
- WebView2 是否可用。Win10/11 通常内置，但自检失败时要给出提示。

#### 建议实现

Rust 新增命令：

```rust
#[tauri::command]
pub fn run_startup_diagnostics() -> Result<StartupDiagnostics, AppError>
```

返回结构示例：

```ts
interface StartupDiagnostics {
  ok: boolean;
  piBundle: {
    node: CheckItem;
    packageJson: CheckItem;
    rpcEntry: CheckItem;
    indexEntry: CheckItem;
    nodeModules: CheckItem;
  };
  userData: {
    piAgentDir: string;
    readable: boolean;
    writable: boolean;
  };
  version: {
    appVersion: string;
    bundledPiVersion?: string;
  };
  errors: DiagnosticError[];
}
```

#### UI 要求

- 启动自检失败时，不进入主对话页。
- 显示“安装资源不完整 / 用户目录不可写 / Pi runtime 无法启动”等明确错误。
- 提供“复制诊断信息”按钮。

#### 验收标准

- 删除 `pi-bundle/package.json` 后启动，UI 能明确提示缺失该文件。
- 删除 `node_modules` 后启动，UI 能明确提示依赖缺失。
- 正常安装包启动，自检通过且不弹 cmd。

### 5.2 First-run Setup Wizard

#### 触发条件

满足任一条件时自动进入向导：

- `~/.pi/agent/auth.json` 不存在或为空。
- `~/.pi/agent/models-store.json` 不存在或没有可用模型。
- PiDesk 没有默认模型配置。
- 用户主动从 Settings 点击“重新运行首次配置”。

#### 步骤

1. 欢迎页：说明 PiDesk 需要配置一个模型 Provider。
2. Provider 选择：OpenAI-compatible、DeepSeek、OpenRouter、Gemini、Anthropic、自定义。
3. API 配置：API Key、Base URL、模型列表 URL 或默认 URL。
4. 测试连接：调用后端 `fetch_models_from_url` 或新增专用 `test_provider_connection`。
5. 模型选择：选择默认模型、thinking level。
6. 工作目录选择：默认 `C:\Git`，支持打开系统目录选择器。
7. 完成页：创建第一个会话。

#### 数据写入

需要写入或更新：

- Pi auth/config 文件，具体按现有 Pi 配置结构实现。
- `models-store.json` / model config。
- PiDesk `settings.defaultModel`。
- PiDesk `settings.defaultCwd`。

#### 验收标准

- 干净用户目录下首次启动会进入向导。
- 填入有效 OpenAI-compatible 配置后能拉取模型。
- 选中模型后进入主界面。
- 新建会话后能收到模型回复。
- 填错 key 时提示 401/认证失败，不进入假成功状态。

## 6. 模块二：Provider 与模型配置闭环

### 6.1 Provider 管理

#### 目标

Settings 中提供完整 Provider CRUD，而不是只编辑底层配置文件。

#### 功能要求

- 新增 Provider。
- 编辑 Provider。
- 删除 Provider。
- 测试连接。
- 拉取模型列表。
- 手动添加模型。
- 设置默认模型。
- 设置角色模型：main、vision、web、compression、approval、title、maintenance、mcp、subAgent。

#### 错误处理

测试连接需区分：

- Base URL 格式错误。
- 网络不可达。
- 认证失败。
- 模型接口格式不兼容。
- 空模型列表。

#### 验收标准

- 不需要打开 JSON 配置文件即可完成 Provider 配置。
- 测试连接成功后模型列表刷新。
- 默认模型设置后，新会话自动使用该模型。
- 删除正在使用的模型时有确认和降级策略。

## 7. 模块三：Pi runtime 与进程生命周期

### 7.1 Runtime 定位

#### 当前要求

后端 locator 应优先使用 bundled runtime：

```text
pi-bundle/node.exe
pi-bundle/package.json
pi-bundle/dist/rpc-entry.js
pi-bundle/dist/index.js
```

找不到 bundled runtime 时，才 fallback 到系统 `PI_CLI_PATH` / npm global / PATH。

#### 不允许

- release 主路径执行 `.cmd`。
- 缺资源时静默 fallback 到用户机器全局 pi。
- 因 fallback 成功而掩盖安装包资源损坏。

#### 验收标准

- release 环境优先使用 `pi-bundle`。
- `.cmd` 不应出现在 bundled 启动路径。
- 资源损坏时明确报错。

### 7.2 Pi 进程健康和恢复

#### 功能要求

- session 级健康状态：`starting`、`idle`、`running`、`failed`、`exited`、`reconnecting`。
- `process-exit` 时显示原因和重启按钮。
- 提供“重启 Pi 内核”动作。
- 重启后可 `switchSession` 回原 session file。
- 启动 300ms 内退出时带 stderr/stdout 返回错误。

#### 验收标准

- 手动 kill Pi 子进程后 UI 不再卡 running。
- UI 显示“Pi 进程已退出”。
- 点击“重启内核”后可继续当前会话。
- 启动失败时错误文本包含 stderr 关键信息。

## 8. 模块四：工具审批与安全

### 8.1 内置审批扩展

#### 目标

让危险工具执行前通过 Pi extension 触发 `extension_ui_request`，由 PiDesk 图形化确认。

#### 需要实现

- 在 repo 中新增内置 approval extension 源文件。
- release 打包 extension。
- 后端启动 Pi RPC 时附加 `-e <approval-extension>`。
- Settings 提供审批策略：
  - 自动执行。
  - 危险工具需确认。
  - 全部工具需确认。
- UI 弹窗显示工具名、参数摘要、风险说明。
- 支持本次允许、本会话允许、拒绝。

#### 危险工具默认列表

- `bash`
- `edit`
- `write`
- 任何能修改文件、执行命令、网络写入的扩展工具

#### 验收标准

- 让 agent 执行 `bash` 时弹出确认。
- 拒绝后工具不执行，并在对话中显示拒绝原因。
- 允许后工具正常执行。
- 关闭审批策略后不弹确认。

## 9. 模块五：错误处理、日志和诊断

### 9.1 统一错误结构

#### 目标

替换无结构的 `Result<_, String>` 和前端散落 `console.error`。

#### 建议错误结构

```ts
interface AppErrorDto {
  code: string;
  message: string;
  details?: string;
  recoverable: boolean;
  action?: {
    label: string;
    command: string;
  };
}
```

Rust 可定义：

```rust
#[derive(thiserror::Error, Debug, serde::Serialize)]
pub enum AppError { ... }
```

#### 错误类别

- `PI_RUNTIME_MISSING`
- `PI_START_FAILED`
- `PI_PROCESS_EXITED`
- `PROVIDER_AUTH_FAILED`
- `PROVIDER_NETWORK_FAILED`
- `MODEL_NOT_FOUND`
- `CONFIG_READ_FAILED`
- `CONFIG_WRITE_FAILED`
- `SESSION_FILE_NOT_FOUND`

#### 验收标准

- UI 能按错误 code 显示可操作建议。
- 后端错误不再只返回模糊 `Failed: ...`。

### 9.2 后端日志

#### 目标

用户反馈问题时能导出诊断，而不是只能复现。

#### 日志位置

建议：

```text
%APPDATA%\PiDesk\logs\app.log
%APPDATA%\PiDesk\logs\pi-stderr.log
```

#### 记录内容

- app start / app version
- bundled Pi version
- runtime path
- session start/stop
- Pi stderr
- process exit status
- startup diagnostics
- provider test result，不记录完整 API key

#### 验收标准

- Settings 或 Help 菜单有“导出诊断信息”。
- 导出的 zip/txt 包含版本、资源检查、最近日志。
- API Key 必须脱敏。

## 10. 模块六：代码优化重构

### 10.1 拆分 SettingsPanel

#### 当前问题

`src/components/SettingsPanel.tsx` 约 803 行，包含模型、行为、配置文件、MCP、Provider 表单等多种职责。

#### 目标结构

```text
src/components/settings/
  SettingsPanel.tsx
  ModelTab.tsx
  BehaviorTab.tsx
  ProviderTab.tsx
  ConfigFilesTab.tsx
  McpTab.tsx
  SetupWizard.tsx
  ProviderConnectionTest.tsx
```

#### 验收标准

- 单个 tab 文件尽量低于 250 行。
- 原有 Settings 功能不回退。
- `npm run build` 通过。

### 10.2 拆分 Rust commands

#### 当前问题

`src-tauri/src/commands/prompt_cmds.rs` 约 608 行，职责混杂。

#### 目标结构

```text
src-tauri/src/commands/
  rpc_cmds.rs
  models.rs
  pi_files.rs
  userdata.rs
  diagnostics.rs
  providers.rs
  mcp.rs
```

#### 验收标准

- 命令注册清晰。
- `cargo check` 通过。
- 前端 bridge API 不破坏现有调用。

### 10.3 bundle-pi.bat 鲁棒性

#### 当前问题

`robocopy` 静默复制，缺少错误码处理。

#### 需要实现

- 每次 robocopy 后检查 `%ERRORLEVEL%`。
- robocopy 0-7 视为成功，>=8 视为失败。
- 检查关键文件是否存在：`node.exe/package.json/dist/rpc-entry.js/node_modules`。
- 失败时打印明确原因并 `exit /b 1`。

#### 验收标准

- 故意改错 `PI_SRC` 时脚本失败并提示。
- 正常环境脚本成功，资源完整。

## 11. 模块七：功能优化与新功能补齐

### 11.1 全局历史搜索

#### 目标

跨所有 Pi session JSONL 搜索历史，而不是只搜索当前 timeline。

#### 功能要求

- 搜索范围：所有 `~/.pi/agent/sessions/**/*.jsonl`。
- 支持按项目/cwd 过滤。
- 支持点击结果恢复对应 session。
- 结果显示会话名、时间、命中片段。

#### 验收标准

- 输入关键词能找到历史会话。
- 点击结果能打开对应会话并定位附近消息。

### 11.2 拖拽文件和图片

#### 目标

Composer 支持拖拽/粘贴附件，贴近 Codex/Hermes 桌面体验。

#### 功能要求

- 拖拽文件到 Composer。
- 图片显示缩略图。
- 普通文件显示路径 chip。
- 支持移除附件。
- 发送时传入 `images` 或文件引用。

#### 验收标准

- 拖入 png 后出现缩略图。
- 发送 prompt 后后端收到图片路径。
- 移除附件后不发送。

### 11.3 暗色主题

#### 目标

提供适合开发者长期使用的 dark mode。

#### 功能要求

- 跟随系统 / 浅色 / 暗色 三种模式。
- 主题 token 化，不散落硬编码颜色。
- Settings 中可切换。

#### 验收标准

- 所有主界面区域在暗色下可读。
- 工具卡、diff、输入框、弹窗没有低对比度问题。

### 11.4 会话树/分支视图

#### 目标

利用 Pi 的 session tree 能力，让用户理解分支和 fork。

#### 功能要求

- Inspector 显示当前 session tree。
- 点击节点切换 leaf。
- 从某条消息 fork。
- 标记当前 active branch。

#### 验收标准

- 有分支会话时能看到树形结构。
- 点击分支后 timeline 切换正确。

## 12. 开发顺序建议

建议严格按以下顺序推进：

1. 启动自检。
2. Setup Wizard。
3. Provider 测试和保存闭环。
4. Pi 进程重启/重连。
5. 审批扩展。
6. 错误结构 + 日志 + 诊断导出。
7. 拆 SettingsPanel。
8. 拆 Rust commands。
9. bundle 脚本鲁棒性。
10. 全局搜索、拖拽附件、暗色主题、会话树。

不要先做 P2 体验项，否则会继续堆在不稳定基础上。

## 13. 每个任务完成后的汇报格式

后续 agent 完成任一模块后，必须按以下格式汇报：

```text
完成模块：<模块名>

改动文件：
- <path>: <说明>

实现内容：
- <功能点>

验证结果：
- npm run build: <通过/失败 + 关键输出>
- cargo check: <通过/失败 + 关键输出>
- 如涉及 release: npm run tauri -- build <通过/失败>

需要用户测试：
- <明确步骤>

已知风险：
- <没有则写“无”>
```

## 14. 总验收标准

当以下条件全部满足时，可认为 PiDesk 达到“setup.exe 安装即用”标准：

- 干净 Windows 电脑安装 setup.exe 后可启动。
- 不依赖系统 Node/npm/Pi。
- 不弹 cmd 窗口。
- 首次启动能完成 Provider 配置。
- 能测试 API Key 和模型。
- 能创建会话并得到回复。
- 工具调用能显示，危险工具能审批。
- 关闭重启后历史会话保留。
- Pi 进程异常退出后可恢复。
- 用户能导出诊断信息。
- README 与 docs 说明当前实现，不含过时 Electron 方案。
