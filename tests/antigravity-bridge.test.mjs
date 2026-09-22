import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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

test("default review scope covers all uncommitted work", async () => {
  const bridge = await loadBridge();

  assert.equal(
    bridge.DEFAULT_REVIEW_SCOPE,
    "all current uncommitted changes in this repository, including staged, unstaged, and untracked files"
  );
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

test("empty successful stdout fails without consulting stale or concurrent transcripts", async () => {
  const bridge = await loadBridge();
  let lookups = 0;
  const report = bridge.commandReport({ status: 0, stdout: "  ", stderr: "" }, {
    transcriptLookup: () => {
      lookups += 1;
      return { conversationId: "old-or-concurrent", result: "unrelated review" };
    }
  });
  assert.equal(report.success, false);
  assert.equal(report.result, "");
  assert.equal(report.conversationId, null);
  assert.equal(report.transcriptPath, null);
  assert.equal(lookups, 0);
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

const boundedPolicy = [
  "Do not execute project code or validation commands unless the user explicitly and directly requests that execution.",
  "Read-only repository inspection commands required to obtain the requested scope are allowed, including `git diff`, `git status`, `git show`, `git log`, `git blame`, and `git ls-files`.",
  "When the scope is current uncommitted work, include staged, unstaged, and untracked files; enumerate them with read-only Git inspection before reviewing only those changes.",
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

test("repository declares Apache-2.0 licensing", () => {
  assert.ok(existsSync(path.join(ROOT_DIR, "LICENSE")));
  assert.match(readFileSync(path.join(ROOT_DIR, "LICENSE"), "utf8"), /Apache License[\s\S]*Version 2\.0/);
});


test("CLI rejects unknown, conflicting, and unsupported setup options", async () => {
  const bridge = await loadBridge();
  assert.throws(() => bridge.parseArgs(["--print-timout", "30s"]), /Unknown option/);
  assert.throws(() => bridge.parseArgs(["--model"]), /Missing value/);
  for (const command of ["review", "setup"]) {
    assert.throws(() => bridge.validateCommandOptions(command, { deep: true, model: "pro" }), /either/);
  }
  for (const option of ["scope", "language", "output-dir", "dry-run"]) {
    assert.throws(() => bridge.validateCommandOptions("setup", { [option]: "value" }), /not valid/);
  }
  assert.throws(() => bridge.validateCommandOptions("setup", {}, ["extra"]), /positional/);
  assert.deepEqual(bridge.parseArgs(["--help"]), { options: { help: true }, positionals: [] });
  assert.deepEqual(bridge.parseArgs(["--", "--literal"]), { options: {}, positionals: ["--literal"] });
});

test("setup shares its deadline between version and smoke", async () => {
  const bridge = await loadBridge();
  let time = 1000;
  const result = bridge.runSetupCheck({ "print-timeout": "100ms" }, {
    now: () => time,
    run: (_command, args, options) => {
      assert.deepEqual(args, ["--version"]);
      assert.equal(options.timeoutMs, 100);
      time += 30;
      return { status: 0, stdout: "version", stderr: "" };
    },
    runPrompt: (options) => {
      assert.equal(options.timeout, "70ms");
      time += 20;
      return { success: true };
    }
  });
  assert.equal(result.ready, true);
});

test("setup skips smoke on version failure or deadline exhaustion", async () => {
  const bridge = await loadBridge();
  for (const mode of ["failure", "deadline", "spawn-error"]) {
    let time = 1000;
    let smokeCalls = 0;
    const result = bridge.runSetupCheck({ "print-timeout": "100ms" }, {
      now: () => time,
      run: () => {
        if (mode === "deadline") time += 100;
        return { status: mode === "failure" ? 1 : 0, stdout: "", stderr: "", error: mode === "spawn-error" ? new Error("missing") : undefined };
      },
      runPrompt: () => { smokeCalls += 1; return { success: true }; }
    });
    assert.equal(result.ready, false, mode);
    assert.equal(result.smoke.skipped, true, mode);
    assert.equal(smokeCalls, 0, mode);
  }
});


test("Flash aliases use the current catalog while explicit legacy labels stay pinned", async () => {
  const bridge = await loadBridge();
  assert.equal(bridge.normalizeModel(undefined, "review", false), "Gemini 3.8 Flash (Medium)");
  assert.equal(bridge.normalizeModel(undefined, "adversarial-review", false), "Gemini 3.8 Flash (High)");
  assert.equal(bridge.normalizeModel("flash", "review", false), "Gemini 3.8 Flash (Medium)");
  assert.equal(bridge.normalizeModel("gemini-3.8-flash-high", "review", false), "Gemini 3.8 Flash (High)");
  assert.equal(bridge.normalizeModel("gemini-3.5-flash-medium", "review", false), "Gemini 3.5 Flash (Medium)");
  assert.equal(bridge.normalizeModel("opus", "review", false), "Claude Opus 4.6 (Thinking)");
});

test("CLI dry-run validates timeout and emits the selected model", () => {
  const invoke = (...args) => spawnSync(process.execPath, [BRIDGE_SCRIPT, ...args], { encoding: "utf8", timeout: 10000 });
  const valid = invoke("review", "--dry-run", "--json", "--print-timeout", "30s");
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(valid.stdout).timeout, "30s");
  assert.equal(JSON.parse(valid.stdout).model, "Gemini 3.8 Flash (Medium)");
  const invalid = invoke("review", "--dry-run", "--print-timeout", "nonsense");
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Invalid timeout/);
  const typo = invoke("review", "--dry-run", "--print-timout", "30s");
  assert.equal(typo.status, 1);
  assert.match(typo.stderr, /Unknown option/);
});
