import { usePiDeskStore } from "../store/pidesk";
import { ROLE_LABELS } from "../types";
import { useT } from "../i18n";

export default function StatusBar() {
  const activeId = usePiDeskStore((s) => s.activeSessionId);
  const sessions = usePiDeskStore((s) => s.sessions);
  const sessionTimelines = usePiDeskStore((s) => s.sessionTimelines);
  const settings = usePiDeskStore((s) => s.settings);
  const sessionRoles = usePiDeskStore((s) => s.sessionRoles);
  const pendingQueues = usePiDeskStore((s) => s.pendingQueues);
  const { t } = useT("statusbar");

  const session = activeId ? sessions[activeId] : null;
  const timeline = activeId ? (sessionTimelines[activeId] || []) : [];
  const currentRole = sessionRoles[activeId || ""] || "main";

  if (!session) {
    return (
      <div className="h-6 flex items-center px-3 border-t border-border bg-surface-secondary text-xs text-muted shrink-0">
        PiDesk — Tauri Desktop UI for Pi Agent
      </div>
    );
  }

  const msgCount = timeline.filter((v) => v.type !== "system-info").length;

  return (
    <div className="h-6 flex items-center px-3 border-t border-border bg-surface-secondary text-xs text-muted shrink-0 gap-4">
      <span>{t("status")}: {t(session.status)}</span>
      <span>{t("messages")}: {msgCount}</span>
      <span>{t("role")}: {(ROLE_LABELS as Record<string, string>)[currentRole] || currentRole}</span>
      {(() => { const n = (pendingQueues[activeId ?? ""] || []).length; return n > 0 ? <span className="text-amber-500 font-medium">{t("queued")}: {n}</span> : null; })()}
      {session.model && (
        <span className="hidden sm:inline">
          {t("model")}: {session.model.provider}/{session.model.id}
        </span>
      )}
      {session.thinkingLevel && (
        <span>{t("thinkingLevel")}: {session.thinkingLevel}</span>
      )}
      <span className="flex-1" />
      <span className="hidden sm:inline">
        {t("autoCompaction")}: {settings.autoCompaction ? t("on") : t("off")}
        {" | "}
        {t("autoRetry")}: {settings.autoRetry ? t("on") : t("off")}
      </span>
    </div>
  );
}
