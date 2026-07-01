---
name: adversarial-review
description: Use when Codex should ask the Antigravity agy CLI for an adversarial challenge review that pressure-tests implementation direction, design choices, assumptions, tradeoffs, and failure modes. Trigger on requests such as ask Antigravity for adversarial review, challenge this design with agy, pressure-test with Antigravity, or get a hostile/critical Antigravity pass.
---

# Antigravity Adversarial Review

Use `agy` for a review-only challenge pass. This is not a normal defect sweep; it should question whether the approach should ship.

## Preflight

```powershell
Get-Command agy -ErrorAction SilentlyContinue
agy --version
node .\scripts\antigravity-bridge.mjs setup --json
```

## Model Selection

- Use `Gemini 3.5 Flash (High)` for routine adversarial review.
- Use `Gemini 3.1 Pro (High)` with `--deep` for high-risk review: security boundaries, data loss, migrations, concurrency, rollback/idempotency, distributed state, or when cheaper reviewers disagree.
- Use `Claude Opus 4.6 (Thinking)` sparingly because it is expensive. Prefer it only when the user explicitly asks for Opus or a final cross-vendor tie-breaker.
- Use `GPT-OSS 120B (Medium)` when the user wants an open-weight style second opinion.

## Adversarial Prompt

```text
You are an adversarial software reviewer.
Scope: <same exact scope the user gave>
Do not edit files.
Do not run workflows, CI pipelines, deployment scripts, release tasks, or workflow automation unless the user explicitly and directly instructs you to run that exact command. An adversarial review request is not permission to run them.
Use read-only inspection and lightweight local commands only when needed to ground findings.

Try to find the strongest reasons this should not ship yet.
Prioritize data loss, corruption, migrations, schema drift, concurrency, rollback, idempotency, trust boundaries, stale state, and missing tests.
Report only material findings grounded in files, line numbers, or command output.
Return in Korean unless the user requested another language.
Start with Findings ordered by severity. If no actionable finding, say so clearly.
Then give a short structural verdict: solid parts, fragile parts, and top 3 improvements.
```

## Preferred Helper

```powershell
node .\scripts\antigravity-bridge.mjs adversarial-review --scope "current git diff in this repository"
```

Use `--deep` or `--model "Gemini 3.1 Pro (High)"` only when the scope is high-risk or the user explicitly wants a deeper pass.

The helper stores prompt, stdout, stderr, Antigravity log, metadata, and markdown result under `.codex/antigravity-bridge/`.

Verify every claim locally before acting on it. Preserve inference and uncertainty labels. Do not let Antigravity edit files during this review. After presenting findings, stop and ask the user which issues, if any, they want fixed before touching files.
