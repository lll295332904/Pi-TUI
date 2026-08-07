use serde::Serialize;

/// Unified application error with machine-readable code and recovery hints.
#[derive(Debug, Clone, Serialize, thiserror::Error)]
pub enum AppError {
    #[error("Pi runtime not found: {detail}")]
    PiRuntimeMissing { detail: String },

    #[error("Pi start failed: {detail}")]
    PiStartFailed { detail: String },

    #[error("Pi process exited unexpectedly: {detail}")]
    PiProcessExited { detail: String },

    #[error("Provider authentication failed: {detail}")]
    ProviderAuthFailed { detail: String },

    #[error("Provider network error: {detail}")]
    ProviderNetworkFailed { detail: String },

    #[error("Model not found: {detail}")]
    ModelNotFound { detail: String },

    #[error("Config read failed: {detail}")]
    ConfigReadFailed { detail: String },

    #[error("Config write failed: {detail}")]
    ConfigWriteFailed { detail: String },

    #[error("Session file not found: {detail}")]
    SessionFileNotFound { detail: String },

    #[error("User data dir not accessible: {detail}")]
    UserDataNotAccessible { detail: String },

    #[error("Internal error: {detail}")]
    Internal { detail: String },
}

impl AppError {
    /// Error code string for frontend routing
    pub fn code(&self) -> &'static str {
        match self {
            AppError::PiRuntimeMissing { .. } => "PI_RUNTIME_MISSING",
            AppError::PiStartFailed { .. } => "PI_START_FAILED",
            AppError::PiProcessExited { .. } => "PI_PROCESS_EXITED",
            AppError::ProviderAuthFailed { .. } => "PROVIDER_AUTH_FAILED",
            AppError::ProviderNetworkFailed { .. } => "PROVIDER_NETWORK_FAILED",
            AppError::ModelNotFound { .. } => "MODEL_NOT_FOUND",
            AppError::ConfigReadFailed { .. } => "CONFIG_READ_FAILED",
            AppError::ConfigWriteFailed { .. } => "CONFIG_WRITE_FAILED",
            AppError::SessionFileNotFound { .. } => "SESSION_FILE_NOT_FOUND",
            AppError::UserDataNotAccessible { .. } => "USER_DATA_NOT_ACCESSIBLE",
            AppError::Internal { .. } => "INTERNAL",
        }
    }

    /// Whether the error has a known recovery action
    pub fn recoverable(&self) -> bool {
        match self {
            AppError::PiRuntimeMissing { .. } => true,
            AppError::PiStartFailed { .. } => true,
            AppError::PiProcessExited { .. } => true,
            AppError::ProviderAuthFailed { .. } => true,
            AppError::ProviderNetworkFailed { .. } => true,
            AppError::ModelNotFound { .. } => true,
            AppError::ConfigReadFailed { .. } => true,
            AppError::ConfigWriteFailed { .. } => true,
            AppError::SessionFileNotFound { .. } => true,
            AppError::UserDataNotAccessible { .. } => true,
            AppError::Internal { .. } => false,
        }
    }

    /// Suggested action label and command for recovery
    pub fn action(&self) -> Option<(&'static str, &'static str)> {
        match self {
            AppError::PiRuntimeMissing { .. } => Some(("Reinstall PiDesk", "reinstall")),
            AppError::PiStartFailed { .. } => Some(("Restart Pi Kernel", "restart_pi")),
            AppError::PiProcessExited { .. } => Some(("Restart Pi Kernel", "restart_pi")),
            AppError::ProviderAuthFailed { .. } => Some(("Open Settings", "open_settings")),
            AppError::ProviderNetworkFailed { .. } => Some(("Check Network", "check_network")),
            AppError::ModelNotFound { .. } => Some(("Add Model", "add_model")),
            AppError::ConfigReadFailed { .. } => Some(("Restore Backup", "restore_backup")),
            AppError::ConfigWriteFailed { .. } => Some(("Check Permissions", "check_permissions")),
            AppError::SessionFileNotFound { .. } => Some(("Return to Home", "go_home")),
            AppError::UserDataNotAccessible { .. } => Some(("Check Permissions", "check_permissions")),
            AppError::Internal { .. } => None,
        }
    }

    /// Serialize to frontend-friendly JSON value
    pub fn to_dto(&self) -> AppErrorDto {
        let (label, command) = self.action().unzip();
        AppErrorDto {
            code: self.code().to_string(),
            message: self.to_string(),
            recoverable: self.recoverable(),
            action_label: label.map(String::from),
            action_command: command.map(String::from),
        }
    }
}

/// Frontend-friendly error DTO
#[derive(Debug, Clone, Serialize)]
pub struct AppErrorDto {
    pub code: String,
    pub message: String,
    pub recoverable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_command: Option<String>,
}

/// Helper to convert common errors into AppError
impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        match e.kind() {
            std::io::ErrorKind::NotFound => AppError::SessionFileNotFound { detail: e.to_string() },
            std::io::ErrorKind::PermissionDenied => AppError::UserDataNotAccessible { detail: e.to_string() },
            _ => AppError::Internal { detail: e.to_string() },
        }
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::ConfigReadFailed { detail: e.to_string() }
    }
}
