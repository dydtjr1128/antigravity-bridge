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
const BOOLEAN_OPTIONS = new Set(["json", "dry-run", "deep", "sandbox", "help"]);
const VALUE_OPTIONS = new Set(["cwd", "output-dir", "print-timeout", "language", "scope", "model"]);
const SETUP_OPTIONS = new Set(["cwd", "print-timeout", "model", "deep", "sandbox", "json", "help"]);
export const DEFAULT_REVIEW_SCOPE = "all current uncommitted changes in this repository, including staged, unstaged, and untracked files";
const DEFAULT_MODELS = {
  setup: "Gemini 3.8 Flash (Medium)",
  review: "Gemini 3.8 Flash (Medium)",
  "adversarial-review": "Gemini 3.8 Flash (High)",
  rescue: "Gemini 3.8 Flash (Medium)",
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

export function parseArgs(argv) {
  const options = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }
    const key = value.slice(2);
    if (BOOLEAN_OPTIONS.has(key)) {
      options[key] = true;
      continue;
    }
    if (!VALUE_OPTIONS.has(key)) {
      throw new Error(`Unknown option: --${key}`);
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

export function validateCommandOptions(command, options, positionals = []) {
  if (options.deep && options.model) throw new Error("Use either --deep or --model, not both.");
  if (command === "setup") {
    for (const key of Object.keys(options)) {
      if (!SETUP_OPTIONS.has(key)) {
        throw new Error(`Option --${key} is not valid for setup.`);
      }
    }
    if (positionals.length > 0) {
      throw new Error("Setup does not accept positional arguments.");
    }
    return;
  }
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

export function normalizeModel(model, command, deep) {
  if (!model) {
    return deep ? DEFAULT_MODELS.deep : DEFAULT_MODELS[command];
  }
  const value = compact(model);
  const aliases = new Map([
    ["gemini-3-5-flash-medium", "Gemini 3.5 Flash (Medium)"],
    ["gemini-3-5-flash-high", "Gemini 3.5 Flash (High)"],
    ["gemini-3-5-flash-low", "Gemini 3.5 Flash (Low)"],
    ["flash", DEFAULT_MODELS.review],
    ["flash-medium", DEFAULT_MODELS.review],
    ["gemini-flash", DEFAULT_MODELS.review],
    ["gemini-flash-medium", DEFAULT_MODELS.review],
    ["gemini-3-8-flash-medium", DEFAULT_MODELS.review],
    ["flash-high", "Gemini 3.8 Flash (High)"],
    ["gemini-flash-high", "Gemini 3.8 Flash (High)"],
    ["gemini-3-8-flash-high", "Gemini 3.8 Flash (High)"],
    ["flash-low", "Gemini 3.8 Flash (Low)"],
    ["gemini-flash-low", "Gemini 3.8 Flash (Low)"],
    ["gemini-3-8-flash-low", "Gemini 3.8 Flash (Low)"],
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
  const review = stdout;
  return {
    status: result.status,
    signal: result.signal,
    stdout,
    stderr,
    spawnError: spawnError || null,
    timeout: options.timeout ?? null,
    timedOut,
    conversationId: null,
    transcriptPath: null,
    success: result.status === 0 && !spawnError && !timedOut && review.length > 0,
    result: review
  };
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
  const timeoutMs = parseDuration(timeout);
  ensureDirectory(outputDir);
  const promptFile = path.join(outputDir, `${command}.prompt.md`);
  const stdoutFile = path.join(outputDir, `${command}.stdout.txt`);
  const stderrFile = path.join(outputDir, `${command}.stderr.txt`);
  const logFile = path.join(outputDir, `${command}.agy.log`);
  const mdFile = path.join(outputDir, `${command}.md`);
  const metadataFile = path.join(outputDir, `${command}.metadata.json`);
  fs.writeFileSync(promptFile, prompt, "utf8");

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
  const report = commandReport(agy, { timeout });
  fs.writeFileSync(mdFile, report.result, "utf8");
  const metadata = {
    command,
    model,
    status: report.status,
    signal: report.signal,
    spawnError: report.spawnError,
    timeout: report.timeout,
    timedOut: report.timedOut,
    success: report.success,
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

export function runSetupCheck(options = {}, dependencies = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const timeout = String(options["print-timeout"] ?? "1m0s").trim();
  const timeoutMs = parseDuration(timeout);
  const model = normalizeModel(options.model, "setup", Boolean(options.deep));
  const now = dependencies.now ?? Date.now;
  const execute = dependencies.run ?? run;
  const executePrompt = dependencies.runPrompt ?? ((parameters) => runAgyPrompt({
    ...parameters,
    outputDir: fs.mkdtempSync(path.join(os.tmpdir(), "antigravity-bridge-setup-"))
  }));
  const deadline = now() + timeoutMs;
  const version = execute("agy", ["--version"], { cwd, timeoutMs });
  const remainingMs = deadline - now();
  const versionReport = commandReport(version);
  if (version.status !== 0 || version.error || remainingMs <= 0) {
    return { ready: false, model, timeout, version: versionReport, smoke: {
      skipped: true, reason: remainingMs <= 0 ? "Setup deadline exhausted." : "Version probe failed."
    } };
  }
  const smoke = executePrompt({
    command: "setup", cwd, prompt: "Return a short acknowledgement.", model,
    timeout: `${remainingMs}ms`, sandbox: Boolean(options.sandbox)
  });
  return { ready: smoke.success && now() <= deadline, model, timeout, version: versionReport, smoke };
}

function handleSetup(options) {
  const payload = runSetupCheck(options);
  printOutput({ ...payload, result: payload.ready ? "Antigravity Bridge setup check passed." : "Antigravity Bridge setup check failed." }, Boolean(options.json));
  if (!payload.ready) process.exitCode = 1;
}

function handleAgyCommand(command, options, positionals) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const scope = options.scope ?? DEFAULT_REVIEW_SCOPE;
  const userFocus = positionals.join(" ").trim() || "No extra focus provided.";
  const language = options.language ?? "Korean unless the user requested another language";
  const model = normalizeModel(options.model, command, Boolean(options.deep));
  const timeout = String(options["print-timeout"] ?? "5m0s").trim();
  parseDuration(timeout);
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
  if (options.help) {
    usage();
    return;
  }
  validateCommandOptions(command, options, positionals);
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
