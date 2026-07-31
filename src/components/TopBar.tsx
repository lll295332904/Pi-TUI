import { useState, useRef, useEffect } from "react";
import { usePiDeskStore } from "../store/pidesk";
import type { AvailableModel } from "../types";
import { Settings, PanelRight, Shrink, Terminal, ChevronDown } from "lucide-react";
import { ROLE_LABELS, DISCONNECTED_ROLES } from "../types";

const THINKING_OPTIONS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

interface Props {
  onChangeModel: (provider: string, modelId: string) => void;
  onChangeThinking: (level: string) => void;
}

export default function TopBar({ onChangeModel, onChangeThinking }: Props) {
  const activeId = usePiDeskStore((s) => s.activeSessionId);
  const sessions = usePiDeskStore((s) => s.sessions);
  const setSettingsOpen = usePiDeskStore((s) => s.setSettingsOpen);
  const inspectorOpen = usePiDeskStore((s) => s.inspectorOpen);
  const setInspectorOpen = usePiDeskStore((s) => s.setInspectorOpen);
  const consoleOpen = usePiDeskStore((s) => s.consoleOpen);
  const setConsoleOpen = usePiDeskStore((s) => s.setConsoleOpen);
  const currentRole = usePiDeskStore((s) => (s.activeSessionId && s.sessionRoles[s.activeSessionId]) || s.globalRole);
  const availableModels = usePiDeskStore((s) => s.availableModels);

  const session = activeId ? sessions[activeId] : null;

  const [modelOpen, setModelOpen] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const modelRef = useRef<HTMLDivElement>(null);
  const thinkingRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) setModelOpen(false);
      if (thinkingRef.current && !thinkingRef.current.contains(e.target as Node)) setThinkingOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const currentModel = session?.model;
  const currentThinking = session?.thinkingLevel;

  return (
    <div className="h-9 flex items-center px-3 border-b border-border bg-surface-secondary select-none shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-semibold text-sm text-gray-800 truncate">
          {session?.name ?? "PiDesk"}
        </span>
        {session && (
          <span className="text-xs text-muted truncate hidden sm:block">
            {session.cwd}
          </span>
        )}
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-3">
        {/* Current role */}
        {currentRole && currentRole !== "main" && (
          <span className={`inline-flex items-center gap-1 text-xs font-medium ${
            DISCONNECTED_ROLES.has(currentRole as keyof typeof ROLE_LABELS) ? "text-gray-400" : "text-accent"
          }`}>
            {(ROLE_LABELS as Record<string, string>)[currentRole] || currentRole}
          </span>
        )}

        {/* Model selector */}
        {session && (availableModels.length > 0 ? (
          <div ref={modelRef} className="relative">
            <button
              onClick={() => { setModelOpen(!modelOpen); setThinkingOpen(false); }}
              className="flex items-center gap-1 text-xs text-muted hover:text-gray-700 transition-colors bg-gray-100 hover:bg-gray-200 rounded px-1.5 py-0.5"
            >
              {currentModel ? currentModel.id : "Auto"}
              <ChevronDown size={10} className={modelOpen ? "rotate-180" : ""} />
            </button>
            {modelOpen && (
              <div className="absolute right-0 top-full mt-1 z-40 w-52 bg-white border border-border rounded-lg shadow-xl text-xs max-h-60 overflow-y-auto">
                <button
                  onClick={() => { onChangeModel("", ""); setModelOpen(false); }}
                  className={`w-full text-left px-3 py-1.5 hover:bg-sidebar-hover flex items-center justify-between ${
                    !currentModel ? "bg-accent/10 text-accent font-medium" : ""
                  }`}>
                  <span>Auto</span>
                  <span className="text-[10px] text-muted">role-based</span>
                </button>
                {availableModels.map((m: AvailableModel) => (
                  <button
                    key={`${m.provider}::${m.id}`}
                    onClick={() => { onChangeModel(m.provider, m.id); setModelOpen(false); }}
                    className={`w-full text-left px-3 py-1.5 hover:bg-sidebar-hover flex items-center justify-between ${
                      currentModel?.provider === m.provider && currentModel?.id === m.id ? "bg-accent/10 text-accent font-medium" : ""
                    }`}
                  >
                    <span>{m.name}</span>
                    <span className="text-[10px] text-muted">{m.provider}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (currentModel ? (
          <span className="flex items-center gap-1 text-xs text-muted">
            {currentModel.provider}/{currentModel.id}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-muted">Auto</span>
        )))}

        {/* Thinking selector */}
        {session && (
          <div ref={thinkingRef} className="relative">
            <button
              onClick={() => { setThinkingOpen(!thinkingOpen); setModelOpen(false); }}
              className="flex items-center gap-1 text-xs text-muted hover:text-gray-700 transition-colors bg-gray-100 hover:bg-gray-200 rounded px-1.5 py-0.5"
            >
              {currentThinking || "quick"}
              <ChevronDown size={10} className={thinkingOpen ? "rotate-180" : ""} />
            </button>
            {thinkingOpen && (
              <div className="absolute right-0 top-full mt-1 z-40 w-28 bg-white border border-border rounded-lg shadow-xl text-xs">
                {THINKING_OPTIONS.map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => {
                      onChangeThinking(lvl);
                      setThinkingOpen(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 hover:bg-sidebar-hover ${
                      currentThinking === lvl ? "bg-accent/10 text-accent font-medium" : ""
                    }`}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Status indicator */}
        {session?.status && (
          <span className={`inline-flex items-center gap-1 text-xs ${
            session.status === "streaming" ? "text-accent" :
            session.status === "compacting" ? "text-warning" : "text-muted"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${
              session.status === "streaming" ? "bg-accent animate-pulse" :
              session.status === "compacting" ? "bg-warning" : "bg-gray-400"
            }`} />
            {session.status === "streaming" ? "Running" :
             session.status === "compacting" ? "Compacting" : "Idle"}
          </span>
        )}
        {/* Compaction */}
        {session?.status !== "idle" && (
          <button className="text-gray-400 hover:text-warning transition-colors" title="Trigger compaction">
            <Shrink size={14} />
          </button>
        )}
        {/* Inspector */}
        <button onClick={() => setInspectorOpen(!inspectorOpen)}
          className={`transition-colors ${inspectorOpen ? "text-accent" : "text-gray-500 hover:text-gray-700"}`}
          title="Inspector">
          <PanelRight size={15} />
        </button>
        {/* Console */}
        <button onClick={() => setConsoleOpen(!consoleOpen)}
          className={`transition-colors ${consoleOpen ? "text-accent" : "text-gray-500 hover:text-gray-700"}`}
          title="Console">
          <Terminal size={15} />
        </button>
        {/* Settings */}
        <button onClick={() => setSettingsOpen(true)}
          className="text-gray-500 hover:text-gray-700 transition-colors" title="Settings">
          <Settings size={15} />
        </button>
      </div>
    </div>
  );
}
