# Contributing to Claude Fleet

Thanks for taking a look at Claude Fleet. This project is early, local-first developer tooling, so the best contributions are small, observable, and easy to debug.

## Product Direction

Claude Fleet is a local context-federation room. It keeps project-local Claude or Codex agents running in separate terminal panes and lets them communicate through MCP messages and plain mailbox files.

The project is intentionally not a task-board product, hidden orchestrator, or glossy multi-agent abstraction. Favor visible primitives: terminals, files, local state, helper binaries, and explicit message passing.

## Development Setup

Install dependencies:

```bash
npm install
```

Run the desktop app:

```bash
npm run tauri dev
```

Run checks before opening a PR:

```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

Build the macOS app bundle:

```bash
npm run tauri build -- --bundles app
```

## Pull Requests

Before opening a PR:

- Keep the change focused.
- Explain the user-facing behavior change.
- Include screenshots or screen recordings for UI changes.
- Mention any local runtime assumptions, especially around `claude`, `codex`, PTY behavior, or `~/.claude-fleet` state.
- Avoid broad refactors unless they are necessary for the feature or fix.

## Design Principles

- Expose the primitives.
- Federate context, not files.
- Keep the human sovereign.
- Prefer boring durability.
- Make failures inspectable.

## Local State

Claude Fleet writes runtime state outside the repo under `~/.claude-fleet`. Do not commit local runtime state, mailbox contents, secrets, or generated app bundles.
