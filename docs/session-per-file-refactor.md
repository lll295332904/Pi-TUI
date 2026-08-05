# Session 独立化重构方案

## 问题

当前系统以 `cwd`（项目路径）作为 session 标识，同一项目下所有 .jsonl 对话被合并为一个 session 显示。而业界标准是以每个 .jsonl 文件为独立对话单元。

| 层级 | 当前行为 | 问题 |
|------|---------|------|
| Rust `list_pi_sessions()` | 遍历目录，每目录只返回 1 个 PiSessionMeta | `--C--Git--` 有 8 个 .jsonl，只报 1 个 |
| Store `setHistoricalSessions()` | `filter((item, i, self) => i === self.findIndex(t => t.cwd === item.cwd))` | 同 cwd 的 session 全被去重合并 |
| `sessionNames` | key 为 `cwd` | 一个项目只能有一个名字 |
| `deletePiSession(cwd)` | 按 cwd 删除 | 无法删除单个对话 |

## 目标

每个 .jsonl 文件 = 一个独立 session，可独立：
- 显示在侧边栏
- 用首条用户消息自动命名
- 重命名
- 删除
- 置顶 / 移入 workspace

## 改动清单

### 1. Rust 后端 `src-tauri/src/commands/session.rs`

- [ ] `list_pi_sessions()` 改为每 .jsonl 文件返回一个 `PiSessionMeta`
  - `id`: 格式 `目录名/文件名`，全局唯一
  - `name`: 从第一条 `role: "user"` 的 message 中取前 24 字符
  - `last_modified`: 文件修改时间
  - `entry_count`: 该 .jsonl 中的条目数
- [ ] `load_session_entries()` 改为接收文件级路径（目录名/文件名）
- [ ] 新增 `delete_pi_session()` 删除单个 .jsonl 文件；目录为空时清理目录

### 2. Types `src/types.ts`

- [ ] `PiSessionMeta` 新增 `name: string` 字段
- [ ] `PiSessionMeta.id` 语义从"目录名"改为"文件级 ID"

### 3. Store `src/store/pidesk.ts`

- [ ] `setHistoricalSessions()` 移除 cwd 去重逻辑
- [ ] `sessionNames` key 从 `cwd` 改为 `sessionId`
- [ ] `renameSession()` 同步写 `sessionNames[sessionId]`
- [ ] `removeSession()` 清理对应的 `sessionNames` 条目
- [ ] `setSessionName()` 签名改为 `(sessionId, name)` 或废弃

### 4. Sidebar `src/components/Sidebar.tsx`

- [ ] 历史 session 名称从 `sessionNames[h.cwd]` 改为 `h.name`
- [ ] 上下文菜单的删除/重命名传 sessionId

### 5. App `src/App.tsx`

- [ ] `handleResumeSession()` 按文件级 ID 恢复
- [ ] `handleDeleteSession()` 传文件级 ID 给 `deletePiSession`
- [ ] 恢复 session 时用 `h.name` 作为初始名称

### 6. 持久化 `userdata.json`

- [ ] `sessionNames` 的 key 从 cwd 迁移到 session file ID
- [ ] 兼容旧数据：首次加载时检测旧格式并迁移

## 兼容性

- `userdata.json` 中的 `sessionNames` 需要平滑迁移
- 旧 key 是 cwd 字符串，新 key 是 `目录名/文件名`
- 启动时检测：如果 `sessionNames` 中存在非 `/` 分隔的 key，视为旧格式，尝试匹配并迁移

## 进度

| 序号 | 文件 | 状态 |
|------|------|------|
| 1 | Rust `session.rs` | ✅ `list_pi_sessions` 每 .jsonl 返回一条；`load_session_entries` 接受文件级 ID；新增 `delete_pi_session` |
| 2 | `types.ts` | ✅ `PiSessionMeta.name` 新增；`SessionVM.fileId` 新增 |
| 3 | `pidesk.ts` | ✅ 移除 cwd 去重；`sessionNames` key 改为 sessionId/fileId；`renameSession` 用 `fileId` 持久化 |
| 4 | `Sidebar.tsx` | ✅ 历史 session 名用 `h.name`；`commitRename` 传 sessionId |
| 5 | `App.tsx` | ✅ `handleResumeSession` 按 fileId 恢复；`handleDeleteSession` 按 fileId 删除；`fileId` 写入 SessionVM |
| 6 | `userdata.json` 兼容 | ✅ 启动时检测旧 cwd-keyed `sessionNames`，匹配迁移到 file-level ID |

## 构建验证

- `cargo check` ✅ 通过
- `npx tsc --noEmit` ✅ 通过
