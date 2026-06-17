import React, { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { TerminalPane } from "./components/TerminalPane";
import { AgentRuntime, runtimeAdapters } from "./runtimeAdapters";
import "./App.css";

void React;

type ProjectWorkspace = {
  id: string;
  name: string;
  path: string;
  createdAt: string;
};

type AgentRecord = {
  id: string;
  label: string;
  accentColor: string | null;
  title: string | null;
  runtime: AgentRuntime;
  role: string;
  reportsTo: string | null;
  capabilities: string | null;
  cwd: string | null;
  worktree: string | null;
  instructions: string | null;
  instructionsBundle: { files: Record<string, string> } | null;
  runtimeConfig: Record<string, unknown>;
  permissions: {
    canCreateAgents: boolean;
    canManageTasks: boolean;
  };
  sourceTaskId: string | null;
  sessionId: string | null;
  status: string;
};

type MessageRecord = {
  id: string;
  from: string;
  to: string;
  body: string;
  createdAt: string;
};

type ClaudeTranscriptMessage = {
  id: string;
  role: string;
  body: string;
  createdAt: string | null;
};

type ClaudeTranscript = {
  sessionId: string | null;
  sessionPath: string | null;
  updatedAt: string | null;
  messages: ClaudeTranscriptMessage[];
};

type ClaudeTranscriptEvent = {
  agentId: string;
  transcript: ClaudeTranscript;
};

type ClaudeTranscriptErrorEvent = {
  agentId: string;
  error: string;
};

type LegacyTaskRecord = {
  id: string;
  title: string;
  body: string;
  status: string;
  assignee: string | null;
  comments: unknown[];
  createdAt: string;
  updatedAt: string;
};

type FleetState = {
  schemaVersion: number;
  activeWorkspace: ProjectWorkspace | null;
  mainAgentId: string | null;
  agents: AgentRecord[];
  tasks: LegacyTaskRecord[];
  orchestratorChat: unknown[];
  messages: MessageRecord[];
  runs: unknown[];
  workspaces: unknown[];
};

type RuntimeContext = {
  mcpBinaryPath: string;
  mcpConfigPath: string;
  systemPrompt: (agentId: string) => string;
};

const agentColors = [
  "#d6d876",
  "#4ebe96",
  "#62a8ff",
  "#b58cff",
  "#f08b52",
  "#f06f8f",
  "#66d9e8",
  "#c9a66b",
];

const encode = (data: string) => Array.from(new TextEncoder().encode(data));
const defaultAgentColor = (index: number) => agentColors[index % agentColors.length];
const sessionMarker = (agentId: string) => `agent-home-v1:${agentId}:${Date.now()}`;
const hasTauriBridge = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const nextId = (prefix: string, existingIds: string[]) => {
  let n = existingIds.length + 1;
  let id = `${prefix}-${n}`;
  while (existingIds.includes(id)) {
    n += 1;
    id = `${prefix}-${n}`;
  }
  return id;
};

const projectNameFromPath = (path: string) =>
  path.trim().split("/").filter(Boolean).pop() || "project";

const shortPath = (path: string | null | undefined) => {
  if (!path) return "No project path";
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 3) return path;
  return `.../${parts.slice(-3).join("/")}`;
};

const formatTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const toolEventName = (body: string) => {
  const match = body.trim().match(/^\[tool:\s*([^\]]+)\]$/);
  return match?.[1] ?? null;
};

const sameFleetState = (a: FleetState | null, b: FleetState) => {
  if (!a) return false;
  return JSON.stringify(a) === JSON.stringify(b);
};

const previewFleetState = (): FleetState => ({
  schemaVersion: 3,
  activeWorkspace: {
    id: "preview-room",
    name: "microservices",
    path: "/Users/zeemon/Development/microservices",
    createdAt: new Date().toISOString(),
  },
  mainAgentId: "agent-1",
  agents: [
    createAgent({
      id: "agent-1",
      label: "billing-service",
      runtime: "claude",
      role: "billing contracts",
      cwd: "/Users/zeemon/Development/billing-service",
      index: 0,
    }),
    createAgent({
      id: "agent-2",
      label: "auth-api",
      runtime: "claude",
      role: "identity owner",
      cwd: "/Users/zeemon/Development/auth-api",
      index: 1,
    }),
    createAgent({
      id: "agent-3",
      label: "web-app",
      runtime: "codex",
      role: "frontend shell",
      cwd: "/Users/zeemon/Development/web-app",
      index: 2,
    }),
  ],
  tasks: [],
  orchestratorChat: [],
  messages: [
    {
      id: "msg-preview-2",
      from: "agent-2",
      to: "agent-1",
      body: "Auth guarantees token subject stability across refresh; billing should key customer joins on account_id, not email.",
      createdAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
    },
    {
      id: "msg-preview-1",
      from: "human",
      to: "agent-2",
      body: "What identifier is safe to use across billing and auth?",
      createdAt: new Date(Date.now() - 1000 * 60 * 11).toISOString(),
    },
  ],
  runs: [],
  workspaces: [],
});

const previewStore = () => {
  const previewWindow = window as Window & { __CLAUDE_FLEET_PREVIEW_STATE__?: FleetState };
  previewWindow.__CLAUDE_FLEET_PREVIEW_STATE__ ??= previewFleetState();
  return previewWindow;
};

async function appInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (hasTauriBridge()) {
    return invoke<T>(cmd, args);
  }

  const previewWindow = previewStore();
  switch (cmd) {
    case "get_mcp_config_path":
      return "~/.claude-fleet/mcp.json" as T;
    case "get_fleet_mcp_binary_path":
      return "/Users/zeemon/Development/claude-fleet/src-tauri/target/debug/fleet-mcp" as T;
    case "get_mailbox_root":
      return "~/.claude-fleet/mail" as T;
    case "load_fleet_state":
      return previewWindow.__CLAUDE_FLEET_PREVIEW_STATE__ as T;
    case "save_fleet_state":
      previewWindow.__CLAUDE_FLEET_PREVIEW_STATE__ = args?.state as FleetState;
      return undefined as T;
    case "open_project_workspace":
    case "create_project_workspace": {
      const path = String(args?.path ?? "/Users/zeemon/Development/microservices");
      return {
        id: "preview-room",
        name: String(args?.name ?? projectNameFromPath(path)),
        path,
        createdAt: new Date().toISOString(),
      } as T;
    }
    case "record_manual_message":
      return {
        id: `msg-preview-${Date.now()}`,
        from: String(args?.from ?? "human"),
        to: String(args?.to ?? "agent-1"),
        body: String(args?.body ?? ""),
        createdAt: new Date().toISOString(),
      } as T;
    case "read_claude_transcript":
      return {
        sessionId: "preview-session",
        sessionPath: "~/.claude/projects/preview/preview-session.jsonl",
        updatedAt: new Date().toISOString(),
        messages: [
          {
            id: "preview-user",
            role: "user",
            body: "Does auth guarantee ordering for account events?",
            createdAt: new Date(Date.now() - 1000 * 60 * 3).toISOString(),
          },
          {
            id: "preview-assistant",
            role: "assistant",
            body: "Auth preserves order per account_id inside one partition. Cross-account events can arrive independently, so consumers should not infer global ordering.",
            createdAt: new Date(Date.now() - 1000 * 60 * 2).toISOString(),
          },
        ],
      } as T;
    case "write_pty":
    case "watch_claude_transcript":
    case "stop_claude_transcript_watch":
    case "plugin:dialog|open":
      return null as T;
    default:
      return undefined as T;
  }
}

const hasUsableSession = (agent: AgentRecord) => {
  if (!agent.sessionId) return false;
  if (agent.runtime === "codex") return agent.sessionId.startsWith("agent-home-v1:");
  return true;
};

const systemPromptFor = (agent: AgentRecord, agents: AgentRecord[]) => {
  const peers = agents
    .filter((peer) => peer.id !== agent.id)
    .map((peer) => `- ${peer.id}: ${peer.label} (${peer.role}) at ${peer.cwd ?? "unknown cwd"}`)
    .join("\n");

  return `You are a long-lived project-local Claude Fleet agent.

Your agent ID is "${agent.id}".
Your display name is "${agent.label}".
Your project directory is "${agent.cwd ?? "unknown"}".
Your local expertise is "${agent.role}".
${agent.capabilities ? `Your expertise notes:\n${agent.capabilities}\n` : ""}
${agent.instructions ? `Standing instructions:\n${agent.instructions}\n` : ""}

This system is context federation, not shared context. Keep the details of your own project in your own context window. When another agent asks about your project, investigate locally and send back only the useful conclusion, contract, file reference, risk, or decision.

Available peer agents:
${peers || "- none yet"}

Use the claude-fleet MCP tools:
- list_agents: discover peer agents, their roles, and project directories
- send_message(to, body): send a concise message to another agent
- list_messages: inspect recent cross-agent messages

Every message is also written to plain JSON mailbox files under ~/.claude-fleet/mail:
- messages/<message-id>.json is the global ledger
- agents/<agent-id>/inbox/<message-id>.json is recipient mail
- agents/<agent-id>/outbox/<message-id>.json is sender mail

When you receive a turn beginning with "[from <sender>]:", it came from another agent. Reply with send_message(to=<sender>, body=<your answer>) when a reply is useful. Do not paste huge files or raw context across the wire. Send understanding, not libraries.`;
};

function createAgent({
  id,
  label,
  runtime,
  role,
  cwd,
  index,
}: {
  id: string;
  label: string;
  runtime: AgentRuntime;
  role: string;
  cwd: string;
  index: number;
}): AgentRecord {
  return {
    id,
    label,
    accentColor: defaultAgentColor(index),
    title: null,
    runtime,
    role,
    reportsTo: null,
    capabilities: `Local expert for ${cwd}. Answer questions from this project; ask peers when another project owns the truth.`,
    cwd,
    worktree: null,
    instructions: "",
    instructionsBundle: null,
    runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: true } },
    permissions: { canCreateAgents: false, canManageTasks: false },
    sourceTaskId: null,
    sessionId: null,
    status: "idle",
  };
}

function App() {
  const [fleetState, setFleetState] = useState<FleetState | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [mcpConfigPath, setMcpConfigPath] = useState<string | null>(null);
  const [mcpBinaryPath, setMcpBinaryPath] = useState<string | null>(null);
  const [setupPath, setSetupPath] = useState("");
  const [setupName, setSetupName] = useState("");
  const [setupError, setSetupError] = useState<string | null>(null);
  const [newAgentPath, setNewAgentPath] = useState("");
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentRole, setNewAgentRole] = useState("service owner");
  const [newAgentRuntime, setNewAgentRuntime] = useState<AgentRuntime>("claude");
  const [isAddAgentOpen, setIsAddAgentOpen] = useState(false);
  const [isEditAgentOpen, setIsEditAgentOpen] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [manualMessage, setManualMessage] = useState("");
  const [manualRecipient, setManualRecipient] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [mailboxRoot, setMailboxRoot] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      appInvoke<string>("get_mcp_config_path"),
      appInvoke<string>("get_fleet_mcp_binary_path"),
      appInvoke<string>("get_mailbox_root"),
      appInvoke<FleetState>("load_fleet_state"),
    ])
      .then(([configPath, binaryPath, mailboxPath, loadedState]) => {
        const state = normalizeLoadedState(loadedState);
        setMcpConfigPath(configPath);
        setMcpBinaryPath(binaryPath);
        setMailboxRoot(mailboxPath);
        setFleetState(state);
        setSelectedAgentId(state.agents[0]?.id ?? null);
        setManualRecipient(state.agents[0]?.id ?? "");
        setNewAgentPath(state.activeWorkspace?.path ?? "");
      })
      .catch((error) => console.error("Failed to load fleet state:", error));
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      appInvoke<FleetState>("load_fleet_state")
        .then((state) => {
          const normalized = normalizeLoadedState(state);
          setFleetState((current) => (sameFleetState(current, normalized) ? current : normalized));
        })
        .catch((error) => console.error("Failed to refresh fleet state:", error));
    }, 2500);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isAddAgentOpen && !isEditAgentOpen && !isFocusMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsAddAgentOpen(false);
        setIsEditAgentOpen(false);
        setIsFocusMode(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isAddAgentOpen, isEditAgentOpen, isFocusMode]);

  const runtimeContext = useMemo<RuntimeContext | null>(() => {
    if (!mcpBinaryPath || !mcpConfigPath || !fleetState) return null;
    return {
      mcpBinaryPath,
      mcpConfigPath,
      systemPrompt: (agentId) => {
        const agent = fleetState.agents.find((item) => item.id === agentId);
        return agent ? systemPromptFor(agent, fleetState.agents) : agentId;
      },
    };
  }, [fleetState, mcpBinaryPath, mcpConfigPath]);

  const saveState = (nextState: FleetState) => {
    const normalized = normalizeLoadedState(nextState);
    setFleetState(normalized);
    appInvoke("save_fleet_state", { state: normalized }).catch((error) =>
      console.error("Failed to save fleet state:", error),
    );
  };

  const activateWorkspace = (workspace: ProjectWorkspace) => {
    const firstAgent = createAgent({
      id: "agent-1",
      label: workspace.name,
      runtime: "claude",
      role: "project expert",
      cwd: workspace.path,
      index: 0,
    });
    const nextState: FleetState = {
      schemaVersion: 3,
      activeWorkspace: workspace,
      mainAgentId: firstAgent.id,
      agents: [firstAgent],
      tasks: [],
      orchestratorChat: [],
      messages: [],
      runs: [],
      workspaces: [],
    };
    saveState(nextState);
    setSelectedAgentId(firstAgent.id);
    setManualRecipient(firstAgent.id);
    setNewAgentPath(workspace.path);
  };

  const openWorkspace = async () => {
    setSetupError(null);
    if (!setupPath.trim()) {
      setSetupError("Choose a home project path first.");
      return;
    }
    try {
      const workspace = await appInvoke<ProjectWorkspace>("open_project_workspace", { path: setupPath });
      activateWorkspace({
        ...workspace,
        name: setupName.trim() || workspace.name,
      });
    } catch (error) {
      setSetupError(String(error));
    }
  };

  const createWorkspace = async () => {
    setSetupError(null);
    if (!setupPath.trim()) {
      setSetupError("Choose a home project path first.");
      return;
    }
    try {
      const workspace = await appInvoke<ProjectWorkspace>("create_project_workspace", {
        path: setupPath,
        name: setupName || null,
      });
      activateWorkspace(workspace);
    } catch (error) {
      setSetupError(String(error));
    }
  };

  const browseSetupPath = async () => {
    try {
      const selected = await appInvoke<string | string[] | null>("plugin:dialog|open", {
        options: { directory: true, multiple: false, title: "Choose fleet home project" },
      });
      if (typeof selected === "string") setSetupPath(selected);
    } catch (error) {
      setSetupError(String(error));
    }
  };

  const browseAgentPath = async () => {
    try {
      const selected = await appInvoke<string | string[] | null>("plugin:dialog|open", {
        options: { directory: true, multiple: false, title: "Choose agent project" },
      });
      if (typeof selected === "string") {
        setNewAgentPath(selected);
        if (!newAgentName.trim()) setNewAgentName(projectNameFromPath(selected));
      }
    } catch (error) {
      console.error("Failed to choose agent path:", error);
    }
  };

  const resetRoom = () => {
    if (!fleetState) return;
    saveState({ ...fleetState, activeWorkspace: null });
  };

  const addAgent = () => {
    if (!fleetState?.activeWorkspace) return;
    const cwd = newAgentPath.trim();
    if (!cwd) return;
    const id = nextId("agent", fleetState.agents.map((agent) => agent.id));
    const agent = createAgent({
      id,
      label: newAgentName.trim() || projectNameFromPath(cwd),
      runtime: newAgentRuntime,
      role: newAgentRole.trim() || "project expert",
      cwd,
      index: fleetState.agents.length,
    });
    saveState({ ...fleetState, agents: [...fleetState.agents, agent] });
    setSelectedAgentId(id);
    setManualRecipient(id);
    setNewAgentName("");
    setIsAddAgentOpen(false);
  };

  const updateAgent = (id: string, patch: Partial<AgentRecord>) => {
    if (!fleetState) return;
    saveState({
      ...fleetState,
      agents: fleetState.agents.map((agent) =>
        agent.id === id ? { ...agent, ...patch } : agent,
      ),
    });
  };

  const removeAgent = (id: string) => {
    if (!fleetState) return;
    const agents = fleetState.agents.filter((agent) => agent.id !== id);
    saveState({
      ...fleetState,
      agents,
      mainAgentId: fleetState.mainAgentId === id ? agents[0]?.id ?? null : fleetState.mainAgentId,
    });
    setSelectedAgentId(agents[0]?.id ?? null);
    setManualRecipient(agents[0]?.id ?? "");
  };

  const markAgentSessionStarted = (id: string) => {
    setFleetState((current) => {
      if (!current) return current;
      const existing = current.agents.find((agent) => agent.id === id);
      if (!existing || existing.sessionId) return current;
      const normalized = normalizeLoadedState({
        ...current,
        agents: current.agents.map((agent) =>
          agent.id === id ? { ...agent, sessionId: sessionMarker(id) } : agent,
        ),
      });
      appInvoke("save_fleet_state", { state: normalized }).catch((error) =>
        console.error("Failed to save agent session marker:", error),
      );
      return normalized;
    });
  };

  const sendManualMessage = async () => {
    const trimmedMessage = manualMessage.trim();
    if (!manualRecipient || !trimmedMessage || isSendingMessage) return;
    setManualError(null);
    setIsSendingMessage(true);
    try {
      const body = `[from human]: ${trimmedMessage}`;
      await appInvoke("write_pty", { id: manualRecipient, data: encode(body) });
      window.setTimeout(() => {
        appInvoke("write_pty", { id: manualRecipient, data: encode("\r") }).catch((error) =>
          console.error("Failed to submit manual message:", error),
        );
      }, 250);
      if (fleetState) {
        const message = await appInvoke<MessageRecord>("record_manual_message", {
          from: "human",
          to: manualRecipient,
          body: trimmedMessage,
        });
        saveState({ ...fleetState, messages: [message, ...fleetState.messages] });
      }
      setManualMessage("");
    } catch (error) {
      setManualError(String(error));
    } finally {
      setIsSendingMessage(false);
    }
  };

  const ready = fleetState !== null && runtimeContext !== null;
  const selectedAgent =
    fleetState?.agents.find((agent) => agent.id === selectedAgentId) ?? fleetState?.agents[0] ?? null;
  const selectAgent = (id: string) => {
    setSelectedAgentId(id);
    setManualRecipient(id);
    setIsEditAgentOpen(false);
  };

  if (!ready) {
    return (
      <main className="loading-screen">
        <span>loading fleet...</span>
      </main>
    );
  }

  if (!fleetState.activeWorkspace) {
    return (
      <WorkspaceSetup
        path={setupPath}
        name={setupName}
        error={setupError}
        onPathChange={setSetupPath}
        onNameChange={setSetupName}
        onOpen={openWorkspace}
        onCreate={createWorkspace}
        onBrowse={browseSetupPath}
      />
    );
  }

  return (
    <main className={`app-shell room-shell ${isFocusMode ? "is-focus-mode" : ""}`}>
      <section className="room-workbench">
        <header className="workbench-bar">
          <div>
            <span>Selected project</span>
            <h1>{selectedAgent?.label ?? "No agent selected"}</h1>
            <p>{selectedAgent?.role ?? "Choose an agent from the room."}</p>
          </div>
          {selectedAgent ? (
            <div className="workbench-actions">
              <div className="workbench-meta">
                <code>{selectedAgent.runtime}</code>
                <code>{selectedAgent.id}</code>
              </div>
            </div>
          ) : null}
        </header>

        <section className="terminal-stage">
          {fleetState.agents.length > 0 ? (
            <div className={`agent-grid ${isFocusMode ? "is-focused" : ""}`}>
              {fleetState.agents.map((agent) => (
                <ProjectAgentPane
                  key={agent.id}
                  agent={agent}
                  selected={agent.id === selectedAgent?.id}
                  focused={isFocusMode && agent.id === selectedAgent?.id}
                  runtimeContext={runtimeContext}
                  allAgents={fleetState.agents}
                  shouldResume={hasUsableSession(agent)}
                  onSelect={selectAgent}
                  onFocus={(id) => {
                    if (isFocusMode && id === selectedAgent?.id) {
                      setIsFocusMode(false);
                    } else {
                      selectAgent(id);
                      setIsFocusMode(true);
                    }
                  }}
                  onSessionStarted={markAgentSessionStarted}
                />
              ))}
            </div>
          ) : (
            <div className="empty-note">No agent selected.</div>
          )}
        </section>
      </section>

      <aside className="room-dock">
        <div className="brand-block">
          <strong>claude-fleet</strong>
          <span>local context federation</span>
        </div>

        <section className="room-summary" aria-label="Room summary">
          <div>
            <span>Room</span>
            <strong>{fleetState.activeWorkspace.name}</strong>
            <code title={fleetState.activeWorkspace.path}>{shortPath(fleetState.activeWorkspace.path)}</code>
          </div>
          <dl>
            <div>
              <dt>Agents</dt>
              <dd>{fleetState.agents.length}</dd>
            </div>
            <div>
              <dt>Messages</dt>
              <dd>{fleetState.messages.length}</dd>
            </div>
          </dl>
        </section>

        <section className="agent-list-block">
          <div className="sidebar-heading">
            <span>Agents</span>
            <small>{fleetState.agents.length}</small>
          </div>
          <div className="agent-roster" aria-label="Agent roster">
            {fleetState.agents.map((agent) => (
              <button
                className={`roster-agent ${agent.id === selectedAgent?.id ? "is-active" : ""}`}
                key={agent.id}
                onClick={() => selectAgent(agent.id)}
                type="button"
              >
                <span className="agent-color" style={{ background: agent.accentColor ?? "#d6d876" }} />
                <span>
                  <strong>{agent.label}</strong>
                  <small>{agent.role}</small>
                </span>
                <code>{agent.runtime}</code>
              </button>
            ))}
          </div>
        </section>

        <button className="btn primary wide" onClick={() => setIsAddAgentOpen(true)}>
          Add agent
        </button>

        <AgentDetails
          agent={selectedAgent}
          agents={fleetState.agents}
          messages={fleetState.messages}
          manualRecipient={manualRecipient}
          manualMessage={manualMessage}
          manualError={manualError}
          isSendingMessage={isSendingMessage}
          onManualRecipientChange={setManualRecipient}
          onManualMessageChange={setManualMessage}
          onSendManualMessage={sendManualMessage}
          onEditAgent={() => setIsEditAgentOpen(true)}
        />

        <div className="mailbox-root" title={mailboxRoot ?? "~/.claude-fleet/mail"}>
          <span>Mailbox</span>
          <code>{shortPath(mailboxRoot ?? "~/.claude-fleet/mail")}</code>
        </div>
        <button className="btn wide" onClick={resetRoom}>Switch room</button>
      </aside>

      {isAddAgentOpen ? (
        <AddAgentModal
          name={newAgentName}
          role={newAgentRole}
          runtime={newAgentRuntime}
          path={newAgentPath}
          onNameChange={setNewAgentName}
          onRoleChange={setNewAgentRole}
          onRuntimeChange={setNewAgentRuntime}
          onPathChange={setNewAgentPath}
          onBrowse={browseAgentPath}
          onClose={() => setIsAddAgentOpen(false)}
          onAdd={addAgent}
        />
      ) : null}
      {isEditAgentOpen && selectedAgent ? (
        <EditAgentModal
          agent={selectedAgent}
          canRemove={fleetState.agents.length > 1}
          onAgentUpdate={updateAgent}
          onRemoveAgent={(id) => {
            removeAgent(id);
            setIsEditAgentOpen(false);
          }}
          onClose={() => setIsEditAgentOpen(false)}
        />
      ) : null}
    </main>
  );
}

function normalizeLoadedState(state: FleetState): FleetState {
  const workspacePath = state.activeWorkspace?.path ?? null;
  const agents = state.agents.map((agent, index) => {
    const isLegacyOrchestrator = agent.id === "orchestrator" || agent.role === "orchestrator";
    return {
      ...agent,
      id: agent.id,
      label: isLegacyOrchestrator ? "home-project" : agent.label,
      accentColor: agent.accentColor ?? defaultAgentColor(index),
      title: agent.title ?? null,
      runtime: agent.runtime ?? "claude",
      role: isLegacyOrchestrator ? "project expert" : agent.role || "project expert",
      reportsTo: null,
      capabilities:
        agent.capabilities ??
        `Local expert for ${agent.cwd ?? workspacePath ?? "this project"}.`,
      cwd: agent.cwd ?? workspacePath,
      worktree: agent.worktree ?? null,
      instructions: agent.instructions ?? "",
      instructionsBundle: agent.instructionsBundle ?? null,
      runtimeConfig: agent.runtimeConfig ?? { heartbeat: { enabled: false, wakeOnDemand: true } },
      permissions: { canCreateAgents: false, canManageTasks: false },
      sourceTaskId: null,
      sessionId:
        agent.runtime === "codex" && agent.sessionId && !agent.sessionId.startsWith("agent-home-v1:")
          ? null
          : agent.sessionId ?? null,
      status: agent.status || "idle",
    };
  });

  return {
    ...state,
    schemaVersion: 3,
    mainAgentId:
      state.mainAgentId && agents.some((agent) => agent.id === state.mainAgentId)
        ? state.mainAgentId
        : agents[0]?.id ?? null,
    agents,
    tasks: [],
    orchestratorChat: [],
    messages: state.messages ?? [],
    runs: [],
    workspaces: state.workspaces ?? [],
  };
}

function ProjectAgentPane({
  agent,
  selected,
  focused,
  runtimeContext,
  allAgents,
  shouldResume,
  onSelect,
  onFocus,
  onSessionStarted,
}: {
  agent: AgentRecord;
  selected: boolean;
  focused: boolean;
  runtimeContext: RuntimeContext;
  allAgents: AgentRecord[];
  shouldResume: boolean;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  onSessionStarted: (id: string) => void;
}) {
  const paneRef = useRef<HTMLElement | null>(null);
  const [terminalReady, setTerminalReady] = useState(selected || focused);
  const [paneView, setPaneView] = useState<"chat" | "terminal">("chat");
  const adapter = runtimeAdapters[agent.runtime];
  const context = {
    ...runtimeContext,
    systemPrompt: () => systemPromptFor(agent, allAgents),
  };

  useEffect(() => {
    if (terminalReady) return;
    if (selected || focused) {
      setTerminalReady(true);
      return;
    }

    const pane = paneRef.current;
    if (!pane || !("IntersectionObserver" in window)) {
      setTerminalReady(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setTerminalReady(true);
          observer.disconnect();
        }
      },
      { rootMargin: "320px" },
    );
    observer.observe(pane);
    return () => observer.disconnect();
  }, [focused, selected, terminalReady]);

  return (
    <article
      ref={paneRef}
      className={`agent-pane ${selected ? "is-selected" : ""} ${focused ? "is-focused" : ""}`}
    >
      <div className="agent-pane-header">
        <span className="agent-color" style={{ background: agent.accentColor ?? "#d6d876" }} />
        <button className="agent-pane-title" onClick={() => onSelect(agent.id)} type="button">
          <strong>{agent.label}</strong>
          <small>{agent.role}</small>
        </button>
        <div className="agent-pane-actions">
          <code>{agent.runtime}</code>
          <div className="pane-mode-toggle" aria-label={`${agent.label} view`}>
            <button
              className={paneView === "chat" ? "is-active" : ""}
              onClick={() => setPaneView("chat")}
              type="button"
            >
              Chat
            </button>
            <button
              className={paneView === "terminal" ? "is-active" : ""}
              onClick={() => setPaneView("terminal")}
              type="button"
            >
              Terminal
            </button>
          </div>
          <button className="btn" onClick={() => onFocus(agent.id)}>
            {focused ? "Exit focus" : "Focus"}
          </button>
        </div>
      </div>
      <div className="agent-project-path" title={agent.cwd ?? undefined}>{shortPath(agent.cwd)}</div>
      <div className="agent-live-slot">
        <div className={`pane-layer ${paneView === "terminal" ? "is-active" : ""}`} aria-hidden={paneView !== "terminal"}>
          {terminalReady ? (
            <TerminalPane
              id={agent.id}
              cmd={adapter.command}
              args={adapter.freshArgs(agent.id, context)}
              continueArgs={adapter.resumeArgs(agent.id, context)}
              initialUseContinue={shouldResume}
              onSessionStarted={() => onSessionStarted(agent.id)}
              cwd={agent.cwd ?? undefined}
            />
          ) : (
            <div className="terminal-standby" aria-label={`${agent.label} terminal standby`}>
              <span>standby</span>
            </div>
          )}
        </div>
        <div className={`pane-layer ${paneView === "chat" ? "is-active" : ""}`} aria-hidden={paneView !== "chat"}>
          <AgentTranscriptChat agent={agent} active={paneView === "chat"} />
        </div>
      </div>
    </article>
  );
}

function AgentTranscriptChat({ agent, active }: { agent: AgentRecord; active: boolean }) {
  const [transcript, setTranscript] = useState<ClaudeTranscript | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const isClaude = agent.runtime === "claude";

  useEffect(() => {
    if (!active || !agent.cwd || !isClaude) return;
    let cancelled = false;
    let unlistenTranscript: UnlistenFn | undefined;
    let unlistenError: UnlistenFn | undefined;

    appInvoke<ClaudeTranscript>("read_claude_transcript", { cwd: agent.cwd, limit: 80 })
      .then((nextTranscript) => {
        if (cancelled) return;
        setTranscript(nextTranscript);
        setError(null);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(String(loadError));
      });

    if (hasTauriBridge()) {
      listen<ClaudeTranscriptEvent>(`claude:transcript:${agent.id}`, (event) => {
        if (cancelled) return;
        setTranscript(event.payload.transcript);
        setError(null);
      }).then((unlisten) => {
        if (cancelled) {
          unlisten();
          return;
        }
        unlistenTranscript = unlisten;
      });

      listen<ClaudeTranscriptErrorEvent>(`claude:transcript-error:${agent.id}`, (event) => {
        if (cancelled) return;
        setError(event.payload.error);
      }).then((unlisten) => {
        if (cancelled) {
          unlisten();
          return;
        }
        unlistenError = unlisten;
      });

      appInvoke("watch_claude_transcript", { agentId: agent.id, cwd: agent.cwd, limit: 80 }).catch((watchError) => {
        if (!cancelled) setError(String(watchError));
      });
    }

    return () => {
      cancelled = true;
      unlistenTranscript?.();
      unlistenError?.();
      if (hasTauriBridge()) {
        appInvoke("stop_claude_transcript_watch", { agentId: agent.id }).catch(() => {});
      }
    };
  }, [active, agent.cwd, agent.id, isClaude]);

  useEffect(() => {
    if (!active) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
  }, [active, transcript?.messages.length]);

  if (!agent.cwd) {
    return (
      <div className="chat-empty-state">
        <strong>No project path</strong>
        <span>Add a project path to read this agent's Claude session as chat.</span>
      </div>
    );
  }

  if (!isClaude) {
    return (
      <div className="chat-empty-state">
        <strong>Chat transcript unavailable</strong>
        <span>Codex panes still run in terminal mode. Claude JSONL chat is available for Claude agents.</span>
      </div>
    );
  }

  const messages = transcript?.messages ?? [];

  return (
    <section className="agent-chat" aria-label={`${agent.label} Claude transcript`}>
      <header className="agent-chat-header">
        <div>
          <strong>Chat</strong>
          <span title={transcript?.sessionPath ?? undefined}>
            {transcript?.sessionId ? `session ${transcript.sessionId.slice(0, 8)}` : "waiting for Claude session"}
          </span>
        </div>
        <code>{messages.length}</code>
      </header>

      <div ref={scrollerRef} className="chat-scroll">
        {messages.map((message) => {
          const toolName = toolEventName(message.body);
          if (toolName) {
            return (
              <div className="chat-event" key={message.id}>
                <span>tool</span>
                <code>{toolName}</code>
                {message.createdAt ? <time>{formatTime(message.createdAt)}</time> : null}
              </div>
            );
          }

          return (
            <article className={`chat-message is-${message.role}`} key={message.id}>
              <div className="chat-message-meta">
                <span>{message.role === "assistant" ? agent.label : "you"}</span>
                {message.createdAt ? <time>{formatTime(message.createdAt)}</time> : null}
              </div>
              <ChatMessageBody body={message.body} />
            </article>
          );
        })}
        {messages.length === 0 && !error ? (
          <div className="chat-empty-state">
            <strong>No transcript yet</strong>
            <span>Claude will appear here after this project has an active session in ~/.claude/projects.</span>
          </div>
        ) : null}
        {error ? (
          <div className="chat-empty-state is-error">
            <strong>Could not read transcript</strong>
            <span>{error}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function renderInlineMarkdown(text: string) {
  const nodes: React.ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(<code key={`${match.index}-code`}>{token.slice(1, -1)}</code>);
    } else {
      nodes.push(<strong key={`${match.index}-strong`}>{token.slice(2, -2)}</strong>);
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function ChatMessageBody({ body }: { body: string }) {
  const segments = body.split(/(```[\s\S]*?```)/g).filter(Boolean);

  return (
    <div className="chat-message-body">
      {segments.map((segment, segmentIndex) => {
        if (segment.startsWith("```") && segment.endsWith("```")) {
          const code = segment.replace(/^```[^\n]*\n?/, "").replace(/```$/, "").trimEnd();
          return <pre key={segmentIndex}><code>{code}</code></pre>;
        }

        return segment
          .split(/\n{2,}/)
          .map((block, blockIndex) => {
            const lines = block.split("\n").map((line) => line.trimEnd()).filter(Boolean);
            if (lines.length === 0) return null;

            const everyLineIsBullet = lines.every((line) => /^[-*]\s+/.test(line.trim()));
            if (everyLineIsBullet) {
              return (
                <ul key={`${segmentIndex}-${blockIndex}`}>
                  {lines.map((line, lineIndex) => (
                    <li key={lineIndex}>{renderInlineMarkdown(line.trim().replace(/^[-*]\s+/, ""))}</li>
                  ))}
                </ul>
              );
            }

            return (
              <p key={`${segmentIndex}-${blockIndex}`}>
                {lines.map((line, lineIndex) => (
                  <React.Fragment key={lineIndex}>
                    {lineIndex > 0 ? <br /> : null}
                    {renderInlineMarkdown(line.trim())}
                  </React.Fragment>
                ))}
              </p>
            );
          });
      })}
    </div>
  );
}

function AgentDetails({
  agent,
  agents,
  messages,
  manualRecipient,
  manualMessage,
  manualError,
  isSendingMessage,
  onManualRecipientChange,
  onManualMessageChange,
  onSendManualMessage,
  onEditAgent,
}: {
  agent: AgentRecord | null;
  agents: AgentRecord[];
  messages: MessageRecord[];
  manualRecipient: string;
  manualMessage: string;
  manualError: string | null;
  isSendingMessage: boolean;
  onManualRecipientChange: (value: string) => void;
  onManualMessageChange: (value: string) => void;
  onSendManualMessage: () => void;
  onEditAgent: () => void;
}) {
  return (
    <>
      <section className="panel-section">
        <div className="section-title">Selected Agent</div>
        {agent ? (
          <div className="agent-summary-card">
            <div>
              <strong>{agent.label}</strong>
              <span>{agent.role}</span>
              <code title={agent.cwd ?? undefined}>{shortPath(agent.cwd)}</code>
            </div>
            <button className="btn wide" onClick={onEditAgent}>Edit agent</button>
          </div>
        ) : (
          <div className="empty-note">No agent selected.</div>
        )}
      </section>

      <section className="panel-section">
        <div className="section-title">Send Message</div>
        <div className="details-stack">
          <label>
            <span>Recipient</span>
            <select value={manualRecipient} onChange={(event) => onManualRecipientChange(event.target.value)}>
              {agents.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Message</span>
            <textarea
              value={manualMessage}
              placeholder="Ask for the contract, risk, file owner, or decision."
              onChange={(event) => onManualMessageChange(event.target.value)}
            />
          </label>
          {manualError ? <div className="inline-error">{manualError}</div> : null}
          <button
            className="btn primary wide"
            disabled={!manualMessage.trim() || !manualRecipient || isSendingMessage}
            onClick={onSendManualMessage}
          >
            {isSendingMessage ? "Sending..." : "Send to agent"}
          </button>
        </div>
      </section>

      <section className="panel-section">
        <div className="section-title">Message Ledger</div>
        <div className="message-ledger">
          {messages.slice(0, 14).map((message) => (
            <div className="ledger-item" key={message.id}>
              <span>{message.from} to {message.to}{formatTime(message.createdAt) ? ` at ${formatTime(message.createdAt)}` : ""}</span>
              <p>{message.body}</p>
            </div>
          ))}
          {messages.length === 0 ? <div className="empty-note">No messages yet.</div> : null}
        </div>
      </section>
    </>
  );
}

function EditAgentModal({
  agent,
  canRemove,
  onAgentUpdate,
  onRemoveAgent,
  onClose,
}: {
  agent: AgentRecord;
  canRemove: boolean;
  onAgentUpdate: (id: string, patch: Partial<AgentRecord>) => void;
  onRemoveAgent: (id: string) => void;
  onClose: () => void;
}) {
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onClose();
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="agent-modal" role="dialog" aria-modal="true" aria-labelledby="edit-agent-title">
        <header className="modal-header">
          <div>
            <h2 id="edit-agent-title">Edit agent</h2>
            <p>Keep this project-local agent easy to route and understand.</p>
          </div>
          <button className="modal-close" onClick={onClose} type="button" aria-label="Close edit agent dialog">
            Close
          </button>
        </header>

        <form className="modal-form" onSubmit={submit}>
          <label>
            Name
            <input
              autoFocus
              value={agent.label}
              onChange={(event) => onAgentUpdate(agent.id, { label: event.target.value })}
            />
          </label>
          <label>
            Role
            <input
              value={agent.role}
              onChange={(event) => onAgentUpdate(agent.id, { role: event.target.value })}
            />
          </label>
          <label>
            Project path
            <input
              value={agent.cwd ?? ""}
              onChange={(event) => onAgentUpdate(agent.id, { cwd: event.target.value })}
            />
          </label>
          <label>
            Local expertise
            <textarea
              value={agent.capabilities ?? ""}
              placeholder="What does this project agent know?"
              onChange={(event) => onAgentUpdate(agent.id, { capabilities: event.target.value || null })}
            />
          </label>
          <label>
            Standing instructions
            <textarea
              value={agent.instructions ?? ""}
              placeholder="Optional"
              onChange={(event) => onAgentUpdate(agent.id, { instructions: event.target.value })}
            />
          </label>
          <div className="modal-actions edit-actions">
            <button
              className="btn danger"
              disabled={!canRemove}
              onClick={() => onRemoveAgent(agent.id)}
              type="button"
            >
              Remove
            </button>
            <button className="btn" onClick={onClose} type="button">Cancel</button>
            <button className="btn primary" type="submit">Done</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function AddAgentModal({
  name,
  role,
  runtime,
  path,
  onNameChange,
  onRoleChange,
  onRuntimeChange,
  onPathChange,
  onBrowse,
  onClose,
  onAdd,
}: {
  name: string;
  role: string;
  runtime: AgentRuntime;
  path: string;
  onNameChange: (value: string) => void;
  onRoleChange: (value: string) => void;
  onRuntimeChange: (value: AgentRuntime) => void;
  onPathChange: (value: string) => void;
  onBrowse: () => void;
  onClose: () => void;
  onAdd: () => void;
}) {
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (path.trim()) onAdd();
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="agent-modal" role="dialog" aria-modal="true" aria-labelledby="add-agent-title">
        <header className="modal-header">
          <div>
            <h2 id="add-agent-title">Add project agent</h2>
            <p>Choose a project directory and give the agent a local role.</p>
          </div>
          <button className="modal-close" onClick={onClose} type="button" aria-label="Close add agent dialog">
            Close
          </button>
        </header>

        <form className="modal-form" onSubmit={submit}>
          <label>
            Name
            <input
              autoFocus
              value={name}
              placeholder="billing-service"
              onChange={(event) => onNameChange(event.target.value)}
            />
          </label>
          <label>
            Role
            <input
              value={role}
              placeholder="service expert"
              onChange={(event) => onRoleChange(event.target.value)}
            />
          </label>
          <label>
            Runtime
            <select
              value={runtime}
              onChange={(event) => onRuntimeChange(event.target.value as AgentRuntime)}
            >
              <option value="claude">Claude</option>
              <option value="codex">Codex</option>
            </select>
          </label>
          <label>
            Project path
            <input
              value={path}
              placeholder="/path/to/project"
              onChange={(event) => onPathChange(event.target.value)}
            />
          </label>
          <div className="modal-actions">
            <button className="btn" onClick={onBrowse} type="button">Browse</button>
            <button className="btn" onClick={onClose} type="button">Cancel</button>
            <button className="btn primary" disabled={!path.trim()} type="submit">Add agent</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function WorkspaceSetup({
  path,
  name,
  error,
  onPathChange,
  onNameChange,
  onOpen,
  onCreate,
  onBrowse,
}: {
  path: string;
  name: string;
  error: string | null;
  onPathChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onOpen: () => void;
  onCreate: () => void;
  onBrowse: () => void;
}) {
  return (
    <main className="setup-shell">
      <section className="setup-brand">
        <div className="eyebrow">Context federation</div>
        <h1>claude-fleet</h1>
        <p>
          Choose a home project. Then add one Claude agent per project or service.
          Each agent keeps its own context warm and talks to peers through MCP messages.
        </p>
      </section>
      <section className="setup-panel">
        <div>
          <div className="setup-title">Open the fleet room</div>
          <div className="setup-copy">This path is only the room anchor. Agents can live in different projects.</div>
        </div>
        <label className="setup-field">
          Home project path
          <div className="path-picker">
            <input
              className="setup-input"
              value={path}
              placeholder="~/Development/billing-service"
              onChange={(event) => onPathChange(event.target.value)}
            />
            <button className="btn" onClick={onBrowse}>Browse</button>
          </div>
        </label>
        <label className="setup-field">
          Room name
          <input
            className="setup-input"
            value={name}
            placeholder="Optional"
            onChange={(event) => onNameChange(event.target.value)}
          />
        </label>
        {error ? <div className="setup-error">{error}</div> : null}
        <div className="setup-actions">
          <button className="btn primary" onClick={onOpen}>Open room</button>
          <button className="btn btn-secondary" onClick={onCreate}>Create room</button>
        </div>
      </section>
    </main>
  );
}

export default App;
