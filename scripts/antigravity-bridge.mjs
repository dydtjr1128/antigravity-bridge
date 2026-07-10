#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const PROMPT_DIR = path.join(ROOT_DIR, "prompts");
const VALID_COMMANDS = new Set(["setup", "review", "adversarial-review", "rescue"]);
const DEFAULT_MODELS = {
  setup: "Gemini 3.5 Flash (Medium)",
  review: "Gemini 3.5 Flash (Medium)",
  "adversarial-review": "Gemini 3.5 Flash (High)",
  rescue: "Gemini 3.5 Flash (Medium)",
  deep: "Gemini 3.1 Pro (High)"
};

function usage() {
  console.log([
    "Usage:",
    "  node scripts/antigravity-bridge.mjs setup [--json]",
    "  node scripts/antigravity-bridge.mjs review [--model <model>] [--language <lang>] [--scope <text>] [focus ...]",
    "  node scripts/antigravity-bridge.mjs adversarial-review [--model <model>|--deep] [--language <lang>] [--scope <text>] [focus ...]",
    "  node scripts/antigravity-bridge.mjs rescue [--model <model>|--deep] [--language <lang>] [--scope <text>] [request ...]",
    "",
    "Options:",
    "  --cwd <path>            Run from this repository path.",
    "  --output-dir <path>     Store agy stdout, stderr, log, prompt, and markdown output here.",
    "  --print-timeout <time>  Timeout for agy print and the process-level hard timeout. Default: 5m0s.",
    "  --sandbox               Pass agy --sandbox.",
    "  --dry-run               Print the generated prompt without calling agy.",
    "  --json                  Print machine-readable wrapper output.",
    "  --deep                  Prefer Gemini 3.1 Pro (High) only when explicitly requested."
  ].join("\n"));
}

function parseArgs(argv) {
  const options = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }
    const key = value.slice(2);
    if (["json", "dry-run", "deep", "sandbox"].includes(key)) {
      options[key] = true;
      continue;
    }
    const next = argv[index + 1];
    if (next == null || next.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    options[key] = next;
    index += 1;
  }
  return { options, positionals };
}

export function parseDuration(value) {
  const input = String(value ?? "").trim();
  const match = /^(?:(\d+)m)?(?:(\d+)s)?(?:(\d+)ms)?$/.exec(input);
  if (!match) {
    throw new Error(`Invalid timeout duration: ${value}`);
  }

  const totalMs =
    Number(match[1] ?? 0) * 60_000 +
    Number(match[2] ?? 0) * 1_000 +
    Number(match[3] ?? 0);
  if (totalMs <= 0 || !Number.isSafeInteger(totalMs)) {
    throw new Error(`Invalid timeout duration: ${value}`);
  }

  return totalMs;
}

function compact(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function normalizeModel(model, command, deep) {
  if (!model) {
    return deep ? DEFAULT_MODELS.deep : DEFAULT_MODELS[command];
  }
  const value = compact(model);
  const aliases = new Map([
    ["flash", DEFAULT_MODELS.review],
    ["flash-medium", DEFAULT_MODELS.review],
    ["gemini-flash", DEFAULT_MODELS.review],
    ["gemini-flash-medium", DEFAULT_MODELS.review],
    ["gemini-3-5-flash-medium", DEFAULT_MODELS.review],
    ["flash-high", "Gemini 3.5 Flash (High)"],
    ["gemini-flash-high", "Gemini 3.5 Flash (High)"],
    ["gemini-3-5-flash-high", "Gemini 3.5 Flash (High)"],
    ["flash-low", "Gemini 3.5 Flash (Low)"],
    ["gemini-flash-low", "Gemini 3.5 Flash (Low)"],
    ["gemini-3-5-flash-low", "Gemini 3.5 Flash (Low)"],
    ["pro", "Gemini 3.1 Pro (High)"],
    ["pro-high", "Gemini 3.1 Pro (High)"],
    ["gemini-pro", "Gemini 3.1 Pro (High)"],
    ["gemini-pro-high", "Gemini 3.1 Pro (High)"],
    ["gemini-3-1-pro-high", "Gemini 3.1 Pro (High)"],
    ["pro-low", "Gemini 3.1 Pro (Low)"],
    ["gemini-pro-low", "Gemini 3.1 Pro (Low)"],
    ["gemini-3-1-pro-low", "Gemini 3.1 Pro (Low)"],
    ["sonnet", "Claude Sonnet 4.6 (Thinking)"],
    ["sonnet-thinking", "Claude Sonnet 4.6 (Thinking)"],
    ["claude-sonnet", "Claude Sonnet 4.6 (Thinking)"],
    ["claude-sonnet-thinking", "Claude Sonnet 4.6 (Thinking)"],
    ["sonnet-4-6", "Claude Sonnet 4.6 (Thinking)"],
    ["claude-sonnet-4-6", "Claude Sonnet 4.6 (Thinking)"],
    ["opus", "Claude Opus 4.6 (Thinking)"],
    ["opus-thinking", "Claude Opus 4.6 (Thinking)"],
    ["claude-opus", "Claude Opus 4.6 (Thinking)"],
    ["claude-opus-thinking", "Claude Opus 4.6 (Thinking)"],
    ["opus-4-6", "Claude Opus 4.6 (Thinking)"],
    ["claude-opus-4-6", "Claude Opus 4.6 (Thinking)"],
    ["gpt-oss", "GPT-OSS 120B (Medium)"],
    ["gpt-oss-120b", "GPT-OSS 120B (Medium)"],
    ["gpt-oss-120b-medium", "GPT-OSS 120B (Medium)"]
  ]);
  return aliases.get(value) ?? model;
}

function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join("");
}

function ensureDirectory(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function loadPrompt(command) {
  const file = path.join(PROMPT_DIR, `${command}.md`);
  return fs.readFileSync(file, "utf8");
}

function renderPrompt(template, values) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => values[key] ?? "");
}

export function run(command, args, options = {}) {
  const spawn = options.spawn ?? spawnSync;
  return spawn(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: process.env,
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
    timeout: options.timeoutMs
  });
}

function outputText(value) {
  return typeof value === "string" ? value : "";
}

export function commandReport(result, options = {}) {
  const stdout = outputText(result.stdout).trim();
  const stderr = outputText(result.stderr).trim();
  const spawnError = result.error instanceof Error ? result.error.message : "";
  const timedOut = result.error?.code === "ETIMEDOUT";
  const providerFailed = result.status !== 0 || Boolean(spawnError);
  let transcript = { conversationId: null, transcriptPath: null, result: "" };

  if (!stdout && !providerFailed && !timedOut && options.transcriptLookup) {
    transcript = options.transcriptLookup();
  }

  const review = stdout || outputText(transcript.result).trim();
  return {
    status: result.status,
    signal: result.signal,
    stdout,
    stderr,
    spawnError: spawnError || null,
    timeout: options.timeout ?? null,
    timedOut,
    conversationId: transcript.conversationId ?? null,
    transcriptPath: transcript.transcriptPath ?? null,
    success: result.status === 0 && !spawnError && !timedOut && review.length > 0,
    result: review
  };
}

function antigravityDataDir() {
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
  return path.join(home, ".gemini", "antigravity-cli");
}

function listBrainIds(dataDir) {
  const brainDir = path.join(dataDir, "brain");
  if (!fs.existsSync(brainDir)) {
    return [];
  }
  return fs.readdirSync(brainDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const fullPath = path.join(brainDir, entry.name);
      return { id: entry.name, mtimeMs: fs.statSync(fullPath).mtimeMs };
    });
}

function readLastConversationForCwd(dataDir, cwd) {
  const file = path.join(dataDir, "cache", "last_conversations.json");
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const normalizedCwd = path.resolve(cwd).toLowerCase();
    let best = null;
    for (const [key, value] of Object.entries(parsed)) {
      const normalizedKey = path.resolve(key).toLowerCase();
      if (normalizedCwd === normalizedKey) {
        return typeof value === "string" ? value : null;
      }
      if (normalizedCwd.startsWith(`${normalizedKey}${path.sep}`)) {
        if (!best || normalizedKey.length > best.length) {
          best = { length: normalizedKey.length, value };
        }
      }
    }
    return best && typeof best.value === "string" ? best.value : null;
  } catch {
    return null;
  }
}

function transcriptPath(dataDir, conversationId) {
  return path.join(dataDir, "brain", conversationId, ".system_generated", "logs", "transcript.jsonl");
}

function extractFinalContent(file) {
  if (!file || !fs.existsSync(file)) {
    return "";
  }
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  let result = "";
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    try {
      const event = JSON.parse(line);
      if (event.source === "MODEL" && event.status === "DONE" && typeof event.content === "string" && event.content.trim()) {
        result = event.content;
      }
    } catch {
      continue;
    }
  }
  return result;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function findConversationResult(dataDir, cwd, beforeIds, startMs, deadlineMs, options = {}) {
  const now = options.now ?? Date.now;
  const listBrainIdsForLookup = options.listBrainIds ?? listBrainIds;
  const sleepForLookup = options.sleep ?? sleep;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (now() >= deadlineMs) {
      break;
    }
    const after = listBrainIdsForLookup(dataDir);
    const newItems = after.filter((item) => !beforeIds.has(item.id)).sort((a, b) => b.mtimeMs - a.mtimeMs);
    const candidates = [
      ...newItems.map((item) => item.id),
      readLastConversationForCwd(dataDir, cwd),
      ...after.filter((item) => item.mtimeMs >= startMs - 1000).sort((a, b) => b.mtimeMs - a.mtimeMs).map((item) => item.id)
    ].filter(Boolean);
    for (const id of candidates) {
      const file = transcriptPath(dataDir, id);
      const result = extractFinalContent(file);
      if (result.trim()) {
        return { conversationId: id, transcriptPath: file, result };
      }
    }
    const remainingMs = deadlineMs - now();
    if (remainingMs <= 0) {
      break;
    }
    sleepForLookup(Math.min(250, remainingMs));
  }
  return { conversationId: null, transcriptPath: null, result: "" };
}

function printOutput(payload, asJson) {
  if (asJson) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  if (payload.result) {
    process.stdout.write(payload.result.endsWith("\n") ? payload.result : `${payload.result}\n`);
  }
  if (payload.outputDir) {
    process.stdout.write(`\nAntigravity Bridge output: ${payload.outputDir}\n`);
  }
}

function runAgyPrompt({ command, cwd, prompt, model, outputDir, timeout, sandbox }) {
  ensureDirectory(outputDir);
  const promptFile = path.join(outputDir, `${command}.prompt.md`);
  const stdoutFile = path.join(outputDir, `${command}.stdout.txt`);
  const stderrFile = path.join(outputDir, `${command}.stderr.txt`);
  const logFile = path.join(outputDir, `${command}.agy.log`);
  const mdFile = path.join(outputDir, `${command}.md`);
  const metadataFile = path.join(outputDir, `${command}.metadata.json`);
  fs.writeFileSync(promptFile, prompt, "utf8");

  const dataDir = antigravityDataDir();
  const beforeIds = new Set(listBrainIds(dataDir).map((item) => item.id));
  const startMs = Date.now();
  const timeoutMs = parseDuration(timeout);
  const args = ["--log-file", logFile, "--model", model, "--print-timeout", timeout];
  if (sandbox) {
    args.push("--sandbox");
  }
  args.push("--print", prompt);
  const agy = run("agy", args, { cwd, timeoutMs });
  const stdout = outputText(agy.stdout);
  const stderr = outputText(agy.stderr);
  fs.writeFileSync(stdoutFile, stdout, "utf8");
  fs.writeFileSync(stderrFile, stderr, "utf8");
  const report = commandReport(agy, {
    timeout,
    transcriptLookup: () => findConversationResult(dataDir, cwd, beforeIds, startMs, startMs + timeoutMs)
  });
  fs.writeFileSync(mdFile, report.result, "utf8");
  const metadata = {
    command,
    model,
    status: report.status,
    signal: report.signal,
    spawnError: report.spawnError,
    timeout: report.timeout,
    timedOut: report.timedOut,
    conversationId: report.conversationId,
    transcriptPath: report.transcriptPath,
    stdoutFile,
    stderrFile,
    logFile,
    promptFile,
    markdownFile: mdFile
  };
  fs.writeFileSync(metadataFile, JSON.stringify(metadata, null, 2), "utf8");
  return {
    ...metadata,
    metadataFile,
    outputDir,
    success: report.success,
    result: report.result
  };
}

function handleSetup(options) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const timeout = options["print-timeout"] ?? "1m0s";
  const model = normalizeModel(options.model, "setup", Boolean(options.deep));
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "antigravity-bridge-setup-"));
  const version = run("agy", ["--version"], { cwd });
  const smoke = runAgyPrompt({
    command: "setup",
    cwd,
    prompt: "Return a short acknowledgement.",
    model,
    outputDir,
    timeout,
    sandbox: Boolean(options.sandbox)
  });
  const ready = version.status === 0 && smoke.success;
  printOutput({
    ready,
    model,
    version: {
      status: version.status,
      stdout: outputText(version.stdout).trim(),
      stderr: outputText(version.stderr).trim()
    },
    smoke,
    result: ready ? "Antigravity Bridge setup check passed." : "Antigravity Bridge setup check failed."
  }, Boolean(options.json));
  if (!ready) {
    process.exitCode = 1;
  }
}

function handleAgyCommand(command, options, positionals) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const scope = options.scope ?? "current git diff in this repository";
  const userFocus = positionals.join(" ").trim() || "No extra focus provided.";
  const language = options.language ?? "Korean unless the user requested another language";
  const model = normalizeModel(options.model, command, Boolean(options.deep));
  const timeout = options["print-timeout"] ?? "5m0s";
  const outputDir = path.resolve(
    cwd,
    options["output-dir"] ?? path.join(".codex", "antigravity-bridge", `run-${timestamp()}`)
  );
  const prompt = renderPrompt(loadPrompt(command), {
    SCOPE: scope,
    USER_FOCUS: userFocus,
    LANGUAGE: language
  });

  if (options["dry-run"]) {
    printOutput({
      command,
      model,
      timeout,
      timedOut: false,
      prompt,
      result: prompt
    }, Boolean(options.json));
    return;
  }

  const payload = runAgyPrompt({
    command,
    cwd,
    prompt,
    model,
    outputDir,
    timeout,
    sandbox: Boolean(options.sandbox)
  });
  printOutput({ command, ...payload }, Boolean(options.json));
  if (!payload.success) {
    process.exitCode = payload.status || 1;
  }
}

function main() {
  const [command, ...argv] = process.argv.slice(2);
  if (!command || command === "--help" || command === "help") {
    usage();
    return;
  }
  if (!VALID_COMMANDS.has(command)) {
    throw new Error(`Unknown command: ${command}`);
  }
  const { options, positionals } = parseArgs(argv);
  if (command === "setup") {
    handleSetup(options);
    return;
  }
  handleAgyCommand(command, options, positionals);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
