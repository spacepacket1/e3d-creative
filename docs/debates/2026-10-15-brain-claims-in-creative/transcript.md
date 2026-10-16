# Debate

**Question:** We want to wire e3d-brain into e3d-creative. Decide the design, concretely.

CONTEXT
- e3d-creative is an offline-first CLI that turns a JSON brief (product, audience, objective, baselineRef, constraints, spendCeiling, metric, threshold) into creative directions, critiques them, and expands kept directions into shot-level guidance. It sends prompts to Claude/OpenAI. It does not render, publish, or spend. QA scores are heuristic.
- e3d-brain is a local-first memory server over a folder of Markdown notes (an Obsidian vault) exposing MCP tools (search, read_note, ...). Its invariant: memory is advisory, never authority. Retrieved text is fenced and labelled untrusted reference data. Notes have ids, revisions and citations (note:<id>@<rev>). Modes: inbox (humans), journal (agents), read-only. It runs as a separate local process per consumer. Text sent to a cloud model leaves the machine.
- The brain integrations are planned, not live. The one existing precedent is a small flagged hook in e3d-pilot's ideate prompt (off unless env vars are set, fails open, capped at 3000 chars, labelled advisory).
- Problem we want to solve: ad directions must not overclaim. A brief's constraints are free text written by hand today.

DECIDE
1. What exactly should e3d-creative pull from the brain: any search hits, or only notes explicitly marked as approved product claims? How is "approved claim" represented (folder, tag, status, a dedicated claims note) and who may curate it?
2. Where in the pipeline does it enter (the brief, the concept prompt, the critique/QA step as a checker of claims in the output), and in what form (citations required?).
3. Data boundary: what must never be sent to a cloud model, and how is that enforced (read-only brain instance, allowlist folder, size cap)?
4. Failure behaviour and authority: if the brain is down or returns nothing, what happens? Confirm recalled claims can never approve, publish, or spend.
5. How do we measure that it helps, cheaply, in the first week (a concrete before/after test)?
6. Minimal first implementation: the smallest change in e3d-creative that is worth merging, and what to leave out.

Answer with a concrete recommendation per numbered item, name the biggest risk, and say what you would NOT build yet.

**Jev pre-screen (shadow mode, informational only):** obviousness noul=0.13 (1.0 = clearly obvious, 0.0 = clearly needs debate) -- logged for calibration, does not affect whether this debate runs.

## Round 1 -- claude

**Recommendation: pull only approved claims, never raw search hits. Use them as a checker in critique/QA first.**

**1. What to pull.** Only notes with `status: approved-claim` in frontmatter, inside a dedicated `claims/<product>/` folder. Each note holds one claim with its allowed wording, a forbidden-wording list (e.g. "never say 'guaranteed'"), and evidence links. Lookup is by exact product key from the brief, not semantic search. Only humans curate these, through the inbox mode and a review step. Agents may propose claims in journal mode, but those never count as approved. Raw search hits are untrusted and unbounded, so they are out.

**2. Where it enters.** The first step is the critique/QA checker. It checks the output: every factual or performance claim in a direction must match an approved claim, or be flagged "unsupported". The second step, after the checker works, is injecting the approved claims and forbidden wording into the concept prompt as a fenced, labelled, advisory block. The brief stays hand-written, but gains an optional `claimsRef` (product key). Citations are required: each claim in the output carries `note:<id>@<rev>`. A claim with a missing or unknown citation is flagged.

**3. Data boundary.** Never send inbox or journal notes, anything outside `claims/`, or any note with `visibility: internal`. That covers pricing, margins, customer names, and unreleased plans. Enforcement has three parts. The brain runs read-only and is scoped to the `claims/` allowlist folder. The client drops any note lacking `status: approved-claim` and `visibility: public`. A total cap of about 3000 characters applies, matching the pilot precedent. Approved claims are marketing copy by definition, so sending them to the cloud is acceptable.

**4. Failure and authority.** The integration is flagged off by default and fails open. If the brain is down or returns nothing, the run continues, and the report states "claims unchecked" loudly rather than silently passing. Recalled claims are advisory input only. They can never approve a direction, publish, or spend. Spend stays governed by `spendCeiling` and humans.

**5. Week-one test.** Take 10 existing briefs and run them with and without the claims block. Plant 5 known-bad claims, such as "clinically proven" or "#1 rated". Measure the unsupported-claim rate with a human reading the output, not the heuristic QA score. Success means the flag rate drops, or the checker catches at least 4 of the 5 planted claims.

**6. Minimal first implementation.** Add a flagged `--claims-ref` option. It fetches the approved claims, then adds a checker pass that emits a claim-to-citation table in the QA output. Leave out semantic search, auto-curation, writing to the brain, and any cross-product recall.

**Biggest risk.** A stale or wrong approved claim gets treated as truth. Mitigate with revision pinning and a `reviewedAt` expiry.

**Not building yet.** Auto-extraction of claims, learning from performance data, and brain-driven constraints that override the brief.

## Round 1 -- codex

Load-bearing assumption: “approved” means cleared for use in cloud-assisted creative development, not merely factually plausible.

1. Pull only approved product claims—never general search hits. Use one atomic Markdown note per claim under `approved-claims/`, with frontmatter: `product`, `status: approved`, `claim`, `approved_by`, `approved_at`, `expires_at`, and optional evidence reference. Only designated product/legal humans may approve or revoke; agents may propose claims into `inbox`, never promote them.

2. Retrieve claims after brief validation into a separate `claimContext`, not into the user-authored brief. Inject it into concept generation and critique. Every factual product assertion in a direction must cite `note:<id>@<rev>` internally. Critique must flag assertions that lack a matching approved citation as “unsupported”; citations are provenance metadata, not ad copy.

3. Run a dedicated read-only brain process pointed at a claims-only vault/export. Allow only `approved-claims/`, exclude expired or non-approved notes, and cap retrieved text at 3,000 characters. Never send arbitrary vault search results, inbox/journal content, raw evidence, customer data, PII, credentials, or confidential strategy to cloud models. Enforce this structurally through the isolated vault—not prompt instructions or client-side filtering alone.

4. Fail open operationally but visibly: if brain is unavailable or empty, continue existing generation, mark `claimGrounding: unavailable|empty`, and make no claim-support assurances. Recalled claims are advisory evidence only. They can never approve creative, publish, render, alter budgets, or spend; human review remains required.

5. First-week test: select 20 representative historical briefs. Generate paired outputs with identical model/settings, with and without approved-claim grounding. Blind-reviewers count factual claims, unsupported/overstated claims, and usable directions. Success criterion: at least 50% fewer unsupported claims without more than a 10% reduction in usable directions. Track retrieval failures and stale citations separately.

6. Minimal merge: an off-by-default flag that queries the isolated brain for the brief’s product, accepts only approved/unexpired notes, caps and fences the context, adds it to generation and critique prompts, requires citation metadata, and records grounding status. Preserve current behavior on every failure.

Biggest risk: stale or loosely approved claims creating false confidence.

Do not yet build automatic claim approval, arbitrary semantic vault search, write-back, evidence ingestion, a policy engine, UI, publishing, or spending integrations.

## Round 2 -- claude

Both other answers agree with my core position, so I'm keeping it. Both pull only approved claims, never raw search hits. Both enter at critique/QA, run read-only and size-capped, fail open and say so, and give recalled text no authority. The differences are small, and I'll concede some of them.

**Where I concede to codex:**
- **Isolation.** A dedicated read-only brain process pointed at a claims-only vault or export is stronger than my allowlist folder plus client-side filtering. If the data boundary is structural, a bug in the filter can't leak anything. I now prefer it.
- **Expiry.** Codex's `expires_at` and `approved_by`/`approved_at` fields are more concrete than my `reviewedAt`. I'll use them. The client rejects expired notes, and a stale citation is reported separately.
- **Grounding status.** A report field with `claimGrounding: unavailable|empty|ok` makes the "claims unchecked" state machine-readable.
- **Week-one test.** A 20-brief paired test with blind review and a usable-directions guard is better than my 10 briefs. My planted-claims check is worth keeping as a cheap recall test for the checker.

**Where I hold my position:**
- **Concept-prompt injection.** Codex injects claims into concept generation and critique at once. I'd ship the checker first, because it is the smallest change and the one that tests whether claims help. Injecting into generation can make directions parrot claims. It also moves approved text into every cloud prompt before we know the checker works. This is a sequencing difference, not a conflict. Codex's minimal merge could be cut to checker-only without changing anything else.
- **Lookup.** I use an exact product key. Codex's "query for the product" could drift into search. I'd state it plainly: a keyed fetch, not semantic search.
- **Citations.** Codex says citations are internal metadata and not ad copy. I agree and add that they live in the QA report, not the creative output.
- **Visibility.** `visibility: public` is an extra gate. With an isolated claims vault it is redundant, so it's optional.

**Biggest risk:** a stale or loosely approved claim is treated as proof. Expiry, revision pinning, and the "advisory, human review required" labelling are the mitigations.

**Not building yet:** auto-extraction or approval, semantic search, write-back, performance-driven learning, a policy engine, UI, and anything that touches publishing or spend.

An implementer following either answer would build the same thing: a flagged, keyed fetch of approved and unexpired claims from an isolated read-only brain. It would be fenced, capped at 3000 characters, fail open with a visible status, and used for a citation-checking QA pass. The only open point is whether injection into generation ships in the first merge, and that is a small sequencing choice.

POSITION: Ship a flagged, keyed fetch of approved, unexpired claims from an isolated read-only claims vault, capped at 3000 characters and fenced as advisory. Use it first as a citation-checking QA pass, fail open with a visible grounding status, and give it no authority over approval, publishing, or spend.
status: approved

## Round 2 -- codex

My prior position mostly holds, but Claude is right that allowed and forbidden wording should be explicit claim fields rather than inferred from a generic `claim` string.

1. Pull only atomic, human-approved claims—not arbitrary search hits. Store one claim per note in a dedicated claims-only vault/export with `product`, `status`, `allowed_wording`, `forbidden_wording`, approver, approval/expiry dates, and evidence references. Product/legal humans alone approve or revoke; agents may only propose into inbox.

2. After brief validation, retrieve by stable product key into separate `claimContext`; never mutate the authored brief. Inject approved wording into generation and use it again during critique. Require internal `note:<id>@<rev>` provenance for factual assertions, while keeping citations out of consumer-facing copy. Unsupported assertions must be flagged, not automatically deleted or approved.

3. Enforce the boundary structurally: a dedicated read-only brain process over a claims-only export, plus approved/unexpired filtering and a 3,000-character cap. Never expose the main vault, inbox/journal, evidence documents, PII, customer data, credentials, pricing, margins, or strategy. Client-side filtering alone is insufficient.

4. Fail open but visibly: preserve existing generation and report `claimGrounding: unavailable|empty`. Never imply that outputs were checked when retrieval failed. Memory cannot approve, render, publish, modify budgets, or spend.

5. Run 20 paired historical briefs with identical settings and blind human review. Count unsupported/overstated claims and usable directions; target at least 50% fewer unsupported claims with no more than a 10% usability reduction. Seed known-bad claims as a secondary sensitivity check.

6. Merge one off-by-default retrieval adapter, fenced context in generation and critique, citation metadata, and grounding status. Claude’s critique-only first implementation would detect problems but misses the cheap opportunity to prevent them during generation.

The biggest risk is stale approval creating false confidence. Do not build semantic vault search, automated approval, write-back, evidence ingestion, policy engines, UI, publishing, or spending integrations yet.

POSITION: Use only human-approved, unexpired claims from an isolated read-only claims vault in both generation and critique, with citation provenance, visible fail-open behavior, and no downstream authority.
status: revise


## Synthesis (claude)

FINAL ANSWER: Pull only human-approved, unexpired product claims, never raw search hits. Store them as one atomic note per claim in a claims-only, read-only brain vault. Fetch them by exact product key, fence them as advisory, and cap them at 3000 characters. Use them first as a citation-checking QA pass that flags unsupported claims with `note:<id>@<rev>` provenance. Citations stay in the QA report, not in the ad copy. Inject the claims into the concept prompt only after the checker proves useful. If the brain is down or empty, fail open and report `claimGrounding: unavailable|empty`. Recalled claims can never approve, publish, or spend. Test it on 20 paired historical briefs with blind human review, plus planted bad claims as a recall check for the checker. The biggest risk is a stale or loosely approved claim being treated as proof, so use expiry dates and revision pinning. Do not build semantic search, auto-approval, write-back, a policy engine, or UI yet.
CONSENSUS: majority
DISSENT: Codex wants claims injected into generation in the first merge. Claude wants a checker-only first merge, with injection added later.
