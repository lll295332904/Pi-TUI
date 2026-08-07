use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// Simple file logger for PiDesk backend
pub struct Logger {
    file: Mutex<Option<File>>,
    path: PathBuf,
}

impl Logger {
    pub fn new() -> Self {
        let dir = get_log_dir();
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("app.log");
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .ok();

        let logger = Self {
            file: Mutex::new(file),
            path,
        };

        logger.info(&format!("PiDesk starting v{}", env!("CARGO_PKG_VERSION")));
        logger
    }

    pub fn info(&self, msg: &str) { self.log("INFO", msg); }
    pub fn warn(&self, msg: &str) { self.log("WARN", msg); }
    pub fn error(&self, msg: &str) { self.log("ERROR", msg); }

    fn log(&self, level: &str, msg: &str) {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| format!("{}.{:03}", d.as_secs(), d.subsec_millis()))
            .unwrap_or_else(|_| "0".into());
        let line = format!("[{}] {} {}\n", ts, level, msg);
        if let Ok(mut guard) = self.file.lock() {
            if let Some(ref mut f) = *guard {
                let _ = f.write_all(line.as_bytes());
                let _ = f.flush();
            }
        }
        #[cfg(debug_assertions)]
        eprint!("{}", line);
    }

    pub fn log_path(&self) -> &PathBuf { &self.path }
    pub fn log_dir(&self) -> PathBuf { get_log_dir() }
}

fn get_log_dir() -> PathBuf {
    let appdata = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
    PathBuf::from(appdata).join("PiDesk").join("logs")
}

/// Sanitize a string for logging by masking API keys
pub fn sanitize_key(s: &str) -> String {
    if s.len() <= 8 { return "***".into(); }
    format!("{}...{}", &s[..4], &s[s.len()-4..])
}
