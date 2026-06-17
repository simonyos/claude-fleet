# Security Policy

Claude Fleet is local-first software that starts terminals, runs user-installed CLIs, writes local state, and exposes a local MCP bridge. Please treat security issues seriously.

## Reporting a Vulnerability

Please report suspected vulnerabilities using GitHub's private vulnerability reporting if available, or by contacting the repository owner through GitHub.

Do not open public issues for vulnerabilities involving:

- command execution
- path handling
- mailbox or state file exposure
- MCP tool abuse
- local socket access
- token or credential leakage

## Scope

Security-relevant areas include:

- PTY spawning and environment construction
- bundled helper binaries
- `~/.claude-fleet` state and mailbox files
- `/tmp/claude-fleet.sock`
- MCP tool behavior
- project directory handling

## Supported Versions

This project is pre-1.0. Security fixes target the latest `main` branch unless release branches are introduced later.
