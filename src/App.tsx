import { useEffect, useRef, useCallback, useState } from "react";
import { usePiDeskStore } from "./store/pidesk";
import {
  startSession, prompt as piPrompt, onPiEvent, abortSession, stopSession,
  followUp,
  listPiSessions, loadSessionEntries, getAvailableModels, deletePiSession,
  setThinkingLevel, setAutoCompaction, setAutoRetry,
  setSteeringMode, setFollowUpMode, checkPiHealth, loadUserdata,
  getSessionsDir, switchSession, newPiSession, steer, saveUserdata,
  restartSession, isValidModelRef, getAppError, onModelsChanged, readPiFile,
} from "./bridge";
import { switchModel } from "./model-switch";
import type { PiRawAgentEvent, TimelineItem, MessageVM, ToolCallVM, PiOutboundEvent, SessionEntryVm, ExtensionUiRequest, RoleModels, PiDeskSettings, ThinkingLevel, SessionStatus, ModelRef, PendingQueueItem } from "./types";
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
import { getT } from "./i18n";
import { registerRecoveryHandler } from "./recovery-actions";
import { notifySystem } from "./system-notify";

// Add this at the top of App() body after other hooks
// (we'll use useT inside the callback, not at module level)

// ── Convert Pi JSONL entries to frontend TimelineItems ──

function summarizeSessionUsage(entries: SessionEntryVm[]): { inputTokens: number; outputTokens: number } {
  return entries.reduce((acc, entry) => ({
    inputTokens: acc.inputTokens + (entry.input_tokens ?? 0),
    outputTokens: acc.outputTokens + (entry.output_tokens ?? 0),
  }), { inputTokens: 0, outputTokens: 0 });
}

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
  const markRequestSent = usePiDeskStore((s) => s.markRequestSent);
  const markRequestFirstEvent = usePiDeskStore((s) => s.markRequestFirstEvent);
  const markRequestFirstTool = usePiDeskStore((s) => s.markRequestFirstTool);
  const markRequestSettled = usePiDeskStore((s) => s.markRequestSettled);
  const sidebarOpen = usePiDeskStore((s) => s.sidebarOpen);
  const addProject = usePiDeskStore((s) => s.addProject);
  const setAvailableModels = usePiDeskStore((s) => s.setAvailableModels);
  const addExtensionUiRequest = usePiDeskStore((s) => s.addExtensionUiRequest);
  const updateSessionModel = usePiDeskStore((s) => s.updateSessionModel);
  const updateSessionThinkingLevel = usePiDeskStore((s) => s.updateSessionThinkingLevel);
  const sessions = usePiDeskStore((s) => s.sessions);
  const availableModels = usePiDeskStore((s) => s.availableModels);
  const setCurrentRole = usePiDeskStore((s) => s.setCurrentRole);

  // Track streaming assistant message
  // Keep streaming state per session so background sessions cannot update the selected page.
  const streamRefs = useRef<Record<string, { id: string; thinking: string; text: string }>>({});
  const streamUpdateTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Last time any pi agent event arrived (used by the response-timeout guard)
  const lastEventRef = useRef<number>(Date.now());
  // Guard against concurrent resume for the same cwd
  const resumingRef = useRef<Set<string>>(new Set());
  const prevStatusRef = useRef<Record<string, SessionStatus>>({});
  // Sessions whose fileId sync has been requested (avoid repeated listPiSessions calls)
  const fileIdSyncedRef = useRef<Set<string>>(new Set());
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // ── Boot phase: startup diagnostics → main app ──
  type BootPhase = "diagnostics" | "ready";
  const [bootPhase, setBootPhase] = useState<BootPhase>("diagnostics");

  // Process recovery state
  const [exitedSessions, setExitedSessions] = useState<Set<string>>(new Set());
  const [restartingSession, setRestartingSession] = useState<string | null>(null);

  function presentAppError(error: unknown, fallbackTitle: string, fallbackMessage?: string) {
    const appError = getAppError(error);
    usePiDeskStore.getState().addToast({
      type: "error",
      title: fallbackTitle,
      message: appError?.message ?? fallbackMessage ?? String(error).slice(0, 200),
      durationMs: 8000,
      actionLabel: appError?.recoverable ? appError.actionLabel : undefined,
      actionCommand: appError?.recoverable ? appError.actionCommand : undefined,
    });
  }

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
      presentAppError(e, "Restart Failed");
    } finally {
      setRestartingSession(null);
    }
  }

  useEffect(() => {
    registerRecoveryHandler(async (command) => {
      const store = usePiDeskStore.getState();
      const sid = store.activeSessionId;
      if (command === "restart_pi" && sid) {
        await handleRestartSession(sid);
        return;
      }
      if (command === "check_permissions") {
        store.setSettingsOpen(true);
        store.addToast({
          type: "info",
          title: "Check Permissions",
          message: "Review your Pi agent directory permissions and writable config files.",
        });
        return;
      }
      if (command === "check_network") {
        store.setSettingsOpen(true);
        store.addToast({
          type: "info",
          title: "Check Network",
          message: "Verify the provider base URL, proxy, and outbound network access.",
        });
        return;
      }
    });
    return () => registerRecoveryHandler(null);
  }, [handleRestartSession]);

  // ── Role-based model switching ──

  // Apply the role's preferred thinking level after a role switch, but only if
  // the role's model actually supports it (deepseek-v4 only supports high/max,
  // so low/medium requests are skipped instead of failing).
  const applyRoleThinkingLevel = useCallback(async (sessionId: string, role: keyof RoleModels, modelRef: ModelRef) => {
    const s = usePiDeskStore.getState();
    const desired = s.settings.roleThinkingLevels?.[role];
    if (!desired) return;
    const matched = s.availableModels.find((m) => m.provider === modelRef.provider && m.id === modelRef.id);
    if (!matched || !matched.thinkingLevels.includes(desired)) return;
    try {
      await setThinkingLevel(sessionId, desired);
      s.updateSessionThinkingLevel(sessionId, desired);
    } catch (e) {
      console.error("setThinkingLevel failed:", e);
    }
  }, []);

  const switchToRole = useCallback(async (role: string) => {
    if (!activeId) return;
    const settings = usePiDeskStore.getState().settings;
    let roleModel = settings.roleModels[role as keyof RoleModels];

    // Vision fallback: when sending images, never hand them to a text-only model.
    // If the current model already supports vision, skip the switch entirely.
    // If no vision role model is configured, auto-pick the first vision-capable
    // model from the model store instead of silently failing.
    if (role === "vision") {
      const store = usePiDeskStore.getState();
      const cur = store.sessions[activeId]?.model;
      const curSupportsVision = cur
        ? store.availableModels.some((m) => m.provider === cur.provider && m.id === cur.id && m.supportsVision)
        : false;
      if (curSupportsVision) return; // current model handles images — no switch needed

      const autoPicked = !isValidModelRef(roleModel);
      if (autoPicked) {
        const visionModel = store.availableModels.find((m) => m.supportsVision);
        if (visionModel) roleModel = { provider: visionModel.provider, id: visionModel.id };
      }
      if (!isValidModelRef(roleModel)) {
        const t = getT(store.language);
        store.addToast({
          type: "warning",
          title: t("toast", "error"),
          message: t("toast", "noVisionModel"),
          durationMs: 8000,
        });
        return;
      }

      const ok = await switchModel(activeId, roleModel.provider, roleModel.id);
      if (ok) {
        setCurrentRole(role as keyof RoleModels);
        await applyRoleThinkingLevel(activeId, role as keyof RoleModels, roleModel);
        if (autoPicked) {
          const t = getT(usePiDeskStore.getState().language);
          usePiDeskStore.getState().addToast({
            type: "info",
            title: t("toast", "visionModelAutoSwitch"),
            message: `${roleModel.provider}/${roleModel.id}`,
            durationMs: 6000,
          });
        }
      }
      return;
    }

    if (!isValidModelRef(roleModel)) return;

    const ok = await switchModel(activeId, roleModel.provider, roleModel.id);
    if (ok) {
      setCurrentRole(role as keyof RoleModels);
      await applyRoleThinkingLevel(activeId, role as keyof RoleModels, roleModel);
    }
  }, [activeId, setCurrentRole, applyRoleThinkingLevel]);

  const restoreMainModel = useCallback(async (forSessionId?: string) => {
    const store = usePiDeskStore.getState();
    const sid = forSessionId ?? store.activeSessionId;
    if (!sid) return;
    // Only restore when THIS session actually switched to a role-specific model
    // (role is recorded per-session on switch). Prevents stale badges
    // (e.g. "Vision (image)") from lingering after the task completes.
    if ((store.sessionRoles[sid] || "main") === "main") return;

    const mainModel = store.settings.roleModels.main || store.settings.defaultModel;
    if (!isValidModelRef(mainModel)) return;

    const ok = await switchModel(sid, mainModel.provider, mainModel.id);
    if (ok) {
      const state = usePiDeskStore.getState();
      if (state.activeSessionId === sid) {
        setCurrentRole("main");
      } else {
        state.setSessionRole(sid, "main");
      }
      // Restore the main role's preferred thinking level too
      await applyRoleThinkingLevel(sid, "main", mainModel);
    }
  }, [setCurrentRole, applyRoleThinkingLevel]);

  useEffect(() => {
    if (!activeId) return;
    const store = usePiDeskStore.getState();
    const modelRef = store.sessions[activeId]?.model;
    if (!modelRef) return;
    const matched = store.availableModels.find((m) => m.provider === modelRef.provider && m.id === modelRef.id);
    const contextMax = matched?.contextWindow || 0;
    if (contextMax > 0) {
      const usageKey = store.sessions[activeId]?.fileId || activeId;
      const existing = store.sessionContextUsage[usageKey] || store.sessionContextUsage[activeId];
      const usage = store.sessionUsage[usageKey] || store.sessionUsage[activeId] || { inputTokens: 0, outputTokens: 0 };
      // Seed usedTokens only on first sight. After that the estimate is owned by
      // usage accumulation / compaction_end results — do NOT clobber it with the
      // lifetime token total (that would undo a context compaction display).
      const usedTokens = existing?.usedTokens ?? usage.inputTokens + usage.outputTokens;
      if (!existing || existing.maxTokens !== contextMax) {
        (usePiDeskStore.getState() as unknown as { setSessionContextUsage?: (id: string, usedTokens: number, maxTokens: number) => void }).setSessionContextUsage?.(usageKey, usedTokens, contextMax);
      }
    }
  }, [activeId, sessions, availableModels]);

  // ── Pi event handler ──
  // Sync the persistent fileId for sessions that don't have one yet (new sessions).
  // Pi creates the .jsonl file asynchronously after the session starts, so we reconcile
  // by listing session files and matching cwd + latest modification time.
  // A stable fileId is what makes pinning survive restarts.
  const syncSessionFileId = useCallback(async (sessionId: string) => {
    try {
      const store = usePiDeskStore.getState();
      const sess = store.sessions[sessionId];
      if (!sess || sess.fileId) return;
      const all = await listPiSessions();
      // Normalize path casing / separators so Windows paths match robustly
      const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
      const normCwd = norm(sess.cwd || "");
      const candidates = all
        .filter((m) => norm(m.cwd) === normCwd)
        .sort((a, b) => b.last_modified - a.last_modified);
      if (candidates.length === 0) return;
      const best = candidates[0];
      // Avoid stealing a file already claimed by another active session (same cwd, multiple sessions)
      const occupied = Object.values(usePiDeskStore.getState().sessions)
        .some((s) => s.fileId === best.id && s.id !== sessionId);
      if (occupied) return;
      usePiDeskStore.getState().setSessionFileId(sessionId, best.id);
    } catch (e) {
      console.error("syncSessionFileId failed:", e);
    }
  }, []);

  // ── Queue-while-running: buffer messages sent while the agent is busy ──
  // 120s no-output guard. Any agent activity (thinking, tool calls, text)
  // resets the clock via lastEventRef in handlePiEvent.
  const startTimeoutGuard = useCallback((sessionId: string) => {
    lastEventRef.current = Date.now();
    const checkTimeout = () => {
      const s = usePiDeskStore.getState();
      const sess = s.sessions[sessionId];
      if (!sess || sess.status !== "streaming") return; // done or aborted
      const idleMs = Date.now() - lastEventRef.current;
      if (idleMs > 120_000) {
        s.updateSessionStatus(sessionId, "idle");
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
  }, []);

  // Pop the next queued message and send it. Chained by agent_settled — each
  // queued prompt produces its own settle event, so the queue drains naturally.
  const drainPendingQueue = useCallback(async (sessionId: string) => {
    const store = usePiDeskStore.getState();
    const q = store.pendingQueues[sessionId] || [];
    if (q.length === 0) return;
    const item = store.shiftPending(sessionId);
    if (!item) return;
    // Apply the role switch the message would have triggered on send.
    if (item.images && item.images.length > 0) {
      await switchToRole("vision");
    } else if (/^\/skill:[^\s]+(?:\s|$)/i.test(item.text.trim())) {
      await switchToRole("skills");
    }
    updateStatus(sessionId, "streaming");
    markRequestSent(sessionId, `req-${Date.now()}`);
    try {
      await piPrompt(sessionId, item.text, item.images);
      startTimeoutGuard(sessionId);
    } catch (e) {
      updateStatus(sessionId, "idle");
      appendTimeline({ type: "system-info", text: `Error: ${String(e)}`, timestamp: Date.now() }, sessionId);
      presentAppError(e, "Request Failed");
    }
  }, [updateStatus, appendTimeline, markRequestSent, switchToRole, presentAppError, piPrompt, startTimeoutGuard]);

  const handlePiEvent = useCallback((ev: PiOutboundEvent) => {
    const store = usePiDeskStore.getState();
    const sessionId = ev.sessionId;

    // Any agent activity (thinking, text, tool calls, retries) resets the
    // response-timeout guard — the request is clearly alive.
    if (ev.kind === "agent-event" || ev.kind === "error") {
      lastEventRef.current = Date.now();
      if (sessionId) markRequestFirstEvent(sessionId);
    }

    // Reconcile the persistent fileId for new sessions (needed for reliable pinning).
    // Retries on later events if the .jsonl file is not created yet.
    if (sessionId && ev.kind === "agent-event" && !fileIdSyncedRef.current.has(sessionId)) {
      const sess = usePiDeskStore.getState().sessions[sessionId];
      if (sess && !sess.fileId) {
        fileIdSyncedRef.current.add(sessionId);
        syncSessionFileId(sessionId).finally(() => fileIdSyncedRef.current.delete(sessionId));
      }
    }

    // Console log: append raw event JSON
    if (sessionId && store.consoleOpen) {
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
        const usageKey = store.sessions[sessionId]?.fileId || sessionId;
        store.accumulateUsage(usageKey, input, output);
        const modelRef = store.sessions[sessionId]?.model;
        if (modelRef) {
          const matched = store.availableModels.find((m) => m.provider === modelRef.provider && m.id === modelRef.id);
          const contextMax = matched?.contextWindow || 0;
          if (contextMax > 0) {
            const prevContext = store.sessionContextUsage[usageKey]?.usedTokens || 0;
            (usePiDeskStore.getState() as unknown as { setSessionContextUsage?: (id: string, usedTokens: number, maxTokens: number) => void }).setSessionContextUsage?.(usageKey, prevContext + input + output, contextMax);
          }
        }
      }
    }

    if (ev.kind === "stderr") {
      const line = (ev.event as { line?: string })?.line ?? "";
      appendTimeline({ type: "system-info", text: `[pi] ${line}`, timestamp: Date.now() }, sessionId);
      return;
    }

    if (ev.kind === "process-exit") {
      const sid = ev.sessionId;
      appendTimeline({ type: "system-info", text: "Pi process exited. Click restart to recover.", timestamp: Date.now() }, sessionId);
      updateStatus(sid, "exited");
      setExitedSessions(prev => new Set(prev).add(sid));
      // Queued messages are meaningless without a live agent — drop them.
      usePiDeskStore.getState().clearPendingQueue(sid);
      return;
    }

    if (ev.kind === "error") {
      const msg = (ev.event as { message?: string })?.message
        ?? (ev.event as { error?: string })?.error
        ?? JSON.stringify(ev.event);
      appendTimeline({ type: "system-info", text: `Error: ${msg}`, timestamp: Date.now() }, sessionId);
      return;
    }

    if (ev.kind === "rpc-response") {
      const rpc = ev.event as { command?: string; success?: boolean; error?: string; data?: unknown };
      if (rpc.success === false && rpc.error) {
        const cmd = rpc.command || "unknown";
        appendTimeline({ type: "system-info", text: `[${cmd}] failed: ${rpc.error}`, timestamp: Date.now() }, sessionId);
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
      } else if (rpc.command === "abort" && sessionId) {
        // User aborted the running task — continue with any queued messages.
        drainPendingQueue(sessionId);
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
    const sid = sessionId;
    const streamRef = streamRefs.current[sessionId];
    let currentStream = streamRef;
    const scheduleStreamUpdate = () => {
      if (streamUpdateTimers.current[sessionId]) return;
      streamUpdateTimers.current[sessionId] = setTimeout(() => {
        delete streamUpdateTimers.current[sessionId];
        const latest = streamRefs.current[sessionId];
        if (latest) updateTimelineItem(latest.id, { text: latest.text, thinking: latest.thinking }, sessionId);
      }, 32);
    };
    const flushStreamUpdate = () => {
      const timer = streamUpdateTimers.current[sessionId];
      if (timer) clearTimeout(timer);
      delete streamUpdateTimers.current[sessionId];
      const latest = streamRefs.current[sessionId];
      if (latest) updateTimelineItem(latest.id, { text: latest.text, thinking: latest.thinking }, sessionId);
    };

    switch (event.type) {
      case "message_update": {
        const ame = event.assistantMessageEvent;
        if (!ame) break;
        if (!currentStream) {
          currentStream = { id: `asst-${Date.now()}`, thinking: "", text: "" };
          streamRefs.current[sessionId] = currentStream;
          const msg: MessageVM = { id: currentStream.id, role: "assistant", text: "", thinking: "", streaming: true, timestamp: Date.now() };
          appendTimeline({ type: "assistant", ...msg } as TimelineItem, sessionId);
          prevStatusRef.current[sessionId] = "streaming";
          updateStatus(sessionId, "streaming");
        }
        switch (ame.type) {
          case "thinking_delta":
            currentStream.thinking += ame.delta ?? "";
            scheduleStreamUpdate();
            break;
          case "thinking_end":
            if (ame.content) currentStream.thinking = ame.content;
            scheduleStreamUpdate();
            break;
          case "text_delta":
            currentStream.text += ame.delta ?? "";
            scheduleStreamUpdate();
            break;
          case "text_end":
            if (ame.content) currentStream.text = ame.content;
            scheduleStreamUpdate();
            break;
        }
        break;
      }
      case "message_end":
      case "turn_end": {
        if (currentStream) {
          if (event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "thinking" && typeof block.thinking === "string") currentStream.thinking = block.thinking;
              if (block.type === "text" && typeof block.text === "string") currentStream.text = block.text;
            }
          }
          flushStreamUpdate();
          updateTimelineItem(currentStream.id, { text: currentStream.text, thinking: currentStream.thinking, streaming: false }, sessionId);
          delete streamRefs.current[sessionId];
        }
        break;
      }
      case "agent_end": {
        if (currentStream) {
          updateTimelineItem(currentStream.id, { streaming: false }, sessionId);
          delete streamRefs.current[sessionId];
        }
        break;
      }
      case "agent_settled": {
        if (currentStream) {
          updateTimelineItem(currentStream.id, { streaming: false }, sessionId);
          delete streamRefs.current[sessionId];
        }
        if (sid) {
          markRequestSettled(sid);
          const prev = prevStatusRef.current[sid] || "";
          if (prev === "streaming" || prev === "compacting") {
            const store = usePiDeskStore.getState();
            const t = getT(store.language);
            const title = t("toast", "taskCompleted");
            const message = t("toast", "taskCompletedMsg");
            // Native OS notification (works while PiDesk is in the background);
            // fall back to the in-app toast only if the system notification
            // could not be delivered.
            void notifySystem(title, message).then((sent) => {
              if (!sent) {
                usePiDeskStore.getState().addToast({ type: "success", title, message });
              }
            });
          }
          prevStatusRef.current[sid] = "idle";
          updateStatus(sid, "idle");
          // Queue-while-running: send the next buffered message, if any.
          if (sid) drainPendingQueue(sid);
          // Revert the role-specific model switch for THIS session as soon as
          // the task settles — even if it is no longer the selected session —
          // so the role badge (e.g. "Vision (image)") never lingers across tasks.
          if ((usePiDeskStore.getState().sessionRoles[sid] || "main") !== "main") {
            restoreMainModel(sid);
          }
        }
        break;
      }
      case "tool_execution_start": {
        markRequestFirstTool(sessionId);
        const toolName = event.toolName ?? "unknown";
        const tool: ToolCallVM = { toolCallId: event.toolCallId ?? `tool-${Date.now()}`, toolName, input: event.input, isError: false, state: "running", timestamp: Date.now() };
        appendTimeline({ type: "tool", ...tool } as TimelineItem, sessionId);
        const normalizedTool = toolName.toLowerCase();
        // Custom MCP tools are conventionally exposed as mcp__server__tool.
        if (sessionId !== usePiDeskStore.getState().activeSessionId) break;
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
          const tid = store.sessionTimelines[sessionId] || [];
          const existing = tid.find((t) => t.type === "tool" && t.toolCallId === tcid) as ToolCallVM | undefined;
          updateTimelineItem(tcid, { output: (existing?.output ?? "") + (event.output ?? "") }, sessionId);
        } else {
          updateTimelineItem(tcid, { output: event.output }, sessionId);
        }
        break;
      }
      case "tool_execution_end":
        updateTimelineItem(event.toolCallId ?? "", { state: "done" as const, result: event.result, isError: event.isError ?? false }, sessionId);
        break;
      // Pi 0.82 emits compaction_start/compaction_end. Keep the older names
      // as aliases for compatibility with older bundled Pi builds.
      case "compaction_start":
      case "agent_compacting":
        if (sid) {
          const currentStatus = usePiDeskStore.getState().sessions[sid]?.status || "idle";
          // Remember the pre-compaction status so we can restore it on compaction_end.
          // Auto-compaction happens mid-turn (prev = "streaming"); manual compaction
          // usually starts from "idle" and must NOT end up stuck as "streaming".
          if (currentStatus !== "compacting" && currentStatus !== "retrying") {
            prevStatusRef.current[sid] = currentStatus;
          }
          updateStatus(sid, "compacting");
        }
        switchToRole("compression");
        break;
      case "compaction_end":
      case "agent_compacted":
        if (sid) {
          // Restore the pre-compaction status instead of hard-coding "streaming":
          // a manual compact from idle would otherwise leave the session stuck at
          // "Running" and turn the composer's send button into an abort button.
          updateStatus(sid, prevStatusRef.current[sid] || "idle");
          // A manual compact is a standalone operation: no agent_settled follows,
          // so the main model swapped out by compaction_start must be restored here
          // (both on success and on failure). Identified by reason="manual" (Pi 0.82)
          // or by the pre-compaction status being "idle" (legacy agent_compacted).
          if (((event as { reason?: string }).reason === "manual" || prevStatusRef.current[sid] === "idle")
              && sessionId === usePiDeskStore.getState().activeSessionId) {
            restoreMainModel();
          }
          // Pi 0.82 reports the compacted context size in compaction_end.result —
          // refresh the context usage so the Inspector reflects the actual
          // post-compaction context instead of the pre-compaction accumulation.
          const compactResult = (event as unknown as { result?: { estimatedTokensAfter?: number } }).result;
          if (compactResult?.estimatedTokensAfter != null) {
            const store = usePiDeskStore.getState();
            const usageKey = store.sessions[sid]?.fileId || sid;
            const modelRef = store.sessions[sid]?.model;
            const matched = modelRef
              ? store.availableModels.find((m) => m.provider === modelRef.provider && m.id === modelRef.id)
              : undefined;
            const contextMax = matched?.contextWindow
              || store.sessionContextUsage[usageKey]?.maxTokens
              || store.sessionContextUsage[sid]?.maxTokens
              || 0;
            if (contextMax > 0) {
              store.setSessionContextUsage(usageKey, compactResult.estimatedTokensAfter, contextMax);
              if (store.sessions[sid]?.fileId) {
                store.setSessionContextUsage(sid, compactResult.estimatedTokensAfter, contextMax);
              }
            }
          }
        }
        break;
      // Auto-retry and summarization are maintenance work performed by Pi
      // outside the normal assistant turn.
      case "auto_retry_start":
      case "summarization_retry_scheduled":
      case "summarization_retry_attempt_start":
        if (sid) {
          const currentStatus = usePiDeskStore.getState().sessions[sid]?.status || "idle";
          if (currentStatus !== "compacting" && currentStatus !== "retrying") {
            prevStatusRef.current[sid] = currentStatus;
          }
          updateStatus(sid, "retrying");
        }
        switchToRole("maintenance");
        break;
      case "auto_retry_end":
      case "summarization_retry_finished":
        if (sid) updateStatus(sid, prevStatusRef.current[sid] || "idle");
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
        if (event.text) appendTimeline({ type: "system-info", text: event.text, timestamp: Date.now() }, sessionId);
        break;
    }
  }, [appendTimeline, updateTimelineItem, updateStatus, addExtensionUiRequest, updateSessionModel, updateSessionThinkingLevel, restoreMainModel, switchToRole, markRequestFirstEvent, markRequestFirstTool, markRequestSettled, syncSessionFileId, drainPendingQueue]);

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
        if (data.archivedSessions && Array.isArray(data.archivedSessions)) usePiDeskStore.setState({ archivedSessions: data.archivedSessions as string[] } as Parameters<typeof usePiDeskStore.setState>[0]);
        if (data.sessionWorkspaces) usePiDeskStore.setState({ sessionWorkspaces: { ...s.sessionWorkspaces, ...data.sessionWorkspaces } } as Parameters<typeof usePiDeskStore.setState>[0]);
        if (data.sessionWorkspacesByFile) usePiDeskStore.setState({ sessionWorkspacesByFile: { ...s.sessionWorkspacesByFile, ...data.sessionWorkspacesByFile } } as Parameters<typeof usePiDeskStore.setState>[0]);
        if (data.sessionUsage) usePiDeskStore.setState({ sessionUsage: { ...s.sessionUsage, ...data.sessionUsage } } as Parameters<typeof usePiDeskStore.setState>[0]);
        if (data.sessionContextUsage) usePiDeskStore.setState({ sessionContextUsage: { ...s.sessionContextUsage, ...data.sessionContextUsage } } as Parameters<typeof usePiDeskStore.setState>[0]);
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
              archivedSessions: data.archivedSessions || s.archivedSessions,
              sessionNames: clean,
              sessionWorkspaces: data.sessionWorkspaces || s.sessionWorkspaces,
              sessionWorkspacesByFile: data.sessionWorkspacesByFile || s.sessionWorkspacesByFile,
              sessionUsage: data.sessionUsage || s.sessionUsage,
              sessionContextUsage: data.sessionContextUsage || s.sessionContextUsage,
              lastActiveCwd: data.lastActiveCwd || s.lastActiveCwd,
            }).catch(() => {});
          }
        }
        // Retroactively apply workspaceCwd to already-loaded sessions — only via the
        // precise per-session mapping (fileId). The legacy cwd→workspace map is NOT
        // used here: applying it to every session sharing a cwd would drag standalone
        // tasks into a project (the "task ⇄ project shuffling" bug).
        const current = usePiDeskStore.getState();
        const updates: Record<string, typeof current.sessions[string]> = {};
        for (const [id, sess] of Object.entries(current.sessions)) {
          const ws = sess.fileId ? current.sessionWorkspacesByFile[sess.fileId] : undefined;
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

  // ── Model catalog: fetch from the single source of truth + sanitize ──
  // Refreshed on startup and whenever the backend broadcasts "models:changed".
  const refreshModels = useCallback(async () => {
    try {
      const models = await getAvailableModels();
      setAvailableModels(models);
      // Sanitize settings: drop defaultModel / roleModels whose provider no longer
      // exists in the model catalog (e.g. after a provider was removed). Without
      // this, a stale ref would keep firing set_model with an unknown provider.
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
    } catch (e) {
      console.error("refreshModels failed:", e);
    }
  }, [setAvailableModels]);

  // Load historical sessions + available models on startup
  useEffect(() => {
    listPiSessions().then((list) => {
      setHistoricalSessions(list);
    }).catch(console.error);
    refreshModels();
  }, [setHistoricalSessions, refreshModels]);

  // Keep the UI model list in sync with the backend catalog (add_model / remove_model)
  useEffect(() => {
    const unlisten = onModelsChanged(() => { refreshModels(); });
    return () => unlisten();
  }, [refreshModels]);

  // ── Inherit Pi's global default model/thinking level ──
  // When the user has NOT explicitly chosen a default model in PiDesk, adopt
  // ~/.pi/agent/settings.json (defaultProvider/defaultModel/defaultThinkingLevel)
  // so new sessions behave exactly like the Pi CLI — no more falling back to
  // whatever model happens to be first in the catalog.
  useEffect(() => {
    if (availableModels.length === 0) return;
    const store = usePiDeskStore.getState();
    const userModel = store.settings.defaultModel;
    (async () => {
      try {
        const raw = await readPiFile("settings.json");
        const pi = JSON.parse(raw) as { defaultProvider?: string; defaultModel?: string; defaultThinkingLevel?: string };
        if (!pi.defaultProvider || !pi.defaultModel) return;
        const matched = store.availableModels.find((m) => m.provider === pi.defaultProvider && m.id === pi.defaultModel);
        if (!matched) return; // provider not in catalog — leave unset
        const patch: Partial<PiDeskSettings> = {};
        // Model: inherit Pi global default only when the user hasn't picked one.
        if (!isValidModelRef(userModel)) {
          patch.defaultModel = { provider: pi.defaultProvider, id: pi.defaultModel };
          // No user-chosen model -> adopt Pi's thinking level too.
          if (pi.defaultThinkingLevel && matched.thinkingLevels.includes(pi.defaultThinkingLevel)) {
            patch.defaultThinkingLevel = pi.defaultThinkingLevel as ThinkingLevel;
          }
        } else if (
          pi.defaultThinkingLevel &&
          matched.thinkingLevels.includes(pi.defaultThinkingLevel) &&
          store.settings.defaultThinkingLevel &&
          !matched.thinkingLevels.includes(store.settings.defaultThinkingLevel)
        ) {
          // User picked a model but their thinking level is unusable on the Pi
          // global model (e.g. stale "medium" on a high/max-only model) — inherit
          // Pi's level instead of silently degrading.
          patch.defaultThinkingLevel = pi.defaultThinkingLevel as ThinkingLevel;
        }
        if (Object.keys(patch).length > 0) {
          store.setSettings(patch);
          console.log("[pidesk] Inherited Pi global defaults:", patch);
        }
      } catch (e) {
        console.error("inheritPiDefaults failed:", e);
      }
    })();
  }, [availableModels]);

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
  const applySettingsToSession = useCallback(async (sessionId: string, modelOverride?: { provider: string; id: string }) => {
    const state = usePiDeskStore.getState();
    const settings = state.settings;
    // Historical sessions keep the model recorded in their JSONL file.
    let dm = modelOverride || settings.defaultModel;
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
      // Record per-session workspace ownership so the session stays in its project
      // after a restart (when it becomes historical). Keyed by runtime id for now;
      // setSessionFileId migrates the key to the persistent fileId once synced.
      if (workspaceCwd) {
        usePiDeskStore.getState().setSessionWorkspace(id, workspaceCwd);
      }
      await applySettingsToSession(id);
      // Persist last active cwd so session can be restored on restart
      usePiDeskStore.getState().setLastActiveCwd(cwd);
      // Reconcile the persistent fileId shortly after start — Pi creates the .jsonl
      // file asynchronously, and a stable fileId is what makes pinning survive restarts.
      // (Events also trigger a sync as a fallback.)
      setTimeout(() => {
        if (!usePiDeskStore.getState().sessions[id]?.fileId) {
          fileIdSyncedRef.current.add(id);
          syncSessionFileId(id).finally(() => fileIdSyncedRef.current.delete(id));
        }
      }, 1500);
    } catch (e) {
      console.error("Failed to start session:", e);
      presentAppError(e, "Session Error");
    }
  }, [setActiveSession, applySettingsToSession, addProject, newPiSession, syncSessionFileId]);

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
      const restoredUsage = summarizeSessionUsage(entries);

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
      const historyModelEntry = [...entries].reverse().find((entry) => entry.model_provider && entry.model_id);
      const historyModel = historyModelEntry?.model_provider && historyModelEntry.model_id
        ? { provider: historyModelEntry.model_provider, id: historyModelEntry.model_id }
        : undefined;
      const histSession = store.historicalSessions.find(h => h.id === dirName);
      const customName = store.sessionNames[dirName];
      const displayName = customName || histSession?.name || "Untitled";

      // Create session with history loaded — restore workspaceCwd from persistent mapping.
      // Per-session (fileId) mapping is authoritative; legacy cwd map is only a fallback.
      const workspaceCwd = usePiDeskStore.getState().sessionWorkspacesByFile[dirName]
        ?? usePiDeskStore.getState().sessionWorkspaces[cwd];
      setActiveSession(id, {
        id, name: displayName, cwd,
        fileId: dirName,
        workspaceCwd,
        thinkingLevel: settings.defaultThinkingLevel,
        model: historyModel || (settings.defaultModel ? { provider: settings.defaultModel.provider, id: settings.defaultModel.id } : undefined),
        status: "idle",
      });
      usePiDeskStore.setState((state) => ({
        sessionUsage: {
          ...state.sessionUsage,
          [dirName]: restoredUsage,
          [id]: restoredUsage,
        },
      }));
      const restoredModel = historyModel || settings.defaultModel;
      const matchedModel = restoredModel
        ? store.availableModels.find((m) => m.provider === restoredModel.provider && m.id === restoredModel.id)
        : undefined;
      const contextMax = matchedModel?.contextWindow || 0;
      if (contextMax > 0) {
        usePiDeskStore.getState().setSessionContextUsage(id, restoredUsage.inputTokens + restoredUsage.outputTokens, contextMax);
        usePiDeskStore.getState().setSessionContextUsage(dirName, restoredUsage.inputTokens + restoredUsage.outputTokens, contextMax);
      }
      usePiDeskStore.getState().setLastActiveCwd(cwd);
      loadHistoryEntries(id, items);
      // Apply settings to the Pi process
      await applySettingsToSession(id, historyModel);
    } catch (e) {
      console.error("Failed to resume session:", e);
      presentAppError(e, "Resume Failed");
    } finally {
      resumingRef.current.delete(cwd);
    }
  }, [setActiveSession, loadHistoryEntries, applySettingsToSession, getSessionsDir, switchSession]);

  // ── Send message ──
  const handleSend = useCallback(async (text: string, images?: string[]) => {
    if (!activeId) return;
    const userMsg: MessageVM = { id: `user-${Date.now()}`, role: "user", text, images: images?.map(p => ({ path: p, type: "file" as const })), streaming: false, timestamp: Date.now() };
    appendTimeline({ type: "user", ...userMsg } as TimelineItem);
    const currentStatus = usePiDeskStore.getState().sessions[activeId]?.status;
    const isProcessing = currentStatus === "streaming" || currentStatus === "compacting" || currentStatus === "retrying";
    const store = usePiDeskStore.getState();

    // Queue-while-running mode: while the agent is busy, buffer the message and
    // auto-send it once the current task settles (agent_settled / abort / exit).
    if (isProcessing && store.settings.queueWhileRunning) {
      const item: PendingQueueItem = { id: `pending-${Date.now()}`, text, images, timestamp: Date.now() };
      store.enqueuePending(activeId, item);
      clearInput();
      const t = getT(store.language);
      store.addToast({
        type: "info",
        title: t("toast", "queued"),
        message: t("toast", "queuedMsg"),
        durationMs: 4000,
      });
      return;
    }

    if (!isProcessing) updateStatus(activeId, "streaming");

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
    const requestId = `req-${Date.now()}`;
    markRequestSent(activeId, requestId);
    try {
      if (currentStatus === "compacting" || currentStatus === "retrying") {
        // Queue messages while compaction/retry is processing the agent.
        if (images && images.length > 0) {
          throw new Error("压缩或重试期间暂不支持排队图片，请等待当前操作完成。");
        }
        await followUp(activeId, text);
      } else if (currentStatus === "streaming") {
        // Pi rejects a competing prompt while a turn is running.
        if (images && images.length > 0) {
          throw new Error("当前任务处理中暂不支持发送图片，请等待完成或先中止任务。");
        }
        await steer(activeId, text);
      } else {
        await piPrompt(activeId, text, images);
      }
      startTimeoutGuard(activeId);
    } catch (e) {
      updateStatus(activeId, "idle");
      appendTimeline({ type: "system-info", text: `Error: ${String(e)}`, timestamp: Date.now() });
      presentAppError(e, "Request Failed");
    }
  }, [activeId, appendTimeline, updateStatus, renameSession, clearInput, markRequestSent, startTimeoutGuard]);

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
    // Clean up archived references
    usePiDeskStore.setState((s) => ({
      archivedSessions: s.archivedSessions.filter(k => k !== persistId),
    }));
    // Also remove from historical list and sessionNames
    const persistId = session?.fileId || id;
    setHistoricalSessions(usePiDeskStore.getState().historicalSessions.filter(h => h.id !== persistId));
    if (session?.cwd) {
      usePiDeskStore.setState((s) => {
        const { [persistId]: _, ...restNames } = s.sessionNames;
        const { [persistId]: __, ...restWsByFile } = s.sessionWorkspacesByFile;
        const { [session.cwd]: ___, ...restWs } = s.sessionWorkspaces;
        return { sessionNames: restNames, sessionWorkspacesByFile: restWsByFile, sessionWorkspaces: restWs };
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
      // Pinned sessions are keyed by persistent fileId (falling back to runtime id for
      // brand-new sessions that have not been reconciled yet).
      const currentSessionIds = [
        ...Object.values(s.sessions).map((sess) => sess.fileId).filter(Boolean),
        ...Object.keys(s.sessions),
        ...s.historicalSessions.map(h => h.id),
      ];
      const validSessions = s.pinned.sessions.filter(id => currentSessionIds.includes(id));
      const validProjects = s.pinned.projects.filter(cwd => !!s.projects[cwd]);
      const validArchived = s.archivedSessions.filter(id => currentSessionIds.includes(id));
      if (validSessions.length !== s.pinned.sessions.length || validProjects.length !== s.pinned.projects.length || validArchived.length !== s.archivedSessions.length) {
        usePiDeskStore.setState({
          pinned: { sessions: validSessions, projects: validProjects },
          archivedSessions: validArchived,
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
        onContinueAnyway={() => setBootPhase("ready")}
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
