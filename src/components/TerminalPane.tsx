import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

void React;

type Props = {
  id: string;
  agentId?: string;
  sessionScope?: string;
  cmd?: string;
  args?: string[];
  continueArgs?: string[];
  initialUseContinue?: boolean;
  onSessionStarted?: () => void;
  cwd?: string;
};

const hasTauriBridge = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function TerminalPane({
  id,
  agentId,
  sessionScope,
  cmd = "claude",
  args = [],
  continueArgs,
  initialUseContinue = false,
  onSessionStarted,
  cwd,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [exited, setExited] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const isPreview = !hasTauriBridge();

  const spawn = async (useContinue: boolean) => {
    const term = termRef.current;
    if (!term) return;
    const finalArgs = useContinue && continueArgs ? continueArgs : args;
    try {
      await invoke("spawn_pty", {
        args: {
          id,
          agentId,
          sessionScope,
          cwd,
          cmd,
          args: finalArgs,
          cols: term.cols,
          rows: term.rows,
        },
      });
      if (!useContinue) {
        onSessionStarted?.();
      }
      setExited(false);
    } catch (e) {
      term.write(`\r\n\x1b[31m[spawn failed: ${e}]\x1b[0m\r\n`);
    }
  };

  useEffect(() => {
    if (isPreview) return;
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
      fontSize: 13,
      theme: {
        background: "#0b0b0d",
        foreground: "#e6e6e6",
        cursor: "#ffa657",
      },
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
    });
    termRef.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);

    let fitFrame: number | null = null;
    let resizeCommandTimer: number | null = null;
    let lastFitSize: { width: number; height: number } | null = null;
    let lastPtySize: { cols: number; rows: number } | null = null;
    let spawned = false;

    const fitToContainer = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width <= 0 || height <= 0) return;
      if (lastFitSize?.width === width && lastFitSize.height === height) return;
      lastFitSize = { width, height };

      try {
        fit.fit();
      } catch {}
    };

    const scheduleFit = () => {
      if (fitFrame !== null) return;
      fitFrame = window.requestAnimationFrame(() => {
        fitFrame = null;
        fitToContainer();
      });
    };

    const waitForStableFit = async () => {
      for (let i = 0; i < 3; i += 1) {
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        fitToContainer();
      }
    };

    let unlistenData: UnlistenFn | undefined;
    let unlistenExit: UnlistenFn | undefined;
    let disposed = false;
    let receivedData = false;
    const replayBuffer = () => {
      invoke<number[]>("read_pty_buffer", { id })
        .then((buffer) => {
          if (!disposed && !receivedData && buffer.length > 0) {
            receivedData = true;
            term.write(new Uint8Array(buffer));
          }
        })
        .catch(() => {});
    };

    (async () => {
      try {
        setIsConnecting(true);
        await waitForStableFit();
        if (disposed) return;

        unlistenData = await listen<{ id: string; data: number[] }>(
          `pty:data:${id}`,
          (e) => {
            receivedData = true;
            term.write(new Uint8Array(e.payload.data));
          },
        );
        unlistenExit = await listen<{ id: string }>(`pty:exit:${id}`, () => {
          term.write("\r\n\x1b[90m[process exited]\x1b[0m\r\n");
          setExited(true);
        });

        if (disposed) return;

        const initialArgs = initialUseContinue && continueArgs ? continueArgs : args;
        await invoke("spawn_pty", {
          args: { id, agentId, sessionScope, cwd, cmd, args: initialArgs, cols: term.cols, rows: term.rows },
        });
        spawned = true;
        lastPtySize = { cols: term.cols, rows: term.rows };
        setIsConnecting(false);
        window.setTimeout(replayBuffer, 250);
        window.setTimeout(replayBuffer, 1000);
        if (!initialUseContinue) {
          onSessionStarted?.();
        }

        term.onData((data) => {
          invoke("write_pty", {
            id,
            data: Array.from(new TextEncoder().encode(data)),
          });
        });

        term.onResize(({ cols, rows }) => {
          if (!spawned) return;
          if (lastPtySize?.cols === cols && lastPtySize.rows === rows) return;
          lastPtySize = { cols, rows };
          if (resizeCommandTimer !== null) {
            window.clearTimeout(resizeCommandTimer);
          }
          resizeCommandTimer = window.setTimeout(() => {
            resizeCommandTimer = null;
            invoke("resize_pty", { id, cols, rows });
          }, 180);
        });
      } catch (error) {
        if (!disposed) {
          setIsConnecting(false);
          term.write(`\r\n\x1b[31m[terminal failed to connect: ${error}]\x1b[0m\r\n`);
        }
      }
    })();

    const ro = new ResizeObserver(scheduleFit);
    ro.observe(container);

    return () => {
      disposed = true;
      setIsConnecting(false);
      if (fitFrame !== null) {
        window.cancelAnimationFrame(fitFrame);
      }
      if (resizeCommandTimer !== null) {
        window.clearTimeout(resizeCommandTimer);
      }
      ro.disconnect();
      unlistenData?.();
      unlistenExit?.();
      invoke("kill_pty", { id }).catch(() => {});
      term.dispose();
      termRef.current = null;
    };
  }, [agentId, cmd, cwd, id, isPreview, sessionScope]);

  if (isPreview) {
    return (
      <div className="term-wrap preview-terminal" aria-label={`${id} terminal preview`}>
        <div className="preview-term-line">
          <span className="preview-prompt">{cwd ?? "~"}</span>
        </div>
        <div className="preview-term-line">{cmd} session ready</div>
        <div className="preview-term-line muted">preview bridge active: desktop PTY starts inside Tauri</div>
        <div className="preview-term-line">mailbox: ~/.claude-fleet/mail/agents/{id}/inbox</div>
        <div className="preview-term-cursor" />
      </div>
    );
  }

  return (
    <div className="term-wrap">
      <div ref={containerRef} className="term-host" />
      {isConnecting && <div className="terminal-status">connecting...</div>}
      {exited && (
        <div className="exit-overlay">
          <div className="exit-msg">process exited</div>
          <div className="exit-actions">
            <button className="btn" onClick={() => spawn(true)}>
              Restart (continue session)
            </button>
            <button className="btn btn-secondary" onClick={() => spawn(false)}>
              Restart fresh
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
