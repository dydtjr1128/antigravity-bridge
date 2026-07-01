---
name: rescue
description: Use when Codex should ask the Antigravity agy CLI for a rescue-style investigation, second opinion, debugging pass, or explicitly requested follow-up fix. Trigger on requests such as ask Antigravity to rescue this, have agy investigate, use Antigravity to debug, ask Antigravity for a fix plan, or let Antigravity try a constrained fix.
---

# Antigravity Rescue

Use `agy` for investigation or follow-up rescue work from Codex. Unlike `review` and `adversarial-review`, this skill can support implementation only when the user explicitly asks for a fix or patch. Otherwise keep Antigravity in investigation and plan mode.

## Preflight

```powershell
Get-Command agy -ErrorAction SilentlyContinue
agy --version
node .\scripts\antigravity-bridge.mjs setup --json
```

## Mode Selection

- Use `Gemini 3.5 Flash (Medium)` by default for investigation, debugging, log interpretation, and fix planning.
- Use `Gemini 3.1 Pro (High)` with `--deep` for difficult failures, deep architectural diagnosis, security-sensitive issues, or repeated failed attempts.
- Use Claude or GPT-OSS models only when the user explicitly requests that model family or you need a diverse final tie-breaker.
- Do not ask Antigravity to run workflows, CI, deployment scripts, release tasks, or workflow automation unless the user explicitly and directly instructs you to run that exact command. A rescue request is not permission to run them.
- If the user only asks for rescue/investigation, ask Antigravity for findings and a plan, not edits.
- If the user explicitly asks Antigravity to fix, constrain the scope and verify the resulting patch yourself before reporting completion.

## Investigation Prompt

```text
You are a rescue engineer giving Codex an external second opinion.
Scope: <exact user request and relevant files, logs, or diff>
Do not edit files unless the user explicitly requested a fix.
Do not run workflows, CI, deployment scripts, release tasks, or workflow automation unless the user explicitly and directly instructs you to run that exact command. A rescue request is not permission to run them.
Use read-only inspection and lightweight local commands when needed.
Return actionable findings, likely root cause, and the smallest safe next step.
If proposing a fix, include files and line references.
```

## Preferred Helper

```powershell
node .\scripts\antigravity-bridge.mjs rescue --scope "<user request and relevant context>"
```

Use `--deep` or `--model "Gemini 3.1 Pro (High)"` only for difficult failures, security-sensitive issues, or repeated failed attempts.

Treat Antigravity output as advisory. Preserve observed facts, inferences, open questions, and next steps. Verify code claims, command claims, and proposed fixes locally. If Antigravity was not successfully invoked, report the failure and do not invent a substitute rescue answer.
