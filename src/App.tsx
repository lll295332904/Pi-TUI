import { useEffect, useRef, useCallback, useState } from "react";
import { usePiDeskStore } from "./store/pidesk";
import {
  startSession, prompt as piPrompt, onPiEvent, abortSession, stopSession,
  listPiSessions, loadSessionEntries, getAvailableModels, deletePiSession,
  setThinkingLevel, setAutoCompaction, setAutoRetry,
  setSteeringMode, setFollowUpMode, checkPiHealth, loadUserdata,
  getSessionsDir, switchSession, newPiSession, steer, saveUserdata,
  restartSession, isValidModelRef,
} from "./bridge";
import { switchModel } from "./model-switch";
import type { PiRawAgentEvent, TimelineItem, MessageVM, ToolCallVM, PiOutboundEvent, SessionEntryVm, ExtensionUiRequest, RoleModels, PiDeskSettings, ThinkingLevel } from "./types";
import TopBar from "./components/TopBar";
import Sidebar from "./components/Sidebar";
import Conversation from "./components/Conversation";
import Composer from "./components/Composer";
import StatusBar from "./components/StatusBar";
import SettingsPanel from "./components/SettingsPanel";
import InspectorPanel from "./components/InspectorPanel";
import SearchBar from "./components/SearchBar";
import ConsolePanel from "./components/ConsolePanel";
import ApprovalDialog from "./components/ApprovalDialog";
import ErrorBoundary from "./components/ErrorBoundary";
import ToastContainer from "./components/ToastContainer";
import ShortcutsPanel from "./components/ShortcutsPanel";
import StartupDiagnosticsPanel from "./components/StartupCheck";
import SetupWizard from "./components/SetupWizard";
import { getT } from "./i18n";

// Add this at the top of App() body after other hooks
// (we'll use useT inside the callback, not at module level)

// ── Convert Pi JSONL entries to frontend TimelineItems ──

function entriesToTimeline(entries: SessionEntryVm[]): TimelineItem[] {
  return entries.map((e) => {
    const ts = e.timestamp ? new Date(e.timestamp).getTime() : Date.now();
    if (e.role === "user") {
      return {
        type: "user",
        id: e.id,
        role: "user" as const,
        text: e.content || "",
        streaming: false,
        timestamp: ts,
      } as TimelineItem;
    }
    if (e.role === "assistant") {
      return {
        type: "assistant",
        id: e.id,
        role: "assistant" as const,
        text: e.content || "",
        thinking: e.thinking || undefined,
        streaming: false,
        timestamp: ts,
      } as TimelineItem;
    }
    return {
      type: "system-info",
      text: `[${e.role || e.type}] ${(e.content || "").slice(0, 80)}`,
      timestamp: ts,
    } as TimelineItem;
  });
}

// ── App ──

export default function App() {
  const activeId = usePiDeskStore((s) => s.activeSessionId);
  const setActiveSession = usePiDeskStore((s) => s.setActiveSession);
  const updateStatus = usePiDeskStore((s) => s.updateSessionStatus);
  const renameSession = usePiDeskStore((s) => s.renameSession);
  const removeSession = usePiDeskStore((s) => s.removeSession);
  const appendTimeline = usePiDeskStore((s) => s.appendTimeline);
  const updateTimelineItem = usePiDeskStore((s) => s.updateTimelineItem);
  const loadHistoryEntries = usePiDeskStore((s) => s.loadHistoryEntries);
  const setHistoricalSessions = usePiDeskStore((s) => s.setHistoricalSessions);
  const clearInput = usePiDeskStore((s) => s.clearInput);
  const sidebarOpen = usePiDeskStore((s) => s.sidebarOpen);
  const addProject = usePiDeskStore((s) => s.addProject);
  const setAvailableModels = usePiDeskStore((s) => s.setAvailableModels);
  const addExtensionUiRequest = usePiDeskStore((s) => s.addExtensionUiRequest);
  const updateSessionModel = usePiDeskStore((s) => s.updateSessionModel);
  const updateSessionThinkingLevel = usePiDeskStore((s) => s.updateSessionThinkingLevel);
  const setCurrentRole = usePiDeskStore((s) => s.setCurrentRole);

  // Track streaming assistant message
  const streamRef = useRef<{ id: string; thinking: string; text: string } | null>(null);
  // Last time any pi agent event arrived (used by the response-timeout guard)
  const lastEventRef = useRef<number>(Date.now());
  // Guard against concurrent resume for the same cwd
  const resumingRef = useRef<Set<string>>(new Set());
  const prevStatusRef = useRef<Record<string, string>>({});
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // ── Boot phase: startup diagnostics → setup wizard → main app ──
  type BootPhase = "diagnostics" | "wizard" | "ready";
  const [bootPhase, setBootPhase] = useState<BootPhase>("diagnostics");

  // Process recovery state
  const [exitedSessions, setExitedSessions] = useState<Set<string>>(new Set());
  const [restartingSession, setRestartingSession] = useState<string | null>(null);

  async function handleRestartSession(sessionId: string) {
    const sess = usePiDeskStore.getState().sessions[sessionId];
    if (!sess) return;
    setRestartingSession(sessionId);
    try {
      await restartSession(sessionId, sess.cwd);
      await applySettingsToSession(sessionId);
      updateStatus(sessionId, "idle");
      setExitedSessions(prev => { const n = new Set(prev); n.delete(sessionId); return n; });
      appendTimeline({ type: "system-info", text: "Pi process restarted", timestamp: Date.now() });
    } catch (e) {
      appendTimeline({ type: "system-info", text: `Restart failed: ${String(e)}`, timestamp: Date.now() });
    } finally {
      setRestartingSession(null);
    }
  }

  // ── Role-based model switching ──

  const switchToRole = useCallback(async (role: string) => {
    if (!activeId) return;
    const settings = usePiDeskStore.getState().settings;
    const roleModel = settings.roleModels[role as keyof RoleModels];
    if (!isValidModelRef(roleModel)) return;

    const ok = await switchModel(activeId, roleModel.provider, roleModel.id);
    if (ok) setCurrentRole(role as keyof RoleModels);
  }, [activeId, setCurrentRole]);

  const restoreMainModel = useCallback(async () => {
    if (!activeId) return;
    const store = usePiDeskStore.getState();
    if (store.currentRole === "main") return;

    const mainModel = store.settings.roleModels.main || store.settings.defaultModel;
    if (!isValidModelRef(mainModel)) return;

    const ok = await switchModel(activeId, mainModel.provider, mainModel.id);
    if (ok) setCurrentRole("main");
  }, [activeId, setCurrentRole]);

  // ── Pi event handler ──
  const handlePiEvent = useCallback((ev: PiOutboundEvent) => {
    const store = usePiDeskStore.getState();
    const sessionId = store.activeSessionId;

    // Any agent activity (thinking, text, tool calls, retries) resets the
    // response-timeout guard — the request is clearly alive.
    if (ev.kind === "agent-event" || ev.kind === "error") {
      lastEventRef.current = Date.now();
    }

    // Console log: append raw event JSON
    if (sessionId) {
      try { store.appendConsoleLog(sessionId, JSON.stringify(ev)); } catch { /* ignore */ }
    }

    // Track usage from agent events
    if (sessionId && ev.kind === "agent-event") {
      const ee = ev as { event?: Record<string, unknown> };
      const body = ee.event;
      // Pi stores usage inside message.usage.{input, output}
      const msg = (body?.message || body?.assistantMessageEvent || {}) as Record<string, unknown>;
      const usage = (msg?.usage || body?.usage || {}) as Record<string, number>;
      const input = usage.input ?? usage.inputTokens ?? usage.input_tokens ?? usage.prompt_tokens ?? 0;
      const output = usage.output ?? usage.outputTokens ?? usage.output_tokens ?? usage.completion_tokens ?? 0;
      if (input > 0 || output > 0) {
        store.accumulateUsage(sessionId, input, output);
      }
    }

    if (ev.kind === "stderr") {
      const line = (ev.event as { line?: string })?.line ?? "";
      appendTimeline({ type: "system-info", text: `[pi] ${line}`, timestamp: Date.now() });
      return;
    }

    if (ev.kind === "process-exit") {
      const sid = ev.sessionId;
      appendTimeline({ type: "system-info", text: "Pi process exited. Click restart to recover.", timestamp: Date.now() });
      updateStatus(sid, "exited");
      setExitedSessions(prev => new Set(prev).add(sid));
      return;
    }

    if (ev.kind === "error") {
      const msg = (ev.event as { message?: string })?.message
        ?? (ev.event as { error?: string })?.error
        ?? JSON.stringify(ev.event);
      appendTimeline({ type: "system-info", text: `Error: ${msg}`, timestamp: Date.now() });
      return;
    }

    if (ev.kind === "rpc-response") {
      const rpc = ev.event as { command?: string; success?: boolean; error?: string; data?: unknown };
      if (rpc.success === false && rpc.error) {
        const cmd = rpc.command || "unknown";
        appendTimeline({ type: "system-info", text: `[${cmd}] failed: ${rpc.error}`, timestamp: Date.now() });
        const s = usePiDeskStore.getState();
        const t = getT(s.language);
        if (cmd === "set_model") {
          // Model config invalid/corrupted — self-heal so the error doesn't repeat
          if (sessionId) updateStatus(sessionId, "idle");
          const patch: Partial<PiDeskSettings> = {};
          const dm = s.settings.defaultModel;
          if (dm && !isValidModelRef(dm)) patch.defaultModel = null;
          const cleanedRoles: Partial<RoleModels> = {};
          let roleDirty = false;
          for (const [role, ref] of Object.entries(s.settings.roleModels)) {
            if (ref && !isValidModelRef(ref)) { (cleanedRoles as Record<string, null>)[role] = null; roleDirty = true; }
          }
          if (roleDirty) patch.roleModels = { ...s.settings.roleModels, ...cleanedRoles };
          if (Object.keys(patch).length) {
            console.warn("[rpc-response] set_model failed, clearing corrupted model refs:", patch);
            s.setSettings(patch);
            s.addToast({
              type: "error",
              title: t("toast", "error"),
              message: t("toast", "modelReset"),
              durationMs: 8000,
            });
          }
        } else {
          s.addToast({
            type: "error",
            title: t("toast", "error"),
            message: rpc.error,
            durationMs: 8000,
          });
        }
      }
      return;
    }

    if (ev.kind === "extension-ui-request") {
      const req = ev.event as { id: string; method: string; title?: string; message?: string; [key: string]: unknown };
      const extReq: ExtensionUiRequest = {
        sessionId: ev.sessionId,
        id: req.id,
        method: req.method,
        title: req.title,
        message: req.message,
      };
      addExtensionUiRequest(extReq);
      const s = usePiDeskStore.getState();
      const tfn = getT(s.language);
      s.addToast({
        type: "warning",
        title: req.title || tfn("toast", "permissionRequired"),
        message: req.message,
        durationMs: 0, // sticky until user acts
      });
      // Switch to approval model for approval decisions
      switchToRole("approval");
      return;
    }

    if (ev.kind === "result") return;
    if (ev.kind !== "agent-event" || !ev.event) return;

    const event = ev.event as PiRawAgentEvent;
    const sid = usePiDeskStore.getState().activeSessionId;

    switch (event.type) {
      case "message_update": {
        const ame = event.assistantMessageEvent;
        if (!ame) break;
        if (!streamRef.current) {
          streamRef.current = { id: `asst-${Date.now()}`, thinking: "", text: "" };
          const msg: MessageVM = { id: streamRef.current.id, role: "assistant", text: "", thinking: "", streaming: true, timestamp: Date.now() };
          appendTimeline({ type: "assistant", ...msg } as TimelineItem);
          if (sid) { prevStatusRef.current[sid] = "streaming"; updateStatus(sid, "streaming"); }
        }
        switch (ame.type) {
          case "thinking_delta":
            streamRef.current.thinking += ame.delta ?? "";
            updateTimelineItem(streamRef.current.id, { thinking: streamRef.current.thinking });
            break;
          case "thinking_end":
            if (ame.content) streamRef.current.thinking = ame.content;
            updateTimelineItem(streamRef.current.id, { thinking: streamRef.current.thinking });
            break;
          case "text_delta":
            streamRef.current.text += ame.delta ?? "";
            updateTimelineItem(streamRef.current.id, { text: streamRef.current.text });
            break;
          case "text_end":
            if (ame.content) streamRef.current.text = ame.content;
            updateTimelineItem(streamRef.current.id, { text: streamRef.current.text });
            break;
        }
        break;
      }
      case "message_end":
      case "turn_end": {
        if (streamRef.current) {
          if (event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "thinking" && typeof block.thinking === "string") streamRef.current.thinking = block.thinking;
              if (block.type === "text" && typeof block.text === "string") streamRef.current.text = block.text;
            }
          }
          updateTimelineItem(streamRef.current.id, { text: streamRef.current.text, thinking: streamRef.current.thinking, streaming: false });
          streamRef.current = null;
        }
        break;
      }
      case "agent_end": {
        if (streamRef.current) { updateTimelineItem(streamRef.current.id, { streaming: false }); streamRef.current = null; }
        break;
      }
      case "agent_settled": {
        if (streamRef.current) { updateTimelineItem(streamRef.current.id, { streaming: false }); streamRef.current = null; }
        if (sid) {
          const prev = prevStatusRef.current[sid] || "";
          if (prev === "streaming" || prev === "compacting") {
            const store = usePiDeskStore.getState();
            const t = getT(store.language);
            store.addToast({ type: "success", title: t("toast", "taskCompleted"), message: t("toast", "taskCompletedMsg") });
          }
          prevStatusRef.current[sid] = "idle";
          updateStatus(sid, "idle");
        }
        // Restore main model after task completes
        restoreMainModel();
        break;
      }
      case "tool_execution_start": {
        const toolName = event.toolName ?? "unknown";
        const tool: ToolCallVM = { toolCallId: event.toolCallId ?? `tool-${Date.now()}`, toolName, input: event.input, isError: false, state: "running", timestamp: Date.now() };
        appendTimeline({ type: "tool", ...tool } as TimelineItem);
        const normalizedTool = toolName.toLowerCase();
        // Custom MCP tools are conventionally exposed as mcp__server__tool.
        if (normalizedTool.startsWith("mcp__") || normalizedTool.startsWith("mcp_") || normalizedTool.includes("mcp.")) {
          switchToRole("mcp");
        } else if (/sub.?agent|delegate|spawn.?agent|child.?agent|task_agent/.test(normalizedTool)) {
          // Pi 0.82 has no built-in sub-agent event; support installed/custom
          // sub-agent tools without treating every normal tool as delegation.
          switchToRole("subAgent");
        } else if (normalizedTool.includes("web") || normalizedTool.includes("fetch") || normalizedTool.includes("scrape")) {
          switchToRole("web");
        }
        break;
      }
      case "tool_execution_update": {
        const tcid = event.toolCallId ?? "";
        if (event.isDelta) {
          const store = usePiDeskStore.getState();
          const tid = store.activeSessionId ? (store.sessionTimelines[store.activeSessionId] || []) : [];
          const existing = tid.find((t) => t.type === "tool" && t.toolCallId === tcid) as ToolCallVM | undefined;
          updateTimelineItem(tcid, { output: (existing?.output ?? "") + (event.output ?? "") });
        } else {
          updateTimelineItem(tcid, { output: event.output });
        }
        break;
      }
      case "tool_execution_end":
        updateTimelineItem(event.toolCallId ?? "", { state: "done" as const, result: event.result, isError: event.isError ?? false });
        break;
      // Pi 0.82 emits compaction_start/compaction_end. Keep the older names
      // as aliases for compatibility with older bundled Pi builds.
      case "compaction_start":
      case "agent_compacting":
        if (sid) { prevStatusRef.current[sid] = "compacting"; updateStatus(sid, "compacting"); }
        switchToRole("compression");
        break;
      case "compaction_end":
      case "agent_compacted":
        if (sid) updateStatus(sid, "streaming");
        break;
      // Auto-retry and summarization are maintenance work performed by Pi
      // outside the normal assistant turn.
      case "auto_retry_start":
      case "summarization_retry_scheduled":
      case "summarization_retry_attempt_start":
        if (sid) updateStatus(sid, "retrying");
        switchToRole("maintenance");
        break;
      case "auto_retry_end":
      case "summarization_retry_finished":
        if (sid) updateStatus(sid, "streaming");
        break;
      // Pi 0.82 emits session_info_changed after a session name has already
      // been produced. There is no pre-title event, so switching here would
      // affect the next task rather than the title request itself.
      case "session_info_changed":
        break;
      case "model_changed": {
        // Pi reports model changes via events
        if (sid && event.provider && event.model) {
          updateSessionModel(sid, event.provider, event.model);
        }
        break;
      }
      case "thinking_level_changed": {
        if (sid && event.level) {
          updateSessionThinkingLevel(sid, event.level as string);
        }
        break;
      }
      case "system_info":
        if (event.text) appendTimeline({ type: "system-info", text: event.text, timestamp: Date.now() });
        break;
    }
  }, [appendTimeline, updateTimelineItem, updateStatus, addExtensionUiRequest, updateSessionModel, updateSessionThinkingLevel, restoreMainModel, switchToRole]);

  // Listen to Pi events
  useEffect(() => {
    const unlisten = onPiEvent(handlePiEvent);
    return () => { unlisten(); };
  }, [handlePiEvent]);

  // ── Load persisted user data in background (non-blocking) ──
  useEffect(() => {
    loadUserdata().then((data) => {
      if (data) {
        const s = usePiDeskStore.getState();
        if (data.projects) usePiDeskStore.setState({ projects: { ...s.projects, ...data.projects } } as Parameters<typeof usePiDeskStore.setState>[0]);
        if (data.pinned) usePiDeskStore.setState({ pinned: { ...s.pinned, ...data.pinned } } as Parameters<typeof usePiDeskStore.setState>[0]);
        if (data.sessionWorkspaces) usePiDeskStore.setState({ sessionWorkspaces: { ...s.sessionWorkspaces, ...data.sessionWorkspaces } } as Parameters<typeof usePiDeskStore.setState>[0]);
        if (data.lastActiveCwd) {
          usePiDeskStore.setState({ lastActiveCwd: data.lastActiveCwd as string } as Parameters<typeof usePiDeskStore.setState>[0]);
        }
        // Load sessionNames: only keep fileId-keyed entries ("--C--Git--/file.jsonl")
        // Discard old cwd-keyed entries (containing \ or :) and UUID-keyed orphans.
        // Also purge entries with duplicate display names that are clearly migration pollution
        // (3+ sessions sharing the identical name = old cwd-based migration artifact).
        if (data.sessionNames) {
          const raw = data.sessionNames as Record<string, string>;
          const clean: Record<string, string> = {};
          let hasJunk = false;
          for (const [k, v] of Object.entries(raw)) {
            if (k.startsWith("--") && k.includes("/") && k.endsWith(".jsonl")) {
              clean[k] = v;
            } else {
              hasJunk = true;
            }
          }
          // Detect migration pollution: count how many entries share each display name
          const nameCounts = new Map<string, number>();
          for (const v of Object.values(clean)) nameCounts.set(v, (nameCounts.get(v) ?? 0) + 1);
          const pollutedNames = new Set([...nameCounts].filter(([, c]) => c >= 3).map(([n]) => n));
          if (pollutedNames.size > 0) {
            for (const [k, v] of Object.entries(clean)) {
              if (pollutedNames.has(v)) { delete clean[k]; hasJunk = true; }
            }
          }
          if (Object.keys(clean).length > 0) {
            usePiDeskStore.setState({ sessionNames: { ...s.sessionNames, ...clean } } as Parameters<typeof usePiDeskStore.setState>[0]);
          }
          // Write cleaned data back to disk to purge old cwd/UUID keys + polluted duplicates
          if (hasJunk) {
            saveUserdata({
              projects: data.projects || s.projects,
              pinned: data.pinned || s.pinned,
              sessionNames: clean,
              sessionWorkspaces: data.sessionWorkspaces || s.sessionWorkspaces,
              lastActiveCwd: data.lastActiveCwd || s.lastActiveCwd,
            }).catch(() => {});
          }
        }
        // Retroactively apply workspaceCwd to already-loaded sessions
        const current = usePiDeskStore.getState();
        const updates: Record<string, typeof current.sessions[string]> = {};
        for (const [id, sess] of Object.entries(current.sessions)) {
          const ws = current.sessionWorkspaces[sess.cwd];
          if (ws && !sess.workspaceCwd) {
            updates[id] = { ...sess, workspaceCwd: ws };
          }
        }
        if (Object.keys(updates).length > 0) {
          usePiDeskStore.setState({ sessions: { ...current.sessions, ...updates } } as Parameters<typeof usePiDeskStore.setState>[0]);
        }
      }
    }).catch((err) => {
      console.error("loadUserdata failed:", err);
    });
  }, []);

  // Load historical sessions + available models on startup
  useEffect(() => {
    listPiSessions().then((list) => {
      setHistoricalSessions(list);
    }).catch(console.error);
    getAvailableModels().then((models) => {
      setAvailableModels(models);
      // Sanitize settings: drop defaultModel / roleModels whose provider no longer
      // exists in the model store (e.g. after a duplicate/renamed provider entry was
      // removed from models-store.json). Without this, a stale "DeepSeek"/etc. ref would
      // keep firing set_model with an unknown provider and stall the session.
      const validProviders = new Set(models.map((m) => m.provider));
      const store = usePiDeskStore.getState();
      const { defaultModel, roleModels } = store.settings;
      const patch: Partial<PiDeskSettings> = {};
      if (defaultModel && !validProviders.has(defaultModel.provider)) {
        console.warn(`[pidesk] Dropping defaultModel with unknown provider "${defaultModel.provider}" — please reconfigure in Settings → Model.`);
        patch.defaultModel = null;
      }
      if (roleModels) {
        const cleaned: Partial<RoleModels> = {};
        let roleDirty = false;
        (Object.keys(roleModels) as (keyof RoleModels)[]).forEach((role) => {
          const ref = roleModels[role];
          if (ref && !validProviders.has(ref.provider)) {
            console.warn(`[pidesk] Dropping roleModel[${role}] with unknown provider "${ref.provider}"`);
            cleaned[role] = null;
            roleDirty = true;
          } else {
            cleaned[role] = ref;
          }
        });
        if (roleDirty) patch.roleModels = cleaned as RoleModels;
      }
      if (Object.keys(patch).length > 0) store.setSettings(patch);
    }).catch(console.error);
  }, [setHistoricalSessions, setAvailableModels]);

  // Auto-resume last active session on startup
  useEffect(() => {
    const hs = usePiDeskStore.getState().historicalSessions;
    const lastCwd = usePiDeskStore.getState().lastActiveCwd;
    if (!lastCwd || hs.length === 0) return;
    const found = hs.find(h => h.cwd === lastCwd);
    // sessions keyed by UUID, not fileId — use fileId matching
    const alreadyActive = found
      ? Object.values(usePiDeskStore.getState().sessions).some(s => s.fileId === found.id)
      : false;
    if (found && !alreadyActive) {
      handleResumeSession(found.id, found.cwd);
    }
  }, [usePiDeskStore((s) => s.historicalSessions.length), usePiDeskStore((s) => s.lastActiveCwd)]);

  // ── Apply settings to a new session ──
  const applySettingsToSession = useCallback(async (sessionId: string) => {
    const state = usePiDeskStore.getState();
    const settings = state.settings;
    // Apply default model
    let dm = settings.defaultModel;
    // Auto-select first available model if no default is configured
    if (!isValidModelRef(dm)) {
      if (dm) {
        console.warn("[applySettingsToSession] defaultModel corrupted, clearing:", dm);
        state.setSettings({ defaultModel: null });
      }
      const available = state.availableModels;
      if (available.length > 0) {
        const firstModel = available[0];
        dm = { provider: firstModel.provider, id: firstModel.id };
        state.setSettings({ defaultModel: dm });
        console.log("[applySettingsToSession] auto-selected default model:", dm);
      }
    }
    if (isValidModelRef(dm)) {
      await switchModel(sessionId, dm.provider, dm.id, { silent: true });
    }
    // Apply default thinking level
    try {
      await setThinkingLevel(sessionId, settings.defaultThinkingLevel);
      updateSessionThinkingLevel(sessionId, settings.defaultThinkingLevel);
    } catch (e) { console.error("Failed to set thinking level:", e); }
    // Apply behavior settings
    try {
      await setAutoCompaction(sessionId, settings.autoCompaction);
      await setAutoRetry(sessionId, settings.autoRetry);
      await setSteeringMode(sessionId, settings.steeringMode);
      await setFollowUpMode(sessionId, settings.followUpMode);
    } catch (e) { console.error("Failed to apply behavior settings:", e); }
    // Apply response language preference (steer Pi to match UI language)
    try {
      const langMsg = state.language === "zh"
        ? "请始终使用中文回复。"
        : "Please always respond in English.";
      await steer(sessionId, langMsg);
    } catch (e) { console.error("Failed to apply language instruction:", e); }
  }, [updateSessionThinkingLevel]);

  // ── New session (fresh) ──
  const handleNewSession = useCallback(async (optCwd?: string, workspaceCwd?: string) => {
    try {
      const settings = usePiDeskStore.getState().settings;
      const cwd = optCwd || settings.defaultCwd || "C:\\Git";
      // Auto-create project only if workspaceCwd is specified and project doesn't exist
      if (workspaceCwd && !usePiDeskStore.getState().projects[workspaceCwd]) {
        addProject(workspaceCwd, workspaceCwd.split("\\").pop() || workspaceCwd);
      }
      const id = await startSession({ cwd });
      // Tell Pi to create a fresh session instead of auto-resuming the most recent
      try {
        await newPiSession(id);
      } catch (e) {
        console.error("Failed to create new Pi session:", e);
      }
      const model = settings.defaultModel;
      setActiveSession(id, {
        id, name: "New Session", cwd,
        workspaceCwd,
        thinkingLevel: settings.defaultThinkingLevel,
        model: model ? { provider: model.provider, id: model.id } : undefined,
        status: "idle",
      });
      await applySettingsToSession(id);
      // Persist last active cwd so session can be restored on restart
      usePiDeskStore.getState().setLastActiveCwd(cwd);
    } catch (e) {
      console.error("Failed to start session:", e);
      usePiDeskStore.getState().addToast({
        type: "error",
        title: "Session Error",
        message: String(e).slice(0, 200),
        durationMs: 8000,
      });
    }
  }, [setActiveSession, applySettingsToSession, addProject, newPiSession]);

  // ── Resume historical session ──
  const handleResumeSession = useCallback(async (dirName: string, cwd: string) => {
    // Idempotent: if this session file is already active, just switch to it
    const existing = Object.values(usePiDeskStore.getState().sessions).find((s) => s.fileId === dirName);
    if (existing) {
      setActiveSession(existing.id, existing);
      usePiDeskStore.getState().setLastActiveCwd(cwd);
      return;
    }

    // Race guard: prevent concurrent resume for same cwd
    if (resumingRef.current.has(cwd)) return;
    resumingRef.current.add(cwd);

    try {
      // Load entries from JSONL files
      const entries = await loadSessionEntries(dirName);
      const items = entriesToTimeline(entries);

      // Start Pi with same cwd (Pi auto-resumes the most recent session by default)
      const id = await startSession({ cwd });

      // Switch Pi to the specific session file the user clicked
      try {
        const sessionsDir = await getSessionsDir();
        const fullPath = `${sessionsDir}/${dirName}`;
        await switchSession(id, fullPath);
      } catch (e) {
        console.error("Failed to switch to session file:", e);
      }

      // Use persisted custom name if available, else fall back to name from session meta
      const settings = usePiDeskStore.getState().settings;
      const store = usePiDeskStore.getState();
      const histSession = store.historicalSessions.find(h => h.id === dirName);
      const customName = store.sessionNames[dirName];
      const displayName = customName || histSession?.name || "Untitled";

      // Create session with history loaded — restore workspaceCwd from persistent mapping
      const workspaceCwd = usePiDeskStore.getState().sessionWorkspaces[cwd];
      setActiveSession(id, {
        id, name: displayName, cwd,
        fileId: dirName,
        workspaceCwd,
        thinkingLevel: settings.defaultThinkingLevel,
        model: settings.defaultModel ? { provider: settings.defaultModel.provider, id: settings.defaultModel.id } : undefined,
        status: "idle",
      });
      usePiDeskStore.getState().setLastActiveCwd(cwd);
      loadHistoryEntries(id, items);
      // Apply settings to the Pi process
      await applySettingsToSession(id);
    } catch (e) {
      console.error("Failed to resume session:", e);
      usePiDeskStore.getState().addToast({
        type: "error",
        title: "Resume Failed",
        message: String(e).slice(0, 200),
        durationMs: 8000,
      });
    } finally {
      resumingRef.current.delete(cwd);
    }
  }, [setActiveSession, loadHistoryEntries, applySettingsToSession, getSessionsDir, switchSession]);

  // ── Send message ──
  const handleSend = useCallback(async (text: string, images?: string[]) => {
    if (!activeId) return;
    const userMsg: MessageVM = { id: `user-${Date.now()}`, role: "user", text, images: images?.map(p => ({ path: p, type: "file" as const })), streaming: false, timestamp: Date.now() };
    appendTimeline({ type: "user", ...userMsg } as TimelineItem);
    updateStatus(activeId, "streaming");

    // Switch to the configured role before Pi starts the corresponding work.
    if (images && images.length > 0) {
      await switchToRole("vision");
    } else if (/^\/skill:[^\s]+(?:\s|$)/i.test(text.trim())) {
      // Pi expands /skill:name commands before the agent run.
      await switchToRole("skills");
    }

    // Auto-name session from first user message (in-memory only, not persisted)
    const sess = usePiDeskStore.getState().sessions[activeId];
    if (sess && sess.name === "New Session") {
      const autoName = text.slice(0, 24).trim() || "New Session";
      usePiDeskStore.setState((s) => ({
        sessions: { ...s.sessions, [activeId]: { ...s.sessions[activeId], name: autoName } },
      }));
    }

    clearInput();
    try {
      await piPrompt(activeId, text, images);
      // Timeout guard: if no agent event arrives within 120s, restore to idle.
      // Any pi activity (thinking, tool calls, text) resets the clock via lastEventRef.
      lastEventRef.current = Date.now();
      const checkTimeout = () => {
        const s = usePiDeskStore.getState();
        const sess = s.sessions[activeId];
        if (!sess || sess.status !== "streaming") return; // done or aborted
        const idleMs = Date.now() - lastEventRef.current;
        if (idleMs > 120_000) {
          updateStatus(activeId, "idle");
          const t = getT(s.language);
          s.addToast({
            type: "error",
            title: t("toast", "timeout"),
            message: t("toast", "timeoutMsg"),
            durationMs: 10000,
          });
        } else {
          // Still streaming with recent activity — re-check in a moment
          setTimeout(checkTimeout, Math.min(5000, 120_000 - idleMs + 100));
        }
      };
      setTimeout(checkTimeout, 5000);
    } catch (e) {
      updateStatus(activeId, "idle");
      appendTimeline({ type: "system-info", text: `Error: ${String(e)}`, timestamp: Date.now() });
    }
  }, [activeId, appendTimeline, updateStatus, renameSession, clearInput]);

  const handleAbort = useCallback(async () => {
    if (!activeId) return;
    await abortSession(activeId);
  }, [activeId]);

  // ── Session management (rename / delete / archive) ──
  const handleRenameSession = useCallback((id: string, name: string) => {
    renameSession(id, name);
  }, [renameSession]);

  const handleDeleteSession = useCallback(async (id: string) => {
    const store = usePiDeskStore.getState();
    const session = store.sessions[id];
    await stopSession(id);
    // Delete from disk
    if (session) {
      // Use persistent fileId if available (for resumed sessions), otherwise skip disk delete
      if (session?.fileId) {
        try { await deletePiSession(session.fileId); } catch (e) { console.error("Delete disk session failed:", e); }
      }
    }
    if (store.activeSessionId === id) {
      const remaining = Object.keys(store.sessions).filter((k) => k !== id);
      if (remaining.length > 0) {
        store.setActiveSession(remaining[0], store.sessions[remaining[0]]);
      }
    }
    removeSession(id);
    // Clean up pinned references
    usePiDeskStore.getState().togglePinSession(id); // removes if pinned
    // Also remove from historical list and sessionNames
    const persistId = session?.fileId || id;
    setHistoricalSessions(usePiDeskStore.getState().historicalSessions.filter(h => h.id !== persistId));
    if (session?.cwd) {
      usePiDeskStore.setState((s) => {
        const { [persistId]: _, ...restNames } = s.sessionNames;
        const { [session.cwd]: __, ...restWs } = s.sessionWorkspaces;
        return { sessionNames: restNames, sessionWorkspaces: restWs };
      });
    }
  }, [removeSession, setHistoricalSessions]);

  // ── Global keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === "k") { e.preventDefault(); usePiDeskStore.getState().setSearchOpen(true); return; }
      if (mod && e.key === "n") { e.preventDefault(); handleNewSession(); return; }
      if (mod && e.key === "w") { e.preventDefault(); const s = usePiDeskStore.getState(); if (s.activeSessionId) handleDeleteSession(s.activeSessionId); return; }
      if (mod && e.key === "b") { e.preventDefault(); usePiDeskStore.setState((s) => ({ sidebarOpen: !s.sidebarOpen })); return; }
      if (mod && e.key === "i") { e.preventDefault(); usePiDeskStore.setState((s) => ({ inspectorOpen: !s.inspectorOpen })); return; }
      if (mod && e.key === ",") { e.preventDefault(); usePiDeskStore.getState().setSettingsOpen(true); return; }
      if (e.key === "Escape") { usePiDeskStore.getState().setSearchOpen(false); setShortcutsOpen(false); return; }
      if ((mod && e.key === "/") || (!mod && e.key === "?")) { e.preventDefault(); setShortcutsOpen(v => !v); return; }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleNewSession, handleDeleteSession]);

  // ── Per-session model / thinking changes ──
  const handleChangeModel = useCallback(async (provider: string, modelId: string) => {
    const s = usePiDeskStore.getState();
    if (!s.activeSessionId) return;
    // Only call Pi if a specific model is selected (not "Auto")
    if (!isValidModelRef({ provider, id: modelId })) return;
    const sid = s.activeSessionId;
    await switchModel(sid, provider, modelId);
  }, []);

  const handleChangeThinking = useCallback(async (level: string) => {
    const s = usePiDeskStore.getState();
    if (!s.activeSessionId) return;
    s.updateSessionThinkingLevel(s.activeSessionId, level);
    try { await setThinkingLevel(s.activeSessionId, level as ThinkingLevel); } catch (e) { console.error("setThinkingLevel failed:", e); }
  }, []);

  // ── Clean orphaned pinned sessions (runs after sessions are loaded) ──
  useEffect(() => {
    const timer = setTimeout(() => {
      const s = usePiDeskStore.getState();
      const currentSessionIds = [...Object.keys(s.sessions), ...s.historicalSessions.map(h => h.id)];
      const validSessions = s.pinned.sessions.filter(id => currentSessionIds.includes(id));
      const validProjects = s.pinned.projects.filter(cwd => !!s.projects[cwd]);
      if (validSessions.length !== s.pinned.sessions.length || validProjects.length !== s.pinned.projects.length) {
        usePiDeskStore.setState({
          pinned: { sessions: validSessions, projects: validProjects },
        } as Parameters<typeof usePiDeskStore.setState>[0]);
      }
    }, 2000); // Wait for sessions to be loaded
    return () => clearTimeout(timer);
  }, []);

  // ── Pi process health check (every 10s) ──
  useEffect(() => {
    const interval = setInterval(async () => {
      const s = usePiDeskStore.getState();
      for (const [id, session] of Object.entries(s.sessions)) {
        if (session.status !== "idle" && session.status !== "exited") continue;
        try {
          const alive = await checkPiHealth(id);
          if (!alive && session.status === "idle") {
            s.updateSessionStatus(id, "exited");
            setExitedSessions(prev => new Set(prev).add(id));
          }
        } catch { /* ignore */ }
      }
    }, 10_000);
    return () => clearInterval(interval);
  }, []);

  // ── Broadcast language change to all active sessions ──
  const language = usePiDeskStore((s) => s.language);
  useEffect(() => {
    const langMsg = language === "zh"
      ? "请始终使用中文回复。"
      : "Please always respond in English.";
    const s = usePiDeskStore.getState();
    for (const id of Object.keys(s.sessions)) {
      steer(id, langMsg).catch(() => {});
    }
  }, [language]);

  // ── Boot Phase: Diagnostics ──
  if (bootPhase === "diagnostics") {
    return (
      <StartupDiagnosticsPanel
        onRetry={() => setBootPhase("diagnostics")}
        onContinueAnyway={() => {
          // Check if first run (no default model configured)
          const s = usePiDeskStore.getState();
          if (!s.settings.defaultModel) {
            setBootPhase("wizard");
          } else {
            setBootPhase("ready");
          }
        }}
      />
    );
  }

  // ── Boot Phase: Setup Wizard ──
  if (bootPhase === "wizard") {
    return (
      <SetupWizard
        onComplete={() => setBootPhase("ready")}
      />
    );
  }

  // ── Main App UI ──
  const activeSession = activeId ? usePiDeskStore.getState().sessions[activeId] : null;
  const isExited = activeId ? exitedSessions.has(activeId) : false;

  return (
    <div className="h-screen flex flex-col bg-surface">
      <TopBar
        onChangeModel={handleChangeModel}
        onChangeThinking={handleChangeThinking}
      />
      <div className="flex-1 flex overflow-hidden min-h-0">
        {sidebarOpen && (
          <Sidebar
            onNewSession={handleNewSession}
            onResumeSession={handleResumeSession}
            onRenameSession={handleRenameSession}
            onDeleteSession={handleDeleteSession}
          />
        )}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Pi process recovery banner */}
          {isExited && activeSession && (
            <div className="flex items-center justify-between px-4 py-2 bg-red-900/40 border-b border-red-800">
              <span className="text-sm text-red-300">
                Pi process has exited. The session cannot continue until restarted.
              </span>
              <button
                onClick={() => handleRestartSession(activeSession.id)}
                disabled={restartingSession === activeSession.id}
                className="px-3 py-1 text-xs font-medium bg-red-700 hover:bg-red-600 text-white rounded disabled:opacity-50"
              >
                {restartingSession === activeSession.id ? "Restarting..." : "Restart Pi Kernel"}
              </button>
            </div>
          )}
          <ErrorBoundary name="Conversation">
            <Conversation />
            <Composer onSend={handleSend} onAbort={handleAbort} />
          </ErrorBoundary>
        </div>
        <ErrorBoundary name="Inspector">
          <InspectorPanel />
        </ErrorBoundary>
      </div>
      <StatusBar />
      <ErrorBoundary name="Console">
        <ConsolePanel />
      </ErrorBoundary>
      <ErrorBoundary name="Search">
        <SearchBar />
      </ErrorBoundary>
      <ErrorBoundary name="Settings">
        <SettingsPanel />
      </ErrorBoundary>
      <ApprovalDialog />
      <ToastContainer />
      <ShortcutsPanel open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
