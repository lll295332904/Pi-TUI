import { useState, useEffect, useCallback } from "react";
import { usePiDeskStore } from "../store/pidesk";
import { getAvailableModels, getThinkingLevels, setModel, setThinkingLevel, setSteeringMode, setFollowUpMode, setAutoCompaction, setAutoRetry, readPiFile, writePiFile, listPiFiles, addModel, removeModel, fetchModelsFromUrl } from "../bridge";
import type { FetchedModel } from "../bridge";
import type { AvailableModel, ThinkingLevel } from "../types";
import { ROLE_LABELS, ROLE_ORDER, DISCONNECTED_ROLES, THINKING_LEVELS } from "../types";
import { useT } from "../i18n";
import { X, Settings, Cpu, Zap, FileText, Save, PlusCircle, Layers, Wrench } from "lucide-react";

export default function SettingsPanel() {
  const settingsOpen = usePiDeskStore((s) => s.settingsOpen);
  const setSettingsOpen = usePiDeskStore((s) => s.setSettingsOpen);
  const settings = usePiDeskStore((s) => s.settings);
  const setSettings = usePiDeskStore((s) => s.setSettings);
  const availableModels = usePiDeskStore((s) => s.availableModels);
  const { t: st } = useT("settings");
  const setAvailableModels = usePiDeskStore((s) => s.setAvailableModels);
  const activeId = usePiDeskStore((s) => s.activeSessionId);
  const sessions = usePiDeskStore((s) => s.sessions);
  const updateSessionModel = usePiDeskStore((s) => s.updateSessionModel);
  const updateSessionThinkingLevel = usePiDeskStore((s) => s.updateSessionThinkingLevel);
  const setRoleModel = usePiDeskStore((s) => s.setRoleModel);
  const language = usePiDeskStore((s) => s.language);
  const setLanguage = usePiDeskStore((s) => s.setLanguage);

  const [activeTab, setActiveTab] = useState<"model" | "behavior" | "add-model" | "config" | "mcp">("model");
  const [thinkingLevels, setThinkingLevels] = useState<string[]>([...THINKING_LEVELS]);
  const [configFiles, setConfigFiles] = useState<string[]>([]);
  const [configContent, setConfigContent] = useState("");
  const [configFileName, setConfigFileName] = useState("");
  const [configDirty, setConfigDirty] = useState(false);
  const [mcpServers, setMcpServers] = useState<Array<{ name: string; command: string; args: string }>>([]);

  // Add model form state
  const [addModelForm, setAddModelForm] = useState({
    provider: "",
    modelId: "",
    displayName: "",
    apiType: "openai-completions",
    apiBaseUrl: "",
    apiKey: "",
    reasoning: true,
    supportsVision: false,
    contextWindow: 128000,
    maxTokens: 16384,
  });
  const [addModelStatus, setAddModelStatus] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [fetchModelsLoading, setFetchModelsLoading] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);

  // Load available models on mount
  useEffect(() => {
    if (availableModels.length === 0) {
      getAvailableModels().then(setAvailableModels).catch(console.error);
    }
  }, [availableModels.length, setAvailableModels]);

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

  // Load MCP servers from Pi settings on tab open
  const loadMcpServers = useCallback(async () => {
    try {
      const raw = await readPiFile("settings.json");
      const settings = JSON.parse(raw);
      const servers = settings.mcpServers || {};
      const list = Object.entries(servers).map(([name, cfg]: [string, any]) => ({
        name,
        command: cfg.command || "",
        args: (cfg.args || []).join(", "),
      }));
      setMcpServers(list);
    } catch {
      setMcpServers([]);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "mcp") loadMcpServers();
  }, [activeTab, loadMcpServers]);
  useEffect(() => {
    if (activeTab === "config" && configFiles.length === 0) {
      listPiFiles().then(setConfigFiles).catch(console.error);
    }
  }, [activeTab, configFiles.length]);

  const session = activeId ? sessions[activeId] : null;

  // 判断是否有未保存的工作（文件编辑脏 或 模型表单已填写）
  const hasUnsavedWork = configDirty || !!(
    addModelForm.provider.trim() ||
    addModelForm.modelId.trim() ||
    addModelForm.displayName.trim() ||
    addModelForm.apiBaseUrl.trim()
  );

  /** 安全关闭：有未保存工作时弹出确认 */
  const handleRequestClose = () => {
    if (hasUnsavedWork) {
      // eslint-disable-next-line no-alert
      if (!confirm(st("closeConfirm"))) return;
    }
    setSettingsOpen(false);
  };

  // ── Model change handler ──
  const handleModelChange = useCallback(async (provider: string, modelId: string) => {
    setSettings({ defaultModel: { provider, id: modelId } });
    // Update thinking levels for new model
    const levels = await getThinkingLevels(provider, modelId);
    setThinkingLevels(levels);
    // If current thinking level not supported, switch to first available
    if (!levels.includes(settings.defaultThinkingLevel) && levels.length > 0) {
      setSettings({ defaultThinkingLevel: levels[0] as ThinkingLevel });
    }
    // Apply to active session
    if (activeId) {
      try {
        await setModel(activeId, provider, modelId);
        updateSessionModel(activeId, provider, modelId);
      } catch (e) {
        console.error("Failed to set model:", e);
      }
    }
  }, [setSettings, settings.defaultThinkingLevel, activeId, updateSessionModel]);

  // ── Thinking level change handler ──
  const handleThinkingLevelChange = useCallback(async (level: string) => {
    setSettings({ defaultThinkingLevel: level as ThinkingLevel });
    if (activeId) {
      try {
        await setThinkingLevel(activeId, level as ThinkingLevel);
        updateSessionThinkingLevel(activeId, level);
      } catch (e) {
        console.error("Failed to set thinking level:", e);
      }
    }
  }, [setSettings, activeId, updateSessionThinkingLevel]);

  // ── Behavior toggle handlers ──
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

  // ── Add model handler ──
  const handleAddModel = useCallback(async () => {
    setAddModelStatus(null);
    if (!addModelForm.provider.trim() || !addModelForm.modelId.trim() || !addModelForm.displayName.trim()) {
      setAddModelStatus({ type: "error", msg: st("addModel") + " required" });
      return;
    }
    try {
      await addModel({
        provider: addModelForm.provider.trim(),
        modelId: addModelForm.modelId.trim(),
        displayName: addModelForm.displayName.trim(),
        apiType: addModelForm.apiType,
        apiBaseUrl: addModelForm.apiBaseUrl.trim(),
        apiKey: addModelForm.apiKey.trim() || undefined,
        reasoning: addModelForm.reasoning,
        supportsVision: addModelForm.supportsVision,
        contextWindow: addModelForm.contextWindow,
        maxTokens: addModelForm.maxTokens,
      });
      setAddModelStatus({ type: "success", msg: `Model "${addModelForm.displayName}" added successfully! Restart Pi to use it.` });
      // Reload models list
      const models = await getAvailableModels();
      setAvailableModels(models);
      // Reset form
      setAddModelForm({
        provider: "", modelId: "", displayName: "", apiType: "openai-completions",
        apiBaseUrl: "", apiKey: "", reasoning: true, supportsVision: false,
        contextWindow: 128000, maxTokens: 16384,
      });
    } catch (e) {
      setAddModelStatus({ type: "error", msg: `Failed: ${e}` });
    }
  }, [addModelForm, setAvailableModels]);

  // ── Fetch models from URL ──
  const handleFetchModels = useCallback(async () => {
    const url = addModelForm.apiBaseUrl.trim();
    if (!url) { setAddModelStatus({ type: "error", msg: st("baseUrl") + " required" }); return; }
    setFetchModelsLoading(true);
    setAddModelStatus(null);
    try {
      const models = await fetchModelsFromUrl(url, addModelForm.apiKey || undefined);
      setFetchedModels(models);
      if (models.length === 0) {
        setAddModelStatus({ type: "error", msg: "No models found at this URL" });
      } else {
        setAddModelStatus({ type: "success", msg: `Found ${models.length} models. Select one to auto-fill.` });
      }
    } catch (e) {
      setAddModelStatus({ type: "error", msg: `Fetch failed: ${e}` });
    } finally {
      setFetchModelsLoading(false);
    }
  }, [addModelForm.apiBaseUrl, addModelForm.apiKey]);

  // ── Config file handlers ──
  const handleLoadConfig = useCallback(async (filename: string) => {
    try {
      const content = await readPiFile(filename);
      setConfigContent(content);
      setConfigFileName(filename);
      setConfigDirty(false);
    } catch (e) {
      setConfigContent(`Error: ${e}`);
    }
  }, []);

  const handleSaveConfig = useCallback(async () => {
    if (!configFileName) return;
    try {
      await writePiFile(configFileName, configContent);
      setConfigDirty(false);
    } catch (e) {
      console.error("Failed to save config:", e);
    }
  }, [configFileName, configContent]);

  if (!settingsOpen) return null;

  const selectedModelKey = settings.defaultModel
    ? `${settings.defaultModel.provider}::${settings.defaultModel.id}`
    : "";

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
          </div>
          <button onClick={handleRequestClose} className="text-gray-500 hover:text-gray-700">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border bg-surface-secondary">
          {([
            { key: "model", label: st("model"), icon: Cpu },
            { key: "behavior", label: st("behavior"), icon: Zap },
            { key: "add-model", label: st("provider"), icon: Layers },
            { key: "config", label: st("files"), icon: FileText },
            { key: "mcp", label: st("mcp"), icon: Wrench },
          ] as const).map((tab) => (
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
          {/* ── Model tab ── */}
          {activeTab === "model" && (
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

              {/* Role-specific defaults */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">{st("roleModels")}</label>
                <div className="space-y-1.5 bg-gray-50 rounded-lg p-2.5">
                  {([
                    { role: "vision" as const, icon: "🖼️", lbl: "vision", h: "visionHint" },
                    { role: "compression" as const, icon: "🗜️", lbl: "compression", h: "compressionHint" },
                    { role: "web" as const, icon: "🌐", lbl: "webSearch", h: "webHint" },
                    { role: "subAgent" as const, icon: "🤖", lbl: "subAgent", h: "subAgentHint" },
                    { role: "mcp" as const, icon: "🔌", lbl: "mcpTools", h: "mcpHint" },
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
                            removeModel(m.provider, m.id).then(() => getAvailableModels().then(setAvailableModels)).catch(console.error);
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
          )}

          {/* ── Behavior tab ── */}
          {activeTab === "behavior" && (
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
          )}

          {/* ── Provider tab: role-specific models + add new ── */}
          {activeTab === "add-model" && (
            <div className="space-y-4">
              {/* Role-specific model selectors */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Layers size={14} className="text-gray-600" />
                  <span className="text-xs font-medium text-gray-600">Role-Specific Models</span>
                  <span className="text-xs text-muted">(falls back to Main if not set)</span>
                </div>
                <div className="space-y-1.5">
                  {ROLE_ORDER.map((role) => {
                    const current = settings.roleModels?.[role];
                    const key = current ? `${current.provider}::${current.id}` : "";
                    const disconnected = DISCONNECTED_ROLES.has(role);
                    return (
                      <div key={role} className={`flex items-center gap-2 ${disconnected ? "opacity-40" : ""}`}>
                        <span className={`w-28 text-xs shrink-0 ${disconnected ? "text-gray-400 line-through" : "text-gray-600"}`}>
                          {ROLE_LABELS[role]}
                          {disconnected && <span className="ml-1 text-[10px]">(no event)</span>}
                        </span>
                        <select
                          value={key}
                          disabled={disconnected}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (!val) { setRoleModel(role, null); return; }
                            const [p, m] = val.split("::");
                            setRoleModel(role, { provider: p, id: m });
                          }}
                          className={`flex-1 text-xs border border-border rounded-md px-2 py-1 focus:outline-none focus:border-accent ${disconnected ? "bg-gray-100 text-gray-400 cursor-not-allowed" : "bg-white"}`}
                        >
                          <option value="">— Inherit from Main —</option>
                          {availableModels.map((m) => (
                            <option key={`${m.provider}::${m.id}`} value={`${m.provider}::${m.id}`}>
                              {m.name} ({m.provider}/{m.id})
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="border-t border-border pt-3">
                <p className="text-xs text-muted mb-3">
                  Add a new model to Pi's configuration. Writes to
                  <code className="bg-gray-100 px-1 rounded">models-store.json</code> and
                  <code className="bg-gray-100 px-1 rounded">auth.json</code>.
                </p>

                {addModelStatus && (
                  <div className={`text-xs rounded-md p-2 border mb-3 ${
                    addModelStatus.type === "success"
                      ? "bg-green-50 border-green-300 text-green-700"
                      : "bg-red-50 border-red-300 text-red-700"
                  }`}>
                    {addModelStatus.msg}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Provider Name *</label>
                    <input type="text" value={addModelForm.provider}
                      onChange={(e) => setAddModelForm({ ...addModelForm, provider: e.target.value })}
                      placeholder="e.g. openai, deepseek, tencent"
                      className="w-full text-sm border border-border rounded-md px-2 py-1 bg-white focus:outline-none focus:border-accent" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Model ID *</label>
                    <input type="text" value={addModelForm.modelId}
                      onChange={(e) => setAddModelForm({ ...addModelForm, modelId: e.target.value })}
                      placeholder="e.g. gpt-4o, claude-sonnet-4"
                      className="w-full text-sm border border-border rounded-md px-2 py-1 bg-white focus:outline-none focus:border-accent" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Display Name *</label>
                    <input type="text" value={addModelForm.displayName}
                      onChange={(e) => setAddModelForm({ ...addModelForm, displayName: e.target.value })}
                      placeholder="e.g. GPT-4o, Claude Sonnet 4"
                      className="w-full text-sm border border-border rounded-md px-2 py-1 bg-white focus:outline-none focus:border-accent" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">API Type</label>
                    <select value={addModelForm.apiType}
                      onChange={(e) => setAddModelForm({ ...addModelForm, apiType: e.target.value })}
                      className="w-full text-sm border border-border rounded-md px-2 py-1 bg-white focus:outline-none focus:border-accent">
                      <option value="openai-completions">OpenAI Compatible</option>
                      <option value="anthropic-messages">Anthropic Messages</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Context Window</label>
                    <input type="number" value={addModelForm.contextWindow}
                      onChange={(e) => setAddModelForm({ ...addModelForm, contextWindow: Number(e.target.value) })}
                      className="w-full text-sm border border-border rounded-md px-2 py-1 bg-white focus:outline-none focus:border-accent" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">API Base URL</label>
                    <div className="flex gap-2">
                      <input type="text" value={addModelForm.apiBaseUrl}
                        onChange={(e) => setAddModelForm({ ...addModelForm, apiBaseUrl: e.target.value })}
                        placeholder="e.g. https://api.openai.com/v1"
                        className="flex-1 text-sm border border-border rounded-md px-2 py-1 bg-white focus:outline-none focus:border-accent" />
                      <button onClick={handleFetchModels} disabled={fetchModelsLoading}
                        className="px-3 py-1 text-xs bg-accent text-white rounded-md hover:bg-accent-hover disabled:opacity-50 shrink-0">
                        {fetchModelsLoading ? "..." : "Fetch"}
                      </button>
                    </div>
                    {fetchedModels.length > 0 && (
                      <select
                        value=""
                        onChange={(e) => {
                          const m = fetchedModels.find(f => f.id === e.target.value);
                          if (m) setAddModelForm({
                            ...addModelForm,
                            modelId: m.id,
                            displayName: m.id,
                            provider: m.owned_by || addModelForm.provider,
                          });
                          setFetchedModels([]);
                        }}
                        className="w-full mt-1 text-sm border border-border rounded-md px-2 py-1 bg-white focus:outline-none focus:border-accent">
                        <option value="">— Pick a model —</option>
                        {fetchedModels.map(m => (
                          <option key={m.id} value={m.id}>{m.id}{m.owned_by ? ` (${m.owned_by})` : ""}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">API Key (optional)</label>
                    <input type="password" value={addModelForm.apiKey}
                      onChange={(e) => setAddModelForm({ ...addModelForm, apiKey: e.target.value })}
                      placeholder="sk-..."
                      className="w-full text-sm border border-border rounded-md px-2 py-1 bg-white focus:outline-none focus:border-accent font-mono" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Max Tokens</label>
                    <input type="number" value={addModelForm.maxTokens}
                      onChange={(e) => setAddModelForm({ ...addModelForm, maxTokens: Number(e.target.value) })}
                      className="w-full text-sm border border-border rounded-md px-2 py-1 bg-white focus:outline-none focus:border-accent" />
                  </div>
                </div>

                <div className="flex gap-6 mt-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={addModelForm.reasoning}
                      onChange={(e) => setAddModelForm({ ...addModelForm, reasoning: e.target.checked })}
                      className="rounded" />
                    <span className="text-sm text-gray-700">Reasoning / Thinking</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={addModelForm.supportsVision}
                      onChange={(e) => setAddModelForm({ ...addModelForm, supportsVision: e.target.checked })}
                      className="rounded" />
                    <span className="text-sm text-gray-700">Vision (Image Input)</span>
                  </label>
                </div>

                <button
                  onClick={handleAddModel}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 mt-3 text-sm bg-accent text-white rounded-md hover:bg-accent-hover transition-colors"
                >
                  <PlusCircle size={14} />
                  Add Model
                </button>

                <p className="text-xs text-muted mt-2">
                  After adding, restart Pi or start a new session for the model to appear in the role selectors above.
                </p>
              </div>
            </div>
          )}

          {/* ── Config files tab ── */}
          {activeTab === "config" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <select
                  value={configFileName}
                  onChange={(e) => handleLoadConfig(e.target.value)}
                  className="flex-1 text-sm border border-border rounded-md px-2 py-1 bg-white focus:outline-none focus:border-accent"
                >
                  <option value="">— Select file —</option>
                  {configFiles.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
                {configFileName && (
                  <button
                    onClick={handleSaveConfig}
                    disabled={!configDirty}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-accent text-white rounded-md hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Save size={12} />
                    Save
                  </button>
                )}
              </div>
              {configFileName && (
                <>
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <span>~/.pi/agent/{configFileName}</span>
                    {configDirty && <span className="text-warning">● unsaved</span>}
                  </div>
                  <textarea
                    value={configContent}
                    onChange={(e) => { setConfigContent(e.target.value); setConfigDirty(true); }}
                    className="w-full h-72 text-xs font-mono border border-border rounded-md p-2 bg-white focus:outline-none focus:border-accent resize-none"
                    spellCheck={false}
                  />
                  <p className="text-xs text-muted">
                    ⚠️ Editing these files may affect Pi's behavior. A backup (.bak) is created on save.
                  </p>
                </>
              )}
            </div>
          )}

          {/* ── MCP tab ── */}
          {activeTab === "mcp" && (
            <div className="space-y-3">
              <p className="text-xs text-muted">
                Manage MCP (Model Context Protocol) servers that Pi can connect to for tools and resources.
                Configuration is stored in <code className="text-[11px] bg-gray-100 px-1 rounded">settings.json</code>.
              </p>

              {/* Example MCP server list */}
              <div className="space-y-2">
                <div className="text-xs font-medium text-gray-600">Configured Servers</div>
                <div className="space-y-1">
                  {mcpServers.length === 0 ? (
                    <div className="text-xs text-muted italic py-2">No MCP servers configured. Add one below or edit settings.json directly.</div>
                  ) : (
                    mcpServers.map((srv) => (
                    <div key={srv.name} className="flex items-center gap-2 bg-gray-50 rounded px-2 py-1.5 text-xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                      <span className="font-mono text-gray-700 flex-1">{srv.name}</span>
                      <span className="text-muted truncate max-w-[120px]">{srv.command}{srv.args ? ` ${srv.args}` : ""}</span>
                      <button className="text-red-400 hover:text-red-600">
                        <X size={12} />
                      </button>
                    </div>
                  ))
                  )}
                </div>
              </div>

              <div className="border-t border-border pt-3">
                <div className="text-xs font-medium text-gray-600 mb-2">Add MCP Server</div>
                <div className="grid grid-cols-2 gap-2">
                  <input placeholder="Server name" className="text-sm border border-border rounded-md px-2 py-1 bg-white focus:outline-none focus:border-accent" />
                  <input placeholder="Command (e.g. npx)" className="text-sm border border-border rounded-md px-2 py-1 bg-white focus:outline-none focus:border-accent" />
                  <div className="col-span-2">
                    <input placeholder="Args (comma-separated)" className="w-full text-sm border border-border rounded-md px-2 py-1 bg-white focus:outline-none focus:border-accent" />
                  </div>
                </div>
                <button className="mt-2 px-3 py-1 text-xs bg-accent text-white rounded-md hover:bg-accent-hover">
                  Add Server
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
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
