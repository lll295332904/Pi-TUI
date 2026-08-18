import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { PiOutboundEvent, ThinkingLevel, PiSessionMeta, SessionEntryVm, AvailableModel } from "./types";

export interface AppErrorDto {
  code: string;
  message: string;
  recoverable: boolean;
  actionLabel?: string;
  actionCommand?: string;
}

export function getAppError(error: unknown): AppErrorDto | null {
  if (typeof error === "object" && error !== null && "message" in error && "code" in error) {
    const maybe = error as Partial<AppErrorDto>;
    if (typeof maybe.message === "string" && typeof maybe.code === "string") {
      return error as AppErrorDto;
    }
  }
  if (error instanceof Error && "appError" in error) {
    return (error as Error & { appError?: AppErrorDto }).appError ?? null;
  }
  return null;
}

function toAppError(error: unknown): Error {
  if (typeof error === "object" && error !== null && "message" in error) {
    const maybe = error as { message?: unknown; code?: unknown };
    if (typeof maybe.message === "string") {
      const err = new Error(maybe.message) as Error & { code?: string; appError?: AppErrorDto };
      if (typeof maybe.code === "string") err.code = maybe.code;
      err.appError = error as AppErrorDto;
      return err;
    }
  }
  return error instanceof Error ? error : new Error(String(error));
}

async function invokeSafe<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (error) {
    throw toAppError(error);
  }
}

// ── Commands (Renderer → Main) ──

export async function startSession(opts: {
  cwd: string;
  provider?: string;
  model?: string;
}): Promise<string> {
  return invokeSafe<string>("start_session", { opts });
}

export async function stopSession(sessionId: string): Promise<void> {
  return invokeSafe("stop_session", { sessionId });
}

export async function prompt(sessionId: string, message: string, images?: string[]): Promise<void> {
  return invokeSafe("prompt", { sessionId, message, images: images ?? [] });
}

export async function steer(sessionId: string, message: string): Promise<void> {
  return invokeSafe("steer", { sessionId, message });
}

export async function newPiSession(sessionId: string): Promise<void> {
  return invokeSafe("new_session", { sessionId });
}

export async function followUp(sessionId: string, message: string): Promise<void> {
  return invokeSafe("follow_up", { sessionId, message });
}

export async function abortSession(sessionId: string): Promise<void> {
  return invokeSafe("abort", { sessionId });
}

// ── Model & Thinking ──

export async function getAvailableModels(): Promise<AvailableModel[]> {
  return invokeSafe<AvailableModel[]>("get_available_models");
}

export async function getThinkingLevels(provider: string, modelId: string): Promise<string[]> {
  return invokeSafe<string[]>("get_thinking_levels", { provider, modelId });
}

// ── Model & Thinking ──

// Pending set_model requests awaiting the correlated pi rpc-response.
// `send_cmd!` in Rust is fire-and-forget: the Tauri command returns as soon
// as the JSON is written to pi's stdin. The actual switch result arrives
// asynchronously as an `rpc-response` event, which we correlate by `id`.
interface PendingSetModel {
  sessionId: string;
  resolve: () => void;
  reject: (err: Error) => void;
  settle: () => void;
}
const pendingSetModel = new Map<string, PendingSetModel>();
// Tauri's listen() is asynchronous. Keep its promise so a fast response
// cannot arrive before the correlation listener is registered.
let setModelListenerPromise: Promise<() => void> | null = null;

function attachSetModelResponseListener(): Promise<() => void> {
  if (setModelListenerPromise) return setModelListenerPromise;
  setModelListenerPromise = listen<PiOutboundEvent>("pi:event", (event) => {
    const ev = event.payload;
    if (ev.kind !== "rpc-response") return;
    const rpc = ev.event as { command?: string; success?: boolean; error?: string; id?: string };
    if (rpc.command !== "set_model" || !rpc.id) return;
    const pending = pendingSetModel.get(rpc.id);
    if (!pending || pending.sessionId !== ev.sessionId) return;
    pendingSetModel.delete(rpc.id);
    if (rpc.success) pending.resolve();
    else pending.reject(new Error(rpc.error || "set_model failed"));
  }).catch((error) => {
    setModelListenerPromise = null;
    throw error;
  });
  return setModelListenerPromise;
}

export async function setModel(sessionId: string, provider: string, modelId: string): Promise<void> {
  if (!modelId || modelId === "undefined" || modelId === "null") {
    throw new Error(`Invalid model ID: "${modelId}" for provider "${provider}". The model setting may be corrupted — please reconfigure in Settings.`);
  }
  await attachSetModelResponseListener();
  const id = crypto.randomUUID();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pendingSetModel.delete(id);
    };
    const timer = setTimeout(() => {
      settle();
      reject(new Error(`Model switch timed out for ${provider}/${modelId}`));
    }, 15000);
    pendingSetModel.set(id, {
      sessionId,
      resolve: () => { settle(); resolve(); },
      reject: (err) => { settle(); reject(err); },
      settle,
    });
    invokeSafe("set_model", { sessionId, provider, modelId, id }).catch((e) => {
      settle();
      reject(e instanceof Error ? e : new Error(String(e)));
    });
  });
}


/**
 * Strict validator for a model reference. Returns false for null/undefined,
 * missing/empty provider or id, or the literal strings "undefined"/"null"
 * (which is what corrupted localStorage serializes as).
 */
export function isValidModelRef(ref: { provider?: unknown; id?: unknown } | null | undefined): ref is { provider: string; id: string } {
  return (
    !!ref &&
    typeof ref.provider === "string" && ref.provider.trim() !== "" &&
    typeof ref.id === "string" && ref.id.trim() !== "" &&
    ref.id !== "undefined" && ref.id !== "null"
  );
}

export async function setThinkingLevel(sessionId: string, level: ThinkingLevel): Promise<void> {
  return invokeSafe("set_thinking_level", { sessionId, level });
}

// ── Steering / FollowUp / Compaction / Retry ──

export async function setSteeringMode(sessionId: string, mode: "all" | "one-at-a-time"): Promise<void> {
  return invokeSafe("set_steering_mode", { sessionId, mode });
}

export async function setFollowUpMode(sessionId: string, mode: "all" | "one-at-a-time"): Promise<void> {
  return invokeSafe("set_follow_up_mode", { sessionId, mode });
}

export async function setAutoCompaction(sessionId: string, enabled: boolean): Promise<void> {
  return invokeSafe("set_auto_compaction", { sessionId, enabled });
}

export async function setAutoRetry(sessionId: string, enabled: boolean): Promise<void> {
  return invokeSafe("set_auto_retry", { sessionId, enabled });
}

// ── Extension UI Response ──

export async function respondExtensionUi(
  sessionId: string,
  requestId: string,
  response: Record<string, unknown>,
): Promise<void> {
  return invokeSafe("respond_extension_ui", { sessionId, requestId, response });
}

// ── Session entries ──

export async function getEntries(
  sessionId: string,
  since?: string
): Promise<void> {
  return invokeSafe("get_entries", { sessionId, since: since ?? null });
}

export async function getTree(
  sessionId: string
): Promise<void> {
  return invokeSafe("get_tree", { sessionId });
}

export async function forkSession(sessionId: string, entryId: string): Promise<void> {
  return invokeSafe("fork", { sessionId, entryId });
}

export async function switchSession(sessionId: string, path: string): Promise<void> {
  return invokeSafe("switch_session", { sessionId, path });
}

export async function bash(sessionId: string, cmd: string): Promise<void> {
  return invokeSafe("bash_exec", { sessionId, command: cmd });
}

export async function compactSession(sessionId: string): Promise<void> {
  return invokeSafe("compact", { sessionId });
}

export async function exportHtml(sessionId: string, out?: string): Promise<{ path: string }> {
  return invokeSafe("export_html", { sessionId, out: out ?? null });
}

// ── Pi version ──

export async function getPiVersion(): Promise<string> {
  return invokeSafe<string>("get_pi_version");
}

export async function locatePi(): Promise<{ path: string; version: string }> {
  return invokeSafe<{ path: string; version: string }>("locate_pi");
}

// ── Session persistence ──

export async function listPiSessions(): Promise<PiSessionMeta[]> {
  return invokeSafe<PiSessionMeta[]>("list_pi_sessions");
}

export async function loadSessionEntries(sessionId: string): Promise<SessionEntryVm[]> {
  return invokeSafe<SessionEntryVm[]>("load_session_entries", { sessionId });
}

// ── Pi config files ──

export async function readPiFile(filename: string): Promise<string> {
  return invokeSafe<string>("read_pi_file", { filename });
}

export async function writePiFile(filename: string, content: string): Promise<void> {
  return invokeSafe("write_pi_file", { filename, content });
}

export async function listPiFiles(): Promise<string[]> {
  return invokeSafe<string[]>("list_pi_files");
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
  return invokeSafe("add_model", {
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
  return invokeSafe("remove_model", { provider, modelId });
}

export interface FetchedModel {
  id: string;
  owned_by?: string;
}

export async function fetchModelsFromUrl(baseUrl: string, apiKey?: string): Promise<FetchedModel[]> {
  return invokeSafe<FetchedModel[]>("fetch_models_from_url", { baseUrl, apiKey });
}

export async function deletePiSession(sessionId: string): Promise<void> {
  return invokeSafe("delete_pi_session", { sessionId });
}

export async function saveUserdata(data: Record<string, unknown>): Promise<void> {
  return invokeSafe("save_userdata", { data });
}

export async function loadUserdata(): Promise<Record<string, unknown>> {
  return invokeSafe<Record<string, unknown>>("load_userdata");
}

export async function getSessionsDir(): Promise<string> {
  return invokeSafe<string>("get_sessions_dir");
}

export async function checkPiHealth(sessionId: string): Promise<boolean> {
  return invokeSafe<boolean>("check_pi_health", { sessionId });
}

// ── Image display ──

/** Return a `data:` URL for a local image so the conversation can render attachments. */
export async function imageToDataUrl(path: string): Promise<string> {
  return invokeSafe<string>("image_to_data_url", { path });
}

export async function restartSession(sessionId: string, cwd: string): Promise<void> {
  return invokeSafe("restart_session", { sessionId, cwd });
}

// ── Startup Diagnostics ──

export interface CheckItem { ok: boolean; detail: string; }
export interface DiagnosticError { component: string; message: string; }
export interface StartupDiagnostics {
  ok: boolean;
  pi_bundle: {
    node: CheckItem;
    package_json: CheckItem;
    rpc_entry: CheckItem;
    index_entry: CheckItem;
    node_modules: CheckItem;
  };
  user_data: { pi_agent_dir: string; readable: boolean; writable: boolean };
  versions: { app_version: string; bundled_pi_version?: string };
  errors: DiagnosticError[];
}

export async function runStartupDiagnostics(): Promise<StartupDiagnostics> {
  return invokeSafe<StartupDiagnostics>("run_startup_diagnostics");
}

export async function exportDiagnostics(): Promise<string> {
  return invokeSafe<string>("export_diagnostics");
}

// ── Events (Main → Renderer) ──

export function onPiEvent(handler: (event: PiOutboundEvent) => void): () => void {
  const unlisten = listen<PiOutboundEvent>("pi:event", (e) => handler(e.payload));
  return () => {
    unlisten.then((fn) => fn());
  };
}

/**
 * Subscribe to backend model-catalog changes (add_model / remove_model emit
 * "models:changed"). The frontend refreshes its cached list from the single
 * source of truth (the merged catalog) instead of mutating it locally.
 */
export function onModelsChanged(handler: () => void): () => void {
  const unlisten = listen("models:changed", () => handler());
  return () => {
    unlisten.then((fn) => fn());
  };
}
