use crate::pi_locator::find_pi_cli;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use thiserror::Error;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command as TokioCommand};
use tokio::sync::Mutex;
use uuid::Uuid;

// ── Windows console UTF-8 setup ──

/// Ensure the process has a console with UTF-8 (CP 65001) code pages.
///
/// On Windows, child processes (cmd.exe, bash.exe) inherit the parent's
/// console code page. The system default is GBK (CP 936) on Chinese Windows,
/// which causes Pi to capture garbled Chinese text from tool outputs.
///
/// This function:
/// 1. If no console exists (GUI app), allocates a hidden one.
/// 2. Sets both input and output code pages to UTF-8 (65001).
///
/// Must be called before spawning Pi so that Pi and its children inherit
/// the UTF-8 console.
#[cfg(windows)]
fn ensure_utf8_console() {
    use windows_sys::Win32::System::Console::{
        AllocConsole, GetConsoleWindow, SetConsoleCP, SetConsoleOutputCP,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::ShowWindow;

    const CP_UTF8: u32 = 65001;
    const SW_HIDE: i32 = 0;

    unsafe {
        // If no console exists, allocate a hidden one
        if GetConsoleWindow().is_null() {
            if AllocConsole() != 0 {
                let hwnd = GetConsoleWindow();
                if !hwnd.is_null() {
                    ShowWindow(hwnd, SW_HIDE);
                }
            }
        }
        // Set console code pages to UTF-8
        SetConsoleOutputCP(CP_UTF8);
        SetConsoleCP(CP_UTF8);
    }
}

#[cfg(not(windows))]
fn ensure_utf8_console() {}

#[derive(Error, Debug)]
pub enum PiError {
    #[error("Pi CLI not found: {0}")]
    CliNotFound(String),
    #[error("Process error: {0}")]
    Process(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Session error: {0}")]
    Session(String),
}

pub type PiResult<T> = Result<T, PiError>;

// ── JSONL message types ──

/// Request sent to Pi stdin
#[derive(Debug, Serialize)]
#[serde(tag = "type")]
pub enum PiRequest {
    #[serde(rename = "prompt")]
    Prompt { message: String, images: Vec<String> },
    #[serde(rename = "steer")]
    Steer { message: String },
    #[serde(rename = "follow_up")]
    FollowUp { message: String },
    #[serde(rename = "abort")]
    Abort,
    #[serde(rename = "set_model")]
    SetModel { provider: String, model: String },
    #[serde(rename = "set_thinking_level")]
    SetThinkingLevel { level: String },
    #[serde(rename = "get_entries")]
    GetEntries { since: Option<String> },
    #[serde(rename = "get_tree")]
    GetTree,
    #[serde(rename = "fork")]
    Fork { entry_id: String },
    #[serde(rename = "switch_session")]
    SwitchSession { path: String },
    #[serde(rename = "bash")]
    Bash { command: String },
    #[serde(rename = "compact")]
    Compact,
    #[serde(rename = "export_html")]
    ExportHtml { out: Option<String> },
    #[serde(rename = "set_steering_mode")]
    SetSteeringMode { mode: String },
    #[serde(rename = "set_follow_up_mode")]
    SetFollowUpMode { mode: String },
    #[serde(rename = "set_auto_compaction")]
    SetAutoCompaction { enabled: bool },
    #[serde(rename = "set_auto_retry")]
    SetAutoRetry { enabled: bool },
    #[serde(rename = "extension_ui_response")]
    ExtensionUiResponse {
        id: String,
        #[serde(flatten)]
        data: Value,
    },
}

/// What we send to the frontend: { sessionId, kind: "agent-event", event }
#[derive(Debug, Clone, Serialize)]
pub struct PiOutboundEvent {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event: Option<Value>,
}

// ── Session ──

struct Session {
    #[allow(dead_code)]
    session_id: String,
    stdin: Mutex<ChildStdin>,
    #[allow(dead_code)]
    child: Child,
}

// ── Kernel Manager ──

pub struct PiKernelManager {
    sessions: HashMap<String, Session>,
}

impl PiKernelManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    /// Start a new Pi RPC session. Returns the session ID.
    pub async fn start_session(
        &mut self,
        app: AppHandle,
        cwd: String,
        provider: Option<String>,
        model: Option<String>,
    ) -> PiResult<String> {
        let cli_path = find_pi_cli().map_err(|e| PiError::CliNotFound(e))?;
        let session_id = Uuid::new_v4().to_string();

        // Build args: pi --mode rpc ...
        let mut cmd = TokioCommand::new(&cli_path);
        cmd.arg("--mode").arg("rpc");
        cmd.current_dir(&cwd);
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        cmd.kill_on_drop(true);

        // Suppress console window on Windows when launching .cmd scripts
        #[cfg(windows)]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        // Set environment for provider/model if specified
        if let Some(ref p) = provider {
            cmd.env("PI_PROVIDER", p);
        }
        if let Some(ref m) = model {
            cmd.env("PI_MODEL", m);
        }

        // Ensure UTF-8 console code page so Pi's child processes (cmd/bash)
        // output UTF-8 instead of system-default GBK on Chinese Windows.
        ensure_utf8_console();

        let mut child = cmd.spawn()?;

        let stdout = child.stdout.take().expect("stdout not available");
        let stdin = child.stdin.take().expect("stdin not available");
        let stderr = child.stderr.take().expect("stderr not available");

        let sid1 = session_id.clone();
        let sid2 = session_id.clone();
        let app1 = app.clone();
        let app2 = app.clone();

        // Spawn task to read stdout lines and emit events
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let line = line.trim().to_string();
                if line.is_empty() {
                    continue;
                }

                // Pi RPC sends bare agent events like {"type":"message_update",...}
                // (NOT wrapped in {"type":"event","event":{...}}).
                // Parse as generic JSON, then route by top-level "type".
                if let Ok(val) = serde_json::from_str::<Value>(&line) {
                    let msg_type = val.get("type").and_then(|t| t.as_str()).unwrap_or("");
                    match msg_type {
                        "response" => {
                            // RPC response (e.g. from get_available_models, get_state, etc.)
                            let ev = PiOutboundEvent {
                                session_id: sid1.clone(),
                                kind: "rpc-response".into(),
                                event: Some(val),
                            };
                            let _ = app1.emit("pi:event", &ev);
                        }
                        "error" => {
                            let ev = PiOutboundEvent {
                                session_id: sid1.clone(),
                                kind: "error".into(),
                                event: Some(val),
                            };
                            let _ = app1.emit("pi:event", &ev);
                        }
                        "extension_ui_request" => {
                            // Pi requests UI interaction (confirm, select, input, etc.)
                            let ev = PiOutboundEvent {
                                session_id: sid1.clone(),
                                kind: "extension-ui-request".into(),
                                event: Some(val),
                            };
                            let _ = app1.emit("pi:event", &ev);
                        }
                        _ => {
                            // All agent events: message_start, message_update,
                            // message_end, turn_end, agent_end, agent_settled,
                            // tool_execution_start/update/end, system_info, etc.
                            let ev = PiOutboundEvent {
                                session_id: sid1.clone(),
                                kind: "agent-event".into(),
                                event: Some(val),
                            };
                            let _ = app1.emit("pi:event", &ev);
                        }
                    }
                } else {
                    // Not valid JSON – forward as stderr for diagnostics
                    let ev = PiOutboundEvent {
                        session_id: sid1.clone(),
                        kind: "stderr".into(),
                        event: Some(serde_json::json!({ "line": line })),
                    };
                    let _ = app1.emit("pi:event", &ev);
                }
            }

            // Process exited
            let ev = PiOutboundEvent {
                session_id: sid1.clone(),
                kind: "process-exit".into(),
                event: None,
            };
            let _ = app1.emit("pi:event", &ev);
        });

        // Spawn task to read stderr and forward to frontend for diagnostics
        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let ev = PiOutboundEvent {
                    session_id: sid2.clone(),
                    kind: "stderr".into(),
                    event: Some(serde_json::json!({ "line": line })),
                };
                let _ = app2.emit("pi:event", &ev);
            }
        });

        let session = Session {
            session_id: session_id.clone(),
            stdin: Mutex::new(stdin),
            child,
        };

        self.sessions.insert(session_id.clone(), session);
        Ok(session_id)
    }

    /// Send a JSON request to a session's stdin
    pub async fn send_request(&self, session_id: &str, req: &PiRequest) -> PiResult<()> {
        let session = self.sessions.get(session_id)
            .ok_or_else(|| PiError::Session(format!("Session {} not found", session_id)))?;

        let json = serde_json::to_string(req)? + "\n";
        let mut stdin = session.stdin.lock().await;
        stdin.write_all(json.as_bytes()).await?;
        stdin.flush().await?;
        Ok(())
    }

    /// Stop a session (kill the child process)
    pub async fn stop_session(&mut self, session_id: &str) -> PiResult<()> {
        if let Some(mut session) = self.sessions.remove(session_id) {
            let _ = session.child.kill().await;
        }
        Ok(())
    }

    /// Check if a session's Pi process is still running
    pub async fn is_alive(&mut self, session_id: &str) -> bool {
        if let Some(session) = self.sessions.get_mut(session_id) {
            match session.child.try_wait() {
                Ok(None) => true,
                _ => false,
            }
        } else {
            false
        }
    }
}
