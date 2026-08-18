# PiDesk Improvement Plan

> 日期：2026-08-05 | 基于全量源码审查 + 行业对标 | ✅ = 已完成 | ⚪ = 暂缓

---

## Part 1: Script 脚本问题

| # | 问题 | 严重程度 | 状态 |
|---|---|---|---|
| S1 | node.exe 查找路径错误 | 中 | ✅ 已修复 |
| S2 | robocopy 静默吞错 | 低 | ⚪ 暂缓 |
| S3 | `SAFE_DELETE_DISABLE=1` 重复设置 | 低 | ✅ 已修复 |
| S4 | build-pidesk.bat 无问题 | - | ✅ 确认 |

### ⚡ 紧急修复：Session 重开后丢失记录 (2026-08-05)

**根因分析：**
1. `handleNewSession()` 未保存 `lastActiveCwd` → 新建 session 关闭后无法恢复
2. `lastActiveCwd` 不在 Zustand `partialize` 中 → 仅通过 500ms 防抖文件写入, 快速关闭则丢失
3. Pi 子进程被直接 kill → JSONL 写入未 flush 到磁盘

**修复：**
| # | 修复 | 文件 |
|---|---|---|
| P1 | `handleNewSession` 添加 `setLastActiveCwd(cwd)` | `App.tsx` |
| P2 | `partialize` 添加 `lastActiveCwd` → localStorage 即时持久化 | `store/pidesk.ts` |
| P3 | `stop_session` 关闭前 drop stdin + 300ms 等待 Pi flush JSONL | `pi_kernel.rs` |
| P4 | `on_window_event(CloseRequested)` 调用 `shutdown_all()` 优雅退出 | `lib.rs` |

---

## Part 2: 代码逻辑错误 / 死代码 / 重复代码

| # | 问题 | 严重程度 | 状态 |
|---|---|---|---|
| B1 | `bash()` 返回类型声明为 `BashResult`，Rust 端只返回 `()` | 高 | ✅ 已修复 |
| B2 | `get_entries()` / `get_tree()` 返回类型暗示含数据，实为 `void` | 中 | ✅ 已修复 |
| B3 | `SettingsPanel.tsx` render 中调用 `getState()` | 中 | ✅ 已修复 |
| B4 | `renameSession` 更新 `sessionNames` 但未触发文件持久化 | 中 | ✅ 已修复 |
| B5 | `moveSessionToWorkspace` / `detachSessionFromWorkspace` 手动重建冗余 | 低 | ✅ 已修复 |
| D1 | `THINKING_OPTIONS` 在两处各定义一次 | 低 | ✅ 已修复 |
| D2 | `formatToolSummary` / `formatToolInput` switch 重复 | 低 | ✅ 已修复 |
| D3 | TopBar 压实按钮无 onClick | 低 | ✅ 已修复 |
| H1 | MCP 服务器列表硬编码 | 中 | ✅ 已修复 |

---

## Part 3: 行业对标 — 缺失功能

对比产品：Cursor、Windsurf、Claude Desktop、VS Code

| # | 功能 | 状态 |
|---|---|---|
| F1 | 暗色主题 (Dark Theme) | ⚪ 暂缓 |
| F2 | 会话导出按钮 (HTML) | ✅ 已完成 |
| F3 | 全局搜索 (跨所有历史 session) | ⚪ 暂缓 |
| F4 | 快捷键面板 (Ctrl+/ or ?) | ✅ 已完成 |
| F5 | 加载骨架屏 (Skeleton) | ⚪ 暂缓 |
| F6 | 拖拽文件到输入框 | ⚪ 暂缓 |
| F7 | 右键菜单 → 导出会话 | ✅ 已完成 |
| F8 | Pi 进程自动重启 | ⚪ 暂缓 |
| F9 | currentRole per-session | ✅ 确认已实现 |
| F10 | ErrorBoundary 扩展覆盖 | ✅ 已完成 |
| F11 | userdata.json 损坏恢复 | ✅ 确认已实现 |

---

## Part 4: 变更摘要

### 已修改文件 (12个)

| 文件 | 变更内容 |
|---|---|
| `src/bridge.ts` | B1: bash() 返回 void; B2: get_entries/get_tree 返回 void; 移除未用类型导入 |
| `src/types.ts` | D1: 新增 `THINKING_LEVELS` 常量导出 |
| `src/store/pidesk.ts` | B4: renameSession 调用 saveManual; B5: 使用展开语法简化 |
| `src/App.tsx` | F4: 添加快捷键面板 (Ctrl+/, ?); F10: ErrorBoundary 包裹 Conversation+Settings |
| `src/components/TopBar.tsx` | D1: 使用共享 THINKING_LEVELS; D3: 压实按钮接线 compactSession; F2: 导出 HTML 按钮 |
| `src/components/SettingsPanel.tsx` | B3: language 改为 selector; D1: 共享 THINKING_LEVELS; H1: MCP 从 settings.json 动态加载 |
| `src/components/Sidebar.tsx` | F7: 右键菜单添加 Export HTML 选项 |
| `src/components/Conversation.tsx` | D2: 提取 extractToolParam() 消除重复 switch |
| `src/components/ShortcutsPanel.tsx` | F4: 新建快捷键帮助面板组件 |
| `scripts/bundle-pi.bat` | S1: 修复 node.exe 查找路径为 `%APPDATA%\npm\node.exe` |
| `start-pidesk.bat` | S3: 移除重复的 `SAFE_DELETE_DISABLE=1` |

### 模型配置优化批次 (2026-08-10,优化 9-18) — 详见 `docs/model-config-optimization-2026-08-10.md` §5/§6

| 文件 | 变更内容 |
|---|---|
| `~/.pi/agent/models.json` | gpt-5.4/5.5/5.6-sol/5.6-terra 开启 `reasoning: true` + thinkingLevelMap(high/max);gpt-5.x 加 samplingParams `{temperature:0.3, top_p:0.9}`;mimo-v2.5/pro 加 samplingParams `{temperature:0.7}`、maxTokens `16384→32768`(落盘修正见下) |
| `~/.pi/agent/models.json` | deepseek-v4-flash/pro 思考档位修正(依据官方文档):thinkingLevelMap 开放 `off/low/high/max` + `compat.supportsReasoningEffort: true`(此前 reasoning_effort 从不发送,high/max 无强度语义);mimo maxTokens 32768 因 heredoc 中文键编码破坏未落盘,已用 id 匹配重写并字节级确认 |
| `~/.pi/agent/settings.json` | retry 显式化 `timeoutMs:600000`(maxRetries 保持 0);thinkingBudgets 补 `max:65536`;`showCacheMissNotices:true`;defaultModel `flash→pro`;`httpIdleTimeoutMs:600000`;branchSummary.reserveTokens 显式化 |
| `src/store/pidesk.ts` | `DEFAULT_SETTINGS.defaultThinkingLevel` `medium→high`(与 Pi 全局一致);merge 迁移残留 medium→high;`DEFAULT_ROLE_THINKING_LEVELS` skills/mcp `medium→low` + 迁移归一(deepseek 无 medium 档) |
| `src/App.tsx` | 继承逻辑重构:thinking level 独立于 defaultModel 继承——用户选过模型但其 level 在 Pi 全局模型上不可用时仍继承 Pi 的 level |

**回归**:`tsc --noEmit` / `vite build` / `cargo check` 全部通过;三份 JSON(`settings/models/models-store`)校验通过;merge_catalog 合并视图 9 模型与内核一致;roleModels 引用全部可解析。

**备份**:`models.json.bak-pidesk-thinking` / `settings.json.bak-pidesk-timeout-max` / `settings.json.bak-pidesk-round2` / `models.json.bak-pidesk-round2`

**待实测**:gpt-5.x 开 thinking 后需验证 Nexus 聚合层实际透传思考;mimo 32K 输出需验证小米 API 支持(均留有按 id 覆盖的秒级回退路径)

### 暂缓项（需较大工程量）

- **F1 暗色主题** — 需要设计 tokens + 重构 Tailwind 颜色方案
- **F3 全局搜索** — 需要跨 JSONL 全文索引 + 搜索结果展示
- **F5 加载骨架屏** — 需要设计 skeleton 组件 + 所有加载态接入
- **F6 拖拽文件** — 需要 Tauri drag-drop 事件 + Composer 改造
- **F8 Pi 自动重启** — 需要状态机管理重连逻辑 + 恢复策略
- **S2 robocopy 日志** — 低优先级，当前静默不影响功能
