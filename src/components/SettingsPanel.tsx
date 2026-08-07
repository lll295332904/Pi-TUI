import { useState, useEffect } from "react";
import { usePiDeskStore } from "../store/pidesk";
import { getAvailableModels } from "../bridge";
import { useT } from "../i18n";
import { X, Settings, Cpu, Zap, FileText, Layers, Wrench } from "lucide-react";
import ModelTab from "./settings/ModelTab";
import BehaviorTab from "./settings/BehaviorTab";
import ProviderTab from "./settings/ProviderTab";
import ConfigFilesTab from "./settings/ConfigFilesTab";
import McpTab from "./settings/McpTab";

export default function SettingsPanel() {
  const settingsOpen = usePiDeskStore((s) => s.settingsOpen);
  const setSettingsOpen = usePiDeskStore((s) => s.setSettingsOpen);
  const availableModels = usePiDeskStore((s) => s.availableModels);
  const setAvailableModels = usePiDeskStore((s) => s.setAvailableModels);
  const activeId = usePiDeskStore((s) => s.activeSessionId);
  const language = usePiDeskStore((s) => s.language);
  const setLanguage = usePiDeskStore((s) => s.setLanguage);
  const { t: st } = useT("settings");

  const [activeTab, setActiveTab] = useState<"model" | "behavior" | "add-model" | "config" | "mcp">("model");

  // Load available models on mount
  useEffect(() => {
    if (availableModels.length === 0) {
      getAvailableModels().then(setAvailableModels).catch(console.error);
    }
  }, [availableModels.length, setAvailableModels]);

  function refreshModels() {
    getAvailableModels().then(setAvailableModels).catch(console.error);
  }

  const handleRequestClose = () => {
    setSettingsOpen(false);
  };

  if (!settingsOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={handleRequestClose}>
      <div
        className="w-[640px] h-[560px] bg-white rounded-lg shadow-xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface-secondary">
          <div className="flex items-center gap-2">
            <Settings size={16} className="text-gray-600" />
            <span className="font-semibold text-sm text-gray-800">{st("title")}</span>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as "zh" | "en")}
              className="text-xs border border-border rounded px-2 py-0.5 bg-white"
            >
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
            <button onClick={handleRequestClose} className="text-gray-500 hover:text-gray-700">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border bg-surface-secondary">
          {([
            { key: "model" as const, label: st("model"), icon: Cpu },
            { key: "behavior" as const, label: st("behavior"), icon: Zap },
            { key: "add-model" as const, label: st("provider"), icon: Layers },
            { key: "config" as const, label: st("files"), icon: FileText },
            { key: "mcp" as const, label: st("mcp"), icon: Wrench },
          ]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? "border-accent text-accent"
                  : "border-transparent text-muted hover:text-gray-600"
              }`}
            >
              <tab.icon size={13} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === "model" && (
            <ModelTab activeId={activeId} onModelsChanged={refreshModels} />
          )}
          {activeTab === "behavior" && (
            <BehaviorTab activeId={activeId} />
          )}
          {activeTab === "add-model" && (
            <ProviderTab onModelsChanged={refreshModels} />
          )}
          {activeTab === "config" && (
            <ConfigFilesTab />
          )}
          {activeTab === "mcp" && (
            <McpTab />
          )}
        </div>
      </div>
    </div>
  );
}
