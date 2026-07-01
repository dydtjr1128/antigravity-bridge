# Antigravity Bridge

Use the Antigravity `agy` CLI from Codex for external code review, adversarial review, and rescue-style investigation.

This plugin mirrors the shape of Claude Bridge, but routes work through `agy`.

## What You Get

- `$review` for a normal read-only Antigravity review.
- `$adversarial-review` for a challenge review that pressure-tests implementation direction, assumptions, and failure modes.
- `$rescue` for investigation, debugging, fix planning, or an explicitly requested constrained fix.

## Requirements

- Antigravity CLI installed and available as `agy`.
- A working Antigravity login or keyring auth.
- Codex with local plugin support.

Check readiness with:

```powershell
agy --version
node .\scripts\antigravity-bridge.mjs setup --json
```

`agy --print` can exit 0 while printing no stdout. The helper treats the transcript final `content` as the review result and ignores transcript `thinking` fields. The setup check is successful when `agy --version` works and a non-empty final response can be extracted.

## Usage

```powershell
node .\scripts\antigravity-bridge.mjs setup
node .\scripts\antigravity-bridge.mjs review --scope "current git diff in this repository"
node .\scripts\antigravity-bridge.mjs adversarial-review --scope "current git diff in this repository"
node .\scripts\antigravity-bridge.mjs rescue --scope "the failing parser test"
```

The helper normalizes model names, stores prompts/logs/results, and keeps reviewer prompts consistent.

## Models

Known Antigravity model labels:

- `Gemini 3.5 Flash (Medium)` default for ordinary reviews.
- `Gemini 3.5 Flash (High)` for stronger routine challenge reviews.
- `Gemini 3.5 Flash (Low)` for cheap smoke checks.
- `Gemini 3.1 Pro (Low)` for moderate deeper checks.
- `Gemini 3.1 Pro (High)` for high-risk or deep reviews.
- `Claude Sonnet 4.6 (Thinking)` for cross-vendor thinking passes.
- `Claude Opus 4.6 (Thinking)` for expensive final tie-breaker reviews.
- `GPT-OSS 120B (Medium)` for an open-weight style second opinion.

Default policy:

- Use `Gemini 3.5 Flash (Medium)` for ordinary reviews and rescue planning.
- Use `Gemini 3.5 Flash (High)` for default adversarial review.
- Use `Gemini 3.1 Pro (High)` with `--deep` for high-risk or complex reviews.
- Use Claude Opus or other expensive models only when explicitly requested or when a final tie-breaker is warranted.

## Safety Rules

Antigravity Bridge treats `agy` output as advisory. Codex should verify findings locally before acting on them.

Review and adversarial-review runs are read-only. They explicitly tell Antigravity:

- do not edit files;
- do not run workflows, CI, deployment scripts, release tasks, or workflow automation unless the user explicitly and directly instructs that exact command;
- use read-only inspection and lightweight local commands only when needed to ground findings.

A general review request is not permission to run CI, deploy, release, or trigger workflow automation.

## Output Handling

The helper captures output under:

```text
.codex/antigravity-bridge/
```

For normal runs it writes:

- generated prompt;
- raw stdout and stderr;
- Antigravity CLI log file;
- markdown result extracted from transcript final `content`;
- result metadata with the conversation id and transcript path.

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
