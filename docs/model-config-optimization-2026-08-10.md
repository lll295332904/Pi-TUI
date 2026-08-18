# 大模型配置优化审计 — 2026-08-10

> 审计对象:PiDesk 的模型选择 / 思考级别 / 角色模型 / 内置 Pi runtime 配置链路
> 审计结论:存在 4 个真实缺陷(P0/P1,其中问题 0 为架构级)+ 5 项优化空间,详见下文

---

## 一、现状快照

### 1.1 Pi 全局配置 `~/.pi/agent/settings.json`

```json
{
  "lastChangelogVersion": "0.84.1",
  "compaction": { "enabled": true },
  "retry": { "enabled": true },
  "steeringMode": "all",
  "followUpMode": "all",
  "defaultProvider": "deepseek",
  "defaultModel": "deepseek-v4-flash",
  "defaultThinkingLevel": "high"
}
```

### 1.2 PiDesk 前端默认值 `src/store/pidesk.ts`

```ts
const DEFAULT_SETTINGS: PiDeskSettings = {
  defaultModel: null,            // ← 未配置时回退逻辑见问题 1
  defaultThinkingLevel: "medium",// ← 与 Pi 全局 high 不一致
  defaultCwd: "C:\\Git",
  autoCompaction: true,
  autoRetry: true,
  steeringMode: "all",
  followUpMode: "all",
  roleModels: { /* 全部 null */ },
};
```

### 1.3 版本

| 项 | 值 |
|---|---|
| PiDesk 内置 runtime(`src-tauri/pi-bundle/package.json`) | **0.82.0** |
| 全局 Pi CLI | **0.84.1** |
| 可用模型来源 | `~/.pi/agent/models-store.json`(目录)+ `~/.pi/agent/models.json`(用户自定义) |

### 1.4 可用模型清单(models-store.json)

| Provider | 模型 | ctx | maxOut | store 中 reasoning | thinkingLevelMap |
|---|---|---|---|---|---|
| Nexus Api | gpt-5.4 | 400K | 128K | false | `{"off": null}` |
| Nexus Api | gpt-5.5 | 400K | 128K | false | `{"off": null}` |
| Nexus Api | gpt-5.6-sol / terra | 1050K | 128K | false | `{"off": null}` |
| Nexus Api | codex-auto-review | 128K | 16K | false | — |
| deepseek | deepseek-v4-flash / pro | 1000K | 384K | true | `minimal/low/medium`=null,`high/max` 有效 |
| 小米mimo | mimo-v2.5(**唯一支持 image**) | 128K | 16K | true | 仅 `high/max` 有效 |
| 小米mimo | mimo-v2.5-pro | 128K | 16K | true | 仅 `high/max` 有效 |

---

## 二、问题清单

### 🔴 问题 0(P0,架构级):数据层双源 + 反向同步 —— 内核与 UI 永远不一致,需 ModelRegistry 根治重构 ✅ 已完成(2026-08-10)

**这是其他所有问题的病根,必须先治。**

#### 根因

Pi 内核(0.84)官方合并语义(**`docs/models.md` 明确规定的“Overriding Built-in Providers”**):

> `models.json`(用户自定义)优先于内置/目录模型(`models-store.json`);自定义模型按 `id` upsert,同 id 时**自定义替换内置**。

而 PiDesk 的 `sync_models_json()`(Rust)干的事**恰好相反**:每次 `get_available_models` 都用 `models-store.json`(checkedAt==null 的 managed 目录)**整体覆盖** `models.json`。

最终形成两条互斥的读路径:

```
Pi 内核   → 读 models.json(合并后,自定义生效)  ──┐
                                                  ├─ 互相矛盾
PiDesk UI → 读 models-store.json(原始目录)       ──┘
              └ 且每次启动把 store 反向写回 models.json(sync_models_json)
```

**影响**
- 内核能用的模型 ≠ UI 显示的模型(用户自定义被静默冲掉,见问题 2)
- 工作偏差:UI 上选的能力(thinking/推理)与实际内核发送的请求不一致
- 任何前端框架都救不了 —— 这是**跨进程数据一致性问题**,需要架构层修复

#### 前端框架的定位(回应 MVC 类比)

游戏 MVC 的演进,前端全部有对应物:

| 游戏开发 | 前端对应 | PiDesk 现状 |
|---|---|---|
| MVC | Backbone.js | — |
| MVVM / 数据绑定 | Vue / Angular | React + hooks(部分) |
| **单向数据流(Flux)** | **React + Redux / Zustand** | ✅ 已用 Zustand |
| **SSOT(单一事实来源)** | Redux 单一 store / 服务端权威 | ❌ 双数据源冲突 ← 病根 |
| **Server State 缓存层** | **TanStack Query / SWR** | ❌ 缺(手写 fetch + 手动刷新) |
| 事件驱动同步 | SSE / WebSocket + 缓存失效 | 部分(Tauri event) |
| CQRS(读写分离) | 读模型 / 写模型分离 | ❌ 读写混在一个文件里 |

**结论:前端不缺框架。** Zustand(单向数据流)已在用且合适;它管不了“内核进程与 UI 进程各持一份文件”的问题。需要的是**架构模式:SSOT + CQRS + 事件总线**(思路类比 TanStack Query 的“服务端状态为唯一权威,UI 从统一缓存层读,变更走统一入口并广播失效”),而不是再装一个框架。

#### 根治方案:ModelRegistry(模型注册表)+ 单一合并器

```
                    ┌─────────────────────────────────────┐
                    │      Pi 内核 (Node runtime)          │
                    │  读 models.json + models-store.json  │
                    │  合并规则:用户自定义优先(官方语义)     │
                    └──────────────┬──────────────────────┘
                                   │ 同一份合并视图
┌──────────────────────────────────▼──────────────────────┐
│        Rust 层: ModelRegistry(新增,唯一数据访问层)        │
│  ├─ merge_catalog()  : 读两份文件,按 Pi 语义合并(只读)    │
│  ├─ get_available_models() : 只从合并视图读 ← UI=内核     │
│  ├─ get_thinking_levels()  : 合并视图 + 过滤 null 值      │
│  ├─ add_model / remove_model : 写 models.json(用户层)    │
│  └─ emit "models:changed" : 任何变更后广播                │
└──────────────┬──────────────────────────────────────────┘
               │ Tauri event / invoke
┌──────────────▼──────────────────────────────────────────┐
│    前端 Zustand store(降级为纯派生缓存)                   │
│    availableModels 只由 启动拉取 + models:changed 事件更新│
│    UI 组件永远从 store 读,禁止手改模型列表                │
└─────────────────────────────────────────────────────────┘
```

#### 实施步骤

1. **新增合并器(核心)**:`merge_catalog()` 复刻 Pi 官方合并语义 —— 目录模型(`models-store.json`)为基底,`models.json` 按 id upsert、同 id 用户定义替换。`get_available_models` / `get_thinking_levels` 全部改从合并视图读。**UI 展示 = 内核使用,从根上一致。**
2. **删除病根**:废弃 `sync_models_json()`(反向覆盖函数),彻底移除“PiDesk 反向写 models.json”这条路径。
3. **写路径归位**:`add_model` / `remove_model` 改为写 **models.json**(用户自定义的正确位置),而不是 models-store.json;同时修复 `add_model` 里 `thinkingLevelMap` 全为 null 的问题(现在新增推理模型标 `{off:null,minimal:null,...}` 等于全不可用)。
4. **变更广播**:所有模型写操作成功后 emit `models:changed` 事件,前端订阅后自动刷新 —— 不用重启、不用手动刷新。
5. **设置一致性(联动问题 1)**:启动时读 Pi 的 `settings.json`,PiDesk 未显式配置时继承 `defaultModel` + `defaultThinkingLevel`,消除第二处“两套配置”。

#### 根治验收标准

- [x] 内核 `/model` 列表与 PiDesk 设置面板列表**一一对应**(合并视图:用户自定义生效,已验证 gpt-5.4 = reasoning:true + 全级别)
- [x] 用户手改 `models.json` 任意字段,**重启后不被冲掉**(`sync_models_json` 已删除,改为 `merge_catalog` 只读合并)
- [x] `pi update --models` 或 PiDesk 增删模型后,UI **自动同步**(add/remove 成功后 emit `models:changed`,前端订阅刷新)
- [x] thinking 级别只显示**实际可用**的(`null` 值过滤:deepseek → [high,max])
- [x] 代码中不再存在“反向写 models.json”的逻辑(已删除 `sync_models_json`)

**实施记录(2026-08-10,已落地)**
- [x] 任务 1:新增 `merge_catalog()` 只读合并器;`get_available_models` / `get_thinking_levels` 改从合并视图读;thinking 级别 null 过滤
- [x] 任务 2:删除 `sync_models_json()`(病根);`add_model` 写 `models.json` + 修复 thinkingLevelMap 非 null;`remove_model` 用户层 + 目录层双删(幂等)
- [x] 任务 3:模型变更后 emit `models:changed` 事件(Rust `AppHandle` + `Emitter`)
- [x] 任务 4:前端 `bridge.ts` 新增 `onModelsChanged` 订阅;`App.tsx` 抽取统一 `refreshModels()`(启动 + 事件双入口)
- [x] 任务 5:启动时继承 Pi 全局 `settings.json` 的 `defaultProvider/defaultModel/defaultThinkingLevel`(仅当用户未显式配置 defaultModel 时)

**验证**:`cargo check` / `tsc --noEmit` / `npm run build` 全部通过;用真实配置模拟合并视图确认 9 个模型的 reasoning/thinking/vision 与内核一致

**涉及文件**
- `src-tauri/src/commands/models.rs`(重构:新增 `merge_catalog`、废弃 `sync_models_json`、改造读写路径)
- `src-tauri/src/lib.rs` / `commands/mod.rs`(注册 `models:changed` 事件)
- `src/bridge.ts`(订阅事件、`refreshModels()` 统一入口)
- `src/store/pidesk.ts`(availableModels 降级为派生缓存)
- `src/App.tsx`(启动继承 Pi settings)

---

### 🔴 问题 1(P0):PiDesk 新会话落到的模型与用户预期不一致 ✅ 已解决(任务 5:继承 Pi 全局默认)

**现象**
`App.tsx` 的 `applySettingsToSession` 中,当 PiDesk 的 `settings.defaultModel` 为 null 时:

```ts
if (!isValidModelRef(dm)) {
  ...
  const firstModel = available[0];            // ← 直接取 availableModels[0]
  dm = { provider: firstModel.provider, id: firstModel.id };
}
```

`get_available_models`(Rust)按 provider 顺序返回,`availableModels[0]` 是 **Nexus Api / gpt-5.4**,而不是 Pi 全局配置的 `deepseek/deepseek-v4-flash`。

**影响**
- 同一台机器两套配置脱节:Pi 全局用 deepseek,PiDesk 新会话用 gpt-5.4
- 且 store 版 gpt-5.4 标记 `reasoning: false`(见问题 2),等于用"无思考"模型跑主任务
- `defaultThinkingLevel: "medium"` 会把 Pi 全局的 `high` 覆盖掉

**建议**
1. PiDesk 启动时读取 `~/.pi/agent/settings.json`,在 PiDesk 未显式配置 defaultModel 时**继承 Pi 全局**的 `defaultProvider/defaultModel/defaultThinkingLevel`;
2. 自动回退时优先选 `reasoning === true` 的模型,避免落到 codex-auto-review 这类非推理模型。

**涉及文件**
- `src/App.tsx`(`applySettingsToSession`)
- `src/store/pidesk.ts`(DEFAULT_SETTINGS 默认值)
- `src/bridge.ts`(新增读取 Pi settings 的桥接,可用现有 `readPiFile("settings.json")`)

---

### 🔴 问题 2(P0):`sync_models_json` 覆盖用户自定义模型配置 ✅ 已解决(问题 0 任务 2:删除病根)

**现象**
`src-tauri/src/commands/models.rs` 的 `sync_models_json()`:对 `models-store.json` 中 `checkedAt == null`(managed)的 provider,用目录版本**整体替换** `models.json` 中同名 provider。

当前 `models-store.json` 中 Nexus Api 的 `checkedAt = null`(managed),因此用户手写在 `models.json` 里的 `gpt-5.4 (reasoning: true, thinkingLevelMap 完整)` 每次 `get_available_models` 都会被目录版(`reasoning: false, {"off": null}`)冲掉。

**影响**
- 用户对模型的自定义(reasoning / thinking / contextWindow / maxTokens)**永远不生效**
- PiDesk 展示的模型能力与实际 Pi 收到的目录信息不一致
- 想给 gpt-5.4 开 thinking 的用户会被静默打回

**建议**
- sync 改为**用户自定义优先的合并**:`models.json` 中已存在的模型字段不被目录覆盖,目录只补充缺失字段;
- 或让 `get_available_models` 直接读**合并后**的 `models.json`(它才是 Pi 实际使用的权威文件)。

**涉及文件**
- `src-tauri/src/commands/models.rs`(`sync_models_json` / `get_available_models`)

---

### 🟡 问题 3(P1):thinking 级别列表包含"假可用"项 ✅ 已解决(问题 0 任务 1:null 值过滤)

**现象**
`get_available_models` 用 `thinkingLevelMap.contains_key(level)` 判断可用性,**不检查值是否为 null**:

```rust
if let Some(tlm) = model.get("thinkingLevelMap").and_then(|v| v.as_object()) {
    for level in ["off", "minimal", "low", "medium", "high", "xhigh", "max"] {
        if tlm.contains_key(level) {
            thinking_levels.push(level.to_string());
        }
    }
}
```

而 Pi 语义中 `value = null` 表示该级别**不可用**。

**影响**

| 模型 | UI 显示可用 | 实际可用 |
|---|---|---|
| deepseek-v4-flash | minimal/low/medium/high/max | **仅 high/max** |
| mimo-v2.5 | high/max | high/max |
| gpt-5.4(store 版) | off | off |

用户在 PiDesk 设置里选 deepseek 的 `medium`,实际会被 Pi fallback 或静默降级。

**建议**
只列入 `value != null` 的级别。

**涉及文件**
- `src-tauri/src/commands/models.rs`(`get_available_models`)

---

### 🟢 优化 4(P1):roleModels 全部为 null,建议按角色配模型 ✅ 已实施(2026-08-10)

当前 `settings.roleModels` 十个角色全空。角色触发时(compaction/approval/vision/web/mcp/subAgent/skills/maintenance)只有 vision 有自动回退,其余直接跳过切换。

| 角色 | 建议模型 | 理由 |
|---|---|---|
| **main** | `gpt-5.6-terra`(1.05M ctx)或 `deepseek-v4-pro` | 主力推理 |
| **compression** | `deepseek-v4-flash` | 摘要任务,快且省 |
| **maintenance** | `deepseek-v4-flash` | 重试/维护轻量 |
| **approval** | `deepseek-v4-flash` | 审批决策,响应快 |
| **vision** | `mimo-v2.5` | **唯一支持图片的模型**(不配则自动选它) |
| **title / web / skills** | `deepseek-v4-flash` | 轻量任务 |

配置入口:PiDesk 设置 → Model → 角色模型(已有 UI)。

**实施记录(2026-08-10,已落地)**
- `src/store/pidesk.ts`:新增 `DEFAULT_ROLE_MODELS` 常量(main/subAgent → `deepseek-v4-pro`;vision → `mimo-v2.5`;其余 → `deepseek-v4-flash`),`DEFAULT_SETTINGS.roleModels` 引用之
- 老用户迁移:localStorage 里 roleModels 全为 null 时自动填充推荐值(store `merge` 逻辑)
- 安全兜底:若默认引用的 provider 不在模型目录,`refreshModels()` 的 sanitize 会自动清空对应角色,不会导致 set_model 失败
- 已验证:10 个角色引用的模型在合并目录中全部存在

---

### 🟢 优化 5(P2):角色联动 thinking level ✅ 已实施(2026-08-10)

现在角色切换(`switchToRole`)只切模型,不切思考级别。建议在 store 增加 `roleThinkingLevels`,让:
- compression / approval / title / maintenance → `low/medium`
- main / subAgent / mcp → `high/max`

减少压缩摘要、审批等轻量角色的推理延迟与 token 消耗。

**实施记录(2026-08-10,已落地)**
- `src/types.ts`:新增 `RoleThinkingLevels` 类型,`PiDeskSettings` 增加 `roleThinkingLevels` 字段
- `src/store/pidesk.ts`:新增 `DEFAULT_ROLE_THINKING_LEVELS`(main/vision/subAgent→high;web/compression/approval/title/maintenance→low;skills/mcp→medium),老存储自动迁移
- `src/App.tsx`:新增 `applyRoleThinkingLevel()` 联动函数——角色切换/恢复主角色后按配置设置 thinking 级别,**仅当角色模型实际支持该级别时生效**(deepseek-v4 只支持 high/max,低级别请求自动跳过,不会报错)
- 注:当前 deepseek-v4 系思考不可降,降级实际效果有限;角色换成 gpt-5.x 等全级别模型后自动受益

**涉及文件**
- `src/types.ts` / `src/store/pidesk.ts` / `src/App.tsx`

---

### 🟢 优化 6(P2):compaction 参数适配 1M 上下文 ✅ 已实施(2026-08-10)

Pi 全局 `~/.pi/agent/settings.json` 当前未显式设置:

```json
"compaction": { "enabled": true, "reserveTokens": 16384, "keepRecentTokens": 20000 }
```

`keepRecentTokens = 20000` 对 deepseek 1M 上下文偏小 → 频繁压缩;而压缩会**打散 DeepSeek 的 prompt cache**,反而更贵更慢。

**实施记录(2026-08-10,已落地)**
- 已修改 `~/.pi/agent/settings.json`:
```json
"compaction": {
  "enabled": true,
  "reserveTokens": 16384,
  "keepRecentTokens": 60000
}
```
- 修改前已备份至 `settings.json.bak-pidesk-optimize`

---

### 🟢 优化 7(P2):内置 runtime 升级 0.82 → 0.84.1 ✅ 已实施(2026-08-10)

- 全局 Pi CLI 已是 0.84.1,PiDesk 内置仍是 0.82.0
- 升级步骤:重跑 `scripts\bundle-pi.bat`(从全局 npm 包复制到 `src-tauri/pi-bundle/`)
- 前端 `App.tsx` 事件处理已预留 0.82+ 事件别名(compaction_start/agent_compacting 等),兼容风险低
- 升级后可获得 0.84 的 compaction 事件细化、thinking 级别、retry 参数等改进

**实施记录(2026-08-10,已落地)**
- 重跑 `scripts\bundle-pi.bat`,`src-tauri/pi-bundle/package.json` 版本 **0.82.0 → 0.84.1**(252MB)
- RPC 兼容性验证:0.84.1 `rpc-mode.js` 命令列表与 PiDesk `PiRequest` 枚举 17 项命令**全部匹配**(prompt/steer/follow_up/abort/set_model/set_thinking_level/get_entries/get_tree/fork/switch_session/bash/compact/export_html/set_steering_mode/set_follow_up_mode/set_auto_compaction/set_auto_retry/extension_ui_response)
- 事件映射兼容(pi_kernel.rs:`response`→rpc-response、`extension_ui_request`→extension-ui-request、其余→agent-event)
- `cargo check` / `npm run build` 通过;注意:当前运行的已安装版(AppData\Local\PiDesk)仍是 0.82,需重新构建 release 安装包才会生效

**验证**
```bash
npm run build
cd src-tauri && cargo check
npm run tauri -- build
```
并确认 release 产物含 `pi-bundle/node.exe`、`dist/rpc-entry.js`、`node_modules/`。

---

### 🟢 优化 8(P3):thinkingBudgets 控制推理 token 预算 ✅ 已实施(2026-08-10)

deepseek-v4 系是推理模型,thinking token 消耗大。可在 Pi 全局 settings 配置预算:

```json
"thinkingBudgets": {
  "minimal": 1024,
  "low": 4096,
  "medium": 10240,
  "high": 32768
}
```

按任务复杂度控制推理开销与延迟。

**实施记录(2026-08-10,已落地)**
- 已写入 `~/.pi/agent/settings.json`(上述配置),备份于 `settings.json.bak-pidesk-thinkingbudgets`
- JSON 校验通过;对当前 deepseek-v4 系有效级别(high/max),high=32768 tokens 推理预算生效

---

## 三、已确认无需改动

| 项 | 结论 |
|---|---|
| `retry.provider.maxRetries = 0` | 保持 0,官方明确建议不要调高(否则 SDK 重试会吞掉限流错误) |
| `steeringMode / followUpMode = all` | 符合 PiDesk 的排队交互设计 |
| `transport` | 默认 auto 即可 |
| 模型 cost 全为 0 | 聚合 API,成本非主要约束,重点是延迟与输出质量 |

---

## 四、建议实施顺序

| 优先级 | 项 | 工作量 | 风险 |
|---|---|---|---|
| **P0** | **问题 0:ModelRegistry 根治重构(单一合并器 + 事件广播)** | 大(Rust 重构) | 中(需回归模型列表) |
| P0 | 问题 1:默认模型对齐 Pi 全局 | 小 | 低 |
| P0 | 问题 2:sync 覆盖用户自定义 | 中(由问题 0 一并解决) | 中(需回归模型列表) |
| P1 | 问题 3:过滤 null thinking 级别 | 小(由问题 0 一并解决) | 低 |
| P1 | 优化 4:配置 roleModels | 无代码(纯配置) | 低 |
| P2 | 优化 5:角色联动 thinking | 中 | 低 |
| P2 | 优化 6:compaction keepRecentTokens | 无代码(改 settings.json) | 低 |
| P2 | 优化 7:runtime 升级 0.84.1 | 小(重跑 bundle 脚本) | 中(需回归) |
| P3 | 优化 8:thinkingBudgets | 无代码(改 settings.json) | 低 |

**全部完成 ✅(2026-08-10)—— 问题 0/1/2/3、优化 4/5/6/7/8 均已落地**

---

## 五、第二轮优化(2026-08-10):模型能力与一致性(1-5)

> 在首轮基础上继续挖掘。前三项涉及代码,后两项纯配置。

### 优化 9:gpt-5.x 系列开启 reasoning ✅ 已实施(2026-08-10)

`~/.pi/agent/models.json`(用户层,merge 用户优先):Nexus Api 的 gpt-5.4 / 5.5 / 5.6-sol / 5.6-terra 从 `reasoning: false` + `thinkingLevelMap: {off: null}` 升级为:

```json
{
  "reasoning": true,
  "thinkingLevelMap": {
    "minimal": null, "low": null, "medium": null,
    "high": "high", "max": "max"
  }
}
```

- compat 已是 `thinkingFormat: "deepseek"`,聚合层走 deepseek 风格思考,映射与 deepseek-v4 系一致
- 1.05M ctx 的 gpt-5.6-sol/terra 现在可用推理
- ⚠️ 需实测:Nexus 聚合是否真正透传思考;若报错改回 `false` 即可(按 id 覆盖,秒级回退)

### 优化 10:samplingParams 显式采样 ✅ 已实施(2026-08-10)

| 模型 | samplingParams | 理由 |
|---|---|---|
| gpt-5.4 / 5.5 / 5.6-sol / 5.6-terra | `{"temperature": 0.3, "top_p": 0.9}` | 代码任务稳定输出 |
| mimo-v2.5 / mimo-v2.5-pro | `{"temperature": 0.7}` | 视觉/轻量任务 |
| deepseek-v4-flash / pro | **未配** | 推理模型,官方 API 拒绝非默认 temperature,有 400 风险 |

### 优化 11:PiDesk thinking level 与 Pi 全局对齐 ✅ 已实施(2026-08-10)

- `src/store/pidesk.ts`:`DEFAULT_SETTINGS.defaultThinkingLevel` `"medium"` → `"high"`(与 Pi 全局一致;medium 在 deepseek/gpt-5.x/mimo 上均不可用,之前会被静默跳过)
- 老用户迁移:merge 时 persisted 残留 `medium` 自动升 `high`
- `src/App.tsx` 继承逻辑重构:thinking level 独立于 defaultModel——用户选过模型但其 level 在 Pi 全局模型上不可用时,仍继承 Pi 的 level,不再整体跳过

### 优化 12:retry.provider.timeoutMs ✅ 已实施(2026-08-10)

`~/.pi/agent/settings.json`:`retry` 显式化 `{"enabled": true, "provider": {"timeoutMs": 600000, "maxRetries": 0, "maxRetryDelayMs": 60000}}`。

- `timeoutMs: 600000`(10 分钟)针对 deepseek 1M ctx + high thinking 长任务,避免 SDK 默认超时中断
- `maxRetries: 0` 按官方建议保留(SDK 重试会吞掉限流错误)

### 优化 13:thinkingBudgets 补 max ✅ 已实施(2026-08-10)

```json
"thinkingBudgets": {
  "minimal": 1024, "low": 4096, "medium": 10240,
  "high": 32768, "max": 65536
}
```

deepseek 实际支持 high/max,此前 max 无预算约束,现在推理 token 上限明确。

---

## 六、第三轮优化(2026-08-10):网络与模型元数据(6-10)

> 全部为纯配置,无代码改动。

### 优化 14:showCacheMissNotices ✅ 已实施(2026-08-10)

`settings.json` 加 `"showCacheMissNotices": true`,会话中可见 prompt cache miss 通知,用于验证 compaction(60K keepRecentTokens)是否真的减少压缩、保住 DeepSeek 缓存。

### 优化 15:defaultModel 切 deepseek-v4-pro ✅ 已实施(2026-08-10)

全局默认 `deepseek-v4-flash` → `deepseek-v4-pro`,新会话默认质量优先(与 roleModels 的 main/subAgent 一致)。

- ⚠️ 生效条件:PiDesk 仅在**未显式配置** defaultModel 时继承(App.tsx 继承逻辑);已有配置的用户需在设置面板手动切换

### 优化 16:httpIdleTimeoutMs ✅ 已实施(2026-08-10)

`"httpIdleTimeoutMs": 600000`(默认 300000),384K maxTokens 输出 + high thinking 长流式不因 5 分钟 idle 断开。

### 优化 17:branchSummary.reserveTokens ✅ 已实施(2026-08-10)

`"branchSummary": { "reserveTokens": 16384 }` 显式化,/tree 分支摘要的响应预算明确。

### 优化 18:mimo maxTokens 放宽 ✅ 已实施(2026-08-10)

`models.json` 中 `mimo-v2.5` / `mimo-v2.5-pro` `maxTokens` `16384` → `32768`,放宽长文档视觉分析输出。

- ⚠️ 若小米 API 实际不支持 32K 输出导致报错,改回 `16384` 即可

---

**两轮增量(优化 9-18)验证**:三份 JSON 均通过校验;merge_catalog 合并视图中 9 个模型 reasoning/thinking/samplingParams/maxTokens 与内核一致;roleModels 引用的 deepseek-v4-pro / deepseek-v4-flash / mimo-v2.5 全部可解析;`tsc --noEmit` 通过。

**备份文件**:`models.json.bak-pidesk-thinking` / `settings.json.bak-pidesk-timeout-max`(第二轮)、`settings.json.bak-pidesk-round2` / `models.json.bak-pidesk-round2`(第三轮)

---

## 七、deepseek 思考档位修正(2026-08-10,优化 19)—— 依据官方文档

### 发现的问题

deepseek 官方 API 文档定义思考控制为:

| 控制 | 参数 |
|---|---|
| 思考模式开关 | `{"thinking": {"type": "enabled/disabled"}}` |
| 思考强度 | `{"reasoning_effort": "low/high/max"}`(none 关闭) |

但此前配置存在**两个叠加缺陷**:

1. **`low` 被错误屏蔽**:pi 目录(models-store.json)给 deepseek 配 `low: null` → UI 不可选;实际 API 支持 `low/high/max`
2. **`supportsReasoningEffort` 未开启**:pi 内核(openai-completions.js deepseek 分支)仅在 `compat.supportsReasoningEffort` 为真时发送 `reasoning_effort`,而目录 compat 无此字段(默认 undefined)→ **high/max 在请求层只是 `thinking: {type:"enabled"}`,思考强度形同虚设**

### 修复(models.json 用户层,同 id 整体覆盖)

- `compat.supportsReasoningEffort: true` → 内核实际发送 `reasoning_effort`
- `thinkingLevelMap: {"off": "off", "minimal": null, "low": "low", "medium": null, "high": "high", "max": "max"}` → 开放 off/low/high/max(medium/minimal deepseek 无此档,保持 null)
- 合并视图:deepseek usable = **[off, low, high, max]**,PiDesk UI 与内核一致
- `off: "off"` 触发 `thinking: {type: "disabled"}`(关闭思考);`low` 触发 `reasoning_effort: "low"`

### 联动修正(src/store/pidesk.ts)

- `DEFAULT_ROLE_THINKING_LEVELS`:`skills`/`mcp` `medium` → `low`(deepseek 无 medium 档,medium 在任何模型上均无效)
- merge 迁移:老用户 roleThinkingLevels 中的 `medium` 自动归一为 `low`
- 现在 web/compression/approval/title/maintenance/skills/mcp = `low` **真正生效**(不再是无效档位,与主角色 high 形成实际区分)

### 附:优化 18(mimo maxTokens)落盘修正

第 10 项 mimo `maxTokens: 32768` 此前因 heredoc 中文键名编码破坏**未落盘**(内存修改丢失,验证时误读为已生效)。已改用 id 子串匹配重写并字节级确认(`32768`×2 落盘)。

### 验证

三份 JSON 校验通过;合并视图 9 模型一致(deepseek=[off,low,high,max]+effort=true,mimo maxOut=32768);`tsc --noEmit` / `vite build` 通过。

### 待实测

- deepseek 实际请求体是否携带 `reasoning_effort`(用会话日志/抓包确认)
- gpt-5.x(Nexus 聚合)与 mimo 是否也应开 `supportsReasoningEffort`(聚合层能力未知,暂缓;若实测支持可同样开放 low 档)

---

*文档生成日期:2026-08-10*
*关联代码:`src/App.tsx` / `src/store/pidesk.ts` / `src-tauri/src/commands/models.rs` / `src-tauri/src/lib.rs` / `src/bridge.ts` / `src/components/settings/ModelTab.tsx`*
