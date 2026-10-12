---
selected: script-quality-critique-loop
reason: approved idea implementation
focus: default
---

# Candidates

## Proposed Candidates

### Candidate script-quality-critique-loop: Script-quality critique/revision loop for Cast's AI script features
Duplicate: no
Dedup rationale: No existing e3d-creative capability evaluates or revises a script against a non-ad quality bar (hook/psychology/wording/audience) -- the only critique loop that exists today is scoped to brief.spendCeiling/metric/threshold, which has no meaning for a podcast or greeting script.
Category: product-strategy
Analogy: Directly reuses the generate -> critique -> revise discipline e3d-creative already runs for ad creative (lib/critique.js's keep/revise/reject verdict loop with structured reasoning and multi-provider fallback), generalized to a second real consumer with a different quality rubric -- the same relationship commission-creative's brief has to a specific use case, applied to Cast's script features instead of a Meta ad.
Attraction (1-5): 4
Retention (1-5): 3
Effort: medium
Revenue (1-5|n/a): n/a
Description: Cast's live transcript/improve and prompt-to-podcast endpoints (spacepacket/server/pod2vidRoutes.js) are both single-pass Claude calls today: one system prompt, one completion, no critique, no revision, no quality gate. Extend e3d-creative's existing generate -> critique (keep/revise/reject + reasoning) -> revise loop with a new, non-ad critique rubric focused on what actually makes a script better: hook strength, persuasion/psychology, wording and copywriting craft, and audience fit -- not production/video polish, which is secondary. The loop must preserve Cast's strict "Label: text" speaker-line format through every revision round, and must serve both of Cast's real inputs: improving an existing user-supplied script/transcript, and writing a new script from a one-sentence topic. Repos involved: e3d-creative (new critique-loop capability) and e3d/spacepacket (server/pod2vidRoutes.js, where the actual endpoints live and would be wired to call it).
