use std::env;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::process::ExitCode;

fn usage() -> ExitCode {
    eprintln!("usage:");
    eprintln!("  fleet-msg send <to> <body>");
    eprintln!("  fleet-msg list");
    ExitCode::from(2)
}

fn main() -> ExitCode {
    let socket = env::var("FLEET_SOCKET").unwrap_or_else(|_| "/tmp/claude-fleet.sock".into());
    let from = env::var("FLEET_AGENT_ID").ok();
    let args: Vec<String> = env::args().skip(1).collect();

    let payload = match args.as_slice() {
        [cmd] if cmd == "list" => "list\n".to_string(),
        [cmd, to, body] if cmd == "send" => {
            let env = serde_json::json!({
                "from": from,
                "to": to,
                "body": body,
            });
            format!("{}\n", env)
        }
        _ => return usage(),
    };

    let mut stream = match UnixStream::connect(&socket) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("fleet-msg: cannot connect to {}: {}", socket, e);
            return ExitCode::from(1);
        }
    };
    if let Err(e) = stream.write_all(payload.as_bytes()) {
        eprintln!("fleet-msg: write failed: {}", e);
        return ExitCode::from(1);
    }
    let mut reader = BufReader::new(stream);
    let mut response = String::new();
    while reader.read_line(&mut response).unwrap_or(0) > 0 {}
    print!("{}", response);
    if response.starts_with("error") {
        return ExitCode::from(1);
    }
    ExitCode::SUCCESS
}
