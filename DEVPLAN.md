# PiDesk Development Plan

> 完整代码审计与业内标准对比见 [AUDIT.md](./AUDIT.md)

## ✅ Completed Features

### Session & Workspace
- [x] Multi-session support (parallel Pi processes via RPC stdin/stdout)
- [x] session lifecycle: create / resume (from JSONL) / delete (disk + memory)
- [x] session rename (double-click inline edit)
- [x] Project/Workspace concept with per-cwd grouping
- [x] 3-zone sidebar: TOP TASKS / WORKSPACES / TASKS
- [x] Pin/unpin sessions and workspaces (persisted)
- [x] Right-click context menu: rename, pin, delete, move/detach workspace
- [x] Move session between workspaces
- [x] Detach session from workspace → standalone

### Settings Panel
- [x] Model tab: select default model + thinking level per session
- [x] Behavior tab: auto-compaction, auto-retry, steering mode, follow-up mode
- [x] Provider tab: role-specific model assignment (10 roles: main, vision, web, compression, skills, approval, title, maintenance, mcp, subAgent)
- [x] Add/remove model via models-store.json
- [x] Fetch models from OpenAI-compatible URL
- [x] Files tab: view/edit Pi config files (models-store.json, agents.json)

### Agent Interaction
- [x] Prompt submission via RPC bridge
- [x] Timeline display: user messages, assistant thinking, tool calls, text responses
- [x] Thinking level indicator (quick/medium/deep)
- [x] Tool call visualization (bash, read, write, grep, edit, etc.)
- [x] Abort running session
- [x] Event parsing: RTT, prefill, progress, tool_use, agent_compacting, mcp

### Persistence
- [x] Zustand persist middleware (pi-desk-storage)
- [x] Manual localStorage backup (pi-desk-userdata) for projects/pinned/sessionNames
- [x] Settings persistence across rebuilds

### Tauri Backend
- [x] Pi process management (start/stop/stdin/stdout)
- [x] Session JSONL reading/parsing
- [x] models-store.json read/write
- [x] Model CRUD (add/remove/fetch)
- [x] Config file read/write
- [x] Session disk deletion

---

## ❌ Missing Features

### P0 — Essential
- [x] **Inspector Panel** — right-side panel showing session info, activity summary, tool stats, recent tool calls
- [x] **Manual Compaction Button** — TopBar button to observe/trigger context compaction
- [x] **Voice Input** — Web Speech API button in Composer for voice-to-text (zh-CN)

### P1 — Important
- [x] **Console/Terminal Panel** — bottom panel showing raw Pi event JSON with syntax coloring
- [x] **Token Usage Statistics** — Inspector shows accumulated input/output/total tokens per session
- [x] **MCP Management Panel** — Settings tab for MCP server list + add form
- [x] **Session Search** — Ctrl+K search bar, timeline filtering, match count
- [x] **Keyboard Shortcuts** — Ctrl+K/N/W/B/I/Comma + Esc

### P2 — Nice to Have
- [ ] **Image Generation** — `/image` slash command → external API call → embed result
- [ ] **Session Export** — export to JSONL or Markdown
- [ ] **Custom System Prompt** — edit agents.json system prompts via UI
- [ ] **Dark Theme** — CSS theme toggle

### P3 — Future
- [ ] **File Browser Panel** — integrated file tree, drag files into chat
- [ ] **Multi-window / Split View** — independent window or split pane layout
- [ ] **Session Sharing** — export + import session bundles
