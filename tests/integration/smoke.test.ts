/**
 * Integration smoke tests: spawn the REAL pi CLI against this package via the
 * dev install (`pi -e .`) in RPC mode, and verify the extension commands
 * handle their prompts.
 *
 * Env-gated: these tests are SKIPPED unless EGM_E2E is set, because they use
 * the account's model quota (each command can trigger model work).
 *
 *   EGM_E2E=1 npx vitest run tests/integration
 *
 * NOTE ON COVERAGE: the full upstream-bar end-to-end (interactive brainstorm →
 * draft → review through an actual `pi install` of this package) is recorded
 * MANUALLY in TESTING.md, not automated here. These RPC smokes cover command
 * disposition and workflow start only.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SMOKE_TIMEOUT_MS = 60_000;
const WORKFLOW_START_TIMEOUT_MS = 120_000;

interface RpcRecord {
  [key: string]: unknown;
}

/**
 * Run one RPC command against a fresh `pi -e . --mode rpc` child and collect
 * every protocol record. RPC frames are strict JSONL (one object per
 * LF-terminated line).
 *
 * waitFor:
 *   - "response"      finish when the command's response record arrives
 *   - "assistantText" finish only when an assistant message_end carrying
 *                     non-empty text arrives afterwards (the model turn can
 *                     stream long after the response record)
 */
function rpcCommand(
  command: string,
  message: string,
  timeoutMs: number,
  waitFor: "response" | "assistantText" = "response",
): Promise<RpcRecord[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("pi", ["-e", ".", "--mode", "rpc"], {
      cwd: REPO_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const records: RpcRecord[] = [];
    let buffer = "";
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill("SIGTERM");
      } catch {
        // Already gone.
      }
      if (error) reject(error);
      else resolve(records);
    };

    const timer = setTimeout(() => {
      finish(new Error(`timeout after ${timeoutMs}ms waiting for RPC response to ${command}`));
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let newlineIdx = buffer.indexOf("\n");
      while (newlineIdx !== -1) {
        const line = buffer.slice(0, newlineIdx).replace(/\r$/, "");
        buffer = buffer.slice(newlineIdx + 1);
        if (line.trim()) {
          try {
            const record = JSON.parse(line) as RpcRecord;
            records.push(record);
            if (waitFor === "assistantText" && record["type"] === "message_end") {
              const message = record["message"] as
                | { role?: string; content?: Array<{ type?: string; text?: string }> }
                | undefined;
              const text = (message?.content ?? [])
                .map((part) => (typeof part?.text === "string" ? part.text : ""))
                .join("");
              if (message?.role === "assistant" && text.trim().length > 0) {
                finish();
                return;
              }
            }
            if (
              record["type"] === "response" &&
              record["command"] === command &&
              (record["id"] === "egm-test-1" || record["id"] === undefined)
            ) {
              if (waitFor === "response") {
                finish();
                return;
              }
              // waitFor === "assistantText": keep consuming past the response.
            }
          } catch {
            // Not a protocol record; ignore per RPC docs (stderr-only diagnostics).
          }
        }
        newlineIdx = buffer.indexOf("\n");
      }
    });
    child.stderr?.on("data", () => {
      /* diagnostics only — never protocol data */
    });
    child.on("error", (err) => finish(err));
    child.on("close", () => finish(new Error(`pi exited before responding to ${command}`)));

    child.stdin?.write(`${JSON.stringify({ id: "egm-test-1", type: command, message })}\n`);
  });
}

function findResponse(records: RpcRecord[]): RpcRecord {
  const response = records.find((r) => r["type"] === "response" && r["command"] === "prompt");
  expect(response, "no prompt response record received").toBeTruthy();
  return response;
}

describe.skipIf(!process.env.EGM_E2E)("RPC smoke against the real pi CLI (env-gated: EGM_E2E)", () => {
  it(
    "/egm-version is handled",
    async () => {
      const records = await rpcCommand("prompt", "/egm-version", SMOKE_TIMEOUT_MS);
      const response = findResponse(records);
      expect(response["success"]).toBe(true);
      expect((response["data"] as Record<string, unknown>)?.["disposition"]).toBe("handled");
    },
    SMOKE_TIMEOUT_MS + 5_000,
  );

  it(
    "/egm-review with no args is handled and the assistant asks for the target document",
    async () => {
      const records = await rpcCommand("prompt", "/egm-review", WORKFLOW_START_TIMEOUT_MS, "assistantText");
      const response = findResponse(records);
      expect(response["success"]).toBe(true);
      expect((response["data"] as Record<string, unknown>)?.["disposition"]).toBe("handled");
      // The extension consumes the command and starts a user turn from the
      // vendored skill body; the model's first assistant turn must ask for the
      // review target. Assistant text arrives in `message_end` events (with a
      // message.role === "assistant" and text content parts); start/update
      // events carry empty content placeholders.
      const assistantText = records
        .filter((r) => r["type"] === "message_end")
        .map((r) => (r as { message?: { role?: string; content?: unknown } }).message)
        .filter((m) => m?.role === "assistant")
        .flatMap((m) => (Array.isArray(m?.content) ? m.content : []))
        .map((part) =>
          part && typeof part === "object" && "text" in part
            ? String((part as { text: string }).text)
            : "",
        )
        .join("\n");
      expect(assistantText.toLowerCase()).toMatch(/target/);
    },
    WORKFLOW_START_TIMEOUT_MS + 5_000,
  );
});
