use serde::Deserialize;
use serde_json::{json, Value};
use std::env;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::UnixStream;

#[derive(Deserialize)]
struct JsonRpcRequest {
    #[allow(dead_code)]
    jsonrpc: Option<String>,
    id: Option<Value>,
    method: String,
    params: Option<Value>,
}

fn emit(value: Value) {
    let s = serde_json::to_string(&value).unwrap_or_default();
    let stdout = std::io::stdout();
    let mut lock = stdout.lock();
    let _ = writeln!(lock, "{}", s);
    let _ = lock.flush();
}

fn ok(id: Option<Value>, result: Value) {
    emit(json!({ "jsonrpc": "2.0", "id": id, "result": result }));
}

fn err(id: Option<Value>, code: i32, message: &str) {
    emit(json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message },
    }));
}

fn call_bus(payload: &str) -> Result<String, String> {
    let socket = env::var("FLEET_SOCKET").unwrap_or_else(|_| "/tmp/claude-fleet.sock".into());
    let mut stream = UnixStream::connect(&socket).map_err(|e| e.to_string())?;
    stream
        .write_all(payload.as_bytes())
        .map_err(|e| e.to_string())?;
    if !payload.ends_with('\n') {
        let _ = stream.write_all(b"\n");
    }
    let _ = stream.flush();

    let mut buf = String::new();
    BufReader::new(&stream)
        .read_to_string(&mut buf)
        .map_err(|e| e.to_string())?;
    Ok(buf.trim().to_string())
}

fn tools_def() -> Value {
    json!({
        "tools": [
            {
                "name": "send_message",
                "description": "Send a message to another agent in the claude-fleet. The message will appear at the target agent's prompt prefixed with `[from <your-id>]:` and submit as a new user turn.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "to": { "type": "string", "description": "Target agent ID (use list_agents to discover available IDs)" },
                        "body": { "type": "string", "description": "Message body to deliver" }
                    },
                    "required": ["to", "body"]
                }
            },
            {
                "name": "list_agents",
                "description": "List project-local agents in the fleet, including role, runtime, status, expertise notes, and project directory.",
                "inputSchema": { "type": "object", "properties": {} }
            },
            {
                "name": "list_messages",
                "description": "List recent cross-agent messages. Use this as an audit trail or to recover recent handoffs.",
                "inputSchema": { "type": "object", "properties": {} }
            }
        ]
    })
}

fn handle(req: JsonRpcRequest) {
    match req.method.as_str() {
        "initialize" => {
            ok(
                req.id,
                json!({
                    "protocolVersion": "2024-11-05",
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": "claude-fleet", "version": "0.1.0" }
                }),
            );
        }
        "tools/list" => ok(req.id, tools_def()),
        "tools/call" => {
            let params = req.params.unwrap_or(json!({}));
            let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let arguments = params.get("arguments").cloned().unwrap_or(json!({}));

            let text = match name {
                "send_message" => {
                    let to = arguments
                        .get("to")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let body = arguments
                        .get("body")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    if to.is_empty() || body.is_empty() {
                        err(req.id, -32602, "send_message requires 'to' and 'body'");
                        return;
                    }
                    let from = env::var("FLEET_AGENT_ID").ok();
                    let payload = json!({ "from": from, "to": to, "body": body }).to_string();
                    match call_bus(&payload) {
                        Ok(resp) if resp == "ok" => format!("Message delivered to {}", to),
                        Ok(resp) => format!("Bus: {}", resp),
                        Err(e) => format!("Bus error: {}", e),
                    }
                }
                "list_agents" => claude_fleet_lib::app_state::list_agents_for_mcp()
                    .unwrap_or_else(|e| format!("State error: {}", e)),
                "list_messages" => claude_fleet_lib::app_state::list_messages_for_mcp()
                    .unwrap_or_else(|e| format!("State error: {}", e)),
                _ => {
                    err(req.id, -32601, &format!("Unknown tool: {}", name));
                    return;
                }
            };

            ok(req.id, json!({ "content": [{ "type": "text", "text": text }] }));
        }
        m if m.starts_with("notifications/") => {}
        _ => {
            if req.id.is_some() {
                err(req.id, -32601, &format!("Unknown method: {}", req.method));
            }
        }
    }
}

fn main() {
    let stdin = std::io::stdin();
    let mut reader = stdin.lock();
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                match serde_json::from_str::<JsonRpcRequest>(trimmed) {
                    Ok(req) => handle(req),
                    Err(_) => {}
                }
            }
            Err(_) => break,
        }
    }
}
