---
head_sha: 39e9aad9d973cd4cc45fb53d88c2bd2b8e9b6950
focus: default
implementation_run_id: manual-2026-10-12-script-quality
---

# Findings

## Local State

Approved idea `idea-4d4c2c52c1d7` is being implemented for `/Users/mini/e3d-creative`. Idea was authored directly (not via an autonomous discover/ideate pass) based on a real, grounded gap: Cast's live `transcript/improve`/`prompt-to-podcast` endpoints (spacepacket/server/pod2vidRoutes.js) are single-pass Claude calls with no critique or revision loop, while e3d-creative already has a generate -> critique -> revise discipline (lib/critique.js) scoped only to ad creative.

## External Context

Cast's live transcript/improve and prompt-to-podcast endpoints (spacepacket/server/pod2vidRoutes.js) are both single-pass Claude calls today: one system prompt, one completion, no critique, no revision, no quality gate. Extend e3d-creative's existing generate -> critique (keep/revise/reject + reasoning) -> revise loop with a new, non-ad critique rubric focused on what actually makes a script better: hook strength, persuasion/psychology, wording and copywriting craft, and audience fit -- not production/video polish, which is secondary. The loop must preserve Cast's strict 'Label: text' speaker-line format through every revision round, and must serve both of Cast's real inputs: improving an existing user-supplied script/transcript, and writing a new script from a one-sentence topic.
