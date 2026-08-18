# Pi-TUI Agent Executable Optimization Plan

Date: 2025-08-09
Project: `C:/Git/Pi-TUI`

## Goal

Reduce perceived latency, lower UI noise, improve maintainability, and make performance bottlenecks measurable without changing core user-facing behavior.

This document is written as an agent-executable implementation plan. Each work item includes scope, concrete steps, acceptance criteria, and constraints.

## Execution Rules

- Follow existing project patterns in `src/App.tsx`, `src/store/pidesk.ts`, and `src/components/Conversation.tsx`.
- Keep changes incremental. Do not combine unrelated refactors into the same patch.
- After each task, run:

```bash
npm --prefix C:/Git/Pi-TUI run build
```

- Do not remove existing session isolation behavior.
- Do not break current tool timeline, console, or inspector visibility.
- Prefer low-risk internal changes before introducing new libraries.

## Priority Order

1. Timeline update hot path optimization
2. Performance instrumentation
3. Tool runtime state extraction
4. Streaming render simplification
5. Conversation virtualization
6. Store split by update frequency and ownership
7. System/debug message layering
8. Role-switch lifecycle state machine
9. Persistence policy cleanup
10. Event typing hardening

---

## Task 1: Optimize Timeline Update Hot Path

### Problem

`updateTimelineItem` in `src/store/pidesk.ts` currently scans the full session timeline with `map()` for each update. Streaming text and tool output updates make this path hot and expensive.

### Objective

Replace full-array scan updates with direct indexed replacement while preserving timeline order.

### Scope

- `src/store/pidesk.ts`
- Any directly affected timeline helper types

### Implementation Steps

1. Extend session timeline state to maintain item indexes per session.
2. When appending timeline items, record item id to index mapping.
3. Update `updateTimelineItem` to:
   - resolve target session
   - look up item index directly
   - replace only the matched element
4. Ensure tool items and assistant/user items use consistent id extraction.
5. Update any timeline reset or history-load path to rebuild indexes.

### Acceptance Criteria

- Timeline order remains unchanged.
- Streaming assistant updates still render correctly.
- Tool output updates still work for running tools.
- No TypeScript errors.
- Build passes.

### Constraints

- Do not change visible conversation semantics.
- Do not rewrite the whole store if a local change is sufficient.

---

## Task 2: Add Performance Instrumentation

### Problem

The app currently cannot distinguish model latency, Pi bridge latency, tool runtime latency, and UI rendering delay.

### Objective

Record enough timestamps to explain slow-feeling interactions.

### Scope

- `src/App.tsx`
- `src/store/pidesk.ts`
- `src/components/InspectorPanel.tsx` or a new lightweight debug panel section
- `src/types.ts`

### Metrics To Capture

Per session request:

- `sendAt`: user triggered send
- `firstEventAt`: first Pi event for the request
- `firstToolAt`: first tool execution start
- `settledAt`: agent settled
- `firstVisibleRenderAt`: first front-end render after response begins

Derived metrics:

- model/bridge startup delay = `firstEventAt - sendAt`
- tool start delay = `firstToolAt - sendAt`
- total task duration = `settledAt - sendAt`
- UI visible delay = `firstVisibleRenderAt - sendAt`

### Implementation Steps

1. Define a request performance structure keyed by session id.
2. On `handleSend`, initialize a new active measurement.
3. In `handlePiEvent`, stamp the first matching timestamps only once.
4. In the conversation render path, stamp `firstVisibleRenderAt` for active streaming response.
5. Expose current and last completed metrics in Inspector.
6. Make the instrumentation non-blocking and in-memory only.

### Acceptance Criteria

- Metrics appear for at least one completed task.
- No user-facing regressions.
- No persistence added for these metrics.
- Build passes.

### Constraints

- Avoid high-frequency logging to console.
- Keep this as lightweight state, not a telemetry framework.

---

## Task 3: Extract Tool Runtime State From Timeline

### Problem

Tool runtime data is stored directly in timeline items. Incremental tool output updates cause repeated timeline rewriting and couple rendering state to execution state.

### Objective

Separate tool runtime state from the conversation timeline while preserving display behavior.

### Scope

- `src/store/pidesk.ts`
- `src/App.tsx`
- `src/components/Conversation.tsx`
- `src/components/InspectorPanel.tsx`
- `src/types.ts`

### Target Design

- Timeline keeps lightweight tool reference items or grouped tool markers.
- Tool execution details live in a dedicated per-session structure:
  - `toolRunsBySession[sessionId][toolCallId]`

### Implementation Steps

1. Add dedicated tool runtime store state.
2. Change tool execution start/update/end handlers to mutate tool runtime state instead of rewriting large timeline payloads.
3. Keep timeline entries minimal and reference `toolCallId`.
4. Update Conversation and Inspector to resolve tool details from the new structure.
5. Preserve current grouping UX.

### Acceptance Criteria

- Tool cards still display input, output, state, and result.
- Tool updates remain real-time.
- Timeline updates are reduced compared with current behavior.
- Build passes.

### Constraints

- Keep migration incremental.
- Do not break resumed historical sessions; define fallback handling if no runtime entry exists.

---

## Task 4: Simplify Streaming Rendering

### Problem

Streaming assistant messages still re-run Markdown rendering frequently and can feel heavy for long outputs.

### Objective

Reduce render cost during streaming without losing final Markdown formatting.

### Scope

- `src/components/Conversation.tsx`

### Implementation Steps

1. During streaming, render assistant text as plain pre-wrapped text.
2. After `message_end` / `turn_end`, switch the completed message to Markdown rendering.
3. Memoize completed assistant bubbles where practical.
4. Keep thinking block behavior unchanged unless it becomes a measurable bottleneck.

### Acceptance Criteria

- Streaming feels more responsive on long responses.
- Final completed assistant message still renders as Markdown.
- Build passes.

### Constraints

- Do not degrade readability during streaming.
- Keep code understandable; avoid premature micro-optimizations.

---

## Task 5: Add Conversation Virtualization

### Problem

Long conversations still accumulate large DOM trees and rendering work even with `contentVisibility`.

### Objective

Render only visible conversation rows.

### Scope

- `src/components/Conversation.tsx`
- Optional dependency if necessary

### Implementation Steps

1. Evaluate whether current custom rendering can support lightweight manual virtualization.
2. If not, introduce a small proven virtualization library compatible with current stack.
3. Virtualize the grouped timeline list, not raw items.
4. Preserve auto-scroll-to-bottom behavior when pinned.
5. Preserve search result filtering behavior.

### Acceptance Criteria

- Long sessions remain smooth.
- Auto-scroll still works correctly.
- Expanding tool groups still works.
- Build passes.

### Constraints

- Do not introduce a large dependency without clear need.
- Avoid regressions in scroll behavior.

---

## Task 6: Split Zustand Store By Responsibility

### Problem

`src/store/pidesk.ts` currently mixes high-frequency runtime state, persistent settings, and general UI state in one store.

### Objective

Reduce unnecessary re-renders and improve code ownership clarity.

### Scope

- `src/store/pidesk.ts`
- Store consumers across `src/components` and `src/App.tsx`

### Proposed Split

- runtime store: sessions, statuses, timelines, tool runs, console, metrics
- settings store: models, projects, pinned items, persisted preferences
- ui store: modal visibility, search, toasts, panel open state

### Implementation Steps

1. Identify hot-update fields.
2. Extract one slice at a time, starting with UI-only state or persistent settings.
3. Update selectors in affected components.
4. Keep external API naming consistent where possible.

### Acceptance Criteria

- No behavioral changes.
- Hot runtime updates trigger fewer unrelated component updates.
- Build passes.

### Constraints

- Do not perform this before hot-path optimization and instrumentation.
- Keep migration staged.

---

## Task 7: Layer System Messages By Audience

### Problem

Main conversation area still mixes user-relevant notices with low-level debug/system messages.

### Objective

Reduce noise in the main conversation while keeping diagnostics available.

### Scope

- `src/App.tsx`
- `src/components/Conversation.tsx`
- `src/components/ConsolePanel.tsx`
- `src/types.ts`

### Target Categories

- `notice`: visible in conversation
- `error`: visible in conversation
- `debug`: console/inspector only unless explicitly expanded

### Implementation Steps

1. Extend timeline/system message typing with category.
2. Reclassify stderr and low-level rpc chatter as debug where appropriate.
3. Show only high-value notices in the main conversation.
4. Preserve full detail in Console.

### Acceptance Criteria

- Main conversation is less noisy.
- Debug information remains available elsewhere.
- Build passes.

---

## Task 8: Formalize Role-Switch Lifecycle

### Problem

Temporary role switching for vision, mcp, web, compression, maintenance, and approval is spread across event handlers and can become fragile as features grow.

### Objective

Introduce explicit role-switch lifecycle control.

### Scope

- `src/App.tsx`
- `src/model-switch.ts`
- Possibly a new helper module

### Implementation Steps

1. Define a small role lifecycle model:
   - `main`
   - `temporary`
   - `restoring`
2. Route all role changes through a shared helper.
3. Guard against overlapping switches and stale restores.
4. Keep restore behavior session-scoped.

### Acceptance Criteria

- Role switches remain correct during tool usage and task completion.
- Background sessions do not change active session role unexpectedly.
- Build passes.

---

## Task 9: Clean Up Persistence Policy

### Problem

Persistence is currently mixed between local store persistence and manual debounced saves, with policy spread across multiple actions.

### Objective

Make state durability rules explicit and reduce accidental save churn.

### Scope

- `src/store/pidesk.ts`
- Any persistence helper modules

### Implementation Steps

1. List every persisted field.
2. Mark each as one of:
   - persist immediately
   - persist debounced
   - memory only
3. Consolidate save triggers behind named helpers.
4. Remove accidental persistence from hot paths.

### Acceptance Criteria

- Persisted data remains correct after restart.
- High-frequency runtime operations do not schedule unnecessary saves.
- Build passes.

---

## Task 10: Harden Pi Event Typing

### Problem

Front-end event handling relies on broad stringly-typed structures, which makes future changes more fragile.

### Objective

Strengthen typing for high-frequency Pi events while keeping backward compatibility.

### Scope

- `src/types.ts`
- `src/App.tsx`

### Implementation Steps

1. Create narrower TypeScript types for:
   - `message_update`
   - `tool_execution_start`
   - `tool_execution_update`
   - `tool_execution_end`
   - `agent_settled`
   - `model_changed`
2. Add local type guards where needed.
3. Simplify `handlePiEvent` branch logic using typed event narrowing.

### Acceptance Criteria

- Fewer unchecked property accesses in `App.tsx`.
- TypeScript catches more event-shape mistakes.
- Build passes.

---

## Recommended Delivery Plan

### Phase 1

- Task 1: Optimize Timeline Update Hot Path
- Task 2: Add Performance Instrumentation
- Task 4: Simplify Streaming Rendering

### Phase 2

- Task 3: Extract Tool Runtime State From Timeline
- Task 7: Layer System Messages By Audience
- Task 8: Formalize Role-Switch Lifecycle

### Phase 3

- Task 5: Add Conversation Virtualization
- Task 6: Split Zustand Store By Responsibility
- Task 9: Clean Up Persistence Policy
- Task 10: Harden Pi Event Typing

## Definition of Done

The optimization program is complete when:

- Long-running tasks feel responsive in the main UI.
- Tool-heavy runs no longer flood the main conversation area.
- Slow-feeling interactions can be explained with captured timings.
- Runtime state updates avoid repeated full timeline rewrites.
- Session isolation remains correct.
- Production build passes after each completed task.

## Suggested First Execution Command For An Agent

Start with Task 1, then Task 2, then Task 4. These three should provide the best immediate improvement per unit of risk.
