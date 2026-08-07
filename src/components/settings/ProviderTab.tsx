import { useState, useCallback } from "react";
import { usePiDeskStore } from "../../store/pidesk";
import { getAvailableModels, fetchModelsFromUrl, addModel } from "../../bridge";
import type { FetchedModel } from "../../bridge";
import { useT } from "../../i18n";
import { PlusCircle } from "lucide-react";

interface Props {
  onModelsChanged: () => void;
}

export default function ProviderTab({ onModelsChanged }: Props) {
  const setAvailableModels = usePiDeskStore((s) => s.setAvailableModels);
  const { t: st } = useT("settings");

  const [addModelForm, setAddModelForm] = useState({
    provider: "", modelId: "", displayName: "", apiType: "openai-completions",
    apiBaseUrl: "", apiKey: "", reasoning: true, supportsVision: false,
    contextWindow: 128000, maxTokens: 16384,
  });
  const [addModelStatus, setAddModelStatus] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [fetchModelsLoading, setFetchModelsLoading] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);

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

  const handleAddModel = useCallback(async () => {
    setAddModelStatus(null);
    if (!addModelForm.provider.trim() || !addModelForm.modelId.trim() || !addModelForm.displayName.trim()) {
      setAddModelStatus({ type: "error", msg: "Provider name, Model ID, and Display Name are required" });
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
      const models = await getAvailableModels();
      setAvailableModels(models);
      onModelsChanged();
      setAddModelForm({
        provider: "", modelId: "", displayName: "", apiType: "openai-completions",
        apiBaseUrl: "", apiKey: "", reasoning: true, supportsVision: false,
        contextWindow: 128000, maxTokens: 16384,
      });
      setFetchedModels([]);
    } catch (e) {
      setAddModelStatus({ type: "error", msg: `Failed: ${e}` });
    }
  }, [addModelForm, setAvailableModels, onModelsChanged]);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-muted mb-3">
          Add a new model to Pi&apos;s configuration. Writes to{" "}
          <code className="bg-gray-100 px-1 rounded">models-store.json</code> and{" "}
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
              placeholder="e.g. openai, deepseek"
              className="w-full text-sm border border-border rounded-md px-2 py-1 bg-white focus:outline-none focus:border-accent" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Model ID *</label>
            <input type="text" value={addModelForm.modelId}
              onChange={(e) => setAddModelForm({ ...addModelForm, modelId: e.target.value })}
              placeholder="e.g. gpt-4o"
              className="w-full text-sm border border-border rounded-md px-2 py-1 bg-white focus:outline-none focus:border-accent" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Display Name *</label>
            <input type="text" value={addModelForm.displayName}
              onChange={(e) => setAddModelForm({ ...addModelForm, displayName: e.target.value })}
              placeholder="e.g. GPT-4o"
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
                    modelId: m.id, displayName: m.id,
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
              onChange={(e) => setAddModelForm({ ...addModelForm, reasoning: e.target.checked })} className="rounded" />
            <span className="text-sm text-gray-700">Reasoning / Thinking</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={addModelForm.supportsVision}
              onChange={(e) => setAddModelForm({ ...addModelForm, supportsVision: e.target.checked })} className="rounded" />
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
  );
}
