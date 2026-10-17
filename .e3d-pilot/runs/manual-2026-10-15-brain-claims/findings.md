---
head_sha: f68182b9e9f3e9afbcf01c5724fdef2d099fe866
focus: default
implementation_run_id: manual-2026-10-15-brain-claims
---

# Findings

## Local State

Approved idea `idea-c57ae33da447` is being implemented for `/Users/mini/e3d-creative`. The idea was authored directly (not by an autonomous discover/ideate pass) after a recorded two-model design debate (`docs/debates/2026-10-15-brain-claims-in-creative/transcript.md`) and a recorded review of the draft spec (`docs/debates/2026-10-15-brain-claims-spec-review/transcript.md`). The spec (`docs/e3d-creative-brain-claims-spec.md`) was read and approved by the user before the build, then negotiated by Claude and Codex (`negotiation-log.md`, converged) and annotated with pilot:touches / runner:model metadata only.

## External Context

e3d-creative generates ad directions and nothing stops a generated direction from overclaiming about a product. e3d-brain (a local-first Markdown memory over MCP, advisory-only) can hold a small set of human-approved, expiring product claims. The debate verdict: pull only approved, unexpired claims from a claims-only read-only vault, use them first as a checker (not in generation), fail open with a visible status, and give recalled claims no authority. This run builds that checker.
