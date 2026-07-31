import { useEffect, useRef } from "react";
import { X, Terminal, Trash2 } from "lucide-react";
import { usePiDeskStore } from "../store/pidesk";

export default function ConsolePanel() {
  const consoleOpen = usePiDeskStore((s) => s.consoleOpen);
  const setConsoleOpen = usePiDeskStore((s) => s.setConsoleOpen);
  const activeId = usePiDeskStore((s) => s.activeSessionId);
  const consoleLogs = usePiDeskStore((s) => s.consoleLogs);
  const scrollRef = useRef<HTMLDivElement>(null);

  const lines = activeId && consoleLogs ? (consoleLogs[activeId] || []) : [];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines.length]);

  if (!consoleOpen) return null;

  const handleClear = () => {
    if (!activeId) return;
    const s = usePiDeskStore.getState();
    usePiDeskStore.setState({
      consoleLogs: { ...s.consoleLogs, [activeId]: [] },
    });
  };

  return (
    <div className="shrink-0" style={{ padding: "10px", paddingTop: "0px", background: "#e5e7eb" }}>
      <div className="flex flex-col rounded-lg overflow-hidden border-2 border-gray-400 shadow-inner" style={{ height: "200px" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 select-none">
          <div className="flex items-center gap-2 text-xs">
            <Terminal size={12} className="text-gray-400" />
            <span className="text-gray-300 font-medium">Console</span>
            <span className="text-gray-500">{lines.length} events</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleClear} className="text-gray-500 hover:text-gray-300" title="Clear">
              <Trash2 size={12} />
            </button>
            <button onClick={() => setConsoleOpen(false)} className="text-gray-500 hover:text-gray-300">
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Log output */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-1.5 bg-gray-900 font-mono text-xs leading-relaxed">
          {lines.length === 0 ? (
            <div className="text-gray-600 italic py-2 text-center">No events yet. Pi output will appear here.</div>
          ) : (
            lines.map((line, i) => {
              let display = line;
              let color = "text-gray-400";
              try {
                const parsed = JSON.parse(line);
                const type = parsed.type || "";
                display = JSON.stringify(parsed, null, 0);
                if (type === "assistant" || type === "stream_chunk") color = "text-green-400";
                else if (type === "tool_use" || type === "tool_result") color = "text-blue-400";
                else if (type === "error") color = "text-red-400";
                else if (type === "agent_compacting") color = "text-yellow-400";
                else if (type === "mcp") color = "text-purple-400";
                else color = "text-gray-400";
              } catch {
                color = "text-gray-500";
              }

              return (
                <div key={i} className={`${color} break-all hover:bg-gray-800/50 px-1 rounded`}>
                  {display}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
