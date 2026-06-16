export type AgentRuntime = "claude" | "codex";

type RuntimeContext = {
  mcpBinaryPath: string;
  mcpConfigPath: string;
  systemPrompt: (agentId: string) => string;
};

type RuntimeAdapter = {
  label: string;
  command: string;
  freshArgs: (agentId: string, context: RuntimeContext) => string[];
  resumeArgs: (agentId: string, context: RuntimeContext) => string[];
};

const tomlString = (value: string): string => JSON.stringify(value);

const codexMcpArgs = (agentId: string, context: RuntimeContext): string[] => [
  "--dangerously-bypass-approvals-and-sandbox",
  "-c",
  `mcp_servers.claude-fleet.command=${tomlString(context.mcpBinaryPath)}`,
  "-c",
  "mcp_servers.claude-fleet.args=[]",
  "-c",
  `mcp_servers.claude-fleet.env.FLEET_AGENT_ID=${tomlString(agentId)}`,
  "-c",
  `mcp_servers.claude-fleet.env.FLEET_SOCKET=${tomlString("/tmp/claude-fleet.sock")}`,
];

export const runtimeAdapters: Record<AgentRuntime, RuntimeAdapter> = {
  claude: {
    label: "Claude",
    command: "claude",
    freshArgs: (agentId, context) => [
      "--append-system-prompt",
      context.systemPrompt(agentId),
      "--mcp-config",
      context.mcpConfigPath,
    ],
    resumeArgs: (agentId, context) => [
      "--continue",
      ...runtimeAdapters.claude.freshArgs(agentId, context),
    ],
  },
  codex: {
    label: "Codex",
    command: "codex",
    freshArgs: (agentId, context) => [
      ...codexMcpArgs(agentId, context),
      context.systemPrompt(agentId),
    ],
    resumeArgs: (agentId, context) => [
      ...codexMcpArgs(agentId, context),
      "resume",
      "--last",
    ],
  },
};
