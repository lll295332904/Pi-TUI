import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { PiOutboundEvent, ThinkingLevel, PiSessionMeta, SessionEntryVm, AvailableModel } from "./types";

// ── Commands (Renderer → Main) ──

export async function startSession(opts: {
  cwd: string;
  provider?: string;
  model?: string;
}): Promise<string> {
  return invoke<string>("start_session", { opts });
}

export async function stopSession(sessionId: string): Promise<void> {
  return invoke("stop_session", { sessionId });
}

export async function prompt(sessionId: string, message: string, images?: string[]): Promise<void> {
  return invoke("prompt", { sessionId, message, images: images ?? [] });
}

export async function steer(sessionId: string, message: string): Promise<void> {
  return invoke("steer", { sessionId, message });
}

export async function newPiSession(sessionId: string): Promise<void> {
  return invoke("new_session", { sessionId });
}

export async function followUp(sessionId: string, message: string): Promise<void> {
  return invoke("follow_up", { sessionId, message });
}

export async function abortSession(sessionId: string): Promise<void> {
  return invoke("abort", { sessionId });
}

// ── Model & Thinking ──

export async function getAvailableModels(): Promise<AvailableModel[]> {
  return invoke<AvailableModel[]>("get_available_models");
}

export async function getThinkingLevels(provider: string, modelId: string): Promise<string[]> {
  return invoke<string[]>("get_thinking_levels", { provider, modelId });
}

export async function setModel(sessionId: string, provider: string, modelId: string): Promise<void> {
  return invoke("set_model", { sessionId, provider, modelId });
}

export async function setThinkingLevel(sessionId: string, level: ThinkingLevel): Promise<void> {
  return invoke("set_thinking_level", { sessionId, level });
}

// ── Steering / FollowUp / Compaction / Retry ──

export async function setSteeringMode(sessionId: string, mode: "all" | "one-at-a-time"): Promise<void> {
  return invoke("set_steering_mode", { sessionId, mode });
}

export async function setFollowUpMode(sessionId: string, mode: "all" | "one-at-a-time"): Promise<void> {
  return invoke("set_follow_up_mode", { sessionId, mode });
}

export async function setAutoCompaction(sessionId: string, enabled: boolean): Promise<void> {
  return invoke("set_auto_compaction", { sessionId, enabled });
}

export async function setAutoRetry(sessionId: string, enabled: boolean): Promise<void> {
  return invoke("set_auto_retry", { sessionId, enabled });
}

// ── Extension UI Response ──

export async function respondExtensionUi(
  sessionId: string,
  requestId: string,
  response: Record<string, unknown>,
): Promise<void> {
  return invoke("respond_extension_ui", { sessionId, requestId, response });
}

// ── Session entries ──

export async function getEntries(
  sessionId: string,
  since?: string
): Promise<void> {
  return invoke("get_entries", { sessionId, since: since ?? null });
}

export async function getTree(
  sessionId: string
): Promise<void> {
  return invoke("get_tree", { sessionId });
}

export async function forkSession(sessionId: string, entryId: string): Promise<void> {
  return invoke("fork", { sessionId, entryId });
}

export async function switchSession(sessionId: string, path: string): Promise<void> {
  return invoke("switch_session", { sessionId, path });
}

export async function bash(sessionId: string, cmd: string): Promise<void> {
  return invoke("bash_exec", { sessionId, command: cmd });
}

export async function compactSession(sessionId: string): Promise<void> {
  return invoke("compact", { sessionId });
}

export async function exportHtml(sessionId: string, out?: string): Promise<{ path: string }> {
  return invoke("export_html", { sessionId, out: out ?? null });
}

// ── Pi version ──

export async function getPiVersion(): Promise<string> {
  return invoke<string>("get_pi_version");
}

export async function locatePi(): Promise<{ path: string; version: string }> {
  return invoke<{ path: string; version: string }>("locate_pi");
}

// ── Session persistence ──

export async function listPiSessions(): Promise<PiSessionMeta[]> {
  return invoke<PiSessionMeta[]>("list_pi_sessions");
}

export async function loadSessionEntries(sessionId: string): Promise<SessionEntryVm[]> {
  return invoke<SessionEntryVm[]>("load_session_entries", { sessionId });
}

// ── Pi config files ──

export async function readPiFile(filename: string): Promise<string> {
  return invoke<string>("read_pi_file", { filename });
}

export async function writePiFile(filename: string, content: string): Promise<void> {
  return invoke("write_pi_file", { filename, content });
}

export async function listPiFiles(): Promise<string[]> {
  return invoke<string[]>("list_pi_files");
}

// ── Add model ──

export interface NewModelParams {
  provider: string;
  modelId: string;
  displayName: string;
  apiType: string;
  apiBaseUrl: string;
  apiKey?: string;
  reasoning: boolean;
  supportsVision: boolean;
  contextWindow: number;
  maxTokens: number;
}

export async function addModel(params: NewModelParams): Promise<void> {
  return invoke("add_model", {
    params: {
      provider: params.provider,
      model_id: params.modelId,
      display_name: params.displayName,
      api_type: params.apiType,
      api_base_url: params.apiBaseUrl,
      api_key: params.apiKey ?? null,
      reasoning: params.reasoning,
      supports_vision: params.supportsVision,
      context_window: params.contextWindow,
      max_tokens: params.maxTokens,
    },
  });
}

export async function removeModel(provider: string, modelId: string): Promise<void> {
  return invoke("remove_model", { provider, modelId });
}

export interface FetchedModel {
  id: string;
  owned_by?: string;
}

export async function fetchModelsFromUrl(baseUrl: string, apiKey?: string): Promise<FetchedModel[]> {
  return invoke<FetchedModel[]>("fetch_models_from_url", { baseUrl, apiKey });
}

export async function deletePiSession(sessionId: string): Promise<void> {
  return invoke("delete_pi_session", { sessionId });
}

export async function saveUserdata(data: Record<string, unknown>): Promise<void> {
  return invoke("save_userdata", { data });
}

export async function loadUserdata(): Promise<Record<string, unknown>> {
  return invoke<Record<string, unknown>>("load_userdata");
}

export async function getSessionsDir(): Promise<string> {
  return invoke<string>("get_sessions_dir");
}

export async function checkPiHealth(sessionId: string): Promise<boolean> {
  return invoke<boolean>("check_pi_health", { sessionId });
}

// ── Events (Main → Renderer) ──

export function onPiEvent(handler: (event: PiOutboundEvent) => void): () => void {
  const unlisten = listen<PiOutboundEvent>("pi:event", (e) => handler(e.payload));
  return () => {
    unlisten.then((fn) => fn());
  };
}
