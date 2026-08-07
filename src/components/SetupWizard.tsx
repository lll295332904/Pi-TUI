import { useState, useEffect } from "react";
import { usePiDeskStore } from "../store/pidesk";
import { fetchModelsFromUrl, addModel, getAvailableModels, getAppError } from "../bridge";
import type { FetchedModel } from "../bridge";
import { ArrowRight, ArrowLeft, Check, AlertTriangle, Loader2, FolderOpen, Globe, Zap } from "lucide-react";

type ProviderPreset = "openai" | "deepseek" | "openrouter" | "gemini" | "anthropic" | "custom";
type WizardStep = "welcome" | "provider" | "apikey" | "test" | "models" | "cwd" | "done";

interface ProviderPresetDef {
  id: ProviderPreset;
  name: string;
  description: string;
  defaultBaseUrl: string;
  defaultApiType: string;
  needsKey: boolean;
}

const PROVIDER_PRESETS: ProviderPresetDef[] = [
  { id: "openai", name: "OpenAI Compatible", description: "Any OpenAI-compatible API (OpenAI, vLLM, LiteLLM, etc.)", defaultBaseUrl: "https://api.openai.com/v1/", defaultApiType: "openai-completions", needsKey: true },
  { id: "deepseek", name: "DeepSeek", description: "DeepSeek API (deepseek-chat, deepseek-reasoner)", defaultBaseUrl: "https://api.deepseek.com/v1/", defaultApiType: "openai-completions", needsKey: true },
  { id: "openrouter", name: "OpenRouter", description: "OpenRouter unified API gateway", defaultBaseUrl: "https://openrouter.ai/api/v1/", defaultApiType: "openai-completions", needsKey: true },
  { id: "gemini", name: "Google Gemini", description: "Gemini via OpenAI-compatible endpoint", defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/", defaultApiType: "openai-completions", needsKey: true },
  { id: "anthropic", name: "Anthropic", description: "Claude models via Anthropic API", defaultBaseUrl: "https://api.anthropic.com/v1/", defaultApiType: "anthropic-messages", needsKey: true },
  { id: "custom", name: "Custom Provider", description: "Configure any OpenAI-compatible endpoint manually", defaultBaseUrl: "", defaultApiType: "openai-completions", needsKey: false },
];

interface Props {
  onComplete: () => void;
}

export default function SetupWizard({ onComplete }: Props) {
  const [step, setStep] = useState<WizardStep>("welcome");
  const [preset, setPreset] = useState<ProviderPreset | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [providerName, setProviderName] = useState("");
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "failed">("idle");
  const [testError, setTestError] = useState("");
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [selectAll, setSelectAll] = useState(true);
  const [defaultCwd, setDefaultCwd] = useState("C:\\Git");
  const [cwdValid, setCwdValid] = useState<boolean | null>(null);

  const settings = usePiDeskStore((s) => s.settings);
  const setSettings = usePiDeskStore((s) => s.setSettings);

  // Restore from settings if already partially configured
  useEffect(() => {
    if (settings.defaultModel) {
      setStep("done");
    }
  }, []);

  function selectPreset(p: ProviderPresetDef) {
    setPreset(p.id);
    setProviderName(p.id === "custom" ? "" : p.name);
    setBaseUrl(p.defaultBaseUrl);
    setStep("apikey");
  }

  async function testConnection() {
    setTestStatus("testing");
    setTestError("");
    try {
      const models = await fetchModelsFromUrl(baseUrl, apiKey || undefined);
      if (models.length === 0) {
        setTestError("No models returned from the API. Check your Base URL.");
        setTestStatus("failed");
        return;
      }
      setFetchedModels(models);
      setSelectAll(true);
      setSelectedModels(new Set(models.map(m => m.id)));
      setTestStatus("success");
    } catch (e) {
      const appError = getAppError(e);
      if (appError?.code === "PROVIDER_AUTH_FAILED") {
        setTestError("Authentication failed. Check your API Key.");
      } else if (appError?.code === "PROVIDER_NETWORK_FAILED") {
        setTestError("Cannot reach the server. Check your Base URL.");
      } else {
        const msg = appError?.message ?? String(e);
        setTestError(msg.slice(0, 200));
      }
      setTestStatus("failed");
    }
  }

  function toggleModel(id: string) {
    const next = new Set(selectedModels);
    if (next.has(id)) { next.delete(id); setSelectAll(false); }
    else { next.add(id); if (next.size === fetchedModels.length) setSelectAll(true); }
    setSelectedModels(next);
  }

  function toggleAll() {
    if (selectAll) { setSelectedModels(new Set()); setSelectAll(false); }
    else { setSelectedModels(new Set(fetchedModels.map(m => m.id))); setSelectAll(true); }
  }

  async function checkCwd() {
    try {
      // Try to invoke a simple check — on Tauri we can't easily check dir existence from frontend
      // Just mark as valid and let backend handle it
      setCwdValid(true);
    } catch { setCwdValid(false); }
  }

  async function finish() {
    const provider = providerName || preset || "openai";
    const def = PROVIDER_PRESETS.find(p => p.id === preset);

    // Add each selected model
    const toAdd = fetchedModels.filter(m => selectedModels.has(m.id));
    for (const model of toAdd) {
      try {
        await addModel({
          provider,
          modelId: model.id,
          displayName: model.id,
          apiType: def?.defaultApiType || "openai-completions",
          apiBaseUrl: baseUrl,
          apiKey: apiKey || undefined,
          reasoning: model.id.toLowerCase().includes("reason") || model.id.toLowerCase().includes("think"),
          supportsVision: model.id.toLowerCase().includes("vision") || model.id.includes("gpt-4") || model.id.includes("claude-3"),
          contextWindow: 128000,
          maxTokens: 16384,
        });
      } catch (e) { console.error("Failed to add model:", model.id, e); }
    }

    // Set default model to first selected
    if (toAdd.length > 0) {
      const first = toAdd[0];
      setSettings({
        defaultModel: { provider, id: first.id },
        defaultCwd,
      });
    } else {
      setSettings({ defaultCwd });
    }

    // Refresh available models
    try { await getAvailableModels(); } catch {}

    onComplete();
  }

  return (
    <div className="flex flex-col h-full bg-zinc-900">
      {/* Header */}
      <div className="p-6 pb-4">
        <h2 className="text-xl font-bold text-white">Setup PiDesk</h2>
        <p className="text-zinc-400 text-sm mt-1">
          {step === "welcome" && "Configure your first AI provider to get started."}
          {step === "provider" && "Choose your AI provider."}
          {step === "apikey" && "Enter your API credentials."}
          {step === "test" && "Test your connection and select models."}
          {step === "models" && "Choose which models to add."}
          {step === "cwd" && "Set your default working directory."}
          {step === "done" && "You're all set!"}
        </p>
      </div>

      <div className="flex-1 overflow-auto px-6 pb-6">
        {/* Step: Welcome */}
        {step === "welcome" && (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-6">
            <Zap size={48} className="text-blue-500" />
            <div>
              <h3 className="text-lg font-bold text-white">Welcome to PiDesk</h3>
              <p className="text-zinc-400 text-sm mt-2 max-w-md">
                PiDesk is a desktop UI for Pi Coding Agent. You need to configure a model provider
                (such as OpenAI, DeepSeek, or any compatible API) before you can start coding with AI.
              </p>
            </div>
            <button
              onClick={() => setStep("provider")}
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
            >
              Get Started <ArrowRight size={16} />
            </button>
          </div>
        )}

        {/* Step: Provider Selection */}
        {step === "provider" && (
          <div className="space-y-3">
            {PROVIDER_PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => selectPreset(p)}
                className="w-full text-left p-4 bg-zinc-800 hover:bg-zinc-700 rounded-lg border border-zinc-700 hover:border-blue-500/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Globe size={20} className="text-blue-400" />
                  <div>
                    <div className="text-white font-medium text-sm">{p.name}</div>
                    <div className="text-zinc-400 text-xs mt-0.5">{p.description}</div>
                  </div>
                </div>
              </button>
            ))}
            <button
              onClick={() => setStep("welcome")}
              className="flex items-center gap-1 text-zinc-500 hover:text-zinc-300 text-sm mt-4"
            >
              <ArrowLeft size={14} /> Back
            </button>
          </div>
        )}

        {/* Step: API Key */}
        {step === "apikey" && (
          <div className="space-y-4">
            {preset === "custom" && (
              <div>
                <label className="text-sm text-zinc-300 mb-1.5 block">Provider Name</label>
                <input
                  type="text"
                  value={providerName}
                  onChange={(e) => setProviderName(e.target.value)}
                  placeholder="My Provider"
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
            )}
            <div>
              <label className="text-sm text-zinc-300 mb-1.5 block">Base URL</label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1/"
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none font-mono"
              />
            </div>
            <div>
              <label className="text-sm text-zinc-300 mb-1.5 block">API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none font-mono"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setStep("provider")} className="px-4 py-2 text-zinc-400 hover:text-white text-sm">
                Back
              </button>
              <button
                onClick={testConnection}
                disabled={!baseUrl.trim() || testStatus === "testing"}
                className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium text-sm"
              >
                {testStatus === "testing" && <Loader2 size={14} className="animate-spin" />}
                Test Connection
              </button>
            </div>

            {/* Test Result */}
            {testStatus === "success" && (
              <div className="flex items-center gap-2 p-3 bg-green-900/20 border border-green-800 rounded-lg">
                <Check size={16} className="text-green-400" />
                <span className="text-green-300 text-sm">
                  Connection successful! Found {fetchedModels.length} model(s).
                </span>
              </div>
            )}
            {testStatus === "failed" && (
              <div className="space-y-2">
                <div className="flex items-start gap-2 p-3 bg-red-900/20 border border-red-800 rounded-lg">
                  <AlertTriangle size={16} className="text-red-400 mt-0.5 shrink-0" />
                  <span className="text-red-300 text-sm">{testError}</span>
                </div>
              </div>
            )}

            {testStatus === "success" && (
              <button
                onClick={() => setStep("models")}
                className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm"
              >
                Continue to Model Selection <ArrowRight size={14} />
              </button>
            )}
          </div>
        )}

        {/* Step: Model Selection */}
        {step === "models" && (
          <div className="space-y-4">
            <p className="text-zinc-400 text-sm">
              Select the models you want to use. You can add more later in Settings.
            </p>
            <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={selectAll}
                onChange={toggleAll}
                className="rounded bg-zinc-700 border-zinc-600"
              />
              Select All ({fetchedModels.length} models)
            </label>
            <div className="space-y-1 max-h-64 overflow-auto">
              {fetchedModels.map((m) => (
                <label key={m.id} className="flex items-center gap-2 p-2 hover:bg-zinc-800 rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedModels.has(m.id)}
                    onChange={() => toggleModel(m.id)}
                    className="rounded bg-zinc-700 border-zinc-600"
                  />
                  <span className="text-sm text-zinc-200">{m.id}</span>
                  {m.owned_by && <span className="text-xs text-zinc-500">by {m.owned_by}</span>}
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setStep("apikey")} className="px-4 py-2 text-zinc-400 hover:text-white text-sm">
                Back
              </button>
              <button
                onClick={() => setStep("cwd")}
                disabled={selectedModels.size === 0}
                className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium text-sm"
              >
                Continue <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Step: Working Directory */}
        {step === "cwd" && (
          <div className="space-y-4">
            <p className="text-zinc-400 text-sm">
              Choose your default working directory for new sessions. You can change this later.
            </p>
            <div>
              <label className="text-sm text-zinc-300 mb-1.5 block">Default Working Directory</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={defaultCwd}
                  onChange={(e) => { setDefaultCwd(e.target.value); setCwdValid(null); }}
                  onBlur={checkCwd}
                  className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none"
                />
                <button
                  onClick={checkCwd}
                  className="p-2 bg-zinc-800 border border-zinc-700 rounded-lg hover:bg-zinc-700"
                >
                  <FolderOpen size={18} className="text-zinc-400" />
                </button>
              </div>
              {cwdValid === false && (
                <p className="text-red-400 text-xs mt-1">Directory may not be accessible. You can change it later.</p>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setStep("models")} className="px-4 py-2 text-zinc-400 hover:text-white text-sm">
                Back
              </button>
              <button
                onClick={finish}
                className="flex items-center gap-2 px-5 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium text-sm"
              >
                <Check size={14} /> Complete Setup
              </button>
            </div>
          </div>
        )}

        {/* Step: Done */}
        {step === "done" && (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-6">
            <Check size={48} className="text-green-500" />
            <div>
              <h3 className="text-lg font-bold text-white">Setup Complete!</h3>
              <p className="text-zinc-400 text-sm mt-2 max-w-md">
                PiDesk is ready to use. Create a new session to start coding with AI.
              </p>
            </div>
            <button
              onClick={finish}
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
            >
              Start Coding <ArrowRight size={16} />
            </button>
          </div>
        )}
      </div>

      {/* Step indicators */}
      <div className="flex items-center justify-center gap-2 p-4 border-t border-zinc-800">
        {(["welcome", "provider", "apikey", "models", "cwd", "done"] as WizardStep[]).map((s, i) => {
          const currentIdx = (["welcome", "provider", "apikey", "models", "cwd", "done"] as WizardStep[]).indexOf(step);
          const isActive = i === currentIdx;
          const isPast = i < currentIdx;
          return (
            <div
              key={s}
              className={`w-2 h-2 rounded-full transition-colors ${
                isActive ? "bg-blue-500" : isPast ? "bg-blue-800" : "bg-zinc-700"
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}
