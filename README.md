# Antigravity Bridge

Use the Antigravity `agy` CLI from Codex for external code review, adversarial review, and rescue-style investigation.

This plugin is for Codex users who want a convenient way to ask the local Antigravity CLI for an independent pass without leaving the repository they are already working in.

## What You Get

- `$review` for a normal read-only Antigravity review.
- `$adversarial-review` for a challenge review that pressure-tests the implementation approach, design choices, assumptions, and failure modes.
- `$rescue` for Antigravity-assisted investigation, debugging, fix planning, or an explicitly requested constrained fix.

## Requirements

- Antigravity CLI installed and available as `agy`.
- A working Antigravity login or keyring auth.
- Codex with local plugin support.

When the user explicitly requests executable validation, check readiness with:

```powershell
agy --version
node .\scripts\antigravity-bridge.mjs setup --json
```

`setup` is an explicit diagnostic command, not an automatic review preflight. `agy --print` can exit 0 while printing no stdout. The helper accepts only non-empty stdout from the current invocation. Empty stdout is a failed result even with exit code 0; global transcripts are never used because they cannot be reliably attributed to this run.

## Install

Clone the plugin into your personal Codex plugin folder:

```powershell
mkdir $HOME\plugins -Force
git clone https://github.com/dydtjr1128/antigravity-bridge.git $HOME\plugins\antigravity-bridge
```

Add it to your personal Codex marketplace at `~/.agents/plugins/marketplace.json`. If you already have a personal marketplace file, add this object to its `plugins` array:

```json
{
  "name": "antigravity-bridge",
  "source": {
    "source": "local",
    "path": "./plugins/antigravity-bridge"
  },
  "policy": {
    "installation": "AVAILABLE",
    "authentication": "ON_INSTALL"
  },
  "category": "Productivity"
}
```

If you do not have a personal marketplace file yet, create one:

```json
{
  "name": "personal",
  "interface": {
    "displayName": "Personal"
  },
  "plugins": [
    {
      "name": "antigravity-bridge",
      "source": {
        "source": "local",
        "path": "./plugins/antigravity-bridge"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Productivity"
    }
  ]
}
```

Install the plugin:

```powershell
codex plugin add antigravity-bridge@personal
```

Then start a new Codex thread so the plugin skills are loaded.

If you explicitly want to validate the executable after installation, run the setup check:

```powershell
node $HOME\plugins\antigravity-bridge\scripts\antigravity-bridge.mjs setup
```

The setup check verifies that the local Antigravity CLI is installed and able to return a non-empty final response. Ordinary review requests do not imply permission to run this diagnostic.

After installation, Codex should expose these skills:

```text
$review
$adversarial-review
$rescue
```

One simple first run is:

```text
Use $review to ask Antigravity to review my local changes.
```

## Usage

Antigravity Bridge includes a small companion script inspired by the helper-runtime pattern in `openai/codex-plugin-cc`.

```powershell
node .\scripts\antigravity-bridge.mjs setup
node .\scripts\antigravity-bridge.mjs review --scope "all current uncommitted changes, including staged, unstaged, and untracked files"
node .\scripts\antigravity-bridge.mjs adversarial-review --scope "all current uncommitted changes, including staged, unstaged, and untracked files"
node .\scripts\antigravity-bridge.mjs rescue --scope "the failing parser test"
```

The helper normalizes model names, stores prompts/logs/results, and keeps reviewer prompts consistent.

Use `--print-timeout <duration>` to set both the timeout passed to `agy --print-timeout` and the process-level hard timeout. The default for review-oriented commands is `5m0s`. A timed-out run fails without a retry, preserves any partial stdout, and records `timeout` and `timedOut` in its metadata.

Setup uses one one-minute deadline across version and smoke probes; `--print-timeout` overrides it. A failed version probe or exhausted budget skips smoke. Unknown options, unsupported setup options, and conflicting `--deep` / `--model` are rejected before execution.

## Model Selection

Antigravity Bridge normalizes common shorthand before calling `agy`:

- `flash`, `flash-medium`, or `gemini-3-8-flash-medium` -> `Gemini 3.8 Flash (Medium)`
- `flash-high` or `gemini-3-8-flash-high` -> `Gemini 3.8 Flash (High)`
- `pro`, `pro-high`, or `gemini-3-1-pro-high` -> `Gemini 3.1 Pro (High)`
- `sonnet`, `sonnet-4-6`, or `claude-sonnet-4-6` -> `Claude Sonnet 4.6 (Thinking)`
- `opus`, `opus-4-6`, or `claude-opus-4-6` -> `Claude Opus 4.6 (Thinking)`
- `gpt-oss` or `gpt-oss-120b` -> `GPT-OSS 120B (Medium)`

Known Antigravity model labels include:

- `Gemini 3.8 Flash (Medium)` default for ordinary reviews.
- `Gemini 3.8 Flash (High)` for stronger routine challenge reviews.
- `Gemini 3.8 Flash (Low)` for cheap smoke checks.
- `Gemini 3.1 Pro (Low)` for moderate deeper checks.
- `Gemini 3.1 Pro (High)` for high-risk or deep reviews.
- `Claude Sonnet 4.6 (Thinking)` for cross-vendor thinking passes.
- `Claude Opus 4.6 (Thinking)` for expensive final tie-breaker reviews.
- `GPT-OSS 120B (Medium)` for an open-weight style second opinion.

Default policy:

- Use `Gemini 3.8 Flash (Medium)` for ordinary reviews and rescue planning.
- Use `Gemini 3.8 Flash (High)` for default adversarial review.
- Use `Gemini 3.1 Pro (High)` with `--deep` only with explicit user intent for a deeper pass.
- Use Claude Opus or any additional provider only with explicit user intent.

When the user explicitly requests model executable validation, smoke-test a label with:

```powershell
node .\scripts\antigravity-bridge.mjs setup --model "Gemini 3.8 Flash (Medium)" --json
```

The Flash defaults match the `agy models` catalog observed on 2026-09-23. Explicit `gemini-3-5-flash-*` aliases retain their previous labels; availability depends on the provider. Claude labels remain at the versions listed by Antigravity and are independent of Claude Bridge model IDs.

## Safety Rules

Antigravity Bridge treats `agy` output as advisory. Codex should verify findings locally before acting on them.

Review and adversarial-review runs are read-only. All three modes enforce this contract:

Do not execute project code or validation commands unless the user explicitly and directly requests that execution. This includes tests, builds, package managers, scripts, servers, applications, CI, deployment, release, and workflow automation. A review or investigation request alone is not permission to execute them.
Read-only repository inspection commands required to obtain the requested scope are allowed, including `git diff`, `git status`, `git show`, `git log`, `git blame`, and `git ls-files`. Shell commands must not be used for any other purpose or modify files, the index, refs, configuration, or other repository state.
Complete one bounded pass within five minutes.
Do not retry, add reviewers, expand the scope, or switch to a deeper model automatically.
If the available time or evidence is insufficient, return the supported findings and state the remaining gap.

Use static file and line inspection only by default. `--deep`, retries, executable validation, fixes, and additional providers all require explicit user intent.

## Output Handling

The helper captures output under:

```text
.codex/antigravity-bridge/
```

For normal runs it writes:

- generated prompt;
- raw stdout and stderr;
- Antigravity CLI log file;
- markdown result from the current invocation stdout;
- result metadata with success and timeout outcomes; legacy conversation and transcript fields remain null.

## Repository Layout

```text
.codex-plugin/
  plugin.json
skills/
  review/
  adversarial-review/
  rescue/
prompts/
  review.md
  adversarial-review.md
  rescue.md
scripts/
  antigravity-bridge.mjs
```

## License

Licensed under the Apache License, Version 2.0. See `LICENSE` for the full terms.
