// ── Pi RPC types (mirror @earendil-works/pi-coding-agent) ──

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export interface ModelInfo {
  provider: string;
  model: string;
  displayName?: string;
}

export interface SessionEntry {
  id: string;
  role: "user" | "assistant" | "system";
  content: unknown;
  timestamp?: string;
  parentId?: string | null;
}

export interface SessionTreeNode {
  id: string;
  entries: Array<{ id: string; role: string }>;
  children: SessionTreeNode[];
}

export interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ImageRef {
  path: string;
  type: "data" | "file";
}

// ── Agent events (forwarded from Pi) ──
// Pi 0.82 RPC sends bare events like {"type":"message_update","assistantMessageEvent":{...}}
// We use a loose type to avoid brittle coupling to every variant.

export interface AssistantMessageEvent {
  type: string; // text_delta | text_end | thinking_delta | thinking_end | tool_use | ...
  contentIndex?: number;
  delta?: string;
  content?: string;
  partial?: unknown;
  [key: string]: unknown;
}

export interface PiMessage {
  role?: string;
  content?: Array<{ type: string; [key: string]: unknown }>;
}

export interface PiRawAgentEvent {
  type: string;
  // message_update carries assistantMessageEvent
  assistantMessageEvent?: AssistantMessageEvent;
  // message_end / turn_end carry a full message
  message?: PiMessage;
  // agent_end carries all messages
  messages?: PiMessage[];
  // system_info
  text?: string;
  // model_changed
  provider?: string;
  model?: string;
  // tool_execution_*
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: string;
  result?: unknown;
  isError?: boolean;
  isDelta?: boolean;
  // agent_retrying
  reason?: string;
  [key: string]: unknown;
}

export interface PiEvent {
  sessionId: string;
  kind: "agent-event";
  event: PiRawAgentEvent;
}

export interface ApprovalRequest {
  sessionId: string;
  kind: "approval-request";
  requestId: string;
  toolName: string;
  input: unknown;
  title: string;
  message: string;
}

export interface SessionState {
  sessionId: string;
  kind: "state";
  state: RpcSessionState;
}

export interface ProcessExit {
  sessionId: string;
  kind: "process-exit";
  code: number;
  stderr: string;
}

export interface ResultEvent {
  sessionId: string;
  kind: "result";
  event: unknown;
}

export interface RpcResponseEvent {
  sessionId: string;
  kind: "rpc-response";
  event: { id?: string; command?: string; success?: boolean; data?: unknown; error?: string; [key: string]: unknown };
}

export interface ExtensionUiRequestEvent {
  sessionId: string;
  kind: "extension-ui-request";
  event: { id: string; method: string; title?: string; message?: string; [key: string]: unknown };
}

export type PiOutboundEvent = PiEvent | ApprovalRequest | SessionState | ProcessExit | StderrEvent | ErrorEvent | ResultEvent | RpcResponseEvent | ExtensionUiRequestEvent;

export interface StderrEvent {
  sessionId: string;
  kind: "stderr";
  event: { line: string };
}

export interface ErrorEvent {
  sessionId: string;
  kind: "error";
  event: { message?: string; [key: string]: unknown };
}

export interface RpcSessionState {
  status: "idle" | "streaming" | "compacting" | "retrying";
  model?: { provider: string; id: string };
  thinkingLevel?: ThinkingLevel;
}

// ── Session persistence ──

export interface PiSessionMeta {
  id: string;          // file-level ID: "dirname/filename" (globally unique)
  cwd: string;         // decoded working directory
  name: string;        // auto-generated from first user message (first 24 chars)
  last_modified: number;
  entry_count: number;
}

export interface SessionEntryVm {
  id: string;
  type: string;
  parent_id: string | null;
  role: string | null;      // "user" | "assistant"
  content: string | null;   // text content
  thinking: string | null;  // thinking content
  timestamp: string | null;
}

// ── Frontend ViewModel ──

export type SessionStatus = "idle" | "streaming" | "compacting" | "retrying";

export interface SessionVM {
  id: string;
  name: string;
  cwd: string;
  fileId?: string;          // persistent file-level ID ("dirname/filename"), set when resuming
  workspaceCwd?: string;   // if set, belongs to this workspace; undefined = standalone
  model?: { provider: string; id: string };
  thinkingLevel: ThinkingLevel;
  status: SessionStatus;
}

export interface MessageVM {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  thinking?: string;
  streaming: boolean;
  images?: ImageRef[];
  timestamp: number;
}

export interface ToolCallVM {
  toolCallId: string;
  toolName: string;
  input: unknown;
  result?: unknown;
  output?: string;
  isError: boolean;
  state: "running" | "done";
  timestamp: number;
}

export type TimelineItem =
  | ({ type: "user" } & MessageVM)
  | ({ type: "assistant" } & MessageVM)
  | ({ type: "system-info"; text: string; timestamp: number })
  | ({ type: "tool" } & ToolCallVM);

export interface ApprovalRequestVM {
  requestId: string;
  toolName: string;
  input: unknown;
  title: string;
  message: string;
}

// ── Available model (from models-store.json) ──

export interface AvailableModel {
  provider: string;
  id: string;
  name: string;
  reasoning: boolean;
  contextWindow: number;
  supportsVision: boolean;
  thinkingLevels: string[];
}

// ── Extension UI request (from Pi RPC) ──

export interface ExtensionUiRequest {
  sessionId: string;
  id: string;           // request id for correlation
  method: "confirm" | "select" | "input" | "notify" | "editor" | string;
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  [key: string]: unknown;
}

// ── PiDesk settings (persisted) ──

export interface PiDeskSettings {
  defaultModel: { provider: string; id: string } | null;
  defaultThinkingLevel: ThinkingLevel;
  defaultCwd: string;
  autoCompaction: boolean;
  autoRetry: boolean;
  steeringMode: "all" | "one-at-a-time";
  followUpMode: "all" | "one-at-a-time";
  roleModels: RoleModels;
}

// ── Role-specific models (Hermes-style) ──

export type ModelRef = { provider: string; id: string };

export interface RoleModels {
  main: ModelRef | null;
  vision: ModelRef | null;
  web: ModelRef | null;
  compression: ModelRef | null;
  skills: ModelRef | null;
  approval: ModelRef | null;
  title: ModelRef | null;
  maintenance: ModelRef | null;
  mcp: ModelRef | null;
  subAgent: ModelRef | null;
}

export const ROLE_LABELS: Record<keyof RoleModels, string> = {
  main: "Main Agent",
  vision: "Vision (Image)",
  web: "Web Extraction",
  compression: "Compression",
  skills: "Skills Center",
  approval: "Approval",
  title: "Title Generation",
  maintenance: "Maintenance",
  mcp: "MCP",
  subAgent: "Sub-Agent",
};

export const ROLE_ORDER: (keyof RoleModels)[] = [
  "main", "subAgent", "vision", "web", "compression",
  "skills", "approval", "title", "maintenance", "mcp",
];

/** Roles that Pi does not expose events for — shown gray in UI */
export const DISCONNECTED_ROLES: Set<keyof RoleModels> = new Set([
  "skills", "mcp", "subAgent", "maintenance",
]);

// ── Toast notifications ──

export interface ToastItem {
  id: string;
  type: "success" | "warning" | "info" | "error";
  title: string;
  message?: string;
  durationMs?: number; // 0 = sticky
}

export interface ProjectVM {
  cwd: string;         // unique identifier
  name: string;        // user-defined project name
  createdAt: number;
}

// ── Pinned items ──

export interface PinnedItems {
  sessions: string[];  // session IDs
  projects: string[];  // project cwds
}
