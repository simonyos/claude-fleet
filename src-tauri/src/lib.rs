pub mod app_state;
mod bus;
mod claude_sessions;
mod codex_chat;
mod mcp_config;
mod pty;

use claude_sessions::ClaudeSessionWatchers;
use pty::PtyRegistry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let registry = PtyRegistry::default();
    let bus_registry = registry.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(registry)
        .manage(ClaudeSessionWatchers::default())
        .setup(move |_app| {
            bus::start(bus_registry.clone());
            if let Err(e) = mcp_config::write_config() {
                eprintln!("claude-fleet: failed to write MCP config: {}", e);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pty::spawn_pty,
            pty::read_pty_buffer,
            pty::write_pty,
            pty::resize_pty,
            pty::kill_pty,
            app_state::load_fleet_state,
            app_state::save_fleet_state,
            app_state::record_manual_message,
            app_state::get_mailbox_root,
            app_state::open_project_workspace,
            app_state::create_project_workspace,
            claude_sessions::read_claude_transcript,
            claude_sessions::watch_claude_transcript,
            claude_sessions::stop_claude_transcript_watch,
            codex_chat::run_orchestrator_chat,
            mcp_config::get_mcp_config_path,
            mcp_config::get_fleet_mcp_binary_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
