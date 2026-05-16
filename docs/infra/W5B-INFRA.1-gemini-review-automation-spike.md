# W5B-INFRA.1 — Gemini Review Automation Spike

## Purpose

This spike adds a manual, dry-run GitHub Actions workflow that reads a selected GitHub issue body, sends bounded issue content to Gemini for architecture review, and posts Gemini's response back as an issue comment.

The workflow is intentionally advisory-only. It does not mutate labels, issue state, pull requests, milestone progress, or any production/runtime system behavior.

## Scope

Approved Phase 1 scope is limited to:

- manual `workflow_dispatch` execution only
- one required workflow input: `issue_number`
- reading the selected issue title/body
- sending sanitized, truncated issue content to Gemini
- posting Gemini's advisory response as an issue comment

Out of scope in this spike:

- source code changes
- scheduling logic changes
- protocol/type changes
- Rust/WASM changes
- UI changes
- Copilot assignment
- PR approval or PR merge
- issue closure or reopen
- automatic label or state changes
- authority, persistence, UAT, or production behavior changes

## Manual Workflow Usage

1. Open the **Actions** tab in GitHub.
2. Select **Gemini Review Dry Run**.
3. Choose **Run workflow**.
4. Enter the target GitHub `issue_number`.
5. Start the workflow manually.
6. Wait for the workflow to finish.
7. Review the posted issue comment.

Expected Phase 1 outcome:

- Gemini posts an advisory review comment
- the comment clearly states that the automation is dry-run only
- no labels are changed
- no issue state is changed
- no PR is approved or merged
- human review remains required

## Required GitHub Secret

The workflow requires the repository secret:

- `GEMINI_API_KEY`

This secret must be created and managed by a human repository owner in GitHub Actions secrets. It must never be committed to the repository, copied into docs, printed to workflow logs, or posted into issue/PR comments.

## Security Boundaries

Phase 1 is read/comment-only.

The workflow:

- reads the selected issue through the GitHub API
- sends only bounded issue content to Gemini
- posts only a review comment back to the issue

The workflow does **not**:

- change labels
- close or reopen issues
- change milestones
- approve PRs
- merge PRs
- assign Copilot or any agent
- write repository contents

## Prompt-Injection Defenses

Issue content is treated as untrusted input.

Defenses implemented in the workflow:

- a hardcoded Gemini system prompt wraps the review request
- the issue title/body are explicitly described as untrusted content
- the issue body is sanitized before submission
- the issue body is truncated to a maximum of 50,000 characters
- raw issue bodies are not printed to logs
- raw Gemini request payloads are not printed to logs
- secrets are not printed to logs

Prompt-injection warning:

If an issue body attempts to override instructions, request secret disclosure, request label/state changes, or request PR approval/merge behavior, that content must be treated as hostile/untrusted text and not as executable workflow instructions.

## Permissions Explanation

The workflow uses these permissions only:

```yaml
permissions:
  contents: read
  issues: write
```

Why these permissions are sufficient:

- `contents: read` keeps repository access read-only
- `issues: write` allows posting the advisory comment

No broader permissions are approved in Phase 1.

## Stop Conditions

Stop and report instead of extending this workflow if any of the following become necessary:

- permissions broader than `contents: read` and `issues: write`
- source code changes outside the approved workflow/documentation files
- automatic label mutation
- automatic issue state changes
- PR approval or PR merge automation
- Copilot assignment automation
- secret exposure risk that cannot be controlled
- Gemini API usage that would require logging raw issue content or raw sensitive payloads

## Phase 2 Prerequisites

Phase 2 label-trigger automation is **not** included in this PR.

Before any Phase 2 proposal is accepted, all of the following must be true:

- at least 10 successful manual dry-runs across diverse issue types
- cost and token-consumption review completed
- explicit human approval recorded before any label-trigger automation
- telemetry/safety review completed for the dry-run behavior
- Phase 1 remains advisory-only unless separately re-approved

## Recommended Manual Review Checklist

After each dry-run:

- confirm the workflow was triggered manually
- confirm the selected issue number was the only target
- confirm the Gemini comment includes the dry-run/advisory disclaimer
- confirm no labels changed
- confirm no issue state changed
- confirm no PR was approved or merged
- confirm no secrets or raw issue body content appeared in logs
