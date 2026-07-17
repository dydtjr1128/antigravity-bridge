import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const BRIDGE_SCRIPT = path.join(ROOT_DIR, "scripts", "antigravity-bridge.mjs");

async function loadBridge() {
  return import(`${pathToFileURL(BRIDGE_SCRIPT).href}?test=unit`);
}

test("parseDuration accepts bounded duration syntax and rejects invalid values", async () => {
  const bridge = await loadBridge();

  assert.equal(bridge.parseDuration("50ms"), 50);
  assert.equal(bridge.parseDuration("2s"), 2_000);
  assert.equal(bridge.parseDuration("3m"), 180_000);
  assert.equal(bridge.parseDuration("5m0s"), 300_000);

  for (const value of ["0ms", "-1s", "1", "5mwat", "1s1s", "1s1m", "", "  "]) {
    assert.throws(() => bridge.parseDuration(value), /duration|timeout/i);
  }
});

test("run passes the print timeout as a hard timeout to an injected provider", async () => {
  const bridge = await loadBridge();
  let invocation;
  const fakeSpawn = (command, args, options) => {
    invocation = { command, args, options };
    return { status: 0, signal: null, stdout: "review complete", stderr: "" };
  };

  const result = bridge.run("agy", ["--print", "review"], {
    cwd: ROOT_DIR,
    timeoutMs: 50,
    spawn: fakeSpawn
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, "review complete");
  assert.equal(invocation.command, "agy");
  assert.equal(invocation.options.timeout, 50);
});

test("commandReport uses non-empty stdout without polling transcripts", async () => {
  const bridge = await loadBridge();
  let transcriptLookups = 0;
  const success = bridge.run("agy", [], {
    spawn: () => ({ status: 0, signal: null, stdout: "direct review", stderr: "" })
  });

  const report = bridge.commandReport(success, {
    timeout: "5m0s",
    transcriptLookup: () => {
      transcriptLookups += 1;
      return {
        conversationId: "unexpected",
        transcriptPath: "unexpected",
        result: "stale transcript"
      };
    }
  });

  assert.equal(report.result, "direct review");
  assert.equal(report.timeout, "5m0s");
  assert.equal(report.timedOut, false);
  assert.equal(report.success, true);
  assert.equal(transcriptLookups, 0);
});

test("commandReport polls transcripts only after an empty successful stdout", async () => {
  const bridge = await loadBridge();
  let transcriptLookups = 0;
  const success = bridge.run("agy", [], {
    spawn: () => ({ status: 0, signal: null, stdout: "", stderr: "" })
  });

  const report = bridge.commandReport(success, {
    timeout: "5m0s",
    transcriptLookup: () => {
      transcriptLookups += 1;
      return {
        conversationId: "conversation-1",
        transcriptPath: "transcript.jsonl",
        result: "transcript review"
      };
    }
  });

  assert.equal(report.result, "transcript review");
  assert.equal(report.conversationId, "conversation-1");
  assert.equal(report.transcriptPath, "transcript.jsonl");
  assert.equal(report.success, true);
  assert.equal(transcriptLookups, 1);
});

test("commandReport preserves provider failure and timeout metadata without polling", async () => {
  const bridge = await loadBridge();
  let transcriptLookups = 0;
  const transcriptLookup = () => {
    transcriptLookups += 1;
    return { conversationId: "unexpected", transcriptPath: "unexpected", result: "unexpected" };
  };
  const failure = bridge.run("agy", [], {
    spawn: () => ({ status: 7, signal: null, stdout: "", stderr: "provider failed" })
  });
  const failureReport = bridge.commandReport(failure, {
    timeout: "5m0s",
    transcriptLookup
  });

  assert.equal(failureReport.status, 7);
  assert.match(failureReport.stderr, /provider failed/i);
  assert.equal(failureReport.timedOut, false);
  assert.equal(failureReport.success, false);

  const timeoutError = Object.assign(new Error("provider timed out"), { code: "ETIMEDOUT" });
  const timedOut = bridge.run("agy", [], {
    timeoutMs: 50,
    spawn: () => ({
      status: null,
      signal: "SIGTERM",
      stdout: "partial review",
      stderr: "",
      error: timeoutError
    })
  });
  const timeoutReport = bridge.commandReport(timedOut, {
    timeout: "50ms",
    transcriptLookup
  });

  assert.equal(timeoutReport.status, null);
  assert.equal(timeoutReport.result, "partial review");
  assert.equal(timeoutReport.timeout, "50ms");
  assert.equal(timeoutReport.timedOut, true);
  assert.equal(timeoutReport.success, false);
  assert.equal(transcriptLookups, 0);
});

test("findConversationResult stops before polling or sleeping after its deadline", async () => {
  const bridge = await loadBridge();
  let transcriptPolls = 0;
  let sleeps = 0;

  const result = bridge.findConversationResult(
    path.join(ROOT_DIR, ".missing-test-data"),
    ROOT_DIR,
    new Set(),
    1_000,
    1_100,
    {
      now: () => 1_100,
      listBrainIds: () => {
        transcriptPolls += 1;
        return [];
      },
      sleep: () => {
        sleeps += 1;
      }
    }
  );

  assert.deepEqual(result, { conversationId: null, transcriptPath: null, result: "" });
  assert.equal(transcriptPolls, 0);
  assert.equal(sleeps, 0);
});

test("findConversationResult caps its sleep to the remaining deadline", async () => {
  const bridge = await loadBridge();
  let now = 1_000;
  let transcriptPolls = 0;
  const sleeps = [];

  const result = bridge.findConversationResult(
    path.join(ROOT_DIR, ".missing-test-data"),
    ROOT_DIR,
    new Set(),
    1_000,
    1_100,
    {
      now: () => now,
      listBrainIds: () => {
        transcriptPolls += 1;
        return [];
      },
      sleep: (ms) => {
        sleeps.push(ms);
        now += ms;
      }
    }
  );

  assert.deepEqual(result, { conversationId: null, transcriptPath: null, result: "" });
  assert.equal(transcriptPolls, 1);
  assert.deepEqual(sleeps, [100]);
});

const boundedPolicy = [
  "Do not execute project code or validation commands unless the user explicitly and directly requests that execution.",
  "Read-only repository inspection commands required to obtain the requested scope are allowed, including `git diff`, `git status`, `git show`, `git log`, `git blame`, and `git ls-files`.",
  "Do not use shell commands for any other purpose, and do not run commands that modify files, the index, refs, configuration, or other repository state.",
  "Complete one bounded pass within five minutes.",
  "Do not retry, add reviewers, expand the scope, or switch to a deeper model automatically.",
  "If the available time or evidence is insufficient, return the supported findings and state the remaining gap.",
  "Start with the exact diff or named files in scope and inspect only directly relevant dependencies needed to support a concrete finding.",
  "Do not perform repository-wide discovery, recursively follow references, or pursue speculative context.",
  "Once a finding has enough static evidence, report it; if evidence remains insufficient, state the uncertainty and remaining gap instead of continuing to investigate."
];

function exactSentence(sentence) {
  return new RegExp(sentence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

test("review prompts enforce one bounded non-executing pass", () => {
  for (const name of ["review", "adversarial-review", "rescue"]) {
    const text = readFileSync(path.join(ROOT_DIR, "prompts", `${name}.md`), "utf8");
    for (const sentence of boundedPolicy) {
      assert.match(text, exactSentence(sentence));
    }
    assert.doesNotMatch(text, /lightweight local commands/i);
  }
});

test("skills limit preflight and verification to explicit, static actions", () => {
  for (const name of ["review", "adversarial-review", "rescue"]) {
    const text = readFileSync(path.join(ROOT_DIR, "skills", name, "SKILL.md"), "utf8");
    for (const sentence of boundedPolicy) {
      assert.match(text, exactSentence(sentence));
    }
    assert.match(text, /static file and line inspection/i);
    assert.match(text, /setup/i);
    assert.doesNotMatch(text, /lightweight local commands/i);
  }

  const readme = readFileSync(path.join(ROOT_DIR, "README.md"), "utf8");
  assert.match(readme, /--print-timeout <duration>/);
  assert.match(readme, /5m0s/);
  assert.match(readme, /explicit user intent/i);
});

test("usage documents the process-level hard timeout", () => {
  const text = readFileSync(BRIDGE_SCRIPT, "utf8");
  const timeoutLine = text.split(/\r?\n/).find((line) => line.includes("--print-timeout <time>"));

  assert.match(timeoutLine ?? "", /process-level hard timeout/i);
});

test("usage requires explicit opt-in for deep review", () => {
  const text = readFileSync(BRIDGE_SCRIPT, "utf8");
  const deepLine = text.split(/\r?\n/).find((line) => line.includes('"  --deep'));

  assert.doesNotMatch(deepLine ?? "", /high-risk\/deep review/i);
  assert.match(deepLine ?? "", /only when explicitly requested/i);
});
