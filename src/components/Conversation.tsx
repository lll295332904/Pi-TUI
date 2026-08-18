import { useRef, useEffect, useMemo, useState } from "react";
import { usePiDeskStore } from "../store/pidesk";
import type { TimelineItem, MessageVM, ToolCallVM } from "../types";
import { imageToDataUrl } from "../bridge";
import ReactMarkdown from "react-markdown";
import { Wrench, ChevronDown, ChevronRight, Check, X, Loader } from "lucide-react";
import { useT } from "../i18n";

function normalizeAssistantMarkdown(text: string): string {
  // Keep one blank line as a paragraph separator, but collapse model-generated spacing.
  return text.replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n").trim();
}

export default function Conversation() {
  const activeId = usePiDeskStore((s) => s.activeSessionId);
  const timeline = usePiDeskStore((s) => (s.activeSessionId ? (s.sessionTimelines[s.activeSessionId] || []) : []));
  const searchQuery = usePiDeskStore((s) => s.searchQuery);
  const availableModels = usePiDeskStore((s) => s.availableModels);
  const markRequestFirstVisibleRender = usePiDeskStore((s) => s.markRequestFirstVisibleRender);
  const { t } = useT("conversation");
  const ct = useT("common");

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pinnedBottomRef = useRef(true);
  const prevLengthRef = useRef(timeline.length);
  const prevActiveIdRef = useRef(activeId);

  // 切换会话/恢复会话：重置滚动锚点，直接定位到该会话最新位置（无动画，避免长列表卡顿）
  useEffect(() => {
    if (prevActiveIdRef.current !== activeId) {
      pinnedBottomRef.current = true;
      prevLengthRef.current = timeline.length;
      prevActiveIdRef.current = activeId;
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [activeId, timeline]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prevLen = prevLengthRef.current;
    const grew = timeline.length > prevLen;
    if (grew) {
      const newItems = timeline.slice(prevLen);
      const userSent = newItems.some((item) => item.type === "user");
      if (userSent && timeline.length - prevLen <= 8) {
        // 用户刚发送新命令/消息：无论当前滚动位置如何，强制滚动到最新位置
        pinnedBottomRef.current = true;
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      } else if (userSent) {
        // 大批量载入（历史恢复等）：直接定位到底部，避免长列表 smooth 动画卡顿
        pinnedBottomRef.current = true;
        el.scrollTop = el.scrollHeight;
      } else {
        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        if (nearBottom || pinnedBottomRef.current) {
          bottomRef.current?.scrollIntoView({ behavior: "smooth" });
        }
      }
    } else if (pinnedBottomRef.current && el.scrollHeight > el.clientHeight) {
      // 流式输出内容增长（长度不变）：保持跟随最新位置
      el.scrollTop = el.scrollHeight;
    }
    prevLengthRef.current = timeline.length;
  }, [timeline]);

  const visibleTimeline = useMemo(() => {
    if (!searchQuery) return timeline;
    const q = searchQuery.toLowerCase();
    return timeline.filter((v) => {
      const text = (v as { text?: string }).text || (v as { toolName?: string }).toolName || "";
      return text.toLowerCase().includes(q);
    });
  }, [timeline, searchQuery]);

  useEffect(() => {
    if (!activeId) return;
    const hasStreamingAssistant = timeline.some((item) => item.type === "assistant" && item.streaming);
    if (hasStreamingAssistant) markRequestFirstVisibleRender(activeId);
  }, [activeId, timeline, markRequestFirstVisibleRender]);

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
      {groupTimeline(visibleTimeline).map((group, i) => (
        <ItemWrapper key={group.kind === "tools" ? `tools-${group.tools[0].toolCallId}` : getItemKey(group.item, i)}>
          {group.kind === "tools" ? <ToolActivityGroup tools={group.tools} t={t} /> : <TimelineRow item={group.item} t={t} />}
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

type TimelineGroup =
  | { kind: "item"; item: TimelineItem }
  | { kind: "tools"; tools: ToolCallVM[] };

function groupTimeline(items: TimelineItem[]): TimelineGroup[] {
  const groups: TimelineGroup[] = [];
  for (const item of items) {
    if (item.type === "tool") {
      const previous = groups[groups.length - 1];
      if (previous?.kind === "tools") previous.tools.push(item);
      else groups.push({ kind: "tools", tools: [item] });
    } else {
      groups.push({ kind: "item", item });
    }
  }
  return groups;
}

function TimelineRow({ item, t }: { item: TimelineItem; t: (k: string) => string }) {
  if (item.type === "user") return <UserBubble msg={item} />;
  if (item.type === "assistant") return <AssistantBubble msg={item} t={t} />;
  if (item.type === "tool") return <ToolCard tool={item} t={t} />;
  if (item.type === "system-info") return <SystemLine text={item.text} />;
  return null;
}

function UserBubble({ msg }: { msg: MessageVM }) {
  return (
    <div className="flex justify-end animate-fade-slide">
      <div className="max-w-[80%] bg-accent text-white rounded-lg px-3 py-2 text-sm">
        {msg.text && <p className="whitespace-pre-wrap break-words">{msg.text}</p>}
        {msg.images && msg.images.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1.5 justify-end">
            {msg.images.map((img, i) => (
              <LocalImage key={`${img.path}-${i}`} path={img.path} alt={`attachment ${i + 1}`} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Cache data URLs per image path so re-renders / re-visits don't re-read the file.
const imageDataUrlCache = new Map<string, string>();

function LocalImage({ path, alt }: { path: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(() => imageDataUrlCache.get(path) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (imageDataUrlCache.has(path)) {
      setSrc(imageDataUrlCache.get(path)!);
      return;
    }
    let cancelled = false;
    imageToDataUrl(path)
      .then((url) => {
        if (cancelled) return;
        imageDataUrlCache.set(path, url);
        setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => { cancelled = true; };
  }, [path]);

  if (failed) {
    return <span className="text-[10px] text-white/70 max-w-40 truncate" title={path}>{path.split(/[\\/]/).pop() || "image"}</span>;
  }
  if (!src) {
    return <span className="inline-block h-16 w-24 rounded bg-white/25 animate-pulse" />;
  }
  return (
    <img
      src={src}
      alt={alt}
      className="max-h-40 max-w-56 rounded object-contain border border-white/30 bg-white/10"
      draggable={false}
    />
  );
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
      <div className="assistant-markdown max-w-none text-gray-800 break-words">
        {msg.text ? (
          msg.streaming ? (
            <p className="whitespace-pre-wrap break-words streaming-cursor my-0">{msg.text}</p>
          ) : (
            <ReactMarkdown
              components={{
                h1: ({ node: _node, ...props }) => <h1 className="assistant-heading assistant-heading-1" {...props} />,
                h2: ({ node: _node, ...props }) => <h2 className="assistant-heading assistant-heading-2" {...props} />,
                h3: ({ node: _node, ...props }) => <h3 className="assistant-heading assistant-heading-3" {...props} />,
                h4: ({ node: _node, ...props }) => <h4 className="assistant-heading assistant-heading-4" {...props} />,
                p: ({ node: _node, ...props }) => <p className="assistant-paragraph" {...props} />,
                ul: ({ node: _node, ...props }) => <ul className="assistant-list assistant-list-unordered" {...props} />,
                ol: ({ node: _node, ...props }) => <ol className="assistant-list assistant-list-ordered" {...props} />,
                li: ({ node: _node, ...props }) => <li className="assistant-list-item" {...props} />,
                pre: ({ node: _node, ...props }) => <pre className="assistant-code-block" {...props} />,
                blockquote: ({ node: _node, ...props }) => <blockquote className="assistant-quote" {...props} />,
              }}
            >{normalizeAssistantMarkdown(msg.text)}</ReactMarkdown>
          )
        ) : msg.streaming ? <span className="text-muted italic">{t("thinking_")}</span> : null}
      </div>
    </div>
  );
}

function ToolActivityGroup({ tools, t }: { tools: ToolCallVM[]; t: (k: string) => string }) {
  const [expanded, setExpanded] = useState(false);
  const running = tools.filter((tool) => tool.state === "running").length;
  const errors = tools.filter((tool) => tool.isError).length;
  const latest = tools[tools.length - 1];
  const statusText = running > 0
    ? `${running} running`
    : errors > 0
      ? `${errors} failed`
      : `${tools.length} completed`;

  return (
    <div className="border border-border rounded-md bg-surface-secondary text-sm overflow-hidden">
      <button
        onClick={() => setExpanded((value) => !value)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-black/5 transition-colors"
        aria-expanded={expanded}
      >
        {running > 0 ? <Loader size={14} className="text-accent animate-spin shrink-0" /> : errors > 0 ? <X size={14} className="text-danger shrink-0" /> : <Check size={14} className="text-success shrink-0" />}
        <Wrench size={14} className="text-muted shrink-0" />
        <span className="font-medium text-gray-700">Tools</span>
        <span className="text-xs text-muted">{tools.length} calls</span>
        <span className="text-xs text-muted truncate flex-1">{latest ? `${latest.toolName} ${formatToolSummary(latest.toolName, latest.input)}` : ""}</span>
        <span className={`text-xs shrink-0 ${errors > 0 ? "text-danger" : running > 0 ? "text-accent" : "text-muted"}`}>{statusText}</span>
        {expanded ? <ChevronDown size={14} className="text-muted shrink-0" /> : <ChevronRight size={14} className="text-muted shrink-0" />}
      </button>
      {expanded && (
        <div className="border-t border-border p-2 space-y-2 max-h-64 overflow-y-auto">
          {tools.map((tool) => <ToolCard key={tool.toolCallId} tool={tool} t={t} />)}
        </div>
      )}
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
  return extractToolParam(toolName, input);
}

function formatToolInput(toolName: string, input: unknown): string {
  const inp = input as Record<string, unknown> | undefined;
  if (!inp) return JSON.stringify(input, null, 2);
  if (toolName === "edit") {
    const edits = inp.edits as Array<{ oldText: string; newText: string }> | undefined;
    return edits ? edits.map(e => `- ${e.oldText?.slice(0, 80)}\n+ ${e.newText?.slice(0, 80)}`).join("\n---\n") : JSON.stringify(inp, null, 2);
  }
  if (toolName === "bash") return (inp.command as string) ?? JSON.stringify(inp, null, 2);
  return JSON.stringify(inp, null, 2);
}

/** Extract the most salient param for a summary line. */
function extractToolParam(toolName: string, input: unknown): string {
  const inp = input as Record<string, unknown> | undefined;
  if (!inp) return "";
  switch (toolName) {
    case "bash": return (inp.command as string)?.slice(0, 60) ?? "";
    case "read": case "edit": case "write": return (inp.path as string) ?? "";
    case "grep": return (inp.pattern as string)?.slice(0, 40) ?? "";
    default: return JSON.stringify(input).slice(0, 40);
  }
}
