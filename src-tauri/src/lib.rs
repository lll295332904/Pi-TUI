mod pi_locator;
mod pi_kernel;
mod commands;
#[allow(dead_code)]
mod error;
#[allow(dead_code)]
mod logger;

use pi_kernel::PiKernelManager;
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct AppState {
    pub kernel: Arc<Mutex<PiKernelManager>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let kernel = Arc::new(Mutex::new(PiKernelManager::new()));
    let kernel_shutdown = kernel.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState { kernel })
        .on_window_event(move |window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Prevent immediate close, flush Pi sessions first
                api.prevent_close();
                let k = kernel_shutdown.clone();
                let w = window.clone();
                tauri::async_runtime::spawn(async move {
                    let mut mgr = k.lock().await;
                    mgr.shutdown_all().await;
                    // Use destroy() instead of close() to avoid re-triggering CloseRequested
                    let _ = w.destroy();
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::session::start_session,
            commands::session::stop_session,
            commands::session::locate_pi,
            commands::session::get_pi_version_cmd,
            commands::session::list_pi_sessions,
            commands::session::load_session_entries,
            commands::session::check_pi_health,
            commands::session::restart_session,
            commands::session::get_sessions_dir,
            commands::session::delete_pi_session,
            commands::prompt_cmds::prompt,
            commands::prompt_cmds::steer,
            commands::prompt_cmds::follow_up,
            commands::prompt_cmds::abort,
            commands::prompt_cmds::get_available_models,
            commands::prompt_cmds::get_thinking_levels,
            commands::prompt_cmds::set_model,
            commands::prompt_cmds::set_thinking_level,
            commands::prompt_cmds::set_steering_mode,
            commands::prompt_cmds::set_follow_up_mode,
            commands::prompt_cmds::set_auto_compaction,
            commands::prompt_cmds::set_auto_retry,
            commands::prompt_cmds::respond_extension_ui,
            commands::prompt_cmds::get_entries,
            commands::prompt_cmds::get_tree,
            commands::prompt_cmds::fork_session,
            commands::prompt_cmds::switch_session,
            commands::prompt_cmds::bash_exec,
            commands::prompt_cmds::compact,
            commands::prompt_cmds::export_html,
            commands::prompt_cmds::new_session,
            commands::prompt_cmds::read_pi_file,
            commands::prompt_cmds::write_pi_file,
            commands::prompt_cmds::list_pi_files,
            commands::prompt_cmds::add_model,
            commands::prompt_cmds::remove_model,
            commands::prompt_cmds::fetch_models_from_url,
            commands::prompt_cmds::save_userdata,
            commands::prompt_cmds::load_userdata,
            commands::diagnostics::run_startup_diagnostics,
            commands::diagnostics::export_diagnostics,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
