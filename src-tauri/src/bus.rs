use crate::{app_state, pty::PtyRegistry};
use serde::Deserialize;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::Path;

const SOCKET_PATH: &str = "/tmp/claude-fleet.sock";

#[derive(Deserialize)]
struct Envelope {
    from: Option<String>,
    to: String,
    body: String,
}

pub fn start(registry: PtyRegistry) {
    let _ = std::fs::remove_file(SOCKET_PATH);
    let listener = match UnixListener::bind(Path::new(SOCKET_PATH)) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("claude-fleet: failed to bind {}: {}", SOCKET_PATH, e);
            return;
        }
    };
    println!("claude-fleet: bus listening on {}", SOCKET_PATH);

    std::thread::spawn(move || {
        for stream in listener.incoming() {
            match stream {
                Ok(stream) => {
                    let reg = registry.clone();
                    std::thread::spawn(move || handle_conn(stream, reg));
                }
                Err(e) => eprintln!("claude-fleet bus accept error: {}", e),
            }
        }
    });
}

fn handle_conn(stream: UnixStream, registry: PtyRegistry) {
    let mut reader = BufReader::new(stream.try_clone().ok().unwrap_or_else(|| stream.try_clone().unwrap()));
    let mut writer = stream;
    let mut line = String::new();
    if reader.read_line(&mut line).is_err() {
        return;
    }

    if line.trim() == "list" {
        let ids = registry.agent_ids().join("\n");
        let _ = writeln!(writer, "{}", ids);
        return;
    }

    let env: Envelope = match serde_json::from_str(line.trim()) {
        Ok(e) => e,
        Err(e) => {
            let _ = writeln!(writer, "error: invalid json: {}", e);
            return;
        }
    };

    let sender = env.from.unwrap_or_else(|| "unknown".to_string());
    let body = format!("[from {}]: {}", sender, env.body);
    if let Err(e) = registry.write(&env.to, body.as_bytes()) {
        let _ = writeln!(writer, "error: {}", e);
        return;
    }
    let _ = app_state::record_message(sender.clone(), env.to.clone(), env.body);

    let target = env.to.clone();
    let reg_for_submit = registry.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(250));
        let _ = reg_for_submit.write(&target, b"\r");
    });

    let _ = writeln!(writer, "ok");
}
