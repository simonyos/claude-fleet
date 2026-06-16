use serde_json::json;
use std::fs;
use std::path::PathBuf;

fn config_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".claude-fleet"))
}

fn fleet_mcp_binary() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.join("fleet-mcp")))
}

pub fn write_config() -> Result<PathBuf, String> {
    let dir = config_dir().ok_or_else(|| "HOME not set".to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let bin = fleet_mcp_binary()
        .ok_or_else(|| "could not resolve fleet-mcp binary path".to_string())?;

    let config = json!({
        "mcpServers": {
            "claude-fleet": {
                "type": "stdio",
                "command": bin.to_string_lossy(),
                "args": [],
                "env": {}
            }
        }
    });

    let path = dir.join("mcp.json");
    fs::write(&path, serde_json::to_string_pretty(&config).unwrap())
        .map_err(|e| e.to_string())?;
    Ok(path)
}

#[tauri::command]
pub fn get_mcp_config_path() -> Result<String, String> {
    let path = write_config()?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_fleet_mcp_binary_path() -> Result<String, String> {
    let path = fleet_mcp_binary()
        .ok_or_else(|| "could not resolve fleet-mcp binary path".to_string())?;
    Ok(path.to_string_lossy().to_string())
}
