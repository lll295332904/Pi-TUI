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
  ModelRef,
  ProjectVM,
  PinnedItems,
  ToastItem,
} from "../types";

const DEFAULT_SETTINGS: PiDeskSettings = {
  defaultModel: null,
  defaultThinkingLevel: "medium",
  defaultCwd: "C:\\Git",
  autoCompaction: true,
  autoRetry: true,
  steeringMode: "all",
  followUpMode: "all",
  roleModels: {
    main: null,
    vision: null,
    web: null,
    compression: null,
    skills: null,
    approval: null,
    title: null,
    maintenance: null,
    mcp: null,
    subAgent: null,
  },
};

interface PiDeskState {
  // Active session
  activeSessionId: string | null;
  sessions: Record<string, SessionVM>;
  sessionTimelines: Record<string, TimelineItem[]>;
  historicalSessions: PiSessionMeta[];
  pendingApproval: ApprovalRequestVM | null;

  // Persisted custom session names: cwd → name
  sessionNames: Record<string, string>;

  // Available models (loaded from models-store.json)
  availableModels: AvailableModel[];

  // Extension UI requests (approvals, confirms, etc.)
  extensionUiRequests: ExtensionUiRequest[];

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

  // UI
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  settingsOpen: boolean;
  searchOpen: boolean;
  consoleOpen: boolean;
  consoleLogs: Record<string, string[]>;  // sessionId → raw event JSON lines
  sessionUsage: Record<string, { inputTokens: number; outputTokens: number }>;
  sessionWorkspaces: Record<string, string>; // cwd → workspaceCwd, persisted
  sessionContextUsage: Record<string, { usedTokens: number; maxTokens: number }>;
  sessionRoles: Record<string, string>; // sessionId → current role
  globalRole: string; // fallback for TopBar display

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
  currentRole: keyof RoleModels;
  setCurrentRole: (role: keyof RoleModels) => void;

  // Actions – projects & pinning
  addProject: (cwd: string, name: string) => void;
  removeProject: (cwd: string) => void;
  renameProject: (cwd: string, name: string) => void;
  setActiveProject: (cwd: string | null) => void;
  togglePinProject: (cwd: string) => void;
  togglePinSession: (sessionId: string) => void;
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
      historicalSessions: [],
      pendingApproval: null,
      sessionNames: {},
      availableModels: [],
      extensionUiRequests: [],
      settings: DEFAULT_SETTINGS,
      projects: {},
      activeProjectCwd: null,
      pinned: { sessions: [], projects: [] },
      currentRole: "main" as keyof RoleModels,
      sidebarOpen: true,
      inspectorOpen: false,
      settingsOpen: false,
      searchOpen: false,
      searchQuery: "",
      consoleOpen: false,
      consoleLogs: {},
      sessionUsage: {},
      sessionWorkspaces: {},
      sessionContextUsage: {},
      sessionRoles: {},
      globalRole: "main",
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
          const { [id]: ___, ...restNames } = s.sessionNames;
          return {
            sessions: restSessions,
            sessionTimelines: restTimelines,
            sessionNames: restNames,
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
        set((s) => ({
          sessionContextUsage: {
            ...s.sessionContextUsage,
            [id]: { usedTokens, maxTokens },
          },
        })),

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
          return {
            sessionTimelines: {
              ...s.sessionTimelines,
              [targetSessionId]: [...current, item],
            },
          };
        }),

      updateTimelineItem: (itemId, patch, sessionId) =>
        set((s) => {
          const targetSessionId = sessionId || s.activeSessionId;
          if (!targetSessionId) return s;
          const current = s.sessionTimelines[targetSessionId] || [];
          return {
            sessionTimelines: {
              ...s.sessionTimelines,
              [targetSessionId]: current.map((t) => {
                const id = t.type === "tool" ? t.toolCallId : (t as { id: string }).id;
                if (id === itemId) return { ...t, ...patch } as TimelineItem;
                return t;
              }),
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
          };
        }),

      loadHistoryEntries: (sessionId, entries) =>
        set((s) => ({
          sessionTimelines: {
            ...s.sessionTimelines,
            [sessionId]: entries,
          },
        })),

      setHistoricalSessions: (list) =>
        set({
          historicalSessions: list,
        }),

      setPendingApproval: (req) => set({ pendingApproval: req }),

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
          return {
            globalRole: role,
            ...(id ? { sessionRoles: { ...s.sessionRoles, [id]: role } } : {}),
          };
        }),

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
          const sessions = s.pinned.sessions.includes(sessionId)
            ? s.pinned.sessions.filter((p) => p !== sessionId)
            : [...s.pinned.sessions, sessionId];
          const next = { pinned: { ...s.pinned, sessions } };
          saveManual(next);
          return next;
        }),

      moveSessionToWorkspace: (sessionId, workspaceCwd) =>
        set((s) => {
          const sess = s.sessions[sessionId];
          if (!sess) return s;
          const next = {
            sessions: {
              ...s.sessions,
              [sessionId]: { ...sess, workspaceCwd },
            },
            sessionWorkspaces: { ...s.sessionWorkspaces, [sess.cwd]: workspaceCwd },
          };
          saveManual(next);
          return next;
        }),

      detachSessionFromWorkspace: (sessionId) =>
        set((s) => {
          const sess = s.sessions[sessionId];
          if (!sess) return s;
          const { workspaceCwd: _, ...cleanSess } = sess;
          const { [sess.cwd]: __, ...restWs } = s.sessionWorkspaces;
          const next = {
            sessions: { ...s.sessions, [sessionId]: cleanSess },
            sessionWorkspaces: restWs,
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
            sessionNames: s.sessionNames,
            sessionWorkspaces: s.sessionWorkspaces,
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
      sessionNames: s.sessionNames,
      sessionWorkspaces: s.sessionWorkspaces,
      lastActiveCwd: s.lastActiveCwd,
    }).catch(() => {});
  }, 500);
}
