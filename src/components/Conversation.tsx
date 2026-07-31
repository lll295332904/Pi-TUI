import { useRef, useEffect, useMemo, useState } from "react";
import { usePiDeskStore } from "../store/pidesk";
import type { TimelineItem, MessageVM, ToolCallVM } from "../types";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import { Wrench, ChevronDown, ChevronRight, Check, X, Loader } from "lucide-react";
import { useT } from "../i18n";

export default function Conversation() {
  const activeId = usePiDeskStore((s) => s.activeSessionId);
  const timeline = usePiDeskStore((s) => (s.activeSessionId ? (s.sessionTimelines[s.activeSessionId] || []) : []));
  const searchQuery = usePiDeskStore((s) => s.searchQuery);
  const availableModels = usePiDeskStore((s) => s.availableModels);
  const { t } = useT("conversation");
  const ct = useT("common");

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pinnedBottomRef = useRef(true);
  const prevLengthRef = useRef(timeline.length);

  const visibleTimeline = useMemo(() => {
    if (!searchQuery) return timeline;
    const q = searchQuery.toLowerCase();
    return timeline.filter((v) => {
      const text = (v as { text?: string }).text || (v as { toolName?: string }).toolName || "";
      return text.toLowerCase().includes(q);
    });
  }, [timeline, searchQuery]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const grew = timeline.length > prevLengthRef.current;
    prevLengthRef.current = timeline.length;
    if (grew) {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      if (nearBottom || pinnedBottomRef.current) {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    }
  }, [timeline]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  if (!activeId) {
    return (
      <div className="flex-1 flex items-center justify-center">
        {availableModels.length === 0 ? (
          <div className="text-center space-y-3">
            <div className="text-lg">⚙️</div>
            <div className="text-sm text-muted">{ct.t("noModels")}</div>
            <div className="text-xs text-gray-400">{ct.t("noModelsHint")}</div>
            <button
              onClick={() => usePiDeskStore.getState().setSettingsOpen(true)}
              className="text-xs px-4 py-1.5 bg-accent text-white rounded-md hover:bg-accent/90 transition-colors"
            >
              {ct.t("openSettings")}
            </button>
          </div>
        ) : (
          <div className="text-sm text-muted">{ct.t("startSession")}</div>
        )}
      </div>
    );
  }

  return (
    <div ref={scrollRef} onScroll={handleScroll} onWheel={handleScroll} className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
      {searchQuery && (
        <div className="text-xs text-muted bg-gray-50 rounded px-2 py-1 mb-3">
          Search: "{searchQuery}" — {visibleTimeline.length} match{visibleTimeline.length !== 1 ? "es" : ""}
          <button onClick={() => usePiDeskStore.getState().setSearchQuery("")} className="ml-2 text-accent hover:underline">clear</button>
        </div>
      )}
      {visibleTimeline.map((item, i) => (
        <ItemWrapper key={getItemKey(item, i)}>
          <TimelineRow item={item} t={t} />
        </ItemWrapper>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

function ItemWrapper({ children }: { children: React.ReactNode }) {
  return <div className="mb-3" style={{ contentVisibility: "auto", containIntrinsicSize: "auto 120px" }}>{children}</div>;
}

function getItemKey(item: TimelineItem, idx: number): string {
  if (item.type === "tool") return `tool-${item.toolCallId}`;
  if (item.type === "system-info") return `sys-${idx}`;
  return (item as MessageVM).id;
}

function TimelineRow({ item, t }: { item: TimelineItem; t: (k: string) => string }) {
  if (item.type === "user") return <UserBubble msg={item} />;
  if (item.type === "assistant") return <AssistantBubble msg={item} t={t} />;
  if (item.type === "tool") return <ToolCard tool={item} t={t} />;
  if (item.type === "system-info") return <SystemLine text={item.text} />;
  return null;
}

function UserBubble({ msg }: { msg: MessageVM }) {
  return <div className="flex justify-end animate-fade-slide"><div className="max-w-[80%] bg-accent text-white rounded-lg px-3 py-2 text-sm"><p className="whitespace-pre-wrap break-words">{msg.text}</p></div></div>;
}

function AssistantBubble({ msg, t }: { msg: MessageVM; t: (k: string) => string }) {
  const [showThinking, setShowThinking] = useState(false);
  return (
    <div className="animate-fade-slide">
      {!!msg.thinking && (
        <div className="mb-2">
          <button onClick={() => setShowThinking(!showThinking)} className="flex items-center gap-1 text-xs text-muted hover:text-gray-600 transition-colors">
            {showThinking ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span>{t("thinking")}</span>
          </button>
          {showThinking && (
            <div className="mt-1 ml-4 pl-3 border-l-2 border-border text-xs text-muted bg-gray-50 rounded-r-md p-2 max-h-48 overflow-y-auto">
              <p className="whitespace-pre-wrap break-words">{msg.thinking}</p>
            </div>
          )}
        </div>
      )}
      <div className="prose prose-sm max-w-none text-gray-800 whitespace-pre-wrap break-words">
        {msg.text ? <span className={msg.streaming ? "streaming-cursor" : ""}><ReactMarkdown remarkPlugins={[remarkBreaks]}>{msg.text}</ReactMarkdown></span>
        : msg.streaming ? <span className="text-muted italic">{t("thinking_")}</span> : null}
      </div>
    </div>
  );
}

function ToolCard({ tool, t }: { tool: ToolCallVM; t: (k: string) => string }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = tool.state === "running";
  return (
    <div className={`animate-fade-slide border rounded-md overflow-hidden text-sm ${tool.isError ? "border-danger bg-red-50" : "border-border bg-surface-secondary"}`}>
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-black/5 transition-colors">
        {isRunning ? <Loader size={14} className="text-accent animate-spin shrink-0" /> : tool.isError ? <X size={14} className="text-danger shrink-0" /> : <Check size={14} className="text-success shrink-0" />}
        <Wrench size={14} className="text-muted shrink-0" />
        <span className="font-medium text-gray-700">{tool.toolName}</span>
        <span className="text-muted truncate flex-1 text-xs">{formatToolSummary(tool.toolName, tool.input)}</span>
        {expanded ? <ChevronDown size={14} className="text-muted shrink-0" /> : <ChevronRight size={14} className="text-muted shrink-0" />}
      </button>
      {expanded && (
        <div className="px-3 py-2 border-t border-border bg-white">
          <div className="text-xs text-muted mb-1 font-medium">{t("input")}</div>
          <pre className="text-xs font-mono bg-gray-100 rounded p-2 overflow-x-auto whitespace-pre-wrap">{formatToolInput(tool.toolName, tool.input)}</pre>
          {tool.output && (<><div className="text-xs text-muted mt-2 mb-1 font-medium">{t("output")}</div><pre className={`text-xs font-mono rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-48 ${tool.isError ? "bg-red-50 text-red-800" : "bg-gray-900 text-green-400"}`}>{tool.output}</pre></>)}
          {tool.state === "done" && tool.result !== undefined && !tool.output && (<><div className="text-xs text-muted mt-2 mb-1 font-medium">{t("result")}</div><pre className="text-xs font-mono bg-gray-100 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-48">{JSON.stringify(tool.result, null, 2)}</pre></>)}
        </div>
      )}
    </div>
  );
}

function SystemLine({ text }: { text: string }) {
  return <div className="flex items-center gap-3 py-1"><div className="flex-1 border-t border-border" /><span className="text-xs text-muted shrink-0">{text}</span><div className="flex-1 border-t border-border" /></div>;
}

function formatToolSummary(toolName: string, input: unknown): string {
  const inp = input as Record<string, unknown> | undefined;
  if (!inp) return "";
  switch (toolName) {
    case "bash": return (inp.command as string)?.slice(0, 60) ?? "";
    case "read": case "edit": case "write": return (inp.path as string) ?? "";
    case "grep": return (inp.pattern as string)?.slice(0, 40) ?? "";
    default: return JSON.stringify(input).slice(0, 40);
  }
}

function formatToolInput(toolName: string, input: unknown): string {
  const inp = input as Record<string, unknown> | undefined;
  if (!inp) return JSON.stringify(input, null, 2);
  switch (toolName) {
    case "bash": return (inp.command as string) ?? JSON.stringify(inp, null, 2);
    case "edit": { const edits = inp.edits as Array<{ oldText: string; newText: string }> | undefined; return edits ? edits.map(e => `- ${e.oldText?.slice(0, 80)}\n+ ${e.newText?.slice(0, 80)}`).join("\n---\n") : JSON.stringify(inp, null, 2); }
    default: return JSON.stringify(inp, null, 2);
  }
}
