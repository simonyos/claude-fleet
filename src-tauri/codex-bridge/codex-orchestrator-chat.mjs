import { Codex } from "@openai/codex-sdk";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
};

const safeName = (value) => value.replace(/[^a-zA-Z0-9_-]/g, "_");

const linkOrCopy = (source, dest) => {
  if (!fs.existsSync(source) || fs.existsSync(dest)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.symlinkSync(source, dest);
  } catch {
    fs.copyFileSync(source, dest);
  }
};

const isolatedCodexHome = (agentId) => {
  const home = os.homedir();
  const codexHome = path.join(home, ".claude-fleet", "agent-homes", safeName(agentId), "codex-sdk");
  fs.mkdirSync(codexHome, { recursive: true });

  const sourceHome = path.join(home, ".codex");
  for (const file of ["auth.json", "config.toml", "AGENTS.md", "installation_id"]) {
    linkOrCopy(path.join(sourceHome, file), path.join(codexHome, file));
  }

  return codexHome;
};

const emit = (event) => {
  process.stdout.write(`${JSON.stringify(event)}\n`);
};

const main = async () => {
  const request = JSON.parse(await readStdin());
  const codexHome = isolatedCodexHome(request.agentId);
  const env = {
    ...process.env,
    CODEX_HOME: codexHome,
    FLEET_AGENT_ID: request.agentId,
    FLEET_SOCKET: request.socketPath,
  };

  const codex = new Codex({
    env,
    config: {
      mcp_servers: {
        "claude-fleet": {
          command: request.mcpBinaryPath,
          args: [],
          env: {
            FLEET_AGENT_ID: request.agentId,
            FLEET_SOCKET: request.socketPath,
          },
        },
      },
    },
  });

  const threadOptions = {
    workingDirectory: request.cwd,
    skipGitRepoCheck: true,
    approvalPolicy: "never",
    sandboxMode: "danger-full-access",
  };
  const isNewThread = !request.threadId;
  const thread = isNewThread
    ? codex.startThread(threadOptions)
    : codex.resumeThread(request.threadId, threadOptions);

  const prompt = isNewThread
    ? `${request.systemPrompt}\n\nYou are the in-app orchestrator chat. Do not answer as a terminal pane. Use the claude-fleet MCP tools for durable tasks, comments, assignment, and hire requests when useful.\n\nUser:\n${request.prompt}`
    : request.prompt;

  const { events } = await thread.runStreamed(prompt);
  const items = [];
  let finalResponse = "";
  let usage = null;

  for await (const event of events) {
    if (event.type === "thread.started") {
      emit({ type: "thread.started", threadId: event.thread_id });
      continue;
    }

    if (
      (event.type === "item.started" ||
        event.type === "item.updated" ||
        event.type === "item.completed") &&
      event.item?.type === "agent_message"
    ) {
      finalResponse = event.item.text ?? finalResponse;
      emit({ type: "agent_message.updated", text: finalResponse });
    }

    if (event.type === "item.completed") {
      items.push(event.item);
    } else if (event.type === "turn.completed") {
      usage = event.usage;
      emit({ type: "turn.completed", usage });
    } else if (event.type === "turn.failed") {
      throw new Error(event.error?.message ?? "Codex turn failed");
    } else if (event.type === "error") {
      throw new Error(event.message ?? "Codex stream failed");
    }
  }

  emit({
    type: "final",
    threadId: thread.id,
    finalResponse,
    items,
    usage,
  });
};

main().catch((error) => {
  emit({
    type: "error",
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
