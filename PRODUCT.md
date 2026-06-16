# Product

## Register

product

## Users

Claude Fleet is for developers working across several local codebases at once, especially microservice or multi-repo systems where one model context cannot safely hold every project. The user is in an active engineering workflow: debugging, designing contracts, tracing ownership, asking cross-project questions, and deciding which project-local expert should answer.

The core user is technical, impatient with ceremony, and comfortable with tmux, terminals, files, and explicit local state. They want visibility and control more than magic.

## Product Purpose

Claude Fleet is a local context federation room. It keeps multiple long-lived Claude or Codex agents alive in separate tmux-backed project contexts, then lets those agents communicate through MCP messages and plain mailbox files.

The product exists so knowledge can stay local to the project that owns it. Instead of stuffing many repositories into one context window, each agent investigates inside its own project and sends back only the useful conclusion, contract, risk, file reference, or decision.

Success looks like a developer asking a question that crosses project boundaries and getting a concise, trustworthy answer from the right project-local agent without losing observability, control, or debuggability.

## Brand Personality

Plainspoken, sovereign, and workmanlike.

The voice should feel like a capable local engineering tool: direct, calm, technically honest, and allergic to theatrics. It should make the user feel in command of a room of visible agents, not managed by an invisible orchestrator.

## Anti-references

This should not look or feel like a marketing landing page, a BridgeSpace-style workspace clone, a task-board product, or a hidden multi-agent framework with glossy abstractions over opaque behavior.

Avoid workflows centered on orchestrators, assigned tasks, review gates, swarms, role bureaucracy, or project-management theater. Avoid decorative dashboards that imply work is happening but hide the actual terminal, message, file, and agent state.

Avoid designs that bury the primitives. tmux sessions, project directories, agent identities, MCP messages, and mailbox files are the product surface, not implementation details to hide.

## Design Principles

Expose the primitives. The user should always be able to see which agent lives in which project, what terminal is running, where messages are stored, and what crossed the wire.

Federate context, not files. The interface should reinforce that agents exchange understanding, not raw repositories or giant context dumps.

Keep the human sovereign. The user can attach, inspect, message, stop, restart, or remove agents directly. Automation should never make the room feel less controllable.

Prefer boring durability. Files, tmux, MCP, and simple local state should feel like reliable first-class mechanisms with understandable failure modes.

Earn density through clarity. This is a developer tool for repeated use, so the UI can be compact, but every control and state should map to a concrete action or observable system fact.

## Accessibility & Inclusion

Target WCAG 2.2 AA for contrast, focus visibility, keyboard access, and readable text. Dense terminal-oriented surfaces still need clear focus states, non-color-only status indicators, and controls that can be reached without a mouse.

Motion should be reduced by default and respect reduced-motion preferences. Color should support color-blind users by pairing hue with text, icons, labels, or placement. Error and empty states should explain recoverable next steps without blaming the user.
