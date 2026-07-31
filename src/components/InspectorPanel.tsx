import { useMemo } from "react";
import { X, Clock, FolderOpen, Activity, Wrench, Cpu } from "lucide-react";
import { usePiDeskStore } from "../store/pidesk";
import type { TimelineItem } from "../types";
import { ROLE_LABELS } from "../types";

export default function InspectorPanel() {
  // ALL hooks must come before any early return (Rules of Hooks)
  const inspectorOpen = usePiDeskStore((s) => s.inspectorOpen);
  const setInspectorOpen = usePiDeskStore((s) => s.setInspectorOpen);
  const activeId = usePiDeskStore((s) => s.activeSessionId);
  const sessions = usePiDeskStore((s) => s.sessions);
  const timelines = usePiDeskStore((s) => s.sessionTimelines);
  const sessionUsage = usePiDeskStore((s) => s.sessionUsage);
  const currentRole = usePiDeskStore((s) => (s.activeSessionId && s.sessionRoles[s.activeSessionId]) || s.globalRole);

  const session = activeId ? sessions[activeId] : null;
  const timeline = activeId ? (timelines[activeId] || []) : [];
  const usage = activeId ? (sessionUsage[activeId] || { inputTokens: 0, outputTokens: 0 }) : { inputTokens: 0, outputTokens: 0 };

  const toolCalls = useMemo(() => {
    return timeline
      .filter((t: TimelineItem): t is TimelineItem & { type: "tool" } => t.type === "tool")
      .map((t) => ({
        tool: t.toolName || "unknown",
        input: t.input,
        result: t.result,
        timestamp: t.timestamp,
        isError: t.isError,
      }));
  }, [timeline]);

  const toolCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const tc of toolCalls) counts[tc.tool] = (counts[tc.tool] || 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [toolCalls]);

  const msgCounts = useMemo(() => {
    const counts = { user: 0, assistant: 0, tool: 0, system: 0 };
    for (const t of timeline) {
      if (t.type === "user") counts.user++;
      else if (t.type === "assistant") counts.assistant++;
      else if (t.type === "tool") counts.tool++;
      else counts.system++;
    }
    return counts;
  }, [timeline]);

  // Only early return after ALL hooks
  if (!inspectorOpen || !activeId) return null;

  return (
    <div className="w-60 border-l border-border bg-white flex flex-col shrink-0 overflow-y-auto">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold text-gray-700">Inspector</span>
        <button onClick={() => setInspectorOpen(false)} className="text-muted hover:text-gray-700">
          <X size={14} />
        </button>
      </div>

      <div className="px-3 py-2 space-y-3 text-xs">
        {session && (
          <section>
            <div className="text-[10px] text-muted font-medium mb-1 flex items-center gap-1">
              <FolderOpen size={10} /> SESSION
            </div>
            <div className="space-y-1 bg-gray-50 rounded p-1.5">
              <div className="flex justify-between"><span className="text-muted">Name</span><span className="text-gray-700 truncate max-w-[130px]">{session.name}</span></div>
              <div className="flex justify-between"><span className="text-muted">Status</span><span className={session.status === "streaming" ? "text-green-600" : "text-muted"}>{session.status}</span></div>
              <div className="flex justify-between"><span className="text-muted">CWD</span><span className="text-gray-700 truncate max-w-[130px]" title={session.cwd}>{session.cwd.split("\\").pop()}</span></div>
              {session.model && (<div className="flex justify-between"><span className="text-muted">Model</span><span className="text-gray-700">{session.model.id}</span></div>)}
              <div className="flex justify-between"><span className="text-muted">Thinking</span><span className="text-gray-700">{session.thinkingLevel}</span></div>
            </div>
          </section>
        )}

        <section>
          <div className="text-[10px] text-muted font-medium mb-1 flex items-center gap-1"><Activity size={10} /> TOKENS</div>
          <div className="space-y-1 bg-gray-50 rounded p-1.5">
            <div className="flex justify-between"><span className="text-muted">Input</span><span className="text-gray-700">{usage.inputTokens.toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-muted">Output</span><span className="text-gray-700">{usage.outputTokens.toLocaleString()}</span></div>
            <div className="flex justify-between border-t border-gray-200 pt-0.5 mt-0.5"><span className="text-muted font-medium">Total</span><span className="text-gray-700 font-medium">{(usage.inputTokens + usage.outputTokens).toLocaleString()}</span></div>
          </div>
        </section>

        {/* Sub-Agent */}
        <section>
          <div className="text-[10px] text-muted font-medium mb-1 flex items-center gap-1"><Cpu size={10} /> AGENT</div>
          <div className="space-y-1 bg-gray-50 rounded p-1.5">
            <div className="flex justify-between">
              <span className="text-muted">Role</span>
              <span className={`text-gray-700 font-medium ${currentRole && currentRole !== "main" ? "text-accent" : ""}`}>
                {currentRole ? (ROLE_LABELS as Record<string, string>)[currentRole] || currentRole : "main"}
              </span>
            </div>
            <div className="text-[10px] text-muted">
              {currentRole === "subAgent" ? "Running sub-agent for complex task" :
               currentRole === "vision" ? "Processing image with vision model" :
               currentRole === "compression" ? "Compacting context" :
               currentRole === "web" ? "Searching the web" :
               currentRole && currentRole !== "main" ? `Role: ${(ROLE_LABELS as Record<string, string>)[currentRole] || currentRole}` :
               "Main agent (handles conversation, uses tools)"}
            </div>
          </div>
        </section>

        <section>
          <div className="text-[10px] text-muted font-medium mb-1 flex items-center gap-1"><Activity size={10} /> ACTIVITY</div>
          <div className="space-y-1 bg-gray-50 rounded p-1.5">
            <div className="flex justify-between"><span className="text-muted">Messages</span><span className="text-gray-700">{msgCounts.user + msgCounts.assistant}</span></div>
            <div className="flex justify-between"><span className="text-muted">Tool calls</span><span className="text-gray-700">{msgCounts.tool}</span></div>
            <div className="flex justify-between"><span className="text-muted">Total items</span><span className="text-gray-700 font-medium">{timeline.length}</span></div>
          </div>
        </section>

        {toolCounts.length > 0 && (
          <section>
            <div className="text-[10px] text-muted font-medium mb-1 flex items-center gap-1"><Wrench size={10} /> TOOLS ({toolCalls.length})</div>
            <div className="space-y-1 bg-gray-50 rounded p-1.5">
              {toolCounts.slice(0, 10).map(([tool, count]) => (
                <div key={tool} className="flex justify-between"><span className="text-gray-700 font-mono">{tool}</span><span className="text-muted">{count}x</span></div>
              ))}
            </div>
          </section>
        )}

        {toolCalls.length > 0 && (
          <section>
            <div className="text-[10px] text-muted font-medium mb-1 flex items-center gap-1"><Clock size={10} /> RECENT</div>
            <div className="space-y-1 max-h-[200px] overflow-y-auto">
              {toolCalls.slice(-8).reverse().map((tc, i) => (
                <div key={i} className={`rounded p-1.5 ${tc.isError ? "bg-red-50" : "bg-gray-50"}`}>
                  <div className="flex items-center gap-1">
                    <span className={`text-[10px] font-medium font-mono ${tc.isError ? "text-red-600" : "text-accent"}`}>{tc.tool}</span>
                    <span className="text-[10px] text-muted ml-auto">{new Date(tc.timestamp).toLocaleTimeString()}</span>
                  </div>
                  {tc.input != null && (
                    <pre className="text-[10px] text-gray-500 mt-0.5 truncate font-mono">
                      {typeof tc.input === "string" ? tc.input.slice(0, 60) : String(JSON.stringify(tc.input)).slice(0, 60)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
