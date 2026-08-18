import { create } from "zustand";
import { persist } from "zustand/middleware";
import { saveUserdata } from "../bridge";
import type {
  SessionVM,
  SessionStatus,
  TimelineItem,
  ApprovalRequestVM,
  PiSessionMeta,
  AvailableModel,
  ExtensionUiRequest,
  PiDeskSettings,
  RoleModels,
  RoleThinkingLevels,
  ModelRef,
  PendingQueueItem,
  ProjectVM,
  PinnedItems,
  ToastItem,
  RequestPerformance,
} from "../types";

/**
 * Recommended per-role models (P1 optimization, 2026-08-10).
 * main/subAgent → strongest reasoning model; vision → the only vision-capable
 * model; everything else → fast/cheap flash. References must exist in the model
 * catalog, otherwise refreshModels() sanitizes them away on startup.
 */
const DEFAULT_ROLE_MODELS: RoleModels = {
  main: { provider: "deepseek", id: "deepseek-v4-pro" },
  vision: { provider: "小米mimo", id: "mimo-v2.5" },
  web: { provider: "deepseek", id: "deepseek-v4-flash" },
  compression: { provider: "deepseek", id: "deepseek-v4-flash" },
  skills: { provider: "deepseek", id: "deepseek-v4-flash" },
  approval: { provider: "deepseek", id: "deepseek-v4-flash" },
  title: { provider: "deepseek", id: "deepseek-v4-flash" },
  maintenance: { provider: "deepseek", id: "deepseek-v4-flash" },
  mcp: { provider: "deepseek", id: "deepseek-v4-flash" },
  subAgent: { provider: "deepseek", id: "deepseek-v4-pro" },
};

/**
 * Recommended per-role thinking levels. All roles default to "medium"
 * (unified default per product decision): heavy and light tasks share the
 * same thinking level unless the user overrides per-role.
 * deepseek exposes off/low/medium/high/max via the unified thinkingLevelMap.
 */
const DEFAULT_ROLE_THINKING_LEVELS: RoleThinkingLevels = {
  main: "medium",
  vision: "medium",
  web: "medium",
  compression: "medium",
  skills: "medium",
  approval: "medium",
  title: "medium",
  maintenance: "medium",
  mcp: "medium",
  subAgent: "medium",
};

const DEFAULT_SETTINGS: PiDeskSettings = {
  defaultModel: null,
  // Unified default thinking level: "medium" (matches Pi global settings.json).
  defaultThinkingLevel: "medium",
  defaultCwd: "C:\\Git",
  autoCompaction: true,
  autoRetry: true,
  steeringMode: "all",
  followUpMode: "all",
  queueWhileRunning: true,
  roleModels: DEFAULT_ROLE_MODELS,
  roleThinkingLevels: DEFAULT_ROLE_THINKING_LEVELS,
};

interface PiDeskState {
  // Active session
  activeSessionId: string | null;
  sessions: Record<string, SessionVM>;
  sessionTimelines: Record<string, TimelineItem[]>;
  sessionTimelineIndexes: Record<string, Record<string, number>>;
  historicalSessions: PiSessionMeta[];
  pendingApproval: ApprovalRequestVM | null;

  // Persisted custom session names: cwd → name
  sessionNames: Record<string, string>;

  // Available models (loaded from models-store.json)
  availableModels: AvailableModel[];

  // Extension UI requests (approvals, confirms, etc.)
  extensionUiRequests: ExtensionUiRequest[];

  // Per-session pending message queues (queue-while-running mode, not persisted)
  pendingQueues: Record<string, PendingQueueItem[]>;
  enqueuePending: (sessionId: string, item: PendingQueueItem) => void;
  /** Removes and returns the head of the queue, or null when empty. */
  shiftPending: (sessionId: string) => PendingQueueItem | null;
  clearPendingQueue: (sessionId: string) => void;

  // App boot state

  // Persisted settings
  settings: PiDeskSettings;
  language: "zh" | "en";
  setLanguage: (lang: "zh" | "en") => void;

  // Project workspaces (keyed by cwd)
  projects: Record<string, ProjectVM>;
  activeProjectCwd: string | null;

  // Pinned items (persisted)
  pinned: PinnedItems;

  // Archived sessions (persisted) — keyed by persistent fileId (same rule as pinning).
  // Archived sessions are hidden from the main lists and shown in the Archive section.
  archivedSessions: string[];

  // UI
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  settingsOpen: boolean;
  searchOpen: boolean;
  consoleOpen: boolean;
  consoleLogs: Record<string, string[]>;  // sessionId → raw event JSON lines
  sessionUsage: Record<string, { inputTokens: number; outputTokens: number }>;
  sessionRequestPerformance: Record<string, RequestPerformance>;
  lastCompletedRequestPerformance: Record<string, RequestPerformance>;
  sessionWorkspaces: Record<string, string>; // cwd → workspaceCwd, persisted
  sessionWorkspacesByFile: Record<string, string>; // fileId → workspaceCwd (per-session, precise; legacy cwd map is only a fallback)
  sessionContextUsage: Record<string, { usedTokens: number; maxTokens: number }>;
  sessionRoles: Record<string, string>; // sessionId → current role

  // Input
  inputValue: string;
  inputImages: string[];

  // Toast notifications
  toasts: ToastItem[];
  addToast: (toast: Omit<ToastItem, "id">) => void;
  removeToast: (id: string) => void;

  // Last active session recovery
  lastActiveCwd: string | null;
  setLastActiveCwd: (cwd: string) => void;

  // Actions – session
  setActiveSession: (id: string, vm: SessionVM) => void;
  updateSessionStatus: (id: string, status: SessionStatus) => void;
  renameSession: (id: string, name: string) => void;
  setSessionName: (sessionId: string, name: string) => void;
  removeSession: (id: string) => void;
  setAvailableModels: (models: AvailableModel[]) => void;
  updateSessionModel: (id: string, provider: string, modelId: string) => void;
  updateSessionThinkingLevel: (id: string, level: string) => void;
  setSessionContextUsage: (id: string, usedTokens: number, maxTokens: number) => void;
  // Transient: sessionId → model ref currently being switched to (shown as "Switching…" in TopBar)
  modelSwitching: Record<string, ModelRef>;
  setModelSwitching: (id: string, ref: ModelRef | null) => void;

  // Actions – timeline
  appendTimeline: (item: TimelineItem, sessionId?: string) => void;
  updateTimelineItem: (itemId: string, patch: Partial<TimelineItem>, sessionId?: string) => void;
  markRequestSent: (sessionId: string, requestId: string, sendAt?: number) => void;
  markRequestFirstEvent: (sessionId: string, at?: number) => void;
  markRequestFirstTool: (sessionId: string, at?: number) => void;
  markRequestSettled: (sessionId: string, at?: number) => void;
  markRequestFirstVisibleRender: (sessionId: string, at?: number) => void;
  clearTimeline: () => void;
  loadHistoryEntries: (sessionId: string, entries: TimelineItem[]) => void;
  setHistoricalSessions: (list: PiSessionMeta[]) => void;
  setPendingApproval: (req: ApprovalRequestVM | null) => void;

  // Actions – extension UI
  addExtensionUiRequest: (req: ExtensionUiRequest) => void;
  removeExtensionUiRequest: (id: string) => void;

  // Actions – settings
  setSettings: (patch: Partial<PiDeskSettings>) => void;
  setRoleModel: (role: keyof RoleModels, model: ModelRef | null) => void;

  // Current active role (for UI display)
  setCurrentRole: (role: keyof RoleModels) => void;
  setSessionRole: (sessionId: string, role: string) => void;

  // Actions – projects & pinning
  addProject: (cwd: string, name: string) => void;
  removeProject: (cwd: string) => void;
  renameProject: (cwd: string, name: string) => void;
  setActiveProject: (cwd: string | null) => void;
  togglePinProject: (cwd: string) => void;
  togglePinSession: (sessionId: string) => void;
  togglePinSessionByFileId: (fileId: string) => void;
  archiveSession: (sessionId: string) => void;
  unarchiveSession: (sessionId: string) => void;
  archiveSessionByFileId: (fileId: string) => void;
  unarchiveSessionByFileId: (fileId: string) => void;
  setSessionFileId: (sessionId: string, fileId: string) => void;
  setSessionWorkspace: (key: string, workspaceCwd: string) => void;
  moveSessionToWorkspace: (sessionId: string, workspaceCwd: string) => void;
  detachSessionFromWorkspace: (sessionId: string) => void;

  // Actions – UI
  setSidebarOpen: (v: boolean) => void;
  setInspectorOpen: (v: boolean) => void;
  setSettingsOpen: (v: boolean) => void;
  setSearchOpen: (v: boolean) => void;
  setSearchQuery: (q: string) => void;
  setConsoleOpen: (v: boolean) => void;
  appendConsoleLog: (sessionId: string, line: string) => void;
  accumulateUsage: (sessionId: string, input: number, output: number) => void;
  searchQuery: string;
  setInputValue: (v: string) => void;
  addInputImage: (path: string) => void;
  removeInputImage: (path: string) => void;
  clearInput: () => void;
}

export const usePiDeskStore = create<PiDeskState>()(
  persist(
    (set): PiDeskState => ({
      activeSessionId: null,
      sessions: {},
      sessionTimelines: {},
      sessionTimelineIndexes: {},
      historicalSessions: [],
      pendingApproval: null,
      sessionNames: {},
      availableModels: [],
      extensionUiRequests: [],
      pendingQueues: {},
      settings: DEFAULT_SETTINGS,
      projects: {},
      activeProjectCwd: null,
      pinned: { sessions: [], projects: [] },
      archivedSessions: [],
      sidebarOpen: true,
      inspectorOpen: false,
      settingsOpen: false,
      searchOpen: false,
      searchQuery: "",
      consoleOpen: false,
      consoleLogs: {},
      sessionUsage: {},
      sessionRequestPerformance: {},
      lastCompletedRequestPerformance: {},
      sessionWorkspaces: {},
      sessionWorkspacesByFile: {},
      sessionContextUsage: {},
      sessionRoles: {},
      modelSwitching: {},
      language: "zh",
      inputValue: "",
      inputImages: [],
      toasts: [],
      lastActiveCwd: null,

      setActiveSession: (id, vm) =>
        set({ activeSessionId: id, sessions: { ...usePiDeskStore.getState().sessions, [id]: { ...vm, createdAt: vm.createdAt ?? Date.now() } } }),

      updateSessionStatus: (id, status) =>
        set((s) => {
          const sess = s.sessions[id];
          if (!sess) return s;
          return {
            sessions: { ...s.sessions, [id]: { ...sess, status } },
          };
        }),

      renameSession: (id, name) =>
        set((s) => {
          const sess = s.sessions[id];
          if (!sess) return s;
          const persistKey = sess.fileId || id;
          const next = {
            sessions: { ...s.sessions, [id]: { ...sess, name } },
            sessionNames: { ...s.sessionNames, [persistKey]: name },
          };
          saveManual(next);
          return next;
        }),

      setSessionName: (id, name) =>
        set((s) => {
          const next = { sessionNames: { ...s.sessionNames, [id]: name } };
          saveManual(next);
          return next;
        }),

      removeSession: (id) =>
        set((s) => {
          const { [id]: _, ...restSessions } = s.sessions;
          const { [id]: __, ...restTimelines } = s.sessionTimelines;
          const { [id]: ___, ...restIndexes } = s.sessionTimelineIndexes;
          const { [id]: ____, ...restPerf } = s.sessionRequestPerformance;
          const { [id]: _____, ...restCompletedPerf } = s.lastCompletedRequestPerformance;
          const { [id]: ______, ...restNames } = s.sessionNames;
          const { [id]: _______, ...restWsByFile } = s.sessionWorkspacesByFile;
          return {
            sessions: restSessions,
            sessionTimelines: restTimelines,
            sessionTimelineIndexes: restIndexes,
            sessionRequestPerformance: restPerf,
            lastCompletedRequestPerformance: restCompletedPerf,
            sessionNames: restNames,
            sessionWorkspacesByFile: restWsByFile,
            activeSessionId: s.activeSessionId === id ? null : s.activeSessionId,
          };
        }),

      setAvailableModels: (models) => set({ availableModels: models }),

      updateSessionModel: (id, provider, modelId) =>
        set((s) => {
          const sess = s.sessions[id];
          if (!sess) return s;
          const model = provider && modelId ? { provider, id: modelId } : undefined;
          return {
            sessions: {
              ...s.sessions,
              [id]: { ...sess, model },
            },
          };
        }),

      updateSessionThinkingLevel: (id, level) =>
        set((s) => {
          const sess = s.sessions[id];
          if (!sess) return s;
          return {
            sessions: {
              ...s.sessions,
              [id]: { ...sess, thinkingLevel: level as SessionVM["thinkingLevel"] },
            },
          };
        }),

      setSessionContextUsage: (id, usedTokens, maxTokens) =>
        set((s) => {
          const next = {
            sessionContextUsage: {
              ...s.sessionContextUsage,
              [id]: { usedTokens, maxTokens },
            },
          };
          saveManual(next);
          return next;
        }),

      setModelSwitching: (id, ref) =>
        set((s) => {
          const next = { ...s.modelSwitching };
          if (ref) next[id] = ref;
          else delete next[id];
          return { modelSwitching: next };
        }),

      appendTimeline: (item, sessionId) =>
        set((s) => {
          const targetSessionId = sessionId || s.activeSessionId;
          if (!targetSessionId) return s;
          const current = s.sessionTimelines[targetSessionId] || [];
          const nextIndex = current.length;
          const itemId = item.type === "tool" ? item.toolCallId : item.type === "system-info" ? null : item.id;
          const sessionIndex = s.sessionTimelineIndexes[targetSessionId] || {};
          return {
            sessionTimelines: {
              ...s.sessionTimelines,
              [targetSessionId]: [...current, item],
            },
            sessionTimelineIndexes: {
              ...s.sessionTimelineIndexes,
              [targetSessionId]: itemId ? { ...sessionIndex, [itemId]: nextIndex } : sessionIndex,
            },
          };
        }),

      updateTimelineItem: (itemId, patch, sessionId) =>
        set((s) => {
          const targetSessionId = sessionId || s.activeSessionId;
          if (!targetSessionId) return s;
          const current = s.sessionTimelines[targetSessionId] || [];
          const index = s.sessionTimelineIndexes[targetSessionId]?.[itemId];
          if (index == null || !current[index]) return s;
          const next = current.slice();
          next[index] = { ...next[index], ...patch } as TimelineItem;
          return {
            sessionTimelines: {
              ...s.sessionTimelines,
              [targetSessionId]: next,
            },
          };
        }),

      markRequestSent: (sessionId, requestId, sendAt = Date.now()) =>
        set((s) => ({
          sessionRequestPerformance: {
            ...s.sessionRequestPerformance,
            [sessionId]: { requestId, sendAt },
          },
        })),

      markRequestFirstEvent: (sessionId, at = Date.now()) =>
        set((s) => {
          const current = s.sessionRequestPerformance[sessionId];
          if (!current || current.firstEventAt) return s;
          return {
            sessionRequestPerformance: {
              ...s.sessionRequestPerformance,
              [sessionId]: { ...current, firstEventAt: at },
            },
          };
        }),

      markRequestFirstTool: (sessionId, at = Date.now()) =>
        set((s) => {
          const current = s.sessionRequestPerformance[sessionId];
          if (!current || current.firstToolAt) return s;
          return {
            sessionRequestPerformance: {
              ...s.sessionRequestPerformance,
              [sessionId]: { ...current, firstToolAt: at },
            },
          };
        }),

      markRequestSettled: (sessionId, at = Date.now()) =>
        set((s) => {
          const current = s.sessionRequestPerformance[sessionId];
          if (!current) return s;
          const completed = { ...current, settledAt: current.settledAt ?? at };
          return {
            sessionRequestPerformance: {
              ...s.sessionRequestPerformance,
              [sessionId]: completed,
            },
            lastCompletedRequestPerformance: {
              ...s.lastCompletedRequestPerformance,
              [sessionId]: completed,
            },
          };
        }),

      markRequestFirstVisibleRender: (sessionId, at = Date.now()) =>
        set((s) => {
          const current = s.sessionRequestPerformance[sessionId];
          if (!current || current.firstVisibleRenderAt) return s;
          return {
            sessionRequestPerformance: {
              ...s.sessionRequestPerformance,
              [sessionId]: { ...current, firstVisibleRenderAt: at },
            },
          };
        }),

      clearTimeline: () =>
        set((s) => {
          if (!s.activeSessionId) return s;
          return {
            sessionTimelines: {
              ...s.sessionTimelines,
              [s.activeSessionId]: [],
            },
            sessionTimelineIndexes: {
              ...s.sessionTimelineIndexes,
              [s.activeSessionId]: {},
            },
          };
        }),

      loadHistoryEntries: (sessionId, entries) =>
        set((s) => {
          const index: Record<string, number> = {};
          entries.forEach((entry, idx) => {
            const itemId = entry.type === "tool" ? entry.toolCallId : entry.type === "system-info" ? null : entry.id;
            if (itemId) index[itemId] = idx;
          });
          return {
            sessionTimelines: {
              ...s.sessionTimelines,
              [sessionId]: entries,
            },
            sessionTimelineIndexes: {
              ...s.sessionTimelineIndexes,
              [sessionId]: index,
            },
          };
        }),

      setHistoricalSessions: (list) =>
        set({
          historicalSessions: list,
        }),

      setPendingApproval: (req) => set({ pendingApproval: req }),

      enqueuePending: (sessionId, item) =>
        set((s) => ({
          pendingQueues: {
            ...s.pendingQueues,
            [sessionId]: [...(s.pendingQueues[sessionId] || []), item],
          },
        })),

      shiftPending: (sessionId) => {
        const q = usePiDeskStore.getState().pendingQueues[sessionId] || [];
        if (q.length === 0) return null;
        const [head, ...rest] = q;
        usePiDeskStore.setState((s) => ({
          pendingQueues: { ...s.pendingQueues, [sessionId]: rest },
        }));
        return head;
      },

      clearPendingQueue: (sessionId) =>
        set((s) => ({
          pendingQueues: { ...s.pendingQueues, [sessionId]: [] },
        })),

      addExtensionUiRequest: (req) =>
        set((s) => ({
          extensionUiRequests: [...s.extensionUiRequests, req],
        })),

      removeExtensionUiRequest: (id) =>
        set((s) => ({
          extensionUiRequests: s.extensionUiRequests.filter((r) => r.id !== id),
        })),

      setSettings: (patch) =>
        set((s) => ({
          settings: { ...s.settings, ...patch },
        })),

      setLanguage: (lang) => set({ language: lang }),

      setRoleModel: (role, model) =>
        set((s) => ({
          settings: {
            ...s.settings,
            roleModels: { ...s.settings.roleModels, [role]: model },
          },
        })),

      setCurrentRole: (role) =>
        set((s) => {
          const id = s.activeSessionId;
          return id ? { sessionRoles: { ...s.sessionRoles, [id]: role } } : {};
        }),

      setSessionRole: (sessionId, role) =>
        set((s) => ({ sessionRoles: { ...s.sessionRoles, [sessionId]: role } })),

      // ── Project & pin actions ──

      addProject: (cwd, name) =>
        set((s) => {
          const projects = { ...s.projects, [cwd]: { cwd, name, createdAt: Date.now() } };
          const next = { projects, activeProjectCwd: s.activeProjectCwd || cwd };
          saveManual(next);
          return next;
        }),

      removeProject: (cwd) =>
        set((s) => {
          const { [cwd]: _, ...rest } = s.projects;
          const next = { projects: rest, activeProjectCwd: s.activeProjectCwd === cwd ? null : s.activeProjectCwd };
          saveManual(next);
          return next;
        }),

      renameProject: (cwd, name) =>
        set((s) => {
          const p = s.projects[cwd];
          if (!p) return s;
          const next = { projects: { ...s.projects, [cwd]: { ...p, name } } };
          saveManual(next);
          return next;
        }),

      setActiveProject: (cwd) => set({ activeProjectCwd: cwd }),

      togglePinProject: (cwd) =>
        set((s) => {
          const projects = s.pinned.projects.includes(cwd)
            ? s.pinned.projects.filter((p) => p !== cwd)
            : [...s.pinned.projects, cwd];
          const next = { pinned: { ...s.pinned, projects } };
          saveManual(next);
          return next;
        }),

      togglePinSession: (sessionId) =>
        set((s) => {
          // 置顶必须基于持久化的文件级 ID（fileId），而不是每次启动都变化的运行时 UUID，
          // 否则重启后置顶会被当作孤儿清理掉。
          const key = s.sessions[sessionId]?.fileId || sessionId;
          const sessions = s.pinned.sessions.includes(key)
            ? s.pinned.sessions.filter((p) => p !== key)
            : [...s.pinned.sessions, key];
          const next = { pinned: { ...s.pinned, sessions } };
          saveManual(next);
          return next;
        }),

      // 按持久化 fileId 置顶/取消置顶（用于历史会话，它们没有运行时 UUID）
      togglePinSessionByFileId: (fileId) =>
        set((s) => {
          const sessions = s.pinned.sessions.includes(fileId)
            ? s.pinned.sessions.filter((p) => p !== fileId)
            : [...s.pinned.sessions, fileId];
          const next = { pinned: { ...s.pinned, sessions } };
          saveManual(next);
          return next;
        }),

      // ── Archive actions ──
      // 归档按持久化 fileId 记录（与置顶同一规则），保证重启后归档不丢。
      // 新会话在 fileId 同步前先用运行时 id，setSessionFileId 会自动迁移到 fileId。
      archiveSession: (sessionId) =>
        set((s) => {
          const key = s.sessions[sessionId]?.fileId || sessionId;
          if (s.archivedSessions.includes(key)) return s;
          const next = { archivedSessions: [...s.archivedSessions, key] };
          saveManual(next);
          return next;
        }),

      unarchiveSession: (sessionId) =>
        set((s) => {
          const key = s.sessions[sessionId]?.fileId || sessionId;
          if (!s.archivedSessions.includes(key)) return s;
          const next = { archivedSessions: s.archivedSessions.filter((k) => k !== key) };
          saveManual(next);
          return next;
        }),

      // 按持久化 fileId 归档/取消归档（用于历史会话，它们没有运行时 UUID）
      archiveSessionByFileId: (fileId) =>
        set((s) => {
          if (s.archivedSessions.includes(fileId)) return s;
          const next = { archivedSessions: [...s.archivedSessions, fileId] };
          saveManual(next);
          return next;
        }),

      unarchiveSessionByFileId: (fileId) =>
        set((s) => {
          if (!s.archivedSessions.includes(fileId)) return s;
          const next = { archivedSessions: s.archivedSessions.filter((k) => k !== fileId) };
          saveManual(next);
          return next;
        }),

      // 为会话补上持久化 fileId（新会话由 Pi 异步创建 .jsonl 文件后同步得到）。
      // 若该会话此前以运行时 UUID 被置顶，自动迁移到 fileId，保证重启后置顶不丢。
      setSessionFileId: (sessionId, fileId) =>
        set((s) => {
          const sess = s.sessions[sessionId];
          if (!sess || sess.fileId === fileId) return s;
          let pinnedSessions = s.pinned.sessions;
          if (pinnedSessions.includes(sessionId)) {
            pinnedSessions = pinnedSessions.filter((p) => p !== sessionId);
            if (!pinnedSessions.includes(fileId)) pinnedSessions = [...pinnedSessions, fileId];
          }
          // 归档归属同样按会话 key 迁移：运行时 id → fileId
          let archivedSessions = s.archivedSessions;
          if (archivedSessions.includes(sessionId)) {
            archivedSessions = archivedSessions.filter((k) => k !== sessionId);
            if (!archivedSessions.includes(fileId)) archivedSessions = [...archivedSessions, fileId];
          }
          // 归属映射同样按会话 key 迁移：运行时 id → fileId
          const wsByFile = { ...s.sessionWorkspacesByFile };
          if (wsByFile[sessionId] != null) {
            wsByFile[fileId] = wsByFile[sessionId];
            delete wsByFile[sessionId];
          }
          const next = {
            sessions: { ...s.sessions, [sessionId]: { ...sess, fileId } },
            pinned: { ...s.pinned, sessions: pinnedSessions },
            archivedSessions,
            sessionWorkspacesByFile: wsByFile,
          };
          saveManual(next);
          return next;
        }),

      // 记录会话的持久化工作区归属（key 为 fileId，fileId 同步前可先用运行时 id）
      setSessionWorkspace: (key, workspaceCwd) =>
        set((s) => {
          if (s.sessionWorkspacesByFile[key] === workspaceCwd) return s;
          const next = {
            sessionWorkspacesByFile: { ...s.sessionWorkspacesByFile, [key]: workspaceCwd },
          };
          saveManual(next);
          return next;
        }),

      moveSessionToWorkspace: (sessionId, workspaceCwd) =>
        set((s) => {
          const sess = s.sessions[sessionId];
          if (!sess) return s;
          // 按会话精确记录归属（同一 cwd 可有多个会话，不能按 cwd 一刀切）
          const wsKey = sess.fileId || sessionId;
          const next = {
            sessions: {
              ...s.sessions,
              [sessionId]: { ...sess, workspaceCwd },
            },
            sessionWorkspacesByFile: { ...s.sessionWorkspacesByFile, [wsKey]: workspaceCwd },
          };
          saveManual(next);
          return next;
        }),

      detachSessionFromWorkspace: (sessionId) =>
        set((s) => {
          const sess = s.sessions[sessionId];
          if (!sess) return s;
          const { workspaceCwd: _, ...cleanSess } = sess;
          const wsKey = sess.fileId || sessionId;
          const { [wsKey]: __, ...restWsByFile } = s.sessionWorkspacesByFile;
          const next = {
            sessions: { ...s.sessions, [sessionId]: cleanSess },
            sessionWorkspacesByFile: restWsByFile,
          };
          saveManual(next);
          return next;
        }),

      setSidebarOpen: (v) => set({ sidebarOpen: v }),
      setInspectorOpen: (v) => set({ inspectorOpen: v }),
      setSettingsOpen: (v) => set({ settingsOpen: v }),
      setSearchOpen: (v) => set({ searchOpen: v, searchQuery: v ? usePiDeskStore.getState().searchQuery : "" }),
      setSearchQuery: (q) => set({ searchQuery: q }),
      setConsoleOpen: (v) => set({ consoleOpen: v }),

      appendConsoleLog: (sessionId, line) =>
        set((s) => {
          const existing = s.consoleLogs[sessionId] || [];
          const next = existing.length > 500 ? existing.slice(-400) : existing;
          return { consoleLogs: { ...s.consoleLogs, [sessionId]: [...next, line] } };
        }),

      accumulateUsage: (sessionId, input, output) =>
        set((s) => {
          const prev = s.sessionUsage[sessionId] || { inputTokens: 0, outputTokens: 0 };
          const next = {
            sessionUsage: {
              ...s.sessionUsage,
              [sessionId]: {
                inputTokens: prev.inputTokens + input,
                outputTokens: prev.outputTokens + output,
              },
            },
          };
          saveManual(next);
          return next;
        }),
      setInputValue: (v) => set({ inputValue: v }),
      addInputImage: (path) => set((s) => ({ inputImages: [...s.inputImages, path] })),
      removeInputImage: (path) => set((s) => ({ inputImages: s.inputImages.filter((p) => p !== path) })),
      clearInput: () => set({ inputValue: "", inputImages: [] }),

      addToast: (t) => set((s) => ({
        toasts: [...s.toasts, { id: crypto.randomUUID(), ...t, durationMs: t.durationMs ?? 4000 }],
      })),
      removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

      setLastActiveCwd: (cwd) => {
        set((s) => {
          if (s.lastActiveCwd === cwd) return s;
          const next = { lastActiveCwd: cwd };
          // Trigger debounced save
          saveUserdata({
            projects: s.projects,
            pinned: s.pinned,
            archivedSessions: s.archivedSessions,
            sessionNames: s.sessionNames,
            sessionWorkspaces: s.sessionWorkspaces,
            sessionWorkspacesByFile: s.sessionWorkspacesByFile,
            sessionUsage: s.sessionUsage,
            sessionContextUsage: s.sessionContextUsage,
            lastActiveCwd: cwd,
          }).catch(() => {});
          return next;
        });
      },
    }),
    {
      name: "pi-desk-storage",
      partialize: (s) => ({
        sessionNames: s.sessionNames,
        sessionUsage: s.sessionUsage,
        sessionContextUsage: s.sessionContextUsage,
        settings: s.settings,
        projects: s.projects,
        pinned: s.pinned,
        archivedSessions: s.archivedSessions,
        language: s.language,
        lastActiveCwd: s.lastActiveCwd,
      }),
      version: 2,
      merge: (persisted, current) => {
        // Shallow merge (default behavior)
        const merged = { ...current, ...(persisted as Partial<PiDeskState>) };
        // Sanitize settings.defaultModel — clean corrupted entries where id/provider is missing or "undefined"
        const dm = merged.settings?.defaultModel;
        if (dm && (!dm.id || !dm.provider || dm.id === "undefined" || dm.id === "null")) {
          console.warn("[pidesk] Cleaning corrupted defaultModel:", JSON.stringify(dm));
          merged.settings = { ...merged.settings, defaultModel: null };
        }
        // Thinking-level unification: product decision — ALL models default to
        // "medium" (Pi global settings.json + PiDesk defaults + role levels).
        // Override stale stored values (previous defaults were "high" per-role /
        // the even older "medium"->"high" promotion) so every model lands on
        // medium, matching the unified thinkingLevelMap (off/low/medium/high/max).
        merged.settings = {
          ...merged.settings,
          defaultThinkingLevel: "medium",
          roleThinkingLevels: { ...DEFAULT_ROLE_THINKING_LEVELS },
        };
        console.log("[pidesk] Unified defaultThinkingLevel + role thinking levels -> medium");
        // Sanitize settings.roleModels — each role's ModelRef must have valid id+provider
        if (merged.settings?.roleModels) {
          const cleaned = { ...merged.settings.roleModels };
          let dirty = false;
          for (const key of Object.keys(cleaned) as (keyof RoleModels)[]) {
            const ref = cleaned[key];
            if (ref && (!ref.id || !ref.provider || ref.id === "undefined" || ref.id === "null")) {
              console.warn(`[pidesk] Cleaning corrupted roleModel[${key}]:`, JSON.stringify(ref));
              cleaned[key] = null;
              dirty = true;
            }
          }
          if (dirty) {
            merged.settings = { ...merged.settings, roleModels: cleaned };
          }
        }
        if (merged.sessionUsage == null) merged.sessionUsage = {};
        if (merged.sessionContextUsage == null) merged.sessionContextUsage = {};
        if (merged.archivedSessions == null || !Array.isArray(merged.archivedSessions)) merged.archivedSessions = [];
        // Pending queues are runtime state — never restore stale items from storage.
        merged.pendingQueues = {};
        // Role-model defaults migration: if every role is unset (fresh install or
        // old storage), adopt the recommended per-role models so users get
        // sensible defaults out of the box. Invalid providers are cleaned up
        // later by refreshModels() in App.tsx.
        const rm = merged.settings?.roleModels;
        if (rm) {
          const allNull = Object.values(rm).every((v) => v == null);
          if (allNull) {
            merged.settings = { ...merged.settings, roleModels: DEFAULT_ROLE_MODELS };
            console.log("[pidesk] Applied recommended per-role model defaults:", DEFAULT_ROLE_MODELS);
          }
        }
        // Role thinking-level defaults migration (new field in old storage)
        if (merged.settings?.roleThinkingLevels == null) {
          merged.settings = { ...merged.settings, roleThinkingLevels: DEFAULT_ROLE_THINKING_LEVELS };
        }
        return merged as PiDeskState;
      },
      onRehydrateStorage: () => undefined, // handled in App.tsx useEffect
    },
  ),
);

// ── File-based persistence (.pi/agent/userdata.json) ──

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function saveManual(_patch?: Partial<PiDeskState>) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const s = usePiDeskStore.getState();
    saveUserdata({
      projects: s.projects,
      pinned: s.pinned,
      archivedSessions: s.archivedSessions,
      sessionNames: s.sessionNames,
      sessionWorkspaces: s.sessionWorkspaces,
      sessionWorkspacesByFile: s.sessionWorkspacesByFile,
      sessionUsage: s.sessionUsage,
      sessionContextUsage: s.sessionContextUsage,
      lastActiveCwd: s.lastActiveCwd,
    }).catch(() => {});
  }, 500);
}
