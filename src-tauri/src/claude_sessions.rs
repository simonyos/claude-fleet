use parking_lot::Mutex;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

#[derive(Clone, Default)]
pub struct ClaudeSessionWatchers {
    stops: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    bindings: Arc<Mutex<HashMap<String, PathBuf>>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeTranscript {
    session_id: Option<String>,
    session_path: Option<String>,
    updated_at: Option<String>,
    messages: Vec<ClaudeTranscriptMessage>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeTranscriptMessage {
    id: String,
    role: String,
    body: String,
    created_at: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeTranscriptEvent {
    agent_id: String,
    transcript: ClaudeTranscript,
}

fn claude_projects_dir() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or_else(|| "HOME not set".to_string())?;
    Ok(PathBuf::from(home).join(".claude").join("projects"))
}

fn claude_project_dir_name(path: &Path) -> String {
    path.to_string_lossy()
        .chars()
        .map(|ch| if ch == '/' || ch == '\\' { '-' } else { ch })
        .collect()
}

fn transcript_candidates(cwd: &Path) -> Result<Vec<PathBuf>, String> {
    let root = claude_projects_dir()?;
    let mut candidates = Vec::new();

    let direct_dir = root.join(claude_project_dir_name(cwd));
    if direct_dir.exists() {
        for entry in fs::read_dir(&direct_dir).map_err(|e| e.to_string())? {
            let path = entry.map_err(|e| e.to_string())?.path();
            if path.extension().and_then(|ext| ext.to_str()) == Some("jsonl") {
                candidates.push(path);
            }
        }
    }

    if candidates.is_empty() && root.exists() {
        for project_entry in fs::read_dir(root).map_err(|e| e.to_string())? {
            let project_path = project_entry.map_err(|e| e.to_string())?.path();
            if !project_path.is_dir() {
                continue;
            }
            for entry in fs::read_dir(project_path).map_err(|e| e.to_string())? {
                let path = entry.map_err(|e| e.to_string())?.path();
                if path.extension().and_then(|ext| ext.to_str()) == Some("jsonl") {
                    candidates.push(path);
                }
            }
        }
    }

    candidates.sort_by_key(|path| {
        fs::metadata(path)
            .and_then(|metadata| metadata.modified())
            .ok()
    });
    candidates.reverse();
    Ok(candidates)
}

fn read_tail(path: &Path, max_bytes: u64) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let len = file.metadata().map_err(|e| e.to_string())?.len();
    let start = len.saturating_sub(max_bytes);
    file.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;

    let mut text = String::new();
    file.read_to_string(&mut text).map_err(|e| e.to_string())?;
    if start > 0 {
        if let Some((_, rest)) = text.split_once('\n') {
            return Ok(rest.to_string());
        }
    }
    Ok(text)
}

fn text_from_content(content: &Value) -> Option<String> {
    match content {
        Value::String(text) => {
            let trimmed = text.trim();
            (!trimmed.is_empty()).then(|| trimmed.to_string())
        }
        Value::Array(blocks) => {
            let parts: Vec<String> = blocks
                .iter()
                .filter_map(|block| {
                    let block_type = block.get("type").and_then(Value::as_str);
                    match block_type {
                        Some("text") => block
                            .get("text")
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|text| !text.is_empty())
                            .map(ToOwned::to_owned),
                        Some("tool_use") => block
                            .get("name")
                            .and_then(Value::as_str)
                            .map(|name| format!("[tool: {}]", name)),
                        _ => None,
                    }
                })
                .collect();
            (!parts.is_empty()).then(|| parts.join("\n\n"))
        }
        _ => None,
    }
}

fn event_cwd_matches(value: &Value, cwd: &Path) -> bool {
    let Some(event_cwd) = value.get("cwd").and_then(Value::as_str) else {
        return false;
    };
    Path::new(event_cwd) == cwd
}

fn parse_transcript(path: &Path, cwd: &Path, limit: usize) -> Result<Option<ClaudeTranscript>, String> {
    let text = read_tail(path, 768 * 1024)?;
    let mut saw_matching_cwd = false;
    let mut messages = Vec::new();
    let mut session_id = path.file_stem().and_then(|stem| stem.to_str()).map(ToOwned::to_owned);

    for line in text.lines() {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };

        if event_cwd_matches(&value, cwd) {
            saw_matching_cwd = true;
        }
        if session_id.is_none() {
            session_id = value.get("sessionId").and_then(Value::as_str).map(ToOwned::to_owned);
        }

        let event_type = value.get("type").and_then(Value::as_str);
        if !matches!(event_type, Some("user") | Some("assistant")) {
            continue;
        }

        let Some(message) = value.get("message") else {
            continue;
        };
        let role = message
            .get("role")
            .and_then(Value::as_str)
            .or(event_type)
            .unwrap_or("message");
        let Some(body) = message.get("content").and_then(text_from_content) else {
            continue;
        };

        let id = value
            .get("uuid")
            .and_then(Value::as_str)
            .or_else(|| value.get("messageId").and_then(Value::as_str))
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| format!("{}:{}", path.to_string_lossy(), messages.len()));

        messages.push(ClaudeTranscriptMessage {
            id,
            role: role.to_string(),
            body,
            created_at: value.get("timestamp").and_then(Value::as_str).map(ToOwned::to_owned),
        });
    }

    if !saw_matching_cwd && path.parent().map(|parent| parent.ends_with(claude_project_dir_name(cwd))).unwrap_or(false) {
        saw_matching_cwd = true;
    }
    if !saw_matching_cwd {
        return Ok(None);
    }

    if messages.len() > limit {
        messages = messages.split_off(messages.len() - limit);
    }

    let updated_at = fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().to_string());

    Ok(Some(ClaudeTranscript {
        session_id,
        session_path: Some(path.to_string_lossy().to_string()),
        updated_at,
        messages,
    }))
}

fn empty_transcript() -> ClaudeTranscript {
    ClaudeTranscript {
        session_id: None,
        session_path: None,
        updated_at: None,
        messages: Vec::new(),
    }
}

fn read_transcript_for_cwd(cwd: &Path, limit: usize) -> Result<ClaudeTranscript, String> {
    for path in transcript_candidates(cwd)?.into_iter().take(40) {
        if let Some(transcript) = parse_transcript(&path, cwd, limit)? {
            return Ok(transcript);
        }
    }
    Ok(empty_transcript())
}

fn read_transcript_for_path(path: &Path, cwd: &Path, limit: usize) -> Result<Option<ClaudeTranscript>, String> {
    if !path.exists() {
        return Ok(None);
    }
    parse_transcript(path, cwd, limit)
}

fn transcript_has_agent_marker(path: &Path, agent_id: &str) -> bool {
    let Ok(text) = read_tail(path, 256 * 1024) else {
        return false;
    };
    text.contains(agent_id) || text.contains(&format!("Consult with {}", agent_id))
}

fn bindable_transcripts(cwd: &Path, limit: usize) -> Result<Vec<(PathBuf, ClaudeTranscript)>, String> {
    let mut matches = Vec::new();
    for path in transcript_candidates(cwd)?.into_iter().take(40) {
        if let Some(transcript) = parse_transcript(&path, cwd, limit)? {
            matches.push((path, transcript));
        }
    }
    Ok(matches)
}

fn read_bound_transcript(
    watchers: &ClaudeSessionWatchers,
    agent_id: &str,
    cwd: &Path,
    limit: usize,
) -> Result<ClaudeTranscript, String> {
    if let Some(path) = watchers.bindings.lock().get(agent_id).cloned() {
        if let Some(transcript) = read_transcript_for_path(&path, cwd, limit)? {
            return Ok(transcript);
        }
        watchers.bindings.lock().remove(agent_id);
    }

    let matches = bindable_transcripts(cwd, limit)?;
    if let Some((path, transcript)) = matches
        .iter()
        .find(|(path, _)| transcript_has_agent_marker(path, agent_id))
    {
        watchers.bindings.lock().insert(agent_id.to_string(), path.clone());
        return Ok(transcript.clone());
    }

    if let Some((path, transcript)) = matches.into_iter().next() {
        watchers.bindings.lock().insert(agent_id.to_string(), path);
        return Ok(transcript);
    }

    Ok(empty_transcript())
}

fn read_existing_bound_transcript(
    watchers: &ClaudeSessionWatchers,
    agent_id: &str,
    cwd: &Path,
    limit: usize,
) -> Result<ClaudeTranscript, String> {
    let Some(path) = watchers.bindings.lock().get(agent_id).cloned() else {
        return Ok(empty_transcript());
    };
    if let Some(transcript) = read_transcript_for_path(&path, cwd, limit)? {
        return Ok(transcript);
    }
    watchers.bindings.lock().remove(agent_id);
    Ok(empty_transcript())
}

fn transcript_signature(transcript: &ClaudeTranscript) -> String {
    let last_id = transcript
        .messages
        .last()
        .map(|message| message.id.as_str())
        .unwrap_or("");
    format!(
        "{}:{}:{}:{}",
        transcript.session_path.as_deref().unwrap_or(""),
        transcript.updated_at.as_deref().unwrap_or(""),
        transcript.messages.len(),
        last_id
    )
}

#[tauri::command]
pub fn read_claude_transcript(
    watchers: State<'_, ClaudeSessionWatchers>,
    cwd: String,
    limit: Option<usize>,
    agent_id: Option<String>,
) -> Result<ClaudeTranscript, String> {
    let cwd = PathBuf::from(cwd);
    let limit = limit.unwrap_or(80).clamp(1, 200);
    if let Some(agent_id) = agent_id {
        return read_existing_bound_transcript(&watchers, &agent_id, &cwd, limit);
    }
    read_transcript_for_cwd(&cwd, limit)
}

#[tauri::command]
pub fn watch_claude_transcript(
    app: AppHandle,
    watchers: State<'_, ClaudeSessionWatchers>,
    agent_id: String,
    cwd: String,
    limit: Option<usize>,
) -> Result<(), String> {
    stop_claude_transcript_watch(watchers.clone(), agent_id.clone())?;

    let stop = Arc::new(AtomicBool::new(false));
    watchers.stops.lock().insert(agent_id.clone(), stop.clone());

    let cwd = PathBuf::from(cwd);
    let limit = limit.unwrap_or(80).clamp(1, 200);
    let watcher_state = ClaudeSessionWatchers {
        stops: watchers.stops.clone(),
        bindings: watchers.bindings.clone(),
    };

    std::thread::spawn(move || {
        let mut last_signature = String::new();
        while !stop.load(Ordering::Relaxed) {
            match read_bound_transcript(&watcher_state, &agent_id, &cwd, limit) {
                Ok(transcript) => {
                    let signature = transcript_signature(&transcript);
                    if signature != last_signature {
                        last_signature = signature;
                        let _ = app.emit(
                            &format!("claude:transcript:{}", agent_id),
                            ClaudeTranscriptEvent {
                                agent_id: agent_id.clone(),
                                transcript,
                            },
                        );
                    }
                }
                Err(error) => {
                    let _ = app.emit(
                        &format!("claude:transcript-error:{}", agent_id),
                        serde_json::json!({
                            "agentId": agent_id,
                            "error": error,
                        }),
                    );
                }
            }
            std::thread::sleep(Duration::from_millis(800));
        }
    });

    Ok(())
}

#[tauri::command]
pub fn stop_claude_transcript_watch(
    watchers: State<'_, ClaudeSessionWatchers>,
    agent_id: String,
) -> Result<(), String> {
    if let Some(stop) = watchers.stops.lock().remove(&agent_id) {
        stop.store(true, Ordering::Relaxed);
    }
    Ok(())
}
