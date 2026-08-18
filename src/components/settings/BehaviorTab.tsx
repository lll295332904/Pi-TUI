import { useCallback } from "react";
import { usePiDeskStore } from "../../store/pidesk";
import { setAutoCompaction, setAutoRetry, setSteeringMode, setFollowUpMode } from "../../bridge";
import { useT } from "../../i18n";

interface Props {
  activeId: string | null;
}

export default function BehaviorTab({ activeId }: Props) {
  const settings = usePiDeskStore((s) => s.settings);
  const setSettings = usePiDeskStore((s) => s.setSettings);
  const { t: st } = useT("settings");

  const handleAutoCompaction = useCallback(async (enabled: boolean) => {
    setSettings({ autoCompaction: enabled });
    if (activeId) {
      try { await setAutoCompaction(activeId, enabled); } catch (e) { console.error(e); }
    }
  }, [setSettings, activeId]);

  const handleAutoRetry = useCallback(async (enabled: boolean) => {
    setSettings({ autoRetry: enabled });
    if (activeId) {
      try { await setAutoRetry(activeId, enabled); } catch (e) { console.error(e); }
    }
  }, [setSettings, activeId]);

  const handleSteeringMode = useCallback(async (mode: "all" | "one-at-a-time") => {
    setSettings({ steeringMode: mode });
    if (activeId) {
      try { await setSteeringMode(activeId, mode); } catch (e) { console.error(e); }
    }
  }, [setSettings, activeId]);

  const handleFollowUpMode = useCallback(async (mode: "all" | "one-at-a-time") => {
    setSettings({ followUpMode: mode });
    if (activeId) {
      try { await setFollowUpMode(activeId, mode); } catch (e) { console.error(e); }
    }
  }, [setSettings, activeId]);

  const handleQueueWhileRunning = useCallback((enabled: boolean) => {
    setSettings({ queueWhileRunning: enabled });
  }, [setSettings]);

  return (
    <div className="space-y-4">
      <ToggleRow
        label="Auto-Compaction"
        description="Automatically compact context when it grows too large"
        checked={settings.autoCompaction}
        onChange={handleAutoCompaction}
      />
      <ToggleRow
        label="Auto-Retry"
        description="Automatically retry on transient failures"
        checked={settings.autoRetry}
        onChange={handleAutoRetry}
      />
      <ToggleRow
        label={st("queueWhileRunning")}
        description="While a task is running, sent messages wait in a queue and are sent automatically when it finishes (instead of steering the agent mid-turn)"
        checked={settings.queueWhileRunning}
        onChange={handleQueueWhileRunning}
      />

      <div className="border-t border-border pt-3">
        <label className="block text-xs font-medium text-gray-600 mb-1.5">Steering Mode</label>
        <div className="flex gap-2">
          {(["all", "one-at-a-time"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => handleSteeringMode(mode)}
              className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                settings.steeringMode === mode
                  ? "bg-accent text-white border-accent"
                  : "bg-white text-gray-600 border-border hover:bg-gray-50"
              }`}
            >
              {mode === "all" ? st("parallel") : st("sequential")}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted mt-1">How multiple steering messages are processed</p>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">Follow-Up Mode</label>
        <div className="flex gap-2">
          {(["all", "one-at-a-time"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => handleFollowUpMode(mode)}
              className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                settings.followUpMode === mode
                  ? "bg-accent text-white border-accent"
                  : "bg-white text-gray-600 border-border hover:bg-gray-50"
              }`}
            >
              {mode === "all" ? st("parallel") : st("sequential")}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted mt-1">How multiple follow-up messages are processed</p>
      </div>
    </div>
  );
}

export function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="text-sm font-medium text-gray-700">{label}</div>
        <div className="text-xs text-muted">{description}</div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-10 h-5 rounded-full transition-colors ${
          checked ? "bg-accent" : "bg-gray-300"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
            checked ? "translate-x-5" : ""
          }`}
        />
      </button>
    </div>
  );
}
