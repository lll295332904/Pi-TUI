mod pi_locator;
mod pi_kernel;
mod commands;
#[allow(dead_code)]
mod error;
mod logger;
mod windows_setup;

use pi_kernel::PiKernelManager;
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct AppState {
    pub kernel: Arc<Mutex<PiKernelManager>>,
    pub logger: Arc<logger::Logger>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let kernel = Arc::new(Mutex::new(PiKernelManager::new()));
    let logger = Arc::new(logger::Logger::new());
    match windows_setup::ensure_user_registry() {
        Ok(()) => logger.info("Per-user Windows registry initialized"),
        Err(error) => logger.warn(&format!("Per-user Windows registry initialization skipped: {}", error)),
    }
    match windows_setup::ensure_aumid_registration() {
        Ok(()) => logger.info("AppUserModelID registration ensured"),
        Err(error) => logger.warn(&format!("AppUserModelID registration skipped: {}", error)),
    }

    // Windows toast notifications require a stable AppUserModelID on the
    // process. The installed app sets it via the bundle, but dev mode does
    // not, so set it explicitly to make system notifications work there too.
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
        let app_id: Vec<u16> = "com.pidesk.app".encode_utf16().chain(std::iter::once(0)).collect();
        // SAFETY: app_id is a null-terminated UTF-16 buffer valid for the call duration.
        unsafe {
            let _ = SetCurrentProcessExplicitAppUserModelID(app_id.as_ptr());
        }
    }

    let kernel_shutdown = kernel.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AppState { kernel, logger })
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
            commands::rpc_cmds::prompt,
            commands::rpc_cmds::steer,
            commands::rpc_cmds::follow_up,
            commands::rpc_cmds::abort,
            commands::models::get_available_models,
            commands::models::get_thinking_levels,
            commands::rpc_cmds::set_model,
            commands::rpc_cmds::set_thinking_level,
            commands::rpc_cmds::set_steering_mode,
            commands::rpc_cmds::set_follow_up_mode,
            commands::rpc_cmds::set_auto_compaction,
            commands::rpc_cmds::set_auto_retry,
            commands::rpc_cmds::respond_extension_ui,
            commands::rpc_cmds::get_entries,
            commands::rpc_cmds::get_tree,
            commands::rpc_cmds::fork_session,
            commands::rpc_cmds::switch_session,
            commands::rpc_cmds::bash_exec,
            commands::rpc_cmds::compact,
            commands::rpc_cmds::export_html,
            commands::rpc_cmds::new_session,
            commands::pi_files::read_pi_file,
            commands::pi_files::write_pi_file,
            commands::pi_files::list_pi_files,
            commands::models::add_model,
            commands::models::remove_model,
            commands::providers::fetch_models_from_url,
            commands::userdata::save_userdata,
            commands::userdata::load_userdata,
            commands::clipboard::save_pasted_image,
            commands::clipboard::save_pasted_rgba,
            commands::images::image_to_data_url,
            commands::diagnostics::run_startup_diagnostics,
            commands::diagnostics::export_diagnostics,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
