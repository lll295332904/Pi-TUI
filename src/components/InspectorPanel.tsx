import { useMemo } from "react";
import { X, Clock, FolderOpen, Activity, Wrench, Cpu } from "lucide-react";
import { usePiDeskStore } from "../store/pidesk";
import type { TimelineItem } from "../types";
import { useT } from "../i18n";

// 行业平均上限：输入 token 不应超过输出的 N 倍，否则说明上下文过臃肿 / 产出偏低。
// 编码类 Agent 健康区间通常为 2:1 ~ 5:1，超过此上限标红提示调优。
const IO_RATIO_UPPER_LIMIT = 10;

const ROLE_LABELS_I18N: Record<string, string> = {
  main: "lblMain",
  vision: "lblVision",
  web: "lblWeb",
  compression: "lblCompression",
  skills: "lblSkills",
  approval: "lblApproval",
  title: "lblTitle",
  maintenance: "lblMaintenance",
  mcp: "lblMcp",
  subAgent: "lblSubAgent",
};

export default function InspectorPanel() {
  // ALL hooks must come before any early return (Rules of Hooks)
  const { t } = useT("inspector");
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

  // I/O 比例（输入 / 输出）。outputTokens 为 0 时无法计算，显示占位符避免除零。
  const ioRatio = usage.outputTokens > 0 ? usage.inputTokens / usage.outputTokens : null;
  const ratioExceeded = ioRatio !== null && ioRatio > IO_RATIO_UPPER_LIMIT;

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

  // 角色描述文本（跟随语言切换）
  const roleDesc =
    currentRole === "subAgent" ? t("roleSubAgent") :
    currentRole === "vision" ? t("roleVision") :
    currentRole === "compression" ? t("roleCompression") :
    currentRole === "web" ? t("roleWeb") :
    currentRole && currentRole !== "main" ? `${t("role")}: ${t(ROLE_LABELS_I18N[currentRole] || "lblMain")}` :
    t("roleMain");

  const roleLabel = currentRole ? (t(ROLE_LABELS_I18N[currentRole as string] || "lblMain")) : t("lblMain");

  // Only early return after ALL hooks
  if (!inspectorOpen || !activeId) return null;

  return (
    <div className="w-60 border-l border-border bg-white flex flex-col shrink-0 overflow-y-auto">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold text-gray-700">{t("title")}</span>
        <button onClick={() => setInspectorOpen(false)} className="text-muted hover:text-gray-700">
          <X size={14} />
        </button>
      </div>

      <div className="px-3 py-2 space-y-3 text-xs">
        {session && (
          <section>
            <div className="text-[10px] text-muted font-medium mb-1 uppercase flex items-center gap-1">
              <FolderOpen size={10} /> {t("session")}
            </div>
            <div className="space-y-1 bg-gray-50 rounded p-1.5">
              <div className="flex justify-between"><span className="text-muted">{t("name")}</span><span className="text-gray-700 truncate max-w-[130px]">{session.name}</span></div>
              <div className="flex justify-between"><span className="text-muted">{t("status")}</span><span className={session.status === "streaming" ? "text-green-600" : "text-muted"}>{session.status}</span></div>
              <div className="flex justify-between"><span className="text-muted">{t("cwdAbbr")}</span><span className="text-gray-700 truncate max-w-[130px]" title={session.cwd}>{session.cwd.split("\\").pop()}</span></div>
              {session.model && (<div className="flex justify-between"><span className="text-muted">{t("model")}</span><span className="text-gray-700">{session.model.id}</span></div>)}
              <div className="flex justify-between"><span className="text-muted">{t("thinking")}</span><span className="text-gray-700">{session.thinkingLevel}</span></div>
            </div>
          </section>
        )}

        <section>
          <div className="text-[10px] text-muted font-medium mb-1 uppercase flex items-center gap-1"><Activity size={10} /> {t("tokens")}</div>
          <div className="space-y-1 bg-gray-50 rounded p-1.5">
            <div className="flex justify-between"><span className="text-muted">{t("inputTokens")}</span><span className="text-gray-700">{usage.inputTokens.toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-muted">{t("outputTokens")}</span><span className="text-gray-700">{usage.outputTokens.toLocaleString()}</span></div>
            <div className="flex justify-between border-t border-gray-200 pt-0.5 mt-0.5"><span className="text-muted font-medium">{t("totalTokens")}</span><span className="text-gray-700 font-medium">{(usage.inputTokens + usage.outputTokens).toLocaleString()}</span></div>
            <div className="flex justify-between border-t border-gray-200 pt-0.5 mt-0.5">
              <span className="text-muted font-medium">{t("ioRatio")}</span>
              <span className={`font-medium ${ratioExceeded ? "text-red-600" : "text-gray-700"}`}>{ioRatio === null ? "—" : `${ioRatio.toFixed(1)} : 1`}</span>
            </div>
            {ratioExceeded && (
              <div className="text-[10px] text-red-500">{t("ioRatioExceeded", { limit: String(IO_RATIO_UPPER_LIMIT) })}</div>
            )}
          </div>
        </section>

        {/* Sub-Agent */}
        <section>
          <div className="text-[10px] text-muted font-medium mb-1 uppercase flex items-center gap-1"><Cpu size={10} /> {t("agent")}</div>
          <div className="space-y-1 bg-gray-50 rounded p-1.5">
            <div className="flex justify-between">
              <span className="text-muted">{t("role")}</span>
              <span className={`text-gray-700 font-medium ${currentRole && currentRole !== "main" ? "text-accent" : ""}`}>
                {roleLabel}
              </span>
            </div>
            <div className="text-[10px] text-muted">
              {roleDesc}
            </div>
          </div>
        </section>

        <section>
          <div className="text-[10px] text-muted font-medium mb-1 uppercase flex items-center gap-1"><Activity size={10} /> {t("activity")}</div>
          <div className="space-y-1 bg-gray-50 rounded p-1.5">
            <div className="flex justify-between"><span className="text-muted">{t("messages")}</span><span className="text-gray-700">{msgCounts.user + msgCounts.assistant}</span></div>
            <div className="flex justify-between"><span className="text-muted">{t("toolCalls")}</span><span className="text-gray-700">{msgCounts.tool}</span></div>
            <div className="flex justify-between"><span className="text-muted">{t("totalItems")}</span><span className="text-gray-700 font-medium">{timeline.length}</span></div>
          </div>
        </section>

        {toolCounts.length > 0 && (
          <section>
            <div className="text-[10px] text-muted font-medium mb-1 uppercase flex items-center gap-1"><Wrench size={10} /> {t("tools")} ({toolCalls.length})</div>
            <div className="space-y-1 bg-gray-50 rounded p-1.5">
              {toolCounts.slice(0, 10).map(([tool, count]) => (
                <div key={tool} className="flex justify-between"><span className="text-gray-700 font-mono">{tool}</span><span className="text-muted">{count}x</span></div>
              ))}
            </div>
          </section>
        )}

        {toolCalls.length > 0 && (
          <section>
            <div className="text-[10px] text-muted font-medium mb-1 uppercase flex items-center gap-1"><Clock size={10} /> {t("recent")}</div>
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
