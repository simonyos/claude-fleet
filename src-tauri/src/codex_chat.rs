use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Emitter;

const CODEX_CHAT_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexChatRequest {
    pub request_id: String,
    pub agent_id: String,
    pub cwd: String,
    pub prompt: String,
    pub system_prompt: String,
    pub thread_id: Option<String>,
    pub mcp_binary_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexChatResponse {
    pub thread_id: Option<String>,
    pub final_response: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexChatStreamEvent {
    pub request_id: String,
    pub kind: String,
    pub thread_id: Option<String>,
    pub body: Option<String>,
    pub error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeResponse {
    thread_id: Option<String>,
    final_response: Option<String>,
    error: Option<String>,
}

fn bridge_script_path() -> Result<std::path::PathBuf, String> {
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    Ok(manifest_dir
        .join("codex-bridge")
        .join("codex-orchestrator-chat.mjs"))
}

#[tauri::command]
pub async fn run_orchestrator_chat(
    app: tauri::AppHandle,
    request: CodexChatRequest,
) -> Result<CodexChatResponse, String> {
    tauri::async_runtime::spawn_blocking(move || run_orchestrator_chat_blocking(app, request))
        .await
        .map_err(|e| format!("Codex SDK worker failed: {}", e))?
}

fn emit_chat_event(app: &tauri::AppHandle, event: CodexChatStreamEvent) {
    let _ = app.emit("orchestrator-chat:event", event);
}

fn run_orchestrator_chat_blocking(
    app: tauri::AppHandle,
    request: CodexChatRequest,
) -> Result<CodexChatResponse, String> {
    let script = bridge_script_path()?;
    let request_id = request.request_id.clone();
    let payload = serde_json::json!({
        "agentId": request.agent_id,
        "cwd": request.cwd,
        "prompt": request.prompt,
        "systemPrompt": request.system_prompt,
        "threadId": request.thread_id,
        "mcpBinaryPath": request.mcp_binary_path,
        "socketPath": "/tmp/claude-fleet.sock",
    });

    let mut child = Command::new("node")
        .arg(script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to start Codex SDK bridge: {}", e))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(payload.to_string().as_bytes())
            .map_err(|e| format!("failed to write Codex SDK request: {}", e))?;
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Codex SDK bridge stdout was not available".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Codex SDK bridge stderr was not available".to_string())?;
    let (line_tx, line_rx) = mpsc::channel::<String>();
    let stdout_thread = std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            if line_tx.send(line).is_err() {
                break;
            }
        }
    });
    let stderr_text = Arc::new(Mutex::new(String::new()));
    let stderr_for_thread = Arc::clone(&stderr_text);
    let stderr_thread = std::thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut text = String::new();
        let _ = reader.read_to_string(&mut text);
        if let Ok(mut current) = stderr_for_thread.lock() {
            *current = text;
        }
    });

    let started_at = Instant::now();
    let mut final_response = BridgeResponse {
        thread_id: None,
        final_response: None,
        error: None,
    };
    let mut bridge_error: Option<String> = None;

    let status = loop {
        while let Ok(line) = line_rx.try_recv() {
            let parsed: serde_json::Value = serde_json::from_str(line.trim())
                .map_err(|e| format!("failed to parse Codex SDK stream event: {}", e))?;
            match parsed.get("type").and_then(|value| value.as_str()) {
                Some("thread.started") => {
                    let thread_id = parsed
                        .get("threadId")
                        .and_then(|value| value.as_str())
                        .map(|value| value.to_string());
                    final_response.thread_id = thread_id.clone();
                    emit_chat_event(
                        &app,
                        CodexChatStreamEvent {
                            request_id: request_id.clone(),
                            kind: "thread.started".to_string(),
                            thread_id,
                            body: None,
                            error: None,
                        },
                    );
                }
                Some("agent_message.updated") => {
                    let body = parsed
                        .get("text")
                        .and_then(|value| value.as_str())
                        .unwrap_or_default()
                        .to_string();
                    final_response.final_response = Some(body.clone());
                    emit_chat_event(
                        &app,
                        CodexChatStreamEvent {
                            request_id: request_id.clone(),
                            kind: "message".to_string(),
                            thread_id: final_response.thread_id.clone(),
                            body: Some(body),
                            error: None,
                        },
                    );
                }
                Some("turn.completed") => {
                    emit_chat_event(
                        &app,
                        CodexChatStreamEvent {
                            request_id: request_id.clone(),
                            kind: "turn.completed".to_string(),
                            thread_id: final_response.thread_id.clone(),
                            body: None,
                            error: None,
                        },
                    );
                }
                Some("final") => {
                    final_response.thread_id = parsed
                        .get("threadId")
                        .and_then(|value| value.as_str())
                        .map(|value| value.to_string())
                        .or(final_response.thread_id);
                    final_response.final_response = parsed
                        .get("finalResponse")
                        .and_then(|value| value.as_str())
                        .map(|value| value.to_string())
                        .or(final_response.final_response);
                    emit_chat_event(
                        &app,
                        CodexChatStreamEvent {
                            request_id: request_id.clone(),
                            kind: "completed".to_string(),
                            thread_id: final_response.thread_id.clone(),
                            body: final_response.final_response.clone(),
                            error: None,
                        },
                    );
                }
                Some("error") => {
                    bridge_error = Some(
                        parsed
                            .get("error")
                            .and_then(|value| value.as_str())
                            .unwrap_or("Codex SDK bridge failed")
                            .to_string(),
                    );
                }
                _ => {}
            }
        }

        if let Some(status) = child
            .try_wait()
            .map_err(|e| format!("failed to poll Codex SDK bridge: {}", e))?
        {
            break status;
        }
        if started_at.elapsed() > CODEX_CHAT_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            let message = "Codex SDK bridge timed out after 180 seconds".to_string();
            emit_chat_event(
                &app,
                CodexChatStreamEvent {
                    request_id,
                    kind: "error".to_string(),
                    thread_id: final_response.thread_id,
                    body: None,
                    error: Some(message.clone()),
                },
            );
            return Err(message);
        }
        std::thread::sleep(Duration::from_millis(100));
    };

    let _ = stdout_thread.join();
    let _ = stderr_thread.join();

    while let Ok(line) = line_rx.try_recv() {
        let parsed: serde_json::Value = serde_json::from_str(line.trim())
            .map_err(|e| format!("failed to parse Codex SDK stream event: {}", e))?;
        if parsed.get("type").and_then(|value| value.as_str()) == Some("final") {
            final_response.thread_id = parsed
                .get("threadId")
                .and_then(|value| value.as_str())
                .map(|value| value.to_string())
                .or(final_response.thread_id);
            final_response.final_response = parsed
                .get("finalResponse")
                .and_then(|value| value.as_str())
                .map(|value| value.to_string())
                .or(final_response.final_response);
        }
    }

    if let Some(error) = bridge_error.or(final_response.error) {
        emit_chat_event(
            &app,
            CodexChatStreamEvent {
                request_id,
                kind: "error".to_string(),
                thread_id: final_response.thread_id,
                body: None,
                error: Some(error.clone()),
            },
        );
        return Err(error);
    }
    if !status.success() {
        let stderr = stderr_text
            .lock()
            .map(|value| value.trim().to_string())
            .unwrap_or_default();
        let message = if stderr.is_empty() {
            format!("Codex SDK bridge exited with {}", status)
        } else {
            format!("Codex SDK bridge exited with {}: {}", status, stderr)
        };
        emit_chat_event(
            &app,
            CodexChatStreamEvent {
                request_id,
                kind: "error".to_string(),
                thread_id: final_response.thread_id,
                body: None,
                error: Some(message.clone()),
            },
        );
        return Err(message);
    }

    Ok(CodexChatResponse {
        thread_id: final_response.thread_id,
        final_response: final_response.final_response.unwrap_or_default(),
    })
}
