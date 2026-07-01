---
name: review
description: Use when Codex should ask the Antigravity agy CLI for an independent ordinary read-only code review, second-pass review, or sanity check. Trigger on requests such as ask Antigravity to review, run agy review, get an Antigravity pass, use Antigravity Bridge review, or compare Antigravity findings against Codex findings.
---

# Antigravity Review

Use the local `agy` executable as an external reviewer. Treat Antigravity output as advisory and verify findings against the repository before editing or reporting them as true.

## Preflight

Check the CLI and run a real print-mode smoke test through the helper:

```powershell
Get-Command agy -ErrorAction SilentlyContinue
agy --version
node .\scripts\antigravity-bridge.mjs setup --json
```

`agy models` can return no visible output even when the CLI is usable. Use the helper setup check as the readiness gate because it verifies `agy --version` and extracts a non-empty final response from Antigravity transcript logs.

## Model Selection

- Use `Gemini 3.5 Flash (Medium)` by default for ordinary reviews, smoke checks, and broad multi-review coverage.
- Use `Gemini 3.5 Flash (High)` for stronger routine challenge reviews.
- Use `Gemini 3.1 Pro (High)` with `--deep` for high-risk security, data loss, migrations, concurrency, rollback, idempotency, or complex architecture.
- Use `Claude Opus 4.6 (Thinking)` or other expensive models only when the user explicitly asks or when a final tie-breaker is warranted.

## Review Prompt

Use this shape and preserve the user's scope:

```text
You are an independent code reviewer.
Scope: <exact diff, branch, files, or user-provided scope>
Do not edit files.
Do not run workflows, CI, deployment scripts, release tasks, or workflow automation unless the user explicitly and directly instructs you to run that exact command. A review request is not permission to run them.
Use read-only inspection and lightweight local commands only when needed to ground findings.
Prioritize correctness bugs, behavioral regressions, security risks, and missing tests.
Return findings first, ordered by severity, with file/line references.
If there are no actionable findings, say that clearly and mention residual test gaps.
```

## Preferred Helper

Prefer the bundled helper over hand-rolled `agy` calls:

```powershell
node .\scripts\antigravity-bridge.mjs review --scope "current git diff in this repository"
```

Useful options:

- `--model "Gemini 3.5 Flash (Medium)"` for the default ordinary review model.
- `--deep` to prefer `Gemini 3.1 Pro (High)` for high-risk review.
- `--scope "<scope>"` to preserve the user's exact target.
- `--dry-run` to inspect the generated prompt without calling `agy`.

The helper stores prompt, stdout, stderr, Antigravity log, metadata, and markdown result under `.codex/antigravity-bridge/`.

## Result Handling

Preserve Antigravity's findings, evidence boundaries, uncertainty notes, and file/line references. Verify claims locally before acting on them. Discard unsupported findings even when they sound plausible. Do not count a failed Antigravity run as a completed review. After presenting review findings, stop and ask the user which issues, if any, they want fixed before touching files.
