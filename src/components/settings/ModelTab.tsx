import { useState, useEffect, useCallback } from "react";
import { usePiDeskStore } from "../../store/pidesk";
import { getThinkingLevels, setThinkingLevel, removeModel } from "../../bridge";
import { switchModel } from "../../model-switch";
import type { AvailableModel, ThinkingLevel } from "../../types";
import { THINKING_LEVELS } from "../../types";
import { useT } from "../../i18n";
import { X } from "lucide-react";

interface Props {
  activeId: string | null;
  onModelsChanged: () => void;
}

export default function ModelTab({ activeId, onModelsChanged }: Props) {
  const settings = usePiDeskStore((s) => s.settings);
  const setSettings = usePiDeskStore((s) => s.setSettings);
  const availableModels = usePiDeskStore((s) => s.availableModels);
  const updateSessionThinkingLevel = usePiDeskStore((s) => s.updateSessionThinkingLevel);
  const setRoleModel = usePiDeskStore((s) => s.setRoleModel);
  const sessions = usePiDeskStore((s) => s.sessions);
  const { t: st } = useT("settings");

  const session = activeId ? sessions[activeId] : null;
  const [thinkingLevels, setThinkingLevels] = useState<string[]>([...THINKING_LEVELS]);

  // Load thinking levels when default model changes
  useEffect(() => {
    if (settings.defaultModel) {
      getThinkingLevels(settings.defaultModel.provider, settings.defaultModel.id)
        .then(setThinkingLevels)
        .catch(() => setThinkingLevels([...THINKING_LEVELS]));
    } else {
      setThinkingLevels([...THINKING_LEVELS]);
    }
  }, [settings.defaultModel]);

  const handleModelChange = useCallback(async (provider: string, modelId: string) => {
    setSettings({ defaultModel: { provider, id: modelId } });
    const levels = await getThinkingLevels(provider, modelId);
    setThinkingLevels(levels);
    if (!levels.includes(settings.defaultThinkingLevel) && levels.length > 0) {
      setSettings({ defaultThinkingLevel: levels[0] as ThinkingLevel });
    }
    if (activeId) {
      await switchModel(activeId, provider, modelId);
    }
  }, [setSettings, settings.defaultThinkingLevel, activeId]);

  const handleThinkingLevelChange = useCallback(async (level: string) => {
    setSettings({ defaultThinkingLevel: level as ThinkingLevel });
    if (activeId) {
      try {
        await setThinkingLevel(activeId, level as ThinkingLevel);
        updateSessionThinkingLevel(activeId, level);
      } catch (e) { console.error("Failed to set thinking level:", e); }
    }
  }, [setSettings, activeId, updateSessionThinkingLevel]);

  const selectedModelKey = settings.defaultModel
    ? `${settings.defaultModel.provider}::${settings.defaultModel.id}`
    : "";

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">{st("defaultModel")}</label>
        <select
          value={selectedModelKey}
          onChange={(e) => {
            const [provider, modelId] = e.target.value.split("::");
            if (provider && modelId) handleModelChange(provider, modelId);
          }}
          className="w-full text-sm border border-border rounded-md px-3 py-1.5 bg-white focus:outline-none focus:border-accent"
        >
          <option value="">— {st("defaultModel")} —</option>
          {availableModels.map((m: AvailableModel) => (
            <option key={`${m.provider}::${m.id}`} value={`${m.provider}::${m.id}`}>
              {m.name} ({m.provider}/{m.id})
              {m.reasoning ? ` [${st("reasoning")}]` : ""}
              {m.supportsVision ? ` [${st("supportsVision")}]` : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Role-specific defaults — the single place to assign models per role */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-2">{st("roleModels")}</label>
        <div className="space-y-1.5 bg-gray-50 rounded-lg p-2.5">
          {([
            { role: "main" as const, icon: "🎯", lbl: "roleMain", h: "mainHint" },
            { role: "vision" as const, icon: "🖼️", lbl: "vision", h: "visionHint" },
            { role: "compression" as const, icon: "🗜️", lbl: "compression", h: "compressionHint" },
            { role: "web" as const, icon: "🌐", lbl: "webSearch", h: "webHint" },
            { role: "subAgent" as const, icon: "🤖", lbl: "subAgent", h: "subAgentHint" },
            { role: "mcp" as const, icon: "🔌", lbl: "mcpTools", h: "mcpHint" },
            { role: "skills" as const, icon: "📚", lbl: "roleSkills", h: "skillsHint" },
            { role: "approval" as const, icon: "✅", lbl: "roleApproval", h: "approvalHint" },
            { role: "title" as const, icon: "🏷️", lbl: "roleTitle", h: "titleHint" },
            { role: "maintenance" as const, icon: "🔧", lbl: "roleMaintenance", h: "maintenanceHint" },
          ] as const).map(({ role, icon, lbl, h }) => {
            const current = settings.roleModels?.[role] as { provider: string; id: string } | null;
            return (
              <div key={role} className="flex items-center gap-2 text-xs">
                <span className="w-20 shrink-0 text-gray-600" title={st(h)}>
                  {icon} {st(lbl)}
                </span>
                <select
                  value={current ? `${current.provider}::${current.id}` : ""}
                  onChange={(e) => {
                    if (!e.target.value) { setRoleModel(role, null); return; }
                    const [p, m] = e.target.value.split("::");
                    setRoleModel(role, { provider: p, id: m });
                  }}
                  className="flex-1 text-xs border border-border rounded-md px-1.5 py-1 bg-white focus:outline-none focus:border-accent"
                >
                  <option value="">{st("auto")}</option>
                  {availableModels.map((m: AvailableModel) => (
                    <option key={`${m.provider}::${m.id}`} value={`${m.provider}::${m.id}`}>
                      {m.name}{m.supportsVision ? ` [${st("supportsVision")}]` : ""}{m.reasoning ? ` [${st("reasoning")}]` : ""}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">{st("defaultThinking")}</label>
        <div className="flex flex-wrap gap-1.5">
          {(thinkingLevels.length > 0 ? thinkingLevels : THINKING_LEVELS).map((level) => (
            <button
              key={level}
              onClick={() => handleThinkingLevelChange(level)}
              className={`px-3 py-1 text-xs rounded-md border transition-colors ${
                settings.defaultThinkingLevel === level
                  ? "bg-accent text-white border-accent"
                  : "bg-white text-gray-600 border-border hover:bg-gray-50"
              }`}
            >
              {level}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">Default Working Directory</label>
        <input
          type="text"
          value={settings.defaultCwd}
          onChange={(e) => setSettings({ defaultCwd: e.target.value })}
          className="w-full text-sm border border-border rounded-md px-3 py-1.5 bg-white focus:outline-none focus:border-accent font-mono"
        />
      </div>

      {session?.model && (
        <div className="text-xs text-muted bg-gray-50 rounded-md p-2 border border-border">
          <span className="font-medium">Current session:</span>{" "}
          {session.model.provider}/{session.model.id}
          {session.thinkingLevel && ` · thinking: ${session.thinkingLevel}`}
        </div>
      )}

      {availableModels.length > 0 && (
        <div className="border-t border-border pt-3">
          <div className="text-xs font-medium text-gray-600 mb-1.5">{st("installedModels")} ({availableModels.length})</div>
          <div className="max-h-40 overflow-y-auto space-y-1">
            {availableModels.map((m) => (
              <div key={`${m.provider}::${m.id}`} className="flex items-center gap-2 text-xs group hover:bg-gray-50 rounded px-1 py-0.5">
                <span className="flex-1 truncate">
                  <span className="font-medium">{m.name}</span>
                  <span className="text-muted ml-1">({m.provider}/{m.id})</span>
                </span>
                <button
                  onClick={() => {
                    if (!confirm(`Delete model "${m.name}" (${m.provider}/${m.id})?`)) return;
                    removeModel(m.provider, m.id).then(() => {
                      getThinkingLevels("", "").catch(() => {});
                      onModelsChanged();
                    }).catch(console.error);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 shrink-0"
                  title="Delete model"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
