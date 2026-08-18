import { useState, useRef, useEffect, useCallback } from "react";
import { Plus, MessageSquare, History, ChevronRight, ChevronDown, Pin, X, Layers, Download, Loader2, Archive, ArchiveRestore } from "lucide-react";
import { usePiDeskStore } from "../store/pidesk";
import { deletePiSession, exportHtml } from "../bridge";
import { useT } from "../i18n";

// Collapse key for the archive section — collapsed by default.
const ARCHIVE_COLLAPSE_KEY = "__archive__";
import type { SessionVM, PiSessionMeta } from "../types";
import { open } from "@tauri-apps/plugin-dialog";

interface Props {
  onNewSession: (cwd?: string, workspaceCwd?: string) => void;
  onResumeSession: (dirName: string, cwd: string) => void;
  onRenameSession: (id: string, name: string) => void;
  onDeleteSession: (id: string) => void;
}

export default function Sidebar({ onNewSession, onResumeSession, onRenameSession, onDeleteSession }: Props) {
  const activeId = usePiDeskStore((s) => s.activeSessionId);
  const sessions = usePiDeskStore((s) => s.sessions);
  const setActiveSession = usePiDeskStore((s) => s.setActiveSession);
  const historicalSessions = usePiDeskStore((s) => s.historicalSessions);
  const sessionNames = usePiDeskStore((s) => s.sessionNames);
  const sessionWorkspaces = usePiDeskStore((s) => s.sessionWorkspaces);
  const sessionWorkspacesByFile = usePiDeskStore((s) => s.sessionWorkspacesByFile);
  const projects = usePiDeskStore((s) => s.projects);

  const { t } = useT("sidebar");
  const pinned = usePiDeskStore((s) => s.pinned);
  const togglePinProject = usePiDeskStore((s) => s.togglePinProject);
  const togglePinSession = usePiDeskStore((s) => s.togglePinSession);
  const togglePinSessionByFileId = usePiDeskStore((s) => s.togglePinSessionByFileId);
  const archivedSessions = usePiDeskStore((s) => s.archivedSessions);
  const archiveSession = usePiDeskStore((s) => s.archiveSession);
  const unarchiveSession = usePiDeskStore((s) => s.unarchiveSession);
  const archiveSessionByFileId = usePiDeskStore((s) => s.archiveSessionByFileId);
  const unarchiveSessionByFileId = usePiDeskStore((s) => s.unarchiveSessionByFileId);
  const renameProject = usePiDeskStore((s) => s.renameProject);
  const removeProject = usePiDeskStore((s) => s.removeProject);
  const moveSessionToWorkspace = usePiDeskStore((s) => s.moveSessionToWorkspace);
  const detachSessionFromWorkspace = usePiDeskStore((s) => s.detachSessionFromWorkspace);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set([ARCHIVE_COLLAPSE_KEY]));
  const [editingTarget, setEditingTarget] = useState<{ type: "session" | "project"; id: string; cwd?: string } | null>(null);
  const [editValue, setEditValue] = useState("");

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<{ sessionId: string; x: number; y: number } | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);
  const [resumingIds, setResumingIds] = useState<Set<string>>(new Set());

  // Wrap onResumeSession to track loading state
  const handleResumeWithLoading = useCallback(async (dirName: string, cwd: string) => {
    setResumingIds(prev => new Set(prev).add(dirName));
    try {
      await onResumeSession(dirName, cwd);
    } finally {
      setResumingIds(prev => {
        const next = new Set(prev);
        next.delete(dirName);
        return next;
      });
    }
  }, [onResumeSession]);

  // Delete an archived historical session: remove from disk + clean up all references.
  const handleDeleteArchivedHistory = useCallback(async (h: PiSessionMeta) => {
    const store = usePiDeskStore.getState();
    try {
      await deletePiSession(h.id);
    } catch (e) {
      console.error("Delete archived session failed:", e);
      store.addToast({ type: "error", title: "Delete failed", message: String(e).slice(0, 200) });
      return;
    }
    store.setHistoricalSessions(store.historicalSessions.filter(x => x.id !== h.id));
    usePiDeskStore.setState((s) => {
      const { [h.id]: _, ...restNames } = s.sessionNames;
      const { [h.id]: __, ...restWsByFile } = s.sessionWorkspacesByFile;
      const { [h.id]: ___, ...restUsage } = s.sessionUsage;
      const { [h.id]: ____, ...restContextUsage } = s.sessionContextUsage;
      return {
        sessionNames: restNames,
        sessionWorkspacesByFile: restWsByFile,
        sessionUsage: restUsage,
        sessionContextUsage: restContextUsage,
        archivedSessions: s.archivedSessions.filter(k => k !== h.id),
        pinned: { ...s.pinned, sessions: s.pinned.sessions.filter(k => k !== h.id) },
      };
    });
    store.addToast({ type: "success", title: "Deleted", message: `"${h.name || h.id}" removed from archive` });
  }, []);

  useEffect(() => {
    if (ctxMenu) {
      const close = (e: MouseEvent) => {
        if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null);
      };
      document.addEventListener("mousedown", close);
      return () => document.removeEventListener("mousedown", close);
    }
  }, [ctxMenu]);

  const projRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editingTarget?.type === "project" && projRef.current) {
      projRef.current.focus(); projRef.current.select();
    }
  }, [editingTarget]);

  const commitRename = () => {
    const name = editValue.trim();
    if (!name || !editingTarget) { setEditingTarget(null); return; }
    if (editingTarget.type === "session") {
      onRenameSession(editingTarget.id, name);
      if (editingTarget.id) usePiDeskStore.getState().setSessionName(editingTarget.id, name);
    } else {
      renameProject(editingTarget.id, name);
    }
    setEditingTarget(null);
  };

  const toggleCollapse = (cwd: string) => {
    setCollapsed((prev) => { const n = new Set(prev); n.has(cwd) ? n.delete(cwd) : n.add(cwd); return n; });
  };

  const projectName = (cwd: string) => projects[cwd]?.name || cwd.split("\\").pop() || cwd;

  // Pinned sessions are keyed by the persistent fileId (falls back to runtime id)
  const isSessionPinned = (s: { id: string; fileId?: string }) => pinned.sessions.includes(s.fileId || s.id);

  // Archived sessions are keyed by the persistent fileId (same rule as pinning)
  const isSessionArchived = (s: { id: string; fileId?: string }) => archivedSessions.includes(s.fileId || s.id);
  const isFileIdArchived = (fileId: string) => archivedSessions.includes(fileId);

  // ── Data partitioning ──
  const allSessions = Object.values(sessions);
  // Match by file-level ID (not cwd) since multiple sessions can share the same cwd
  const inactiveHistorical = historicalSessions.filter(hs => !allSessions.some(s => s.fileId === hs.id));

  // Standalone sessions (no workspaceCwd or workspace no longer exists)
  const standaloneSessions = allSessions.filter(s => !s.workspaceCwd || !projects[s.workspaceCwd]);

  // Build workspace map — including active AND historical sessions
  const workspaceMap = new Map<string, { active: SessionVM[]; history: PiSessionMeta[] }>();
  for (const s of allSessions) {
    if (s.workspaceCwd && projects[s.workspaceCwd]) {
      let entry = workspaceMap.get(s.workspaceCwd);
      if (!entry) { entry = { active: [], history: [] }; workspaceMap.set(s.workspaceCwd, entry); }
      entry.active.push(s);
    }
  }
  // Also include historical sessions with workspace mapping
  const standaloneHistory: PiSessionMeta[] = [];
  for (const h of inactiveHistorical) {
    if (pinned.sessions.includes(h.id) || archivedSessions.includes(h.id)) continue; // pinned/archived history shown in top/archive sections
    // Per-session (fileId) ownership is authoritative; legacy cwd map is only a fallback
    const ws = sessionWorkspacesByFile[h.id] ?? sessionWorkspaces[h.cwd];
    if (ws && projects[ws]) {
      let entry = workspaceMap.get(ws);
      if (!entry) { entry = { active: [], history: [] }; workspaceMap.set(ws, entry); }
      entry.history.push(h);
    } else {
      standaloneHistory.push(h);
    }
  }

  // Pinned historical sessions — pinning is keyed by fileId so it survives restarts.
  const pinnedHistory = inactiveHistorical.filter(h => pinned.sessions.includes(h.id) && !archivedSessions.includes(h.id));

  // Archived sessions — hidden from main lists, shown in the Archive section at the bottom.
  const archivedActive = allSessions.filter(s => isSessionArchived(s));
  const archivedHistory = inactiveHistorical.filter(h => isFileIdArchived(h.id));

  // All project cwds (from projects state, not just those with sessions)
  const sortedProjects = Object.keys(projects).sort((a, b) => {
    return (pinned.projects.includes(a) ? 0 : 1) - (pinned.projects.includes(b) ? 0 : 1);
  });

  // Sort standalone: pinned first, then newest first
  const sortedStandalone = [...standaloneSessions].sort((a, b) => {
    const pin = (isSessionPinned(a) ? 0 : 1) - (isSessionPinned(b) ? 0 : 1);
    if (pin !== 0) return pin;
    return (b.createdAt ?? 0) - (a.createdAt ?? 0);
  });
  const pinnedStandalone = sortedStandalone.filter(s => isSessionPinned(s) && !isSessionArchived(s));
  const normalStandalone = sortedStandalone.filter(s => !isSessionPinned(s) && !isSessionArchived(s));

  // Sort workspace sessions: pinned first, then newest first
  const sortSessions = (list: SessionVM[]) => [...list].sort((a, b) => {
    const pin = (isSessionPinned(a) ? 0 : 1) - (isSessionPinned(b) ? 0 : 1);
    if (pin !== 0) return pin;
    return (b.createdAt ?? 0) - (a.createdAt ?? 0);
  });

  // ── Context menu handlers ──
  const ctxSession = ctxMenu ? sessions[ctxMenu.sessionId] : null;

  return (
    <div className="w-56 border-r border-border bg-sidebar flex flex-col shrink-0">
      {/* Top buttons */}
      <div className="p-2 space-y-1">
        <button onClick={() => onNewSession()}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700
                     bg-white border border-border rounded-md hover:bg-sidebar-hover transition-colors">
          <Plus size={14} />
          <span>{t("newSession")}</span>
        </button>
        {/* New workspace button */}
        <button
          onClick={async () => {
            const name = prompt("Workspace name:");
            if (!name || !name.trim()) return;
            const selected = await open({ directory: true, title: "Select workspace folder" });
            if (!selected) return;
            const cwd = selected as string;
            usePiDeskStore.getState().addProject(cwd, name.trim());
            onNewSession(cwd, cwd);
          }}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-muted
                     hover:bg-sidebar-hover transition-colors rounded-md"
          title="Create new workspace with a session">
          <Layers size={12} />
          <span>{t("newWorkspace")}</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {/* ── {t("topTasks")} ── */}
        <div className="text-[10px] text-muted px-1 py-1 mt-0.5 font-semibold tracking-wide flex items-center gap-1">
          <Pin size={10} /> {t("topTasks")}
        </div>
        {pinnedStandalone.length > 0 || pinnedHistory.length > 0 ? (
          <>
            {pinnedStandalone.map(s => (
              <SessionLine key={s.id} session={s} isActive={s.id === activeId}
                onClick={() => setActiveSession(s.id, s)}
                onPin={() => togglePinSession(s.id)}
                onDelete={() => onDeleteSession(s.id)}
                onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ sessionId: s.id, x: e.clientX, y: e.clientY }); }}
                editingTarget={editingTarget} setEditingTarget={setEditingTarget}
                editValue={editValue} setEditValue={setEditValue} commitRename={commitRename}
              />
            ))}
            {pinnedHistory.map(h => (
              <div key={h.id} onClick={() => handleResumeWithLoading(h.id, h.cwd)}
                className={`flex items-center gap-2 pl-5 pr-2 py-1 text-xs rounded-md cursor-pointer
                           text-gray-500 hover:bg-sidebar-hover transition-colors group
                           ${resumingIds.has(h.id) ? "opacity-60 pointer-events-none" : ""}`}>
                {resumingIds.has(h.id)
                  ? <Loader2 size={11} className="shrink-0 text-accent animate-spin" />
                  : <History size={11} className="shrink-0 text-muted" />
                }
                <span className="truncate flex-1">{h.name || sessionNames[h.id] || "Untitled"}</span>
                <Pin size={10} className="text-accent fill-accent shrink-0" />
                <button onClick={(e) => { e.stopPropagation(); archiveSessionByFileId(h.id); }}
                  className="opacity-0 group-hover:opacity-100 text-muted hover:text-gray-600 shrink-0" title={t("archiveSession")}>
                  <Archive size={10} />
                </button>
                <button onClick={(e) => { e.stopPropagation(); togglePinSessionByFileId(h.id); }}
                  className="opacity-0 group-hover:opacity-100 text-muted hover:text-red-500 shrink-0" title="Unpin">
                  <X size={11} />
                </button>
              </div>
            ))}
          </>
        ) : (
          <div className="text-[10px] text-muted italic pl-3 py-0.5">{t("pinSessionHint")}</div>
        )}

        {/* ── {t("workspaces")} ── */}
        <div className="text-[10px] text-muted px-1 py-1 mt-1.5 font-semibold tracking-wide flex items-center gap-1">
          <Layers size={10} /> {t("workspaces")}
        </div>
        {sortedProjects.length > 0 ? (
          sortedProjects.map(cwd => {
            const wsData = workspaceMap.get(cwd) || { active: [], history: [] };
            const wsSessions = wsData.active;
            const wsHistory = wsData.history;
            const isPinned = pinned.projects.includes(cwd);
            const isCollapsed = collapsed.has(cwd);
            const sorted = sortSessions(wsSessions);
            const pinnedWs = sorted.filter(s => isSessionPinned(s) && !isSessionArchived(s));
            const normalWs = sorted.filter(s => !isSessionPinned(s) && !isSessionArchived(s));

            return (
              <div key={cwd} className="mb-0.5">
                <div className="flex items-center gap-1 px-1 py-1 group rounded hover:bg-sidebar-hover/50">
                  <button onClick={() => toggleCollapse(cwd)} className="text-muted hover:text-gray-600 shrink-0">
                    {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  </button>
                  {editingTarget?.type === "project" && editingTarget.id === cwd ? (
                    <input ref={projRef} value={editValue}
                      onChange={e => setEditValue(e.target.value)} onBlur={commitRename}
                      onKeyDown={e => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditingTarget(null); }}
                      onClick={e => e.stopPropagation()}
                      className="flex-1 min-w-0 text-xs bg-white border border-border rounded px-1 py-0 outline-none" />
                  ) : (
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-gray-700 truncate"
                        onDoubleClick={() => { setEditingTarget({ type: "project", id: cwd }); setEditValue(projectName(cwd)); }}
                        title={cwd}>
                        {projectName(cwd)}
                      </div>
                    </div>
                  )}
                  <button onClick={() => togglePinProject(cwd)}
                    className={`opacity-0 group-hover:opacity-100 ${isPinned ? "opacity-100 text-accent" : "text-muted hover:text-gray-600"}`}
                    title={isPinned ? "Unpin" : "Pin"}>
                    <Pin size={11} className={isPinned ? "fill-accent" : ""} />
                  </button>
                  <button onClick={() => removeProject(cwd)}
                    className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 shrink-0" title="Remove workspace">
                    <X size={13} />
                  </button>
                  <button onClick={() => onNewSession(cwd, cwd)}
                    className="opacity-0 group-hover:opacity-100 text-muted hover:text-gray-600 shrink-0" title="New session in workspace">
                    <Plus size={13} />
                  </button>
                </div>
                {!isCollapsed && (pinnedWs.length > 0 || normalWs.length > 0) && (
                  <div className="ml-3">
                    {pinnedWs.length > 0 && (
                      <div>
                        <div className="text-[10px] text-muted pl-4 py-0.5">{t("topLabel")}</div>
                        {pinnedWs.map(s => (
                          <SessionLine key={s.id} session={s} isActive={s.id === activeId}
                            onClick={() => setActiveSession(s.id, s)}
                            onPin={() => togglePinSession(s.id)}
                            onDelete={() => onDeleteSession(s.id)}
                            onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ sessionId: s.id, x: e.clientX, y: e.clientY }); }}
                            editingTarget={editingTarget} setEditingTarget={setEditingTarget}
                            editValue={editValue} setEditValue={setEditValue} commitRename={commitRename}
                          />
                        ))}
                      </div>
                    )}
                    {normalWs.map(s => (
                      <SessionLine key={s.id} session={s} isActive={s.id === activeId}
                        onClick={() => setActiveSession(s.id, s)}
                        onPin={() => togglePinSession(s.id)}
                        onDelete={() => onDeleteSession(s.id)}
                        onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ sessionId: s.id, x: e.clientX, y: e.clientY }); }}
                        editingTarget={editingTarget} setEditingTarget={setEditingTarget}
                        editValue={editValue} setEditValue={setEditValue} commitRename={commitRename}
                      />
                    ))}
                  </div>
                )}
                {wsHistory.length > 0 && (
                  <div className="ml-3 mt-0.5">
                    {wsHistory.map(h => (
                      <div key={h.id} onClick={() => handleResumeWithLoading(h.id, h.cwd)}
                        className={`flex items-center gap-2 pl-6 pr-2 py-1 text-xs rounded-md cursor-pointer
                                   text-gray-500 hover:bg-sidebar-hover transition-colors group
                                   ${resumingIds.has(h.id) ? "opacity-60 pointer-events-none" : ""}`}>
                        {resumingIds.has(h.id)
                          ? <Loader2 size={11} className="shrink-0 text-accent animate-spin" />
                          : <History size={11} className="shrink-0 text-muted" />
                        }
                        <span className="truncate flex-1">{h.name || sessionNames[h.id] || "Untitled"}</span>
                        <button onClick={(e) => { e.stopPropagation(); togglePinSessionByFileId(h.id); }}
                          className="opacity-0 group-hover:opacity-100 text-muted hover:text-gray-600 shrink-0"
                          title={pinned.sessions.includes(h.id) ? "Unpin" : "Pin"}>
                          <Pin size={10} className={pinned.sessions.includes(h.id) ? "text-accent fill-accent" : ""} />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); archiveSessionByFileId(h.id); }}
                          className="opacity-0 group-hover:opacity-100 text-muted hover:text-gray-600 shrink-0" title={t("archiveSession")}>
                          <Archive size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {!isCollapsed && pinnedWs.length === 0 && normalWs.length === 0 && wsHistory.length === 0 && (
                  <div className="text-[10px] text-muted italic pl-5 py-0.5">{t("noSessionsInWorkspace")}</div>
                )}
              </div>
            );
          })
        ) : (
          <div className="text-[10px] text-muted italic pl-3 py-0.5">{t("createWorkspace")}</div>
        )}

        {/* ── {t("tasks")} ── */}
        <div className="text-[10px] text-muted px-1 py-1 mt-1.5 font-semibold tracking-wide">{t("tasks")}</div>
        {normalStandalone.map(s => (
          <SessionLine key={s.id} session={s} isActive={s.id === activeId}
                onClick={() => setActiveSession(s.id, s)}
                onPin={() => togglePinSession(s.id)}
                onDelete={() => onDeleteSession(s.id)}
                onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ sessionId: s.id, x: e.clientX, y: e.clientY }); }}
                editingTarget={editingTarget} setEditingTarget={setEditingTarget}
                editValue={editValue} setEditValue={setEditValue} commitRename={commitRename}
              />
            ))}
            {standaloneHistory.map(h => (
              <div key={h.id} onClick={() => handleResumeWithLoading(h.id, h.cwd)}
                className={`flex items-center gap-2 pl-6 pr-2 py-1 text-xs rounded-md cursor-pointer
                           text-gray-500 hover:bg-sidebar-hover transition-colors group
                           ${resumingIds.has(h.id) ? "opacity-60 pointer-events-none" : ""}`}>
                {resumingIds.has(h.id)
                  ? <Loader2 size={11} className="shrink-0 text-accent animate-spin" />
                  : <History size={11} className="shrink-0 text-muted" />
                }
                <span className="truncate flex-1">{h.name || sessionNames[h.id] || "Untitled"}</span>
                <button onClick={(e) => { e.stopPropagation(); togglePinSessionByFileId(h.id); }}
                  className="opacity-0 group-hover:opacity-100 text-muted hover:text-gray-600 shrink-0"
                  title={pinned.sessions.includes(h.id) ? "Unpin" : "Pin"}>
                  <Pin size={10} className={pinned.sessions.includes(h.id) ? "text-accent fill-accent" : ""} />
                </button>
                <button onClick={(e) => { e.stopPropagation(); archiveSessionByFileId(h.id); }}
                  className="opacity-0 group-hover:opacity-100 text-muted hover:text-gray-600 shrink-0" title={t("archiveSession")}>
                  <Archive size={10} />
                </button>
              </div>
            ))}
          {normalStandalone.length === 0 && standaloneHistory.length === 0 && (
            <div className="text-[10px] text-muted italic pl-3 py-0.5">No active sessions</div>
          )}
        </div>

        {/* ── {t("archive")} ── */}
        <button onClick={() => toggleCollapse(ARCHIVE_COLLAPSE_KEY)}
          className="w-full flex items-center gap-1 text-[10px] text-muted px-1 py-1 mt-1.5 font-semibold tracking-wide hover:text-gray-700 transition-colors"
          title={collapsed.has(ARCHIVE_COLLAPSE_KEY) ? "展开归档" : "折叠归档"}>
          {collapsed.has(ARCHIVE_COLLAPSE_KEY) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          <Archive size={10} /> {t("archive")}
        </button>
        {!collapsed.has(ARCHIVE_COLLAPSE_KEY) && (archivedActive.length > 0 || archivedHistory.length > 0) ? (
          <>
            {archivedActive.map(s => (
              <div key={s.id}
                onClick={() => { unarchiveSession(s.id); setActiveSession(s.id, s); }}
                className={`flex items-center gap-2 pl-5 pr-2 py-1 text-xs rounded-md cursor-pointer group
                           ${s.id === activeId ? "bg-sidebar-active text-gray-900 font-medium" : "text-gray-500 hover:bg-sidebar-hover"} transition-colors`}
                title={t("unarchiveSession")}>
                <Archive size={11} className="shrink-0 text-muted" />
                <span className="truncate flex-1">{s.name}</span>
                <button onClick={(e) => { e.stopPropagation(); unarchiveSession(s.id); }}
                  className="opacity-0 group-hover:opacity-100 text-muted hover:text-gray-600 shrink-0" title={t("unarchiveSession")}>
                  <ArchiveRestore size={11} />
                </button>
                <button onClick={(e) => { e.stopPropagation(); onDeleteSession(s.id); }}
                  className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 shrink-0" title={t("delete")}>
                  <X size={11} />
                </button>
              </div>
            ))}
            {archivedHistory.map(h => (
              <div key={h.id}
                onClick={() => { unarchiveSessionByFileId(h.id); handleResumeWithLoading(h.id, h.cwd); }}
                className={`flex items-center gap-2 pl-5 pr-2 py-1 text-xs rounded-md cursor-pointer group
                           text-gray-500 hover:bg-sidebar-hover transition-colors
                           ${resumingIds.has(h.id) ? "opacity-60 pointer-events-none" : ""}`}
                title={t("unarchiveSession")}>
                {resumingIds.has(h.id)
                  ? <Loader2 size={11} className="shrink-0 text-accent animate-spin" />
                  : <Archive size={11} className="shrink-0 text-muted" />
                }
                <span className="truncate flex-1">{h.name || sessionNames[h.id] || "Untitled"}</span>
                <button onClick={(e) => { e.stopPropagation(); unarchiveSessionByFileId(h.id); }}
                  className="opacity-0 group-hover:opacity-100 text-muted hover:text-gray-600 shrink-0" title={t("unarchiveSession")}>
                  <ArchiveRestore size={11} />
                </button>
                <button onClick={(e) => { e.stopPropagation(); handleDeleteArchivedHistory(h); }}
                  className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 shrink-0" title={t("delete")}>
                  <X size={11} />
                </button>
              </div>
            ))}
          </>
        ) : (
          !collapsed.has(ARCHIVE_COLLAPSE_KEY) && <div className="text-[10px] text-muted italic pl-3 py-0.5">{t("archiveEmpty")}</div>
        )}

      {/* Context menu */}
      {ctxMenu && ctxSession && (
        <div ref={ctxRef}
          className="fixed z-50 bg-white border border-border rounded-lg shadow-xl py-1 text-xs min-w-[180px]"
          style={{ left: Math.min(ctxMenu.x, window.innerWidth - 190), top: Math.min(ctxMenu.y, window.innerHeight - 150) }}>
          <div className="px-3 py-1.5 text-muted font-medium truncate">{ctxSession.name}</div>
          <div className="border-t border-border" />
          {/* Rename */}
          <button className="w-full text-left px-3 py-1.5 hover:bg-sidebar-hover flex items-center gap-2"
            onClick={() => {
              setEditingTarget({ type: "session", id: ctxSession.id, cwd: ctxSession.cwd });
              setEditValue(ctxSession.name);
              setCtxMenu(null);
            }}>
            <MessageSquare size={12} />
            Rename
          </button>
          {/* Export HTML */}
          <button className="w-full text-left px-3 py-1.5 hover:bg-sidebar-hover flex items-center gap-2"
            onClick={() => {
              exportHtml(ctxSession.id).then((r) => {
                usePiDeskStore.getState().addToast({ type: "success", title: "Exported", message: `Saved to ${r.path}` });
              }).catch(console.error);
              setCtxMenu(null);
            }}>
            <Download size={12} />
            Export HTML
          </button>
          {/* Pin / Unpin */}
          <button className="w-full text-left px-3 py-1.5 hover:bg-sidebar-hover flex items-center gap-2"
            onClick={() => { togglePinSession(ctxSession.id); setCtxMenu(null); }}>
            <Pin size={12} />
            {pinned.sessions.includes(ctxSession.fileId || ctxSession.id) ? "Unpin" : "Pin to top"}
          </button>
          {/* Archive / Restore */}
          <button className="w-full text-left px-3 py-1.5 hover:bg-sidebar-hover flex items-center gap-2"
            onClick={() => {
              if (archivedSessions.includes(ctxSession.fileId || ctxSession.id)) unarchiveSession(ctxSession.id);
              else archiveSession(ctxSession.id);
              setCtxMenu(null);
            }}>
            <Archive size={12} />
            {archivedSessions.includes(ctxSession.fileId || ctxSession.id) ? t("unarchiveSession") : t("archiveSession")}
          </button>
          {/* Delete */}
          <button className="w-full text-left px-3 py-1.5 hover:bg-sidebar-hover text-red-600 flex items-center gap-2"
            onClick={() => { onDeleteSession(ctxSession.id); setCtxMenu(null); }}>
            <X size={12} />
            Delete
          </button>
          <div className="border-t border-border" />
          <button className="w-full text-left px-3 py-1.5 hover:bg-sidebar-hover flex items-center gap-2"
            onClick={() => {
              const cwd = ctxSession.cwd;
              if (!projects[cwd]) {
                // Auto-create workspace at this cwd
                usePiDeskStore.getState().addProject(cwd, cwd.split("\\").pop() || cwd);
              }
              moveSessionToWorkspace(ctxSession.id, cwd);
              setCtxMenu(null);
            }}>
            <Layers size={12} />
            Move to &quot;{ctxSession.cwd.split("\\").pop()}&quot;
          </button>
          {ctxSession.workspaceCwd && projects[ctxSession.workspaceCwd] && (
            <button className="w-full text-left px-3 py-1.5 hover:bg-sidebar-hover text-red-600 flex items-center gap-2"
              onClick={() => { detachSessionFromWorkspace(ctxSession.id); setCtxMenu(null); }}>
              <X size={12} />
              Detach from &quot;{projectName(ctxSession.workspaceCwd)}&quot;
            </button>
          )}
          {Object.keys(projects).filter(p => p !== (ctxSession.workspaceCwd || "") && projects[p]).length > 0 && (
            <>
              <div className="border-t border-border mt-0.5" />
              <div className="px-3 py-1 text-[10px] text-muted">Move to other workspace</div>
              {Object.keys(projects).filter(p => p !== (ctxSession.workspaceCwd || "")).map(p => (
                <button key={p} className="w-full text-left px-3 py-1.5 hover:bg-sidebar-hover truncate pl-6"
                  onClick={() => { moveSessionToWorkspace(ctxSession.id, p); setCtxMenu(null); }}>
                  {projectName(p)}
                </button>
              ))}
            </>
          )}
        </div>
      )}

      <div className="px-3 py-2 border-t border-border text-xs text-muted">PiDesk v0.2.0</div>
    </div>
  );
}

// ── Running indicator: spinning theme-accent dot ring ──

const RUNNING_DOT_COUNT = 8;
const RUNNING_DOT_CX = 8;
const RUNNING_DOT_CY = 8;
const RUNNING_DOT_RADIUS = 5.5;
const RUNNING_DOT_SIZE = 1.5;

/** Statuses that mean the task/session is actively running. */
const isTaskRunning = (status: SessionVM["status"]): boolean =>
  status === "streaming" || status === "compacting" || status === "retrying" || status === "starting";

function RunningDots() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" className="text-accent shrink-0" aria-hidden="true">
      <g>
        <animateTransform
          attributeName="transform"
          type="rotate"
          from={`0 ${RUNNING_DOT_CX} ${RUNNING_DOT_CY}`}
          to={`360 ${RUNNING_DOT_CX} ${RUNNING_DOT_CY}`}
          dur="0.9s"
          repeatCount="indefinite"
        />
        {Array.from({ length: RUNNING_DOT_COUNT }).map((_, i) => {
          const angle = (i / RUNNING_DOT_COUNT) * Math.PI * 2;
          return (
            <circle
              key={i}
              cx={RUNNING_DOT_CX + RUNNING_DOT_RADIUS * Math.cos(angle)}
              cy={RUNNING_DOT_CY + RUNNING_DOT_RADIUS * Math.sin(angle)}
              r={RUNNING_DOT_SIZE}
              fill="currentColor"
              opacity={0.35 + (i / RUNNING_DOT_COUNT) * 0.65}
            />
          );
        })}
      </g>
    </svg>
  );
}

// ── Session line ──

type ET = { type: "session" | "project"; id: string; cwd?: string } | null;

function SessionLine({
  session, isActive, onClick, onPin, onDelete,
  onContextMenu,
  editingTarget, setEditingTarget, editValue, setEditValue, commitRename,
}: {
  session: SessionVM; isActive: boolean; onClick: () => void; onPin: () => void; onDelete: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  editingTarget: ET; setEditingTarget: (t: ET) => void;
  editValue: string; setEditValue: (v: string) => void; commitRename: () => void;
}) {
  const isPinned = usePiDeskStore((s) => s.pinned.sessions.includes(session.fileId || session.id));
  const running = isTaskRunning(session.status);
  const localRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editingTarget?.type === "session" && editingTarget.id === session.id && localRef.current) {
      localRef.current.focus(); localRef.current.select();
    }
  }, [editingTarget, session.id]);

  return (
    <div onClick={onClick} onContextMenu={onContextMenu}
      className={`flex items-center gap-2 pl-5 pr-1 py-1 text-sm rounded-md cursor-pointer select-none group
        ${isActive ? "bg-sidebar-active text-gray-900 font-medium" : "text-gray-700 hover:bg-sidebar-hover"}`}>
      {running ? <RunningDots /> : <MessageSquare size={11} className="shrink-0 text-muted" />}
      {editingTarget?.type === "session" && editingTarget.id === session.id ? (
        <input ref={localRef} value={editValue}
          onChange={e => setEditValue(e.target.value)} onBlur={commitRename}
          onKeyDown={e => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditingTarget(null); }}
          onClick={e => e.stopPropagation()}
          className="flex-1 min-w-0 text-xs bg-white border border-border rounded px-1 py-0 outline-none" />
      ) : (
        <span className="truncate text-xs flex-1"
          onDoubleClick={e => { e.stopPropagation(); setEditingTarget({ type: "session", id: session.id, cwd: session.cwd }); setEditValue(session.name); }}>
          {session.name}
        </span>
      )}
      {isPinned && <Pin size={10} className="text-accent fill-accent shrink-0" />}
      <button onClick={e => { e.stopPropagation(); onPin(); }}
        className="opacity-0 group-hover:opacity-100 text-muted hover:text-gray-600 shrink-0" title={isPinned ? "Unpin" : "Pin"}>
        <Pin size={10} />
      </button>
      <button onClick={e => { e.stopPropagation(); onDelete(); }}
        className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 shrink-0" title="Delete">
        <X size={12} />
      </button>
    </div>
  );
}
