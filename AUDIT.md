# PiDesk 功能实现审计报告

> 日期：2026-07-29 | 版本：v0.2.0  
> 基于对全部 22 个源文件的逐行审查  
> 参考标准：VS Code, Cursor, Windsurf, Claude Desktop, Tauri 最佳实践, Zustand 文档, React 最佳实践

---

## 一、架构总览

| 层级 | 技术 | 规模 |
|---|---|---|
| 前端 | React 18 + TypeScript + Vite + Tailwind CSS | 11 个组件，~2500 行 TSX |
| 状态管理 | Zustand v4 + persist 中间件 | 35 个 actions，~40 个状态字段 |
| 后端 | Tauri v2 (Rust) | 30 个命令，3 个模块 |
| Agent 通信 | Pi RPC (stdin/stdout JSONL) | Rust 管道桥接 |
| 持久化 | Zustand persist (localStorage) + 文件备份 (userdata.json) | 双层 |

---

## 二、功能完成度

### ✅ P0 — 已实现

| 功能 | 实现位置 | 完成度 |
|---|---|---|
| 多会话并行 | session.rs + App.tsx | 100% |
| 工作区/Project | store + Sidebar | 100% |
| 会话置顶/重命名/删除 | Sidebar + store | 100% |
| 右键上下文菜单 | Sidebar.tsx | 100% |
| 模型管理 (CRUD + URL拉取) | prompt_cmds.rs | 100% |
| Role-Specific Models | SettingsPanel.tsx | 100% |
| Inspector 面板 | InspectorPanel.tsx | 100% |
| 压缩按钮 | TopBar.tsx | 100% |
| 语音输入 | Composer.tsx (Web Speech API) | 100% |

### ✅ P1 — 已实现

| 功能 | 实现位置 | 完成度 |
|---|---|---|
| Console 面板 | ConsolePanel.tsx | 100% |
| Token 统计 | InspectorPanel + handlePiEvent | 80%* |
| MCP 管理 UI | SettingsPanel MCP tab | 60%** |
| 会话搜索 | SearchBar.tsx (Ctrl+K) | 100% |
| 键盘快捷键 | App.tsx useEffect | 100% |

*\* Token 统计 — 字段对齐已修复，但 Pi 仅在 message 事件中返回 usage，非所有事件*  
*\*\* MCP — UI 已存在，但表单无后端连接，服务器列表是硬编码示例*

### ❌ P2 — 未实现

| 功能 | 状态 |
|---|---|
| Image Generation (`/image`) | 未开始 |
| Session Export UI | `export_html` Rust 命令已连接，前端无按钮 |
| Custom System Prompt | agents.json 可编辑（Files tab），但 Pi 的 system_prompt 配置路径未确认 |
| Dark Theme | 无 |

---

## 三、与业内标准对比

### 3.1 状态管理

| 维度 | PiDesk 现状 | 业内标准 (Cursor/Windsurf/VS Code) | 是否一致 | 说明 |
|---|---|---|---|---|
| 全局状态方案 | Zustand v4 单体 store | Zustand / Redux Toolkit / Jotai | ✅ | Zustand 是正确选择 |
| 状态持久化 | Zustand persist + 自定义文件写入 | Zustand persist 或 electron-store | ✅ | 文件备份方案应对 Tauri localStorage 不可靠 |
| 状态粒度 | 单 store 40 字段 + 35 actions | 按领域分 slice (Zustand / Redux Toolkit) | ⚠️ | 单 store 能工作但维护性差，建议拆分 |
| 非持久化状态与持久化状态混用 | 全在同一个 store | transient 状态应该分离 (React state / 独立 store) | ⚠️ | `inputValue`、`searchQuery` 等 UI 临时状态不应在全局 store |

**建议改进：**
- 拆分为 3 个 store：`useSessionStore`（会话+时间线）、`useUIStore`（面板开关+输入）、`useSettingsStore`（持久化设置）
- UI 临时状态（inputValue、searchQuery）移到组件级 useState

**当前风险：低。可工作，但随着功能增加会越来越难维护。**

---

### 3.2 持久化方案

| 维度 | PiDesk 现状 | 业内标准 | 是否一致 | 说明 |
|---|---|---|---|---|
| 存储介质 | Zustand persist (localStorage) + userdata.json (Rust 文件) | electron-store / Tauri fs API / IndexedDB | ✅ | 双保险是正确做法 |
| 写入策略 | 500ms debounce | 500ms-2s debounce 或 throttle | ✅ | 合理 |
| 加载时序 | `loadUserdata()` 在 App.tsx useEffect 中 | 应在 hydration 完成后加载 | ⚠️ | 当前 `loadUserdata` 在 useEffect 中，但 Zustand persist 的 hydration 也是异步的，可能存在竞态 |
| 回退机制 | 用户数据损坏时无恢复 | 应有迁移/恢复机制 | ❌ | 无 |

**建议改进：**
- 使用 Zustand 的 `onRehydrateStorage` 回调统一加载文件数据，避免竞态
- 添加 `userdata.json.bak` 备份并在主文件解析失败时自动恢复

**当前风险：中。已在生产中出现过数据丢失，虽然已通过文件持久化缓解，但缺少恢复机制。**

---

### 3.3 会话管理

| 维度 | PiDesk 现状 | 业内标准 | 是否一致 | 说明 |
|---|---|---|---|---|
| 会话创建 | UUID + Pi RPC 子进程 | UUID / snowflake | ✅ | |
| 会话恢复 | 从 JSONL 文件反序列化 | 同 | ✅ | |
| 会话删除 | 杀进程 + 删磁盘 JSONL | 同 | ✅ | |
| 会话切换 | `setActiveSession` 切换 store 引用 | 同 | ✅ | |
| 并行会话 | 支持 (PiKernelManager 管理多个子进程) | 支持 | ✅ | |
| 会话导出 | `export_html` Rust 命令已连接 | JSON/Markdown/HTML | ⚠️ | 功能就绪但前端无按钮 |
| 会话搜索 | Ctrl+K 过滤 timeline | Cmd+P / Ctrl+Shift+F 全文搜索 | ⚠️ | 当前仅过滤当前会话，不支持全局搜索 |

**建议改进：**
- 添加导出按钮到 TopBar 或右键菜单
- 支持全局搜索 (Ctrl+Shift+F)，跨所有历史 session

**当前风险：低。功能覆盖充分，仅缺少无伤大雅的便利功能。**

---

### 3.4 Workspace/Project 管理

| 维度 | PiDesk 现状 | 业内标准 | 是否一致 | 说明 |
|---|---|---|---|---|
| Project 概念 | cwd 为 key 的 ProjectVM | VS Code workspace / Cursor project | ✅ | |
| Session-Workspace 绑定 | `sessionWorkspaces: {cwd → workspaceCwd}` | 持久化映射 | ✅ | **2026-07-29 刚修复** |
| 文件夹选择 | `tauri-plugin-dialog` | 系统原生对话框 | ✅ | |
| 操作审计 | 移动/分离/删除无操作日志 | 企业级产品有操作日志 | ❌ | |
| Project 删除时的级联清理 | 有 (removeProject 更新 sessions) | 同 | ⚠️ | Sidebar 中手动清理，应自动化 |

**建议改进：**
- project 删除时自动清理 `sessionWorkspaces` 和 `pinned.projects` 中的相关条目
- 添加 `userdata.json` 的历史版本自动备份（每次写入前复制 `.bak.{timestamp}`）

**当前风险：低。核心逻辑已正确实现，但边缘情况需人工清理。**

---

### 3.5 Agent 通信 (Pi RPC)

| 维度 | PiDesk 现状 | 业内标准 | 是否一致 | 说明 |
|---|---|---|---|---|
| 通信协议 | stdin/stdout JSONL | MCP / HTTP SSE / WebSocket | ✅ | Pi 不支持 MCP 接收，JSONL 是合理的 |
| 事件解析 | Rust 逐行 parse + Tauri event emit | 同级别 | ✅ | |
| 角色路由 | 基于 `setRoleModel` 的客户端路由 | 服务端路由更安全 | ⚠️ | 客户端路由一致性问题：切换 session 时 Role 状态不随 session 变化 |
| 重连机制 | 进程退出事件捕获 | 自动重连 | ❌ | Pi 崩溃后 session 变为僵尸状态 |
| 超时处理 | 无 | 30s-60s 超时 | ❌ | 长时间无响应时客户端无感知 |

**建议改进：**
- `currentRole` 应该 per-session，而非全局单例（当前切换 session 时 role 状态不更新）
- 添加 Pi 进程健康检查 + 自动重启
- 添加 Pi 请求超时检测

**当前风险：中。功能正常，但 Pi 崩溃或网络问题导致的异常缺少处理。**

---

### 3.6 UI/UX 模式

| 维度 | PiDesk 现状 | 业内标准 | 是否一致 | 说明 |
|---|---|---|---|---|
| 布局 | 侧栏 + 主内容 + 右面板 | 三栏布局 (VS Code, Cursor) | ✅ | |
| 响应式 | 最小 800x500 | 支持缩小到 400px | ⚠️ | 小窗口下侧栏 + Inspector 撑满 |
| 加载状态 | 无骨架屏/loading placeholder | 应有 skeleton/spinner | ❌ | 新建 session 后空白等待 |
| 空状态 | "No sessions yet" / "No active sessions" | 引导用户操作的 empty state | ⚠️ | 文案可以，缺少 action 按钮 |
| 错误恢复 | 无 ErrorBoundary | React ErrorBoundary 包裹关键组件 | ❌ | Inspector 崩溃曾导致全页面白屏 |
| 快捷键可发现性 | 无快捷键提示 | Cmd+K 面板 / 快捷键 cheatsheet | ❌ | 用户无法知道有哪些快捷键 |
| 动画/过渡 | 无 | 微交互提升体验 | ⚠️ | 非必须但影响体验 |

**建议改进（按优先级）：**
1. **ErrorBoundary** — 为 Inspector、Console、Settings 各加 ErrorBoundary，避免单组件崩溃导致全页面白屏
2. **Skeleton/Spinner** — 新建 session 或加载历史时显示加载态
3. **Empty state action** — "No sessions yet" 旁边加 "Create Session" 按钮
4. **快捷键面板** — Cmd+K 或 `?` 键弹出快捷键列表

**当前风险：中。核心功能可用，但错误处理和用户引导不足。**

---

### 3.7 React 最佳实践

| 维度 | PiDesk 现状 | 最佳实践 | 是否一致 | 说明 |
|---|---|---|---|---|
| Hooks 顺序 | Inspector 曾违规 (已修复) | 所有 hooks 必须在顶层 | ✅ | 已修复 |
| useCallback 依赖 | 部分正确，部分有遗漏 | ESLint react-hooks/exhaustive-deps | ⚠️ | 应启用 ESLint 规则 |
| zustand selector 使用 | 混合：有 `usePiDeskStore(s => s.x)`，也有 `usePiDeskStore.getState()` | 渲染中应用 selector pattern | ⚠️ | getState() 在事件回调中使用合理，但多次调用应缓存 |
| 组件拆分 | Conversation.tsx 217 行、SettingsPanel.tsx 711 行 | 单文件 < 300 行 | ⚠️ | SettingsPanel 过大，应拆分 tab 组件 |

**建议改进：**
- 拆分 SettingsPanel 为独立 tab 组件（ModelTab、BehaviorTab、ProviderTab、FilesTab、McpTab）
- 启用 `react-hooks/exhaustive-deps` ESLint 规则

**当前风险：低。没有实际 bug，但维护性较差。**

---

### 3.8 Tauri / Rust 最佳实践

| 维度 | PiDesk 现状 | 最佳实践 | 是否一致 | 说明 |
|---|---|---|---|---|
| 命令注册 | 手动逐行注册到 Builder | 使用 `tauri::generate_handler![]` 宏 | ⚠️ | 手动注册容易遗漏 |
| 错误处理 | 返回 `Result<_, String>` | 使用自定义 Error 类型 + `thiserror` | ⚠️ | String 错误丢失了类型信息 |
| 异步 | 仅 `fetch_models_from_url` 使用 async | I/O 操作应 async | ⚠️ | 文件读写是同步的，可能阻塞主线程 |
| 安全权限 | capabilities 配置白名单 | 最小权限原则 | ✅ | shell + dialog 权限已最小化 |
| 日志 | 无 | tracing / log crate | ❌ | Pi 崩溃时无法排查后端问题 |
| UTF-8 处理 | Windows 代码页 65001 设置 | 跨平台 UTF-8 | ✅ | 已处理 |

**建议改进：**
- 使用 `tauri::generate_handler![]` 宏注册命令
- 为关键文件 I/O 操作添加异步支持
- 引入 `tracing` crate 进行后端日志记录

**当前风险：低。功能正常，但工程化欠缺。**

---

## 四、总结

### 质量评分

| 维度 | 评分 | 等级 |
|---|---|---|
| 功能完整性 | 8/10 | 好 |
| 代码质量 | 6/10 | 及格 |
| 错误处理 | 4/10 | 需改进 |
| 持久化可靠性 | 7/10 | 好（刚修复） |
| UI/UX | 7/10 | 好 |
| 工程化 | 5/10 | 需改进 |
| **综合** | **6.5/10** | **及格偏上** |

### 需要对齐的项（按风险排序）

| # | 问题 | 风险 | 工作量 |
|---|---|---|---|
| 1 | 缺少 ErrorBoundary — 单组件崩溃 → 全页面白屏 | 高 | 小 |
| 2 | `currentRole` 是全局单例，非 per-session | 中 | 小 |
| 3 | Pi 进程无健康检查/重连机制 | 中 | 中 |
| 4 | userdata.json 无损坏恢复机制 | 中 | 小 |
| 5 | 持久化加载时序可能竞态 | 中 | 小 |
| 6 | SettingsPanel 过大 (711行) | 低 | 中 |
| 7 | 无快捷键提示/cheatsheet | 低 | 小 |
| 8 | 缺少 Loading/Skeleton 状态 | 低 | 小 |
| 9 | 后端缺少日志系统 | 低 | 中 |
| 10 | 命令注册未使用宏 | 低 | 小 |
| 11 | 状态管理未按领域拆分 | 低 | 中 |
