---
run_id: manual-2026-10-15-brain-claims
---

# Negotiation Log

## Round 1

### Draft Before Round

```text
# Feature Ticket: e3d-creative — Approved-Claims Grounding from e3d-brain

## Overview

Add an optional, off-by-default way for `e3d-creative` to check generated ad directions against a small set of **human-approved product claims** kept in an `e3d-brain` vault, so a direction cannot quietly overclaim. The first build is a **claim checker**: a QA-style pass that reads the claims, compares a finished direction against them, and reports `supported`, `unsupported`, and `forbidden` statements with `note:<id>@<rev>` citations.

This ticket comes from a recorded two-model design debate (Claude and Codex, two rounds, idea `idea-c57ae33da447`, transcript `docs/debates/2026-10-15-brain-claims-in-creative/transcript.md`). Its verdict is the contract: pull only human-approved, unexpired claims, never raw search hits; use them first as a checker; fail open with a visible status; recalled claims never approve, publish, or spend. Codex wanted the claims injected into generation in the first merge too; Claude wanted checker-only first. This ticket follows checker-first. Injection into generation is a later ticket.

This revision merges the findings of a second recorded debate that reviewed the first draft of this spec (`docs/debates/2026-10-15-brain-claims-spec-review/transcript.md`, full consensus: fix first).

e3d-brain's invariant applies: **memory is advisory, never authority.** Nothing here may let a recalled note approve, render, publish, change a budget, or spend.

**Known limits, stated up front and repeated in every report:** a model-based check can miss assertions (it is a heuristic, not a proof), and checking that a "supported" assertion quotes an approved claim shows the model cited a real claim, not that the claim logically covers the assertion. A human decides.

## Goals

- A **claims reader** that fetches approved, unexpired claims for one product from a claims-only, read-only e3d-brain instance, with revision-pinned citations, per-claim digests, strict size and field limits, and a visible status.
- A **claim checker** that takes one finished direction plus the claims and writes a grounding report: each factual product assertion is `supported` (with a verified quote from a claim), `unsupported`, or `forbidden` (matches a claim's forbidden wording).
- **Fail open, visibly.** If the brain is not configured, down, unsafe, or returns nothing, the engine behaves exactly as today and the report says so. It never implies the output was checked when it was not.
- A **deterministic forbidden-wording check** (normalized string matching, no model) so the most important failures do not depend on a model's judgement.
- Tests with a stub brain and a stub model, including planted false assertions the checker must catch.
- An **evaluation script** that generates directions once, then measures the checker on the same artifacts: recall on planted unsupported assertions, false flags on unmodified directions, and a blind-review sheet for a human.

## Non-Goals

- No injection of claims into concept generation or critique prompts (a later ticket, decided after the checker has been evaluated).
- No semantic or free-text search. Claims are fetched by exact product key only. The reader never calls `search`, `related`, `read_ref_chunk`, or `report_use`.
- No write access to the brain from e3d-creative.
- No claim approval workflow, policy engine, or UI. A human approves a claim by creating the note in the claims vault with e3d-brain's own tools.
- No rendering, publishing, spend, or e3d-corp integration.
- No new runtime dependencies. The MCP client is a small vendored stdio client.

## Running This Spec

Run with s2c's default provider and auto-routing:

```bash
s2c docs/e3d-creative-brain-claims-spec.md all --auto-route
```

Each phase has a `runner:verify` hook. Build on a branch; a different model reviews each phase diff; a human merges.

## Existing Files (read first)

- `docs/e3d-creative-engine-spec.md` — shared constraints (UTC timestamps, atomic JSON writes, SHA-256 digests, no secrets in prompts, the claims guardrails) apply here unchanged.
- `lib/qa.js` — the independent QA pass this checker resembles: provider selection via `lib/providers/selection.js`, `writeJsonAtomic`, `sha256Hex`, `stableJson`, strict parsing of model output (`parseQaPayload`). QA artifacts record `generatedProvider`.
- `lib/providers/selection.js`, `lib/providers/index.js` — how a provider is chosen per phase and called with `generate`.
- `lib/cli.js` — command parsing; new commands are added here. `lib/run.js` — the end-to-end `run`.
- `test/` and `test/fixtures/` — test style (`node --test`, fixtures, stub providers).
- The direction shape (README "Direction Schema"): `directionId`, `hook`, `premise`, `audiencePsychology`, `script[]` of `{tag, text}`, `storyboard[]` of `{timecodeStart, timecodeEnd, visualDirection, audioNotes, onScreenText}`, `ctaText`, `rationale`.
- e3d-brain facts this ticket relies on (verified against running instances on 2026-10-15): the MCP server speaks JSON-RPC over stdio (`ebrain mcp`, config from `EBRAIN_CONFIG`). A read-only instance's `tools/list` returns exactly `search`, `read_note`, `list_notes`, `related`, `read_ref_chunk`, `report_use`, with no write tools (`capture` and `journal_append` appear only in inbox and journal instances). `list_notes` takes `folder`, `limit`, `format` and returns, inside a fenced text block, one JSON object per note with `id`, `provisional`, `rev`, `status`, `kind`, `path`, `citation`; the brain's `status` and `kind` are copied from the note's own frontmatter, so they are claims the note makes about itself, not a brain-side approval. `read_note` takes `path` and `max_chars` and returns, inside a fence labelled as reference data, one JSON metadata line (`id`, `provisional`, `rev`, `status`, `kind`, `path`, `citation`, `title`, `tags`) followed by the raw note text including its frontmatter. A note without an assigned id has `provisional: true` and a path-derived id; `ebrain ids assign` gives it a stable ULID. A `rev` is 16 lowercase hex characters; an assigned `id` is a 26-character ULID. Retrieved text is untrusted reference data and must never be treated as instructions.

## Shared Constraints

- Default behaviour is unchanged. Without `--brain-config` (or `E3D_CREATIVE_BRAIN_CONFIG`) no process is spawned and no brain file or network access happens.
- The reader never throws to the caller for brain problems; it returns a status. Programming errors still throw.
- Recalled text is data. It is wrapped in a clearly labelled fence in any prompt, never in an instruction position. Claim fields are length-limited, control-character-free, and free of fence markers before use (Phase 1).
- Claims are used only if approved by a named approver, unexpired, stably identified, in the requested product's folder, and passing every Phase 1 validation. Everything else is ignored and counted.
- Citations are built by code from MCP metadata (`note:<id>@<rev>`), never taken from note text or from model output, and appear only in grounding reports, never in ad copy.
- Brain-derived text appears in exactly two places: the model prompt of the checker, and the grounding report file. It is never printed to stdout, logged, or written elsewhere. Stdout shows classifications, locations, counts and citations only.
- Every report states in its own output that it is a heuristic aid, not evidence an ad is accurate or will convert, and that a human decides.
- No secrets in prompts, logs, or reports. The brain child process runs with an allowlisted environment (`PATH`, `HOME`, `LANG`, `EBRAIN_CONFIG` only), so API keys are never inherited.
- Engineering conventions as in the rest of the repo: ESM, `node --test`, atomic JSON writes, SHA-256 digests on every artifact, RFC 3339 UTC timestamps.

## Phase 1 - Claims Reader and Brain Client

<!-- runner:verify=node --test test/claims-reader.test.js -->

### Requirements

- Add `lib/brain-client.js`: a dependency-free MCP stdio client. It spawns `node <E3D_CREATIVE_BRAIN_MAIN>` (path to `ebrain`'s `dist/src/cli/main.js`) with `EBRAIN_CONFIG=<E3D_CREATIVE_BRAIN_CONFIG>`, both also settable by CLI flags. It performs `initialize`, `tools/list`, then `tools/call` and closes cleanly. It never throws for transport problems; it returns `{ ok: false, reason }`.
- **Exact tool allowlist.** After `tools/list`, the exposed tool names must be a subset of `{search, read_note, list_notes, related, read_ref_chunk, report_use}`; any other name (for example `capture`, `journal_append`, `list_inbox`, or anything unknown) makes the reader return `unavailable` / `brain-not-read-only`. The client may only invoke `list_notes` and `read_note`; calling any other tool is a programming error that throws, and a unit test asserts `report_use` and `search` are never invoked.
- **Resource limits** (named constants, tested): at most 50 notes read per product (`list_notes` limit 50; extra matches only increment `counts.notesNotRead`); `read_note` `max_chars` 4000; any single JSON-RPC frame over 256 KB aborts the call; stderr of the child is captured up to 4 KB and never logged with payloads; each call times out at 10 s and the whole fetch at 30 s. On timeout or abort the child is sent SIGTERM, then SIGKILL after 1 s, and reaped; no zombie process remains.
- Add `lib/claims.js` exporting `fetchApprovedClaims({ product, now, brainOptions })`.
  - **Product key.** Canonicalize with NFKC, lowercase, replace each run of characters outside `a-z0-9` with a single `-`, trim leading and trailing `-`. An empty result returns `unavailable` / `invalid-product`. The folder is `claims/<slug>/`.
  - **Path scoping.** Each returned path must match exactly `claims/<slug>/<name>.md` (a direct child, no deeper folders, no `..`, no absolute path). Anything else is rejected with reason `out-of-folder`, even if the brain returned it.
  - **Identity.** MCP metadata is authoritative. `id` must match the ULID pattern, `provisional` must be `false`, `rev` must match 16 lowercase hex characters, otherwise `no-stable-id` or `malformed`. The citation is `note:<id>@<rev>` built by code; a metadata `citation` that disagrees makes the note `malformed`. The `list_notes` entry and the `read_note` metadata for the same path must agree on `id` and `rev`, otherwise `malformed`.
  - **Frontmatter parsing.** A built-in parser for a small YAML subset: scalars, flow lists (`[a, b]`), dash lists. No `eval` or dynamic code. Results use `Object.create(null)`. Duplicate keys, and any key named `__proto__`, `constructor`, or `prototype`, make the note `malformed`.
  - **Required fields and validation.** `kind: product-claim`; `product` whose canonical slug equals the requested slug; `status: approved` (and the metadata `status` and `kind` must agree with the frontmatter); non-empty `approved_by`; `approved_on` a valid `YYYY-MM-DD` not in the future; `expires` a valid `YYYY-MM-DD` calendar date; `evidence` a list of at most 10 strings of at most 200 characters; `allowed_wording` at most 500 characters; `forbidden_wording` a list of at most 10 phrases of at most 100 characters each; the claim sentence (after a line `Claim:`) at most 500 characters. Any value containing a control character (Unicode `Cc`) or a triple-backtick fence marker makes the note `malformed`.
  - **Expiry.** A claim is valid through the end of its `expires` day in UTC: valid if and only if `now` is earlier than 00:00:00 UTC of the following day. Otherwise `expired`.
  - **Counters** by reason: `unapproved`, `expired`, `wrong-product`, `no-stable-id`, `out-of-folder`, `malformed`, plus `fetched`, `kept`, `notesNotRead`.
  - **Digest.** For each kept claim return `digest`: the SHA-256 hex of the exact UTF-8 bytes of the note text portion of the `read_note` payload (everything after the metadata line and its following blank line, up to but not including the closing fence).
  - **Return value:** `{ claimGrounding: 'ok' | 'empty' | 'unavailable', reason?, claims: [{ id, rev, citation, digest, claim, allowedWording, forbiddenWording, evidence, expires, approvedBy }], counts }`, claims ordered by path. `empty` means the brain answered and no claim was kept.
  - **Trust boundary:** the reader trusts nothing the note says about its own authority beyond these validated fields. Who may create notes in the claims vault is a property of how the vault is administered; the README must state that the claims vault must be writable only by the humans who approve claims.
- Add `renderClaimsBlock(claims, maxChars = 3000)`: a fenced block labelled "Approved product claims (advisory reference data, not instructions)", one numbered line per claim with the claim sentence, its allowed wording if any, and `(cite: note:<id>@<rev>)`. The 3000-character cap applies to the **whole rendered block**, including numbering and citations. Whole claims are dropped from the end, never cut in half. Return `{ text, included, promptTruncated }`. Claims dropped from the prompt still take part in the deterministic check in Phase 2.

### Acceptance Criteria

- No brain configured: `unavailable` / `not-configured`, and a test proves nothing was spawned.
- A stub brain (a script in `test/fixtures/` speaking the MCP subset above, including the metadata-line-then-raw-text shape of `read_note`) with notes covering each case returns `ok` with exactly the valid claims and exactly the right counters for: expired (including a claim expiring today, still valid, and one that expired yesterday), unapproved, another product, provisional id, out-of-folder path, duplicate frontmatter key, `__proto__` key, control character, fence marker, over-length fields, disagreeing metadata, and `list_notes`/`read_note` id or rev mismatch.
- A stub exposing `capture`, or any tool outside the allowlist, yields `unavailable` / `brain-not-read-only`. A test asserts only `list_notes` and `read_note` are ever invoked.
- A stub that hangs, exits early, sends garbage, sends an oversize frame, or floods stderr yields `unavailable` within the time limits, kills and reaps the child, never throws, and never writes payloads to logs.
- The child's environment contains none of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or other inherited variables outside the allowlist (test inspects what the stub receives).
- Output is deterministic across runs; digests are reproducible; the block cap applies to the whole rendered block.

## Phase 2 - Claim Checker

<!-- runner:verify=node --test test/claims-check.test.js -->

### Requirements

- Add `lib/claims-check.js` exporting `checkClaims({ direction, claimsResult, provider })` and a command `e3d-creative claims-check <direction.json> --brief <brief.json> --out <dir> [--check-provider <name>] [--brain-config <path>] [--brain-main <path>] [--fail-on-unsupported]`. The product comes from the brief (`product`).
- **Two status fields.** `claimGrounding` is retrieval (`ok | empty | unavailable`, from Phase 1). `checkStatus` is the check outcome: `not-run` (no `ok` grounding, so nothing was compared), `passed` (checked, zero `unsupported` and zero `forbidden` findings), `findings` (at least one such finding), `failed` (the model call or its output was invalid; reason recorded). A `failed` or `not-run` check never reads as a pass.
- **Exit codes.** Default: 0 on any completed run (usage error 2, I/O error 1). With `--fail-on-unsupported`: 0 only when `checkStatus` is `passed`; 3 for `findings`; 4 for `failed`; 5 for `not-run`.
- **Stage 1, deterministic forbidden-wording check** (no model). For every kept claim, every phrase in `forbiddenWording` is searched in all direction text fields: `hook`, `premise`, `script[i].text`, `storyboard[j].onScreenText`, `.audioNotes`, `.visualDirection`, `ctaText`. Both phrase and text are normalized the same way: NFKC, case-fold, each run of non-alphanumeric characters becomes one space, trimmed, matched as whole-word substrings. Each hit is a `forbidden` finding with the claim's citation, the location, and `needsHumanJudgement: true` (negation and context are not understood; a human decides). Stage 1 runs on all kept claims, including those left out of the prompt by the 3000-character cap.
- **Locations** use one format: `hook`, `premise`, `script:<i>`, `shot:<j>:onScreenText`, `shot:<j>:audioNotes`, `shot:<j>:visualDirection`, `cta`, with 1-based indexes.
- **Stage 2, model check**, only when `claimGrounding` is `ok`. Send the direction text and the claims block to the check provider and require JSON: `{ "assertions": [ { "quote": <verbatim text from the direction>, "location": <location>, "classification": "supported" | "unsupported" | "not-a-claim", "claim": <claim number or null>, "claimQuote": <verbatim text from that claim or null> } ] }`. Code then verifies: `quote` is a substring (after whitespace normalization) of the text at `location`; for `supported`, `claim` names an included claim and `claimQuote` is a substring of that claim's `claim` or `allowedWording` text. A `supported` assertion that fails the `claimQuote` check is downgraded to `unsupported` with `supportRejected: true`. Any schema violation, unknown claim number, or quote not found in the direction makes `checkStatus` `failed` with the reason (`model-output-invalid`, `quote-not-found`). Code attaches the citation from the claim number; the model's own citation text is ignored.
- **Merging findings.** Finding types are `forbidden`, `unsupported`, `supported`. Deduplicate by (type, location, normalized quote). Where the same text span has both a `forbidden` and a model `unsupported` finding, keep only `forbidden`.
- **Provider.** `--check-provider` if given, else the repo's default critique provider (via `lib/providers/selection.js`). Record `checkedBy: { provider, model }` and `sameProviderAsGeneration`: true or false from the direction file's `generatedProvider` when present, otherwise `null`.
- **Report file** `<out>/<directionId>.claims-check.json`, where `directionId` is read from the direction and must match `^[A-Za-z0-9._-]{1,80}$` (otherwise the command fails with a clear error). It contains `claimGrounding`, `groundingReason`, `checkStatus`, `checkReason`, the Phase 1 counters, `promptTruncated`, the findings (type, location, quote, `claimNumber`, citation or null, `supportRejected`, `needsHumanJudgement`), `checkedBy`, `sameProviderAsGeneration`, the SHA-256 of the direction file checked, the digest and citation of every claim revision used, an RFC 3339 `checkedAt`, and the disclaimer including the two known limits from the Overview. Atomic write; the report's own SHA-256 is recorded alongside it.
- **Stdout** shows only: the two statuses, counts by finding type, and one line per finding with type, location and citation. No brain text and no matched phrases.
- The check never edits or deletes a direction and never changes a QA score.

### Acceptance Criteria

- Planted assertions: a direction whose script says "used by 10,000 teams" and "enterprise-grade security audit", with approved claims that do not cover them, yields `unsupported` findings for both (stub model); and yields `forbidden` findings, with the model stub disabled, when the claims list those phrases as forbidden wording, including variants with different capitalization, punctuation, and fullwidth characters.
- A direction whose statements all match approved claims yields no `unsupported`, `checkStatus: passed`, and cites the right `note:<id>@<rev>` built from metadata.
- Wrong-support case: the model marks an assertion `supported` and quotes a claim, but the quote is not in that claim: the finding is downgraded to `unsupported` with `supportRejected: true`. A model quote that is not in the direction yields `checkStatus: failed`.
- Invalid JSON, an unknown claim number, or a provider error yields `checkStatus: failed` with a reason, and the exit codes above hold with and without `--fail-on-unsupported`.
- Brain unavailable or empty: `claimGrounding` says so, `checkStatus: not-run`, the report says "NOT CHECKED: no approved claims were available.", exit 0 by default and 5 with `--fail-on-unsupported`.
- Two directions with the same `directionId` do not silently overwrite each other (second write is rejected); a changed direction file changes the recorded digest.
- Stdout contains none of the claim text, matched phrases, or quotes (test greps for planted marker strings).
- Claim text from the brain appears only in the model prompt and the report file.

## Phase 3 - Integration, Evaluation Script, and Documentation

<!-- runner:verify=node --test -->

### Requirements

- Add an opt-in `--claims-check` flag to `e3d-creative run` that, after QA, runs the checker on each QA'd direction and writes reports to `<out>/claims/<directionId>.claims-check.json`. Without the flag, `run` makes no brain process spawn, no extra model calls, creates no extra artifacts, and has the same exit behaviour as before. (Timestamps and model output vary between runs, so the test compares artifact lists and content under fixed-clock stub providers.)
- Add `scripts/eval-claims.js`. Experiment design: the checker does not change generation, so **generate once, then evaluate the same artifacts.** Given a directory of briefs and a claims vault configuration, it (1) runs the normal engine once per brief; (2) runs the checker over each resulting direction; (3) builds **planted variants**: for each direction, a copy with one sentence from `test/fixtures/planted-claims.json` appended to the script, chosen deterministically from a fixed seed, with the planted sentence's location and text recorded in a key file; (4) runs the checker on those variants too. It reports **recall** (planted unsupported assertions flagged out of planted) and **false flags** (findings per unmodified direction), and writes `eval-sheet.csv` for blind human review (columns: `row_id`, `direction_text`, `human_overstated_yes_no`, `notes`; rows shuffled with a fixed seed; the condition and the checker's findings are only in a separate `eval-key.json`). Before any model call it prints how many calls it will make and to which providers, and waits for confirmation unless `--yes` is given. It makes no calls beyond the engine's own and the checker's.
- Add `test/fixtures/planted-claims.json`: at least 10 sentences that overstate or invent product capabilities, each tagged with the claim it should trip.
- Update `README.md` with a "Grounding claims from e3d-brain" section: the claim note format with a worked example for the product `e3d-brain` and three example claims; how to create a claims-only, read-only brain instance and run `ebrain ids assign`; that the claims vault must be writable only by the humans who approve claims; the two statuses and the exit codes; fail-open behaviour; the data boundary (never point it at a general vault); the known limits from the Overview; and that it is advisory and a human decides.
- Update `docs/e3d-creative-engine-spec.md`'s "After This Ticket" list: claim injection into generation; automatic re-check when a claim is revised or expires; the eval-driven decision on injection.

### Acceptance Criteria

- `node --test` passes, with every previous test unchanged.
- An end-to-end test with the flag absent asserts: identical artifact set to the pre-change baseline, zero spawns of the brain stub, zero extra provider calls.
- With the flag, a stub brain and a stub provider, `run` writes one report per QA'd direction at the stated path.
- `scripts/eval-claims.js` runs end to end against stubs: one generation per brief, planted variants, a shuffled sheet and a key file with the condition hidden from the sheet, and a summary printing recall and false flags.
- The README's example claim notes pass the Phase 1 validation (a test loads them).

## After This Ticket (not in scope here)

- Inject approved claims into the concept and critique prompts, once the checker has been evaluated on 20 paired historical briefs by blind human review.
- Re-check a direction automatically when a claim it relied on is revised or expires.
- A tool to draft claim notes from existing brain notes, for a human to approve.
- Wire the same reader into e3d-corp's creative Opportunity step.

```

### Reviewer 1: claude

Status: approved

Reason: The spec is complete, internally consistent, testable and safely scoped (checker-first, fail-open, read-only allowlist, bounded resources), so no changes are needed.

Raw Response:

```text
---STATUS---
status: approved
reason: The spec is complete, internally consistent, testable and safely scoped (checker-first, fail-open, read-only allowlist, bounded resources), so no changes are needed.
```

### Reviewer 2: codex

Status: revise

Reason: The draft requires an exact notesNotRead count even though list_notes is capped at 50 and exposes neither pagination nor a total, and it contradicts itself about persisting brain text in reports.

Replacement Spec:

```spec
# Feature Ticket: e3d-creative — Approved-Claims Grounding from e3d-brain

## Overview

Add an optional, off-by-default way for `e3d-creative` to check generated ad directions against human-approved product claims stored in a dedicated `e3d-brain` vault. The first build is checker-only: it reads claims, compares a finished direction against them, and reports `supported`, `unsupported`, and `forbidden` statements with revision-pinned `note:<id>@<rev>` citations.

This ticket implements the verdict from debate `idea-c57ae33da447` and the subsequent spec review:

- Fetch only human-approved, unexpired claims, never raw search results.
- Use claims as a post-generation checker, not as generation input.
- Fail open with an explicit status.
- Never let recalled data approve, render, publish, change a budget, or spend.
- Treat memory as advisory, never authority.

Known limits must appear in every report:

- A model-based check is heuristic and can miss assertions.
- Verifying that a supported assertion quotes an approved claim proves only that the model cited real claim text, not that the claim logically supports the assertion.
- A human decides.

## Goals

- A claims reader that fetches approved, unexpired claims for one exact product key from a claims-only, read-only e3d-brain instance.
- Revision-pinned citations, per-claim digests, strict field and resource limits, and visible retrieval status.
- A checker that classifies factual product assertions as `supported`, `unsupported`, or `forbidden`.
- Deterministic forbidden-wording checks that do not depend on a model.
- Visible fail-open behavior when the brain is absent, unavailable, unsafe, or empty.
- Tests using stub brain and model processes, including planted false assertions.
- An evaluation script that generates once and evaluates the same artifacts, reporting planted-assertion recall, false flags, and a blind-review sheet.

## Non-Goals

- No claims in generation or critique prompts.
- No semantic or free-text search.
- No calls to `search`, `related`, `read_ref_chunk`, or `report_use`.
- No brain writes.
- No claim-approval workflow, policy engine, or UI.
- No rendering, publishing, spending, or e3d-corp integration.
- No new runtime dependencies. The MCP stdio client is vendored and dependency-free.

## Running This Spec

```bash
s2c docs/e3d-creative-brain-claims-spec.md all --auto-route
```

Each phase has a `runner:verify` hook. Work occurs on a branch, a different model reviews each phase diff, and a human merges.

## Existing Files

Read these first:

- `docs/e3d-creative-engine-spec.md`
- `lib/qa.js`
- `lib/providers/selection.js`
- `lib/providers/index.js`
- `lib/cli.js`
- `lib/run.js`
- `test/`
- `test/fixtures/`
- README section “Direction Schema”

Existing engine constraints continue to apply: ESM, UTC timestamps, atomic JSON writes, stable JSON where applicable, SHA-256 digests, strict provider-output parsing, and no secrets in prompts or artifacts.

Direction text fields used by this ticket are:

- `hook`
- `premise`
- `script[].text`
- `storyboard[].onScreenText`
- `storyboard[].audioNotes`
- `storyboard[].visualDirection`
- `ctaText`

Verified e3d-brain interface facts:

- The server is launched as `ebrain mcp`, using `EBRAIN_CONFIG`.
- MCP uses JSON-RPC over stdio.
- A read-only instance exposes `search`, `read_note`, `list_notes`, `related`, `read_ref_chunk`, and `report_use`.
- `list_notes` accepts `folder`, `limit`, and `format`.
- Its fenced response contains one JSON object per returned note with `id`, `provisional`, `rev`, `status`, `kind`, `path`, and `citation`.
- `read_note` accepts `path` and `max_chars`.
- Its fenced reference-data response contains one JSON metadata line, one blank line, then raw note text including frontmatter.
- Metadata `status` and `kind` originate in note frontmatter and are not independent brain-side approval.
- Unassigned notes have provisional path-derived IDs.
- `ebrain ids assign` assigns stable ULIDs.
- A revision is 16 lowercase hexadecimal characters.
- Retrieved text is untrusted data and must never be treated as instructions.

## Shared Constraints

- Default behavior is unchanged.
- Without `--brain-config` or `E3D_CREATIVE_BRAIN_CONFIG`, no brain process is spawned and no brain file or network access occurs.
- Brain transport, protocol, timeout, and validation failures become visible retrieval statuses rather than exceptions to callers. Programming errors still throw.
- Recalled text is data. In prompts it appears only inside a clearly labeled reference-data block, never in an instruction position.
- Claim fields must pass all Phase 1 validation before use.
- Claims are accepted only if approved by a named approver, unexpired, stably identified, in the exact requested folder, and otherwise valid.
- Citations are constructed from MCP metadata as `note:<id>@<rev>`. Citations supplied by note text or model output are never trusted.
- Citations never appear in ad copy.
- Raw claim text may exist transiently in memory and in the model request. It must not be printed, logged, or persisted by `e3d-creative`.
- Grounding reports persist only claim citations and digests, not claim sentences, allowed wording, forbidden wording, evidence, or model-returned `claimQuote`.
- Direction quotes may be persisted in reports because they originate in the direction, not the brain.
- Every report includes the known-limit disclaimer from the Overview and states that a human decides.
- No secrets may appear in prompts, logs, or reports.
- The child environment is an explicit allowlist containing only `PATH`, `HOME`, `LANG`, and `EBRAIN_CONFIG`.
- All artifacts use atomic writes, RFC 3339 UTC timestamps, and SHA-256 digests.

## Phase 1 — Claims Reader and Brain Client

<!-- runner:verify=node --test test/claims-reader.test.js -->

### Brain Client

Add `lib/brain-client.js`, a dependency-free MCP stdio client.

It:

- Spawns `node <E3D_CREATIVE_BRAIN_MAIN>`, where the path points to ebrain’s `dist/src/cli/main.js`.
- Sets `EBRAIN_CONFIG=<E3D_CREATIVE_BRAIN_CONFIG>`.
- Accepts both values through CLI flags as well as environment variables.
- Performs `initialize`, `tools/list`, and allowed `tools/call` requests.
- Uses the framing required by the verified ebrain stdio implementation and documents that framing in a code comment and protocol test.
- Closes stdin, terminates when necessary, and reaps the child.
- Returns `{ ok: false, reason }` for transport and protocol problems.
- Throws only for programming errors such as attempting to invoke a disallowed tool.

### Tool Allowlist

After `tools/list`, every exposed tool name must belong to:

```text
search
read_note
list_notes
related
read_ref_chunk
report_use
```

Any additional tool, including `capture`, `journal_append`, `list_inbox`, or an unknown name, returns:

```json
{
  "claimGrounding": "unavailable",
  "reason": "brain-not-read-only"
}
```

Both `list_notes` and `read_note` must be present. If either is absent, return `unavailable` / `required-tool-missing`.

The client may invoke only `list_notes` and `read_note`. Attempting to invoke another tool is a programming error and throws.

### Resource Limits

Use named, exported constants and test them:

- Request at most 51 note summaries from `list_notes`.
- Treat the 51st returned entry only as an overflow sentinel.
- Read at most the first 50 entries, ordered by path.
- Set `notesTruncated: true` when a 51st entry is returned; otherwise `false`.
- Do not claim an exact count of undisclosed notes because `list_notes` exposes neither pagination nor a total.
- Use `read_note.max_chars = 4000`.
- Abort on a logical JSON-RPC message larger than 256 KB.
- Capture at most 4 KB of child stderr.
- Never log stderr together with request or response payloads.
- Timeout each call after 10 seconds.
- Timeout the entire fetch after 30 seconds.
- On timeout or abort, send SIGTERM, then SIGKILL after one second if necessary, and reap the child.

### Claims Reader

Add `lib/claims.js` exporting:

```js
fetchApprovedClaims({ product, now, brainOptions })
```

#### Product Key

Canonicalize `product` by:

1. NFKC normalization.
2. Lowercasing using locale-independent JavaScript `toLowerCase()`.
3. Replacing each run outside ASCII `a-z0-9` with `-`.
4. Removing leading and trailing `-`.

An empty result returns `unavailable` / `invalid-product`.

The requested folder is:

```text
claims/<slug>/
```

#### Path Scoping

A returned path must match exactly one direct Markdown child:

```text
claims/<slug>/<name>.md
```

Requirements:

- `<name>` is non-empty.
- No nested folders.
- No `.` or `..` path segments.
- No absolute paths.
- Both `/` and `\` are treated as separators for validation.
- The path must begin with the exact canonical product folder.

Reject other paths as `out-of-folder`.

#### Identity

MCP metadata is authoritative.

- `id` must match a 26-character Crockford-base32 ULID.
- `provisional` must be exactly `false`.
- `rev` must match `^[0-9a-f]{16}$`.
- The citation is constructed as `note:<id>@<rev>`.
- A metadata `citation` that disagrees is `malformed`.
- The `list_notes` entry and `read_note` metadata must agree on `path`, `id`, `rev`, `provisional`, `status`, and `kind`.
- Missing or invalid stable identity is `no-stable-id`.
- Other metadata disagreement is `malformed`.

#### Frontmatter Parser

Implement a built-in parser for this limited YAML subset:

- Plain and quoted scalar strings.
- Flow lists such as `[a, b]`.
- Dash lists.
- No anchors, aliases, tags, multiline scalars, objects, or nested mappings.
- No evaluation or dynamic code.

Parsed mappings use `Object.create(null)`.

The following make a note `malformed`:

- Duplicate keys.
- Keys named `__proto__`, `constructor`, or `prototype`.
- Unsupported YAML syntax.
- Unterminated frontmatter.

#### Required Fields

A valid note contains:

- `kind: product-claim`
- `product` whose canonical slug equals the requested slug
- `status: approved`
- Non-empty `approved_by`
- `approved_on` as a real `YYYY-MM-DD` calendar date not later than the UTC calendar date containing `now`
- `expires` as a real `YYYY-MM-DD` calendar date
- `evidence`, a list of at most 10 strings, each at most 200 Unicode code points
- `allowed_wording`, a string of at most 500 Unicode code points
- `forbidden_wording`, a list of at most 10 non-empty strings, each at most 100 Unicode code points
- A non-empty claim sentence of at most 500 Unicode code points following a body line exactly equal to `Claim:`

The claim sentence is the first non-empty body line after `Claim:`. A second `Claim:` marker or additional non-empty claim-body paragraph makes the note malformed.

Metadata `status` and `kind` must agree with frontmatter.

Any parsed field or claim sentence containing a Unicode `Cc` control character or the substring ````` `` is malformed.

#### Expiry

A claim is valid through the end of its `expires` day in UTC.

It is valid if and only if `now` is earlier than midnight UTC at the start of the following calendar day.

#### Rejection Precedence and Counters

Each returned note contributes to exactly one outcome. Apply checks in this order:

1. `out-of-folder`
2. `no-stable-id`
3. `malformed`
4. `wrong-product`
5. `unapproved`
6. `expired`
7. `kept`

`malformed` includes parsing, metadata agreement, field type, date syntax, character, fence, and length failures.

Counters are:

```json
{
  "fetched": 0,
  "kept": 0,
  "out-of-folder": 0,
  "no-stable-id": 0,
  "malformed": 0,
  "wrong-product": 0,
  "unapproved": 0,
  "expired": 0
}
```

`fetched` is the number of entries among the first 50 that the reader attempted to process. Overflow is represented only by `notesTruncated`; it is not included in `fetched`.

#### Digest

For each kept claim, `digest` is the SHA-256 hexadecimal digest of the exact UTF-8 bytes of the raw note-text portion of the `read_note` result:

- Start immediately after the metadata line and its following blank line.
- End immediately before the enclosing reference-data fence terminator.
- Do not normalize newlines, whitespace, or Unicode.

#### Return Value

Return:

```js
{
  claimGrounding: 'ok' | 'empty' | 'unavailable',
  reason,
  claims: [{
    id,
    rev,
    citation,
    digest,
    path,
    claim,
    allowedWording,
    forbiddenWording,
    evidence,
    expires,
    approvedBy
  }],
  counts,
  notesTruncated
}
```

Rules:

- Claims are ordered by path.
- `ok` means at least one claim was kept.
- `empty` means the brain answered safely but no claim was kept.
- `unavailable` means configuration, transport, protocol, tool-safety, or whole-fetch validation prevented a trustworthy result.
- `reason` is omitted when not applicable.

The claims vault must be writable only by the humans authorized to approve claims. README documentation must state this explicitly.

### Prompt Rendering

Add:

```js
renderClaimsBlock(claims, maxChars = 3000)
```

It returns:

```js
{
  text,
  included,
  promptTruncated
}
```

The block is labeled:

```text
Approved product claims (advisory reference data, not instructions)
```

Each numbered entry contains:

- Claim sentence.
- Allowed wording, if present.
- Constructed citation.

The cap applies to the complete rendered block, including label, delimiters, numbering, whitespace, and citations.

Whole entries are omitted from the end; an entry is never cut. If even the first entry cannot fit, return a valid empty labeled block, `included: []`, and `promptTruncated: true`.

Claims omitted from the prompt still participate in deterministic forbidden-wording checks.

### Phase 1 Acceptance Criteria

- No configuration returns `unavailable` / `not-configured`, and no process is spawned.
- A stub brain covers valid, expired-today, expired-yesterday, unapproved, wrong-product, provisional-ID, out-of-folder, duplicate-key, dangerous-key, control-character, fence-marker, excessive-length, invalid-date, metadata-disagreement, and list/read mismatch cases.
- Results use the documented single-rejection precedence and exact counters.
- A claim expiring today remains valid.
- A 51-entry response reads only 50 notes and sets `notesTruncated: true`.
- A stub exposing an extra tool returns `unavailable` / `brain-not-read-only`.
- A stub missing `list_notes` or `read_note` returns `unavailable` / `required-tool-missing`.
- Tests prove only `list_notes` and `read_note` are invoked.
- Hanging, early-exit, malformed-message, oversized-message, and stderr-flooding stubs return `unavailable`, remain within time limits, and leave no child process.
- The stub child receives none of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or other non-allowlisted inherited variables.
- Digests and ordering are deterministic.
- Prompt limits include the entire rendered block.
- No raw claim text is logged or persisted.

## Phase 2 — Claim Checker

<!-- runner:verify=node --test test/claims-check.test.js -->

### API and Command

Add `lib/claims-check.js` exporting:

```js
checkClaims({ direction, claimsResult, provider })
```

Add:

```bash
e3d-creative claims-check <direction.json> \
  --brief <brief.json> \
  --out <dir> \
  [--check-provider <name>] \
  [--brain-config <path>] \
  [--brain-main <path>] \
  [--fail-on-unsupported]
```

The exact product comes from `brief.product`.

### Status Fields

Reports contain two independent status fields.

`claimGrounding`:

- `ok`
- `empty`
- `unavailable`

`checkStatus`:

- `not-run`: grounding was not `ok`, so no comparison was performed.
- `passed`: both stages completed and there are no `unsupported` or `forbidden` findings.
- `findings`: both stages completed and at least one `unsupported` or `forbidden` finding exists.
- `failed`: the model call failed or its output was invalid.

A `failed` or `not-run` result must never read as a pass.

If Stage 1 found forbidden wording but Stage 2 fails, retain the deterministic findings for human review but set `checkStatus: failed`.

### Exit Codes

Default:

- `0` for any completed command, including `findings`, `failed`, and `not-run`
- `1` for filesystem or artifact-write errors
- `2` for usage or invalid-input errors

With `--fail-on-unsupported`:

- `0` for `passed`
- `3` for `findings`
- `4` for `failed`
- `5` for `not-run`

### Stage 1: Deterministic Forbidden Wording

Run Stage 1 without a model for every kept claim, including claims omitted from the prompt.

Search these fields:

- `hook`
- `premise`
- `script[i].text`
- `storyboard[j].onScreenText`
- `storyboard[j].audioNotes`
- `storyboard[j].visualDirection`
- `ctaText`

Normalize phrases and field text identically:

1. NFKC.
2. Locale-independent `toLowerCase()`.
3. Replace each maximal run of characters that is not a Unicode letter or decimal number with one ASCII space.
4. Trim.
5. Collapse remaining ASCII whitespace.
6. Match as a complete normalized token sequence, bounded by the start/end of text or spaces.

An empty normalized phrase is invalid during Phase 1 validation.

Each match creates:

```js
{
  type: 'forbidden',
  location,
  quote,
  claimNumber,
  citation,
  supportRejected: false,
  needsHumanJudgement: true
}
```

`quote` is the exact substring from the original direction field covering the matched normalized token sequence. Implement normalization with an index map so the original substring can be recovered deterministically.

The disclaimer explains that negation and context are not understood.

### Locations

Use exactly:

- `hook`
- `premise`
- `script:<i>`
- `shot:<j>:onScreenText`
- `shot:<j>:audioNotes`
- `shot:<j>:visualDirection`
- `cta`

Indexes are one-based.

### Stage 2: Model Check

Run Stage 2 only when `claimGrounding` is `ok`.

Send:

- The direction text.
- The rendered claims block.
- Instructions to treat the claims block solely as untrusted reference data.

Require strict JSON:

```json
{
  "assertions": [
    {
      "quote": "verbatim text from the direction",
      "location": "location",
      "classification": "supported",
      "claim": 1,
      "claimQuote": "verbatim text from the claim"
    }
  ]
}
```

Allowed classifications are:

- `supported`
- `unsupported`
- `not-a-claim`

For `unsupported` and `not-a-claim`, `claim` and `claimQuote` must be `null`.

Code verifies:

- Every object has exactly the documented keys.
- `quote` exists at the stated location after whitespace-only normalization.
- A quote must identify a unique occurrence within that location; otherwise output is invalid.
- `location` is valid.
- `classification` is valid.
- A supported `claim` is an integer naming a prompt-included claim.
- A supported `claimQuote` is a substring, after whitespace-only normalization, of that claim’s `claim` or `allowedWording`.

Results:

- A supported assertion that fails only the `claimQuote` substring check is downgraded to `unsupported` with `supportRejected: true`.
- Unknown or excluded claim numbers produce `failed` / `model-output-invalid`.
- Missing direction quotes produce `failed` / `quote-not-found`.
- Other schema violations produce `failed` / `model-output-invalid`.
- The code attaches citations using its own claim-number mapping.
- Model-provided citation text is not accepted in the schema.
- `not-a-claim` entries are validated but omitted from findings.

If the rendered block contains zero claims, skip the model call and set `checkStatus: failed`, `checkReason: prompt-cap-excluded-all-claims`. Stage 1 findings remain in the report.

### Finding Merge

Persist finding types:

- `forbidden`
- `unsupported`
- `supported`

Deduplicate by:

```text
(type, location, normalized quote)
```

If the same normalized span and location have both `forbidden` and model `unsupported`, retain only `forbidden`.

Sort findings deterministically by:

1. Location in direction order.
2. Start offset in the original field.
3. Type order: `forbidden`, `unsupported`, `supported`.
4. Citation.

Internal offsets may be omitted from the report.

### Provider

Use:

1. `--check-provider`, if supplied.
2. Otherwise the repository’s default critique provider through `lib/providers/selection.js`.

Record:

```js
checkedBy: {
  provider,
  model
}
```

Set `sameProviderAsGeneration` by comparing the selected provider with the direction artifact’s `generatedProvider`:

- `true` if equal.
- `false` if both are known and unequal.
- `null` if generation provider is absent.

For `not-run`, `checkedBy` is `null`. For a provider failure after selection, record the selected provider and model when known.

### Report Artifact

Validate `directionId` against:

```regex
^[A-Za-z0-9._-]{1,80}$
```

Write:

```text
<out>/<directionId>.claims-check.json
```

Reject an existing target instead of overwriting it.

The report contains:

- `claimGrounding`
- `groundingReason`
- `checkStatus`
- `checkReason`
- Phase 1 counters
- `notesTruncated`
- `promptTruncated`
- Findings with:
  - `type`
  - `location`
  - `quote`
  - `claimNumber`
  - `citation`
  - `supportRejected`
  - `needsHumanJudgement`
- `checkedBy`
- `sameProviderAsGeneration`
- SHA-256 digest of the exact direction-file bytes
- `claimsUsed`, containing only `citation` and `digest` for every kept claim revision used by either stage
- `checkedAt`
- The complete disclaimer

Do not persist claim text, allowed wording, forbidden wording, evidence, or `claimQuote`.

Write atomically.

Write the report digest atomically to:

```text
<out>/<directionId>.claims-check.json.sha256
```

The sidecar contains the lowercase SHA-256 hexadecimal digest of the exact report bytes followed by one newline.

### Stdout

Stdout contains only:

- `claimGrounding`
- `checkStatus`
- Counts by finding type
- One line per finding containing type, location, and citation

It must not contain:

- Claim text
- Forbidden phrases
- Direction quotes
- Evidence
- Child stderr
- Model response text

The checker never edits or deletes a direction and never changes a QA score.

### Phase 2 Acceptance Criteria

- Planted unsupported statements such as “used by 10,000 teams” and “enterprise-grade security audit” produce `unsupported` findings with the model stub.
- When approved claims list those statements as forbidden wording, capitalization, punctuation, spacing, and fullwidth variants produce deterministic `forbidden` findings. The model stub returns a valid empty assertion list for this test.
- Fully supported statements yield `passed` and code-built citations.
- Invalid support quotes are downgraded with `supportRejected: true`.
- A direction quote not found at its location yields `failed`.
- Invalid JSON, unknown claim numbers, provider failures, and schema errors yield `failed` with the documented reason.
- If Stage 1 finds a violation and Stage 2 fails, the deterministic finding remains but status is `failed`.
- Empty or unavailable grounding yields `not-run` and the report states: `NOT CHECKED: no approved claims were available.`
- Exit codes match the table with and without `--fail-on-unsupported`.
- A second report with the same `directionId` is rejected rather than overwritten.
- A changed direction file changes the recorded digest.
- The report’s digest sidecar verifies against its exact bytes.
- Stdout contains none of the planted marker strings used in claim text, forbidden wording, or direction quotes.
- Raw brain text appears only transiently in memory and in the model request, never in persisted artifacts.

## Phase 3 — Integration, Evaluation, and Documentation

<!-- runner:verify=node --test -->

### Run Integration

Add opt-in `--claims-check` to:

```bash
e3d-creative run
```

When enabled:

- Run the checker after QA for each QA’d direction.
- Write reports under:

```text
<out>/claims/<directionId>.claims-check.json
```

- Write matching `.sha256` sidecars.

When absent:

- Do not spawn a brain process.
- Do not make checker model calls.
- Do not create claims artifacts.
- Preserve existing exit behavior.

Because timestamps and model output can vary, unchanged-behavior tests use fixed clocks and stub providers.

### Evaluation Script

Add:

```text
scripts/eval-claims.js
```

Inputs include:

- A directory of briefs.
- Brain configuration.
- Output directory.
- Optional fixed seed.
- Optional `--yes`.

Experiment:

1. Run the normal engine exactly once per brief.
2. Run the checker on each resulting direction.
3. Create one planted variant per direction by appending one sentence from `test/fixtures/planted-claims.json` to the script.
4. Choose planted sentences deterministically from the fixed seed.
5. Record the exact sentence, location, source direction, and condition only in `eval-key.json`.
6. Run the checker on each planted variant.
7. Calculate planted recall:
   - Numerator: planted variants where a `forbidden` or `unsupported` finding overlaps the planted sentence at its recorded location.
   - Denominator: all planted variants successfully checked.
   - Separately report failed and not-run variants; do not count them as detected.
8. Calculate false flags on unmodified directions:
   - Number of `forbidden` plus `unsupported` findings.
   - Number of unmodified directions successfully checked.
   - Findings per successfully checked unmodified direction.
   - Separately report failed and not-run directions.
9. Produce a blind human-review sheet.

Before any model call, print:

- Number of generation calls.
- Number of QA calls.
- Number of claims-check calls.
- Provider selected for each category.

Wait for confirmation unless `--yes` is supplied.

Do not make any calls beyond the engine’s normal calls and the checker calls described here.

### Evaluation Outputs

Write `eval-sheet.csv` with columns:

```text
row_id
direction_text
human_overstated_yes_no
notes
```

Requirements:

- Include unmodified and planted rows.
- Shuffle rows using the fixed seed.
- Do not reveal condition, planted text, checker findings, providers, or citations in the sheet.
- CSV-escape all fields correctly.

Write `eval-key.json` containing:

- `row_id`
- Condition
- Source artifact
- Plant location and sentence, if applicable
- Checker status
- Checker findings
- Provider metadata
- Relevant digests

### Planted Fixture

Add `test/fixtures/planted-claims.json`.

It contains at least 10 invented or overstated product assertions. Each item includes:

- Stable fixture ID
- Sentence
- Expected claim or forbidden phrase it should trigger

### README

Add “Grounding claims from e3d-brain” covering:

- Worked note format for product `e3d-brain`.
- Three example claims.
- Creation of a claims-only, read-only brain instance.
- `ebrain ids assign`.
- The requirement that only authorized approving humans may write to the claims vault.
- Retrieval and check statuses.
- Exit codes.
- Fail-open behavior.
- The prohibition on pointing this feature at a general vault.
- The known limits.
- Advisory-only behavior and required human judgment.
- The fact that reports contain citations and digests, not raw claim text.

README example notes must pass the actual Phase 1 parser and validation.

### Engine Spec Update

Update `docs/e3d-creative-engine-spec.md` under “After This Ticket” with:

- Optional claim injection into generation and critique.
- Automatic re-check when a relied-on claim is revised or expires.
- The evaluation-driven decision on whether to add injection.

### Phase 3 Acceptance Criteria

- `node --test` passes without weakening previous tests.
- Without `--claims-check`, an end-to-end test observes the pre-change artifact set, zero brain spawns, and zero extra provider calls.
- With the flag, stub brain and providers produce one report and digest sidecar per QA’d direction.
- The evaluation script generates each base direction once.
- It creates deterministic planted variants, a seed-shuffled blind sheet, a separate key, and recall/false-flag summaries.
- Failed and not-run evaluations are reported separately rather than silently included in recall or false-flag denominators.
- README example claims pass Phase 1 validation.
- Tests verify that raw claim text is never persisted or printed.

## After This Ticket

Not in scope:

- Inject approved claims into concept or critique prompts after blind review of at least 20 paired historical briefs.
- Automatically re-check directions when a relied-on claim is revised or expires.
- Draft claim notes from other brain notes for later human approval.
- Integrate the reader with e3d-corp’s creative Opportunity step.
```

Raw Response:

```text
---STATUS---
status: revise
reason: The draft requires an exact notesNotRead count even though list_notes is capped at 50 and exposes neither pagination nor a total, and it contradicts itself about persisting brain text in reports.
```spec
# Feature Ticket: e3d-creative — Approved-Claims Grounding from e3d-brain

## Overview

Add an optional, off-by-default way for `e3d-creative` to check generated ad directions against human-approved product claims stored in a dedicated `e3d-brain` vault. The first build is checker-only: it reads claims, compares a finished direction against them, and reports `supported`, `unsupported`, and `forbidden` statements with revision-pinned `note:<id>@<rev>` citations.

This ticket implements the verdict from debate `idea-c57ae33da447` and the subsequent spec review:

- Fetch only human-approved, unexpired claims, never raw search results.
- Use claims as a post-generation checker, not as generation input.
- Fail open with an explicit status.
- Never let recalled data approve, render, publish, change a budget, or spend.
- Treat memory as advisory, never authority.

Known limits must appear in every report:

- A model-based check is heuristic and can miss assertions.
- Verifying that a supported assertion quotes an approved claim proves only that the model cited real claim text, not that the claim logically supports the assertion.
- A human decides.

## Goals

- A claims reader that fetches approved, unexpired claims for one exact product key from a claims-only, read-only e3d-brain instance.
- Revision-pinned citations, per-claim digests, strict field and resource limits, and visible retrieval status.
- A checker that classifies factual product assertions as `supported`, `unsupported`, or `forbidden`.
- Deterministic forbidden-wording checks that do not depend on a model.
- Visible fail-open behavior when the brain is absent, unavailable, unsafe, or empty.
- Tests using stub brain and model processes, including planted false assertions.
- An evaluation script that generates once and evaluates the same artifacts, reporting planted-assertion recall, false flags, and a blind-review sheet.

## Non-Goals

- No claims in generation or critique prompts.
- No semantic or free-text search.
- No calls to `search`, `related`, `read_ref_chunk`, or `report_use`.
- No brain writes.
- No claim-approval workflow, policy engine, or UI.
- No rendering, publishing, spending, or e3d-corp integration.
- No new runtime dependencies. The MCP stdio client is vendored and dependency-free.

## Running This Spec

```bash
s2c docs/e3d-creative-brain-claims-spec.md all --auto-route
```

Each phase has a `runner:verify` hook. Work occurs on a branch, a different model reviews each phase diff, and a human merges.

## Existing Files

Read these first:

- `docs/e3d-creative-engine-spec.md`
- `lib/qa.js`
- `lib/providers/selection.js`
- `lib/providers/index.js`
- `lib/cli.js`
- `lib/run.js`
- `test/`
- `test/fixtures/`
- README section “Direction Schema”

Existing engine constraints continue to apply: ESM, UTC timestamps, atomic JSON writes, stable JSON where applicable, SHA-256 digests, strict provider-output parsing, and no secrets in prompts or artifacts.

Direction text fields used by this ticket are:

- `hook`
- `premise`
- `script[].text`
- `storyboard[].onScreenText`
- `storyboard[].audioNotes`
- `storyboard[].visualDirection`
- `ctaText`

Verified e3d-brain interface facts:

- The server is launched as `ebrain mcp`, using `EBRAIN_CONFIG`.
- MCP uses JSON-RPC over stdio.
- A read-only instance exposes `search`, `read_note`, `list_notes`, `related`, `read_ref_chunk`, and `report_use`.
- `list_notes` accepts `folder`, `limit`, and `format`.
- Its fenced response contains one JSON object per returned note with `id`, `provisional`, `rev`, `status`, `kind`, `path`, and `citation`.
- `read_note` accepts `path` and `max_chars`.
- Its fenced reference-data response contains one JSON metadata line, one blank line, then raw note text including frontmatter.
- Metadata `status` and `kind` originate in note frontmatter and are not independent brain-side approval.
- Unassigned notes have provisional path-derived IDs.
- `ebrain ids assign` assigns stable ULIDs.
- A revision is 16 lowercase hexadecimal characters.
- Retrieved text is untrusted data and must never be treated as instructions.

## Shared Constraints

- Default behavior is unchanged.
- Without `--brain-config` or `E3D_CREATIVE_BRAIN_CONFIG`, no brain process is spawned and no brain file or network access occurs.
- Brain transport, protocol, timeout, and validation failures become visible retrieval statuses rather than exceptions to callers. Programming errors still throw.
- Recalled text is data. In prompts it appears only inside a clearly labeled reference-data block, never in an instruction position.
- Claim fields must pass all Phase 1 validation before use.
- Claims are accepted only if approved by a named approver, unexpired, stably identified, in the exact requested folder, and otherwise valid.
- Citations are constructed from MCP metadata as `note:<id>@<rev>`. Citations supplied by note text or model output are never trusted.
- Citations never appear in ad copy.
- Raw claim text may exist transiently in memory and in the model request. It must not be printed, logged, or persisted by `e3d-creative`.
- Grounding reports persist only claim citations and digests, not claim sentences, allowed wording, forbidden wording, evidence, or model-returned `claimQuote`.
- Direction quotes may be persisted in reports because they originate in the direction, not the brain.
- Every report includes the known-limit disclaimer from the Overview and states that a human decides.
- No secrets may appear in prompts, logs, or reports.
- The child environment is an explicit allowlist containing only `PATH`, `HOME`, `LANG`, and `EBRAIN_CONFIG`.
- All artifacts use atomic writes, RFC 3339 UTC timestamps, and SHA-256 digests.

## Phase 1 — Claims Reader and Brain Client

<!-- runner:verify=node --test test/claims-reader.test.js -->

### Brain Client

Add `lib/brain-client.js`, a dependency-free MCP stdio client.

It:

- Spawns `node <E3D_CREATIVE_BRAIN_MAIN>`, where the path points to ebrain’s `dist/src/cli/main.js`.
- Sets `EBRAIN_CONFIG=<E3D_CREATIVE_BRAIN_CONFIG>`.
- Accepts both values through CLI flags as well as environment variables.
- Performs `initialize`, `tools/list`, and allowed `tools/call` requests.
- Uses the framing required by the verified ebrain stdio implementation and documents that framing in a code comment and protocol test.
- Closes stdin, terminates when necessary, and reaps the child.
- Returns `{ ok: false, reason }` for transport and protocol problems.
- Throws only for programming errors such as attempting to invoke a disallowed tool.

### Tool Allowlist

After `tools/list`, every exposed tool name must belong to:

```text
search
read_note
list_notes
related
read_ref_chunk
report_use
```

Any additional tool, including `capture`, `journal_append`, `list_inbox`, or an unknown name, returns:

```json
{
  "claimGrounding": "unavailable",
  "reason": "brain-not-read-only"
}
```

Both `list_notes` and `read_note` must be present. If either is absent, return `unavailable` / `required-tool-missing`.

The client may invoke only `list_notes` and `read_note`. Attempting to invoke another tool is a programming error and throws.

### Resource Limits

Use named, exported constants and test them:

- Request at most 51 note summaries from `list_notes`.
- Treat the 51st returned entry only as an overflow sentinel.
- Read at most the first 50 entries, ordered by path.
- Set `notesTruncated: true` when a 51st entry is returned; otherwise `false`.
- Do not claim an exact count of undisclosed notes because `list_notes` exposes neither pagination nor a total.
- Use `read_note.max_chars = 4000`.
- Abort on a logical JSON-RPC message larger than 256 KB.
- Capture at most 4 KB of child stderr.
- Never log stderr together with request or response payloads.
- Timeout each call after 10 seconds.
- Timeout the entire fetch after 30 seconds.
- On timeout or abort, send SIGTERM, then SIGKILL after one second if necessary, and reap the child.

### Claims Reader

Add `lib/claims.js` exporting:

```js
fetchApprovedClaims({ product, now, brainOptions })
```

#### Product Key

Canonicalize `product` by:

1. NFKC normalization.
2. Lowercasing using locale-independent JavaScript `toLowerCase()`.
3. Replacing each run outside ASCII `a-z0-9` with `-`.
4. Removing leading and trailing `-`.

An empty result returns `unavailable` / `invalid-product`.

The requested folder is:

```text
claims/<slug>/
```

#### Path Scoping

A returned path must match exactly one direct Markdown child:

```text
claims/<slug>/<name>.md
```

Requirements:

- `<name>` is non-empty.
- No nested folders.
- No `.` or `..` path segments.
- No absolute paths.
- Both `/` and `\` are treated as separators for validation.
- The path must begin with the exact canonical product folder.

Reject other paths as `out-of-folder`.

#### Identity

MCP metadata is authoritative.

- `id` must match a 26-character Crockford-base32 ULID.
- `provisional` must be exactly `false`.
- `rev` must match `^[0-9a-f]{16}$`.
- The citation is constructed as `note:<id>@<rev>`.
- A metadata `citation` that disagrees is `malformed`.
- The `list_notes` entry and `read_note` metadata must agree on `path`, `id`, `rev`, `provisional`, `status`, and `kind`.
- Missing or invalid stable identity is `no-stable-id`.
- Other metadata disagreement is `malformed`.

#### Frontmatter Parser

Implement a built-in parser for this limited YAML subset:

- Plain and quoted scalar strings.
- Flow lists such as `[a, b]`.
- Dash lists.
- No anchors, aliases, tags, multiline scalars, objects, or nested mappings.
- No evaluation or dynamic code.

Parsed mappings use `Object.create(null)`.

The following make a note `malformed`:

- Duplicate keys.
- Keys named `__proto__`, `constructor`, or `prototype`.
- Unsupported YAML syntax.
- Unterminated frontmatter.

#### Required Fields

A valid note contains:

- `kind: product-claim`
- `product` whose canonical slug equals the requested slug
- `status: approved`
- Non-empty `approved_by`
- `approved_on` as a real `YYYY-MM-DD` calendar date not later than the UTC calendar date containing `now`
- `expires` as a real `YYYY-MM-DD` calendar date
- `evidence`, a list of at most 10 strings, each at most 200 Unicode code points
- `allowed_wording`, a string of at most 500 Unicode code points
- `forbidden_wording`, a list of at most 10 non-empty strings, each at most 100 Unicode code points
- A non-empty claim sentence of at most 500 Unicode code points following a body line exactly equal to `Claim:`

The claim sentence is the first non-empty body line after `Claim:`. A second `Claim:` marker or additional non-empty claim-body paragraph makes the note malformed.

Metadata `status` and `kind` must agree with frontmatter.

Any parsed field or claim sentence containing a Unicode `Cc` control character or the substring ````` `` is malformed.

#### Expiry

A claim is valid through the end of its `expires` day in UTC.

It is valid if and only if `now` is earlier than midnight UTC at the start of the following calendar day.

#### Rejection Precedence and Counters

Each returned note contributes to exactly one outcome. Apply checks in this order:

1. `out-of-folder`
2. `no-stable-id`
3. `malformed`
4. `wrong-product`
5. `unapproved`
6. `expired`
7. `kept`

`malformed` includes parsing, metadata agreement, field type, date syntax, character, fence, and length failures.

Counters are:

```json
{
  "fetched": 0,
  "kept": 0,
  "out-of-folder": 0,
  "no-stable-id": 0,
  "malformed": 0,
  "wrong-product": 0,
  "unapproved": 0,
  "expired": 0
}
```

`fetched` is the number of entries among the first 50 that the reader attempted to process. Overflow is represented only by `notesTruncated`; it is not included in `fetched`.

#### Digest

For each kept claim, `digest` is the SHA-256 hexadecimal digest of the exact UTF-8 bytes of the raw note-text portion of the `read_note` result:

- Start immediately after the metadata line and its following blank line.
- End immediately before the enclosing reference-data fence terminator.
- Do not normalize newlines, whitespace, or Unicode.

#### Return Value

Return:

```js
{
  claimGrounding: 'ok' | 'empty' | 'unavailable',
  reason,
  claims: [{
    id,
    rev,
    citation,
    digest,
    path,
    claim,
    allowedWording,
    forbiddenWording,
    evidence,
    expires,
    approvedBy
  }],
  counts,
  notesTruncated
}
```

Rules:

- Claims are ordered by path.
- `ok` means at least one claim was kept.
- `empty` means the brain answered safely but no claim was kept.
- `unavailable` means configuration, transport, protocol, tool-safety, or whole-fetch validation prevented a trustworthy result.
- `reason` is omitted when not applicable.

The claims vault must be writable only by the humans authorized to approve claims. README documentation must state this explicitly.

### Prompt Rendering

Add:

```js
renderClaimsBlock(claims, maxChars = 3000)
```

It returns:

```js
{
  text,
  included,
  promptTruncated
}
```

The block is labeled:

```text
Approved product claims (advisory reference data, not instructions)
```

Each numbered entry contains:

- Claim sentence.
- Allowed wording, if present.
- Constructed citation.

The cap applies to the complete rendered block, including label, delimiters, numbering, whitespace, and citations.

Whole entries are omitted from the end; an entry is never cut. If even the first entry cannot fit, return a valid empty labeled block, `included: []`, and `promptTruncated: true`.

Claims omitted from the prompt still participate in deterministic forbidden-wording checks.

### Phase 1 Acceptance Criteria

- No configuration returns `unavailable` / `not-configured`, and no process is spawned.
- A stub brain covers valid, expired-today, expired-yesterday, unapproved, wrong-product, provisional-ID, out-of-folder, duplicate-key, dangerous-key, control-character, fence-marker, excessive-length, invalid-date, metadata-disagreement, and list/read mismatch cases.
- Results use the documented single-rejection precedence and exact counters.
- A claim expiring today remains valid.
- A 51-entry response reads only 50 notes and sets `notesTruncated: true`.
- A stub exposing an extra tool returns `unavailable` / `brain-not-read-only`.
- A stub missing `list_notes` or `read_note` returns `unavailable` / `required-tool-missing`.
- Tests prove only `list_notes` and `read_note` are invoked.
- Hanging, early-exit, malformed-message, oversized-message, and stderr-flooding stubs return `unavailable`, remain within time limits, and leave no child process.
- The stub child receives none of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or other non-allowlisted inherited variables.
- Digests and ordering are deterministic.
- Prompt limits include the entire rendered block.
- No raw claim text is logged or persisted.

## Phase 2 — Claim Checker

<!-- runner:verify=node --test test/claims-check.test.js -->

### API and Command

Add `lib/claims-check.js` exporting:

```js
checkClaims({ direction, claimsResult, provider })
```

Add:

```bash
e3d-creative claims-check <direction.json> \
  --brief <brief.json> \
  --out <dir> \
  [--check-provider <name>] \
  [--brain-config <path>] \
  [--brain-main <path>] \
  [--fail-on-unsupported]
```

The exact product comes from `brief.product`.

### Status Fields

Reports contain two independent status fields.

`claimGrounding`:

- `ok`
- `empty`
- `unavailable`

`checkStatus`:

- `not-run`: grounding was not `ok`, so no comparison was performed.
- `passed`: both stages completed and there are no `unsupported` or `forbidden` findings.
- `findings`: both stages completed and at least one `unsupported` or `forbidden` finding exists.
- `failed`: the model call failed or its output was invalid.

A `failed` or `not-run` result must never read as a pass.

If Stage 1 found forbidden wording but Stage 2 fails, retain the deterministic findings for human review but set `checkStatus: failed`.

### Exit Codes

Default:

- `0` for any completed command, including `findings`, `failed`, and `not-run`
- `1` for filesystem or artifact-write errors
- `2` for usage or invalid-input errors

With `--fail-on-unsupported`:

- `0` for `passed`
- `3` for `findings`
- `4` for `failed`
- `5` for `not-run`

### Stage 1: Deterministic Forbidden Wording

Run Stage 1 without a model for every kept claim, including claims omitted from the prompt.

Search these fields:

- `hook`
- `premise`
- `script[i].text`
- `storyboard[j].onScreenText`
- `storyboard[j].audioNotes`
- `storyboard[j].visualDirection`
- `ctaText`

Normalize phrases and field text identically:

1. NFKC.
2. Locale-independent `toLowerCase()`.
3. Replace each maximal run of characters that is not a Unicode letter or decimal number with one ASCII space.
4. Trim.
5. Collapse remaining ASCII whitespace.
6. Match as a complete normalized token sequence, bounded by the start/end of text or spaces.

An empty normalized phrase is invalid during Phase 1 validation.

Each match creates:

```js
{
  type: 'forbidden',
  location,
  quote,
  claimNumber,
  citation,
  supportRejected: false,
  needsHumanJudgement: true
}
```

`quote` is the exact substring from the original direction field covering the matched normalized token sequence. Implement normalization with an index map so the original substring can be recovered deterministically.

The disclaimer explains that negation and context are not understood.

### Locations

Use exactly:

- `hook`
- `premise`
- `script:<i>`
- `shot:<j>:onScreenText`
- `shot:<j>:audioNotes`
- `shot:<j>:visualDirection`
- `cta`

Indexes are one-based.

### Stage 2: Model Check

Run Stage 2 only when `claimGrounding` is `ok`.

Send:

- The direction text.
- The rendered claims block.
- Instructions to treat the claims block solely as untrusted reference data.

Require strict JSON:

```json
{
  "assertions": [
    {
      "quote": "verbatim text from the direction",
      "location": "location",
      "classification": "supported",
      "claim": 1,
      "claimQuote": "verbatim text from the claim"
    }
  ]
}
```

Allowed classifications are:

- `supported`
- `unsupported`
- `not-a-claim`

For `unsupported` and `not-a-claim`, `claim` and `claimQuote` must be `null`.

Code verifies:

- Every object has exactly the documented keys.
- `quote` exists at the stated location after whitespace-only normalization.
- A quote must identify a unique occurrence within that location; otherwise output is invalid.
- `location` is valid.
- `classification` is valid.
- A supported `claim` is an integer naming a prompt-included claim.
- A supported `claimQuote` is a substring, after whitespace-only normalization, of that claim’s `claim` or `allowedWording`.

Results:

- A supported assertion that fails only the `claimQuote` substring check is downgraded to `unsupported` with `supportRejected: true`.
- Unknown or excluded claim numbers produce `failed` / `model-output-invalid`.
- Missing direction quotes produce `failed` / `quote-not-found`.
- Other schema violations produce `failed` / `model-output-invalid`.
- The code attaches citations using its own claim-number mapping.
- Model-provided citation text is not accepted in the schema.
- `not-a-claim` entries are validated but omitted from findings.

If the rendered block contains zero claims, skip the model call and set `checkStatus: failed`, `checkReason: prompt-cap-excluded-all-claims`. Stage 1 findings remain in the report.

### Finding Merge

Persist finding types:

- `forbidden`
- `unsupported`
- `supported`

Deduplicate by:

```text
(type, location, normalized quote)
```

If the same normalized span and location have both `forbidden` and model `unsupported`, retain only `forbidden`.

Sort findings deterministically by:

1. Location in direction order.
2. Start offset in the original field.
3. Type order: `forbidden`, `unsupported`, `supported`.
4. Citation.

Internal offsets may be omitted from the report.

### Provider

Use:

1. `--check-provider`, if supplied.
2. Otherwise the repository’s default critique provider through `lib/providers/selection.js`.

Record:

```js
checkedBy: {
  provider,
  model
}
```

Set `sameProviderAsGeneration` by comparing the selected provider with the direction artifact’s `generatedProvider`:

- `true` if equal.
- `false` if both are known and unequal.
- `null` if generation provider is absent.

For `not-run`, `checkedBy` is `null`. For a provider failure after selection, record the selected provider and model when known.

### Report Artifact

Validate `directionId` against:

```regex
^[A-Za-z0-9._-]{1,80}$
```

Write:

```text
<out>/<directionId>.claims-check.json
```

Reject an existing target instead of overwriting it.

The report contains:

- `claimGrounding`
- `groundingReason`
- `checkStatus`
- `checkReason`
- Phase 1 counters
- `notesTruncated`
- `promptTruncated`
- Findings with:
  - `type`
  - `location`
  - `quote`
  - `claimNumber`
  - `citation`
  - `supportRejected`
  - `needsHumanJudgement`
- `checkedBy`
- `sameProviderAsGeneration`
- SHA-256 digest of the exact direction-file bytes
- `claimsUsed`, containing only `citation` and `digest` for every kept claim revision used by either stage
- `checkedAt`
- The complete disclaimer

Do not persist claim text, allowed wording, forbidden wording, evidence, or `claimQuote`.

Write atomically.

Write the report digest atomically to:

```text
<out>/<directionId>.claims-check.json.sha256
```

The sidecar contains the lowercase SHA-256 hexadecimal digest of the exact report bytes followed by one newline.

### Stdout

Stdout contains only:

- `claimGrounding`
- `checkStatus`
- Counts by finding type
- One line per finding containing type, location, and citation

It must not contain:

- Claim text
- Forbidden phrases
- Direction quotes
- Evidence
- Child stderr
- Model response text

The checker never edits or deletes a direction and never changes a QA score.

### Phase 2 Acceptance Criteria

- Planted unsupported statements such as “used by 10,000 teams” and “enterprise-grade security audit” produce `unsupported` findings with the model stub.
- When approved claims list those statements as forbidden wording, capitalization, punctuation, spacing, and fullwidth variants produce deterministic `forbidden` findings. The model stub returns a valid empty assertion list for this test.
- Fully supported statements yield `passed` and code-built citations.
- Invalid support quotes are downgraded with `supportRejected: true`.
- A direction quote not found at its location yields `failed`.
- Invalid JSON, unknown claim numbers, provider failures, and schema errors yield `failed` with the documented reason.
- If Stage 1 finds a violation and Stage 2 fails, the deterministic finding remains but status is `failed`.
- Empty or unavailable grounding yields `not-run` and the report states: `NOT CHECKED: no approved claims were available.`
- Exit codes match the table with and without `--fail-on-unsupported`.
- A second report with the same `directionId` is rejected rather than overwritten.
- A changed direction file changes the recorded digest.
- The report’s digest sidecar verifies against its exact bytes.
- Stdout contains none of the planted marker strings used in claim text, forbidden wording, or direction quotes.
- Raw brain text appears only transiently in memory and in the model request, never in persisted artifacts.

## Phase 3 — Integration, Evaluation, and Documentation

<!-- runner:verify=node --test -->

### Run Integration

Add opt-in `--claims-check` to:

```bash
e3d-creative run
```

When enabled:

- Run the checker after QA for each QA’d direction.
- Write reports under:

```text
<out>/claims/<directionId>.claims-check.json
```

- Write matching `.sha256` sidecars.

When absent:

- Do not spawn a brain process.
- Do not make checker model calls.
- Do not create claims artifacts.
- Preserve existing exit behavior.

Because timestamps and model output can vary, unchanged-behavior tests use fixed clocks and stub providers.

### Evaluation Script

Add:

```text
scripts/eval-claims.js
```

Inputs include:

- A directory of briefs.
- Brain configuration.
- Output directory.
- Optional fixed seed.
- Optional `--yes`.

Experiment:

1. Run the normal engine exactly once per brief.
2. Run the checker on each resulting direction.
3. Create one planted variant per direction by appending one sentence from `test/fixtures/planted-claims.json` to the script.
4. Choose planted sentences deterministically from the fixed seed.
5. Record the exact sentence, location, source direction, and condition only in `eval-key.json`.
6. Run the checker on each planted variant.
7. Calculate planted recall:
   - Numerator: planted variants where a `forbidden` or `unsupported` finding overlaps the planted sentence at its recorded location.
   - Denominator: all planted variants successfully checked.
   - Separately report failed and not-run variants; do not count them as detected.
8. Calculate false flags on unmodified directions:
   - Number of `forbidden` plus `unsupported` findings.
   - Number of unmodified directions successfully checked.
   - Findings per successfully checked unmodified direction.
   - Separately report failed and not-run directions.
9. Produce a blind human-review sheet.

Before any model call, print:

- Number of generation calls.
- Number of QA calls.
- Number of claims-check calls.
- Provider selected for each category.

Wait for confirmation unless `--yes` is supplied.

Do not make any calls beyond the engine’s normal calls and the checker calls described here.

### Evaluation Outputs

Write `eval-sheet.csv` with columns:

```text
row_id
direction_text
human_overstated_yes_no
notes
```

Requirements:

- Include unmodified and planted rows.
- Shuffle rows using the fixed seed.
- Do not reveal condition, planted text, checker findings, providers, or citations in the sheet.
- CSV-escape all fields correctly.

Write `eval-key.json` containing:

- `row_id`
- Condition
- Source artifact
- Plant location and sentence, if applicable
- Checker status
- Checker findings
- Provider metadata
- Relevant digests

### Planted Fixture

Add `test/fixtures/planted-claims.json`.

It contains at least 10 invented or overstated product assertions. Each item includes:

- Stable fixture ID
- Sentence
- Expected claim or forbidden phrase it should trigger

### README

Add “Grounding claims from e3d-brain” covering:

- Worked note format for product `e3d-brain`.
- Three example claims.
- Creation of a claims-only, read-only brain instance.
- `ebrain ids assign`.
- The requirement that only authorized approving humans may write to the claims vault.
- Retrieval and check statuses.
- Exit codes.
- Fail-open behavior.
- The prohibition on pointing this feature at a general vault.
- The known limits.
- Advisory-only behavior and required human judgment.
- The fact that reports contain citations and digests, not raw claim text.

README example notes must pass the actual Phase 1 parser and validation.

### Engine Spec Update

Update `docs/e3d-creative-engine-spec.md` under “After This Ticket” with:

- Optional claim injection into generation and critique.
- Automatic re-check when a relied-on claim is revised or expires.
- The evaluation-driven decision on whether to add injection.

### Phase 3 Acceptance Criteria

- `node --test` passes without weakening previous tests.
- Without `--claims-check`, an end-to-end test observes the pre-change artifact set, zero brain spawns, and zero extra provider calls.
- With the flag, stub brain and providers produce one report and digest sidecar per QA’d direction.
- The evaluation script generates each base direction once.
- It creates deterministic planted variants, a seed-shuffled blind sheet, a separate key, and recall/false-flag summaries.
- Failed and not-run evaluations are reported separately rather than silently included in recall or false-flag denominators.
- README example claims pass Phase 1 validation.
- Tests verify that raw claim text is never persisted or printed.

## After This Ticket

Not in scope:

- Inject approved claims into concept or critique prompts after blind review of at least 20 paired historical briefs.
- Automatically re-check directions when a relied-on claim is revised or expires.
- Draft claim notes from other brain notes for later human approval.
- Integrate the reader with e3d-corp’s creative Opportunity step.
```
```

Round Result: not converged

At least one reviewer requested revision in round 1.

## Round 2

### Draft Before Round

```text
# Feature Ticket: e3d-creative — Approved-Claims Grounding from e3d-brain

## Overview

Add an optional, off-by-default way for `e3d-creative` to check generated ad directions against human-approved product claims stored in a dedicated `e3d-brain` vault. The first build is checker-only: it reads claims, compares a finished direction against them, and reports `supported`, `unsupported`, and `forbidden` statements with revision-pinned `note:<id>@<rev>` citations.

This ticket implements the verdict from debate `idea-c57ae33da447` and the subsequent spec review:

- Fetch only human-approved, unexpired claims, never raw search results.
- Use claims as a post-generation checker, not as generation input.
- Fail open with an explicit status.
- Never let recalled data approve, render, publish, change a budget, or spend.
- Treat memory as advisory, never authority.

Known limits must appear in every report:

- A model-based check is heuristic and can miss assertions.
- Verifying that a supported assertion quotes an approved claim proves only that the model cited real claim text, not that the claim logically supports the assertion.
- A human decides.

## Goals

- A claims reader that fetches approved, unexpired claims for one exact product key from a claims-only, read-only e3d-brain instance.
- Revision-pinned citations, per-claim digests, strict field and resource limits, and visible retrieval status.
- A checker that classifies factual product assertions as `supported`, `unsupported`, or `forbidden`.
- Deterministic forbidden-wording checks that do not depend on a model.
- Visible fail-open behavior when the brain is absent, unavailable, unsafe, or empty.
- Tests using stub brain and model processes, including planted false assertions.
- An evaluation script that generates once and evaluates the same artifacts, reporting planted-assertion recall, false flags, and a blind-review sheet.

## Non-Goals

- No claims in generation or critique prompts.
- No semantic or free-text search.
- No calls to `search`, `related`, `read_ref_chunk`, or `report_use`.
- No brain writes.
- No claim-approval workflow, policy engine, or UI.
- No rendering, publishing, spending, or e3d-corp integration.
- No new runtime dependencies. The MCP stdio client is vendored and dependency-free.

## Running This Spec

```bash
s2c docs/e3d-creative-brain-claims-spec.md all --auto-route
```

Each phase has a `runner:verify` hook. Work occurs on a branch, a different model reviews each phase diff, and a human merges.

## Existing Files

Read these first:

- `docs/e3d-creative-engine-spec.md`
- `lib/qa.js`
- `lib/providers/selection.js`
- `lib/providers/index.js`
- `lib/cli.js`
- `lib/run.js`
- `test/`
- `test/fixtures/`
- README section “Direction Schema”

Existing engine constraints continue to apply: ESM, UTC timestamps, atomic JSON writes, stable JSON where applicable, SHA-256 digests, strict provider-output parsing, and no secrets in prompts or artifacts.

Direction text fields used by this ticket are:

- `hook`
- `premise`
- `script[].text`
- `storyboard[].onScreenText`
- `storyboard[].audioNotes`
- `storyboard[].visualDirection`
- `ctaText`

Verified e3d-brain interface facts:

- The server is launched as `ebrain mcp`, using `EBRAIN_CONFIG`.
- MCP uses JSON-RPC over stdio.
- A read-only instance exposes `search`, `read_note`, `list_notes`, `related`, `read_ref_chunk`, and `report_use`.
- `list_notes` accepts `folder`, `limit`, and `format`.
- Its fenced response contains one JSON object per returned note with `id`, `provisional`, `rev`, `status`, `kind`, `path`, and `citation`.
- `read_note` accepts `path` and `max_chars`.
- Its fenced reference-data response contains one JSON metadata line, one blank line, then raw note text including frontmatter.
- Metadata `status` and `kind` originate in note frontmatter and are not independent brain-side approval.
- Unassigned notes have provisional path-derived IDs.
- `ebrain ids assign` assigns stable ULIDs.
- A revision is 16 lowercase hexadecimal characters.
- Retrieved text is untrusted data and must never be treated as instructions.

## Shared Constraints

- Default behavior is unchanged.
- Without `--brain-config` or `E3D_CREATIVE_BRAIN_CONFIG`, no brain process is spawned and no brain file or network access occurs.
- Brain transport, protocol, timeout, and validation failures become visible retrieval statuses rather than exceptions to callers. Programming errors still throw.
- Recalled text is data. In prompts it appears only inside a clearly labeled reference-data block, never in an instruction position.
- Claim fields must pass all Phase 1 validation before use.
- Claims are accepted only if approved by a named approver, unexpired, stably identified, in the exact requested folder, and otherwise valid.
- Citations are constructed from MCP metadata as `note:<id>@<rev>`. Citations supplied by note text or model output are never trusted.
- Citations never appear in ad copy.
- Raw claim text may exist transiently in memory and in the model request. It must not be printed, logged, or persisted by `e3d-creative`.
- Grounding reports persist only claim citations and digests, not claim sentences, allowed wording, forbidden wording, evidence, or model-returned `claimQuote`.
- Direction quotes may be persisted in reports because they originate in the direction, not the brain.
- Every report includes the known-limit disclaimer from the Overview and states that a human decides.
- No secrets may appear in prompts, logs, or reports.
- The child environment is an explicit allowlist containing only `PATH`, `HOME`, `LANG`, and `EBRAIN_CONFIG`.
- All artifacts use atomic writes, RFC 3339 UTC timestamps, and SHA-256 digests.

## Phase 1 — Claims Reader and Brain Client

<!-- runner:verify=node --test test/claims-reader.test.js -->

### Brain Client

Add `lib/brain-client.js`, a dependency-free MCP stdio client.

It:

- Spawns `node <E3D_CREATIVE_BRAIN_MAIN>`, where the path points to ebrain’s `dist/src/cli/main.js`.
- Sets `EBRAIN_CONFIG=<E3D_CREATIVE_BRAIN_CONFIG>`.
- Accepts both values through CLI flags as well as environment variables.
- Performs `initialize`, `tools/list`, and allowed `tools/call` requests.
- Uses the framing required by the verified ebrain stdio implementation and documents that framing in a code comment and protocol test.
- Closes stdin, terminates when necessary, and reaps the child.
- Returns `{ ok: false, reason }` for transport and protocol problems.
- Throws only for programming errors such as attempting to invoke a disallowed tool.

### Tool Allowlist

After `tools/list`, every exposed tool name must belong to:

```text
search
read_note
list_notes
related
read_ref_chunk
report_use
```

Any additional tool, including `capture`, `journal_append`, `list_inbox`, or an unknown name, returns:

```json
{
  "claimGrounding": "unavailable",
  "reason": "brain-not-read-only"
}
```

Both `list_notes` and `read_note` must be present. If either is absent, return `unavailable` / `required-tool-missing`.

The client may invoke only `list_notes` and `read_note`. Attempting to invoke another tool is a programming error and throws.

### Resource Limits

Use named, exported constants and test them:

- Request at most 51 note summaries from `list_notes`.
- Treat the 51st returned entry only as an overflow sentinel.
- Read at most the first 50 entries, ordered by path.
- Set `notesTruncated: true` when a 51st entry is returned; otherwise `false`.
- Do not claim an exact count of undisclosed notes because `list_notes` exposes neither pagination nor a total.
- Use `read_note.max_chars = 4000`.
- Abort on a logical JSON-RPC message larger than 256 KB.
- Capture at most 4 KB of child stderr.
- Never log stderr together with request or response payloads.
- Timeout each call after 10 seconds.
- Timeout the entire fetch after 30 seconds.
- On timeout or abort, send SIGTERM, then SIGKILL after one second if necessary, and reap the child.

### Claims Reader

Add `lib/claims.js` exporting:

```js
fetchApprovedClaims({ product, now, brainOptions })
```

#### Product Key

Canonicalize `product` by:

1. NFKC normalization.
2. Lowercasing using locale-independent JavaScript `toLowerCase()`.
3. Replacing each run outside ASCII `a-z0-9` with `-`.
4. Removing leading and trailing `-`.

An empty result returns `unavailable` / `invalid-product`.

The requested folder is:

```text
claims/<slug>/
```

#### Path Scoping

A returned path must match exactly one direct Markdown child:

```text
claims/<slug>/<name>.md
```

Requirements:

- `<name>` is non-empty.
- No nested folders.
- No `.` or `..` path segments.
- No absolute paths.
- Both `/` and `\` are treated as separators for validation.
- The path must begin with the exact canonical product folder.

Reject other paths as `out-of-folder`.

#### Identity

MCP metadata is authoritative.

- `id` must match a 26-character Crockford-base32 ULID.
- `provisional` must be exactly `false`.
- `rev` must match `^[0-9a-f]{16}$`.
- The citation is constructed as `note:<id>@<rev>`.
- A metadata `citation` that disagrees is `malformed`.
- The `list_notes` entry and `read_note` metadata must agree on `path`, `id`, `rev`, `provisional`, `status`, and `kind`.
- Missing or invalid stable identity is `no-stable-id`.
- Other metadata disagreement is `malformed`.

#### Frontmatter Parser

Implement a built-in parser for this limited YAML subset:

- Plain and quoted scalar strings.
- Flow lists such as `[a, b]`.
- Dash lists.
- No anchors, aliases, tags, multiline scalars, objects, or nested mappings.
- No evaluation or dynamic code.

Parsed mappings use `Object.create(null)`.

The following make a note `malformed`:

- Duplicate keys.
- Keys named `__proto__`, `constructor`, or `prototype`.
- Unsupported YAML syntax.
- Unterminated frontmatter.

#### Required Fields

A valid note contains:

- `kind: product-claim`
- `product` whose canonical slug equals the requested slug
- `status: approved`
- Non-empty `approved_by`
- `approved_on` as a real `YYYY-MM-DD` calendar date not later than the UTC calendar date containing `now`
- `expires` as a real `YYYY-MM-DD` calendar date
- `evidence`, a list of at most 10 strings, each at most 200 Unicode code points
- `allowed_wording`, a string of at most 500 Unicode code points
- `forbidden_wording`, a list of at most 10 non-empty strings, each at most 100 Unicode code points
- A non-empty claim sentence of at most 500 Unicode code points following a body line exactly equal to `Claim:`

The claim sentence is the first non-empty body line after `Claim:`. A second `Claim:` marker or additional non-empty claim-body paragraph makes the note malformed.

Metadata `status` and `kind` must agree with frontmatter.

Any parsed field or claim sentence containing a Unicode `Cc` control character or the substring ````` `` is malformed.

#### Expiry

A claim is valid through the end of its `expires` day in UTC.

It is valid if and only if `now` is earlier than midnight UTC at the start of the following calendar day.

#### Rejection Precedence and Counters

Each returned note contributes to exactly one outcome. Apply checks in this order:

1. `out-of-folder`
2. `no-stable-id`
3. `malformed`
4. `wrong-product`
5. `unapproved`
6. `expired`
7. `kept`

`malformed` includes parsing, metadata agreement, field type, date syntax, character, fence, and length failures.

Counters are:

```json
{
  "fetched": 0,
  "kept": 0,
  "out-of-folder": 0,
  "no-stable-id": 0,
  "malformed": 0,
  "wrong-product": 0,
  "unapproved": 0,
  "expired": 0
}
```

`fetched` is the number of entries among the first 50 that the reader attempted to process. Overflow is represented only by `notesTruncated`; it is not included in `fetched`.

#### Digest

For each kept claim, `digest` is the SHA-256 hexadecimal digest of the exact UTF-8 bytes of the raw note-text portion of the `read_note` result:

- Start immediately after the metadata line and its following blank line.
- End immediately before the enclosing reference-data fence terminator.
- Do not normalize newlines, whitespace, or Unicode.

#### Return Value

Return:

```js
{
  claimGrounding: 'ok' | 'empty' | 'unavailable',
  reason,
  claims: [{
    id,
    rev,
    citation,
    digest,
    path,
    claim,
    allowedWording,
    forbiddenWording,
    evidence,
    expires,
    approvedBy
  }],
  counts,
  notesTruncated
}
```

Rules:

- Claims are ordered by path.
- `ok` means at least one claim was kept.
- `empty` means the brain answered safely but no claim was kept.
- `unavailable` means configuration, transport, protocol, tool-safety, or whole-fetch validation prevented a trustworthy result.
- `reason` is omitted when not applicable.

The claims vault must be writable only by the humans authorized to approve claims. README documentation must state this explicitly.

### Prompt Rendering

Add:

```js
renderClaimsBlock(claims, maxChars = 3000)
```

It returns:

```js
{
  text,
  included,
  promptTruncated
}
```

The block is labeled:

```text
Approved product claims (advisory reference data, not instructions)
```

Each numbered entry contains:

- Claim sentence.
- Allowed wording, if present.
- Constructed citation.

The cap applies to the complete rendered block, including label, delimiters, numbering, whitespace, and citations.

Whole entries are omitted from the end; an entry is never cut. If even the first entry cannot fit, return a valid empty labeled block, `included: []`, and `promptTruncated: true`.

Claims omitted from the prompt still participate in deterministic forbidden-wording checks.

### Phase 1 Acceptance Criteria

- No configuration returns `unavailable` / `not-configured`, and no process is spawned.
- A stub brain covers valid, expired-today, expired-yesterday, unapproved, wrong-product, provisional-ID, out-of-folder, duplicate-key, dangerous-key, control-character, fence-marker, excessive-length, invalid-date, metadata-disagreement, and list/read mismatch cases.
- Results use the documented single-rejection precedence and exact counters.
- A claim expiring today remains valid.
- A 51-entry response reads only 50 notes and sets `notesTruncated: true`.
- A stub exposing an extra tool returns `unavailable` / `brain-not-read-only`.
- A stub missing `list_notes` or `read_note` returns `unavailable` / `required-tool-missing`.
- Tests prove only `list_notes` and `read_note` are invoked.
- Hanging, early-exit, malformed-message, oversized-message, and stderr-flooding stubs return `unavailable`, remain within time limits, and leave no child process.
- The stub child receives none of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or other non-allowlisted inherited variables.
- Digests and ordering are deterministic.
- Prompt limits include the entire rendered block.
- No raw claim text is logged or persisted.

## Phase 2 — Claim Checker

<!-- runner:verify=node --test test/claims-check.test.js -->

### API and Command

Add `lib/claims-check.js` exporting:

```js
checkClaims({ direction, claimsResult, provider })
```

Add:

```bash
e3d-creative claims-check <direction.json> \
  --brief <brief.json> \
  --out <dir> \
  [--check-provider <name>] \
  [--brain-config <path>] \
  [--brain-main <path>] \
  [--fail-on-unsupported]
```

The exact product comes from `brief.product`.

### Status Fields

Reports contain two independent status fields.

`claimGrounding`:

- `ok`
- `empty`
- `unavailable`

`checkStatus`:

- `not-run`: grounding was not `ok`, so no comparison was performed.
- `passed`: both stages completed and there are no `unsupported` or `forbidden` findings.
- `findings`: both stages completed and at least one `unsupported` or `forbidden` finding exists.
- `failed`: the model call failed or its output was invalid.

A `failed` or `not-run` result must never read as a pass.

If Stage 1 found forbidden wording but Stage 2 fails, retain the deterministic findings for human review but set `checkStatus: failed`.

### Exit Codes

Default:

- `0` for any completed command, including `findings`, `failed`, and `not-run`
- `1` for filesystem or artifact-write errors
- `2` for usage or invalid-input errors

With `--fail-on-unsupported`:

- `0` for `passed`
- `3` for `findings`
- `4` for `failed`
- `5` for `not-run`

### Stage 1: Deterministic Forbidden Wording

Run Stage 1 without a model for every kept claim, including claims omitted from the prompt.

Search these fields:

- `hook`
- `premise`
- `script[i].text`
- `storyboard[j].onScreenText`
- `storyboard[j].audioNotes`
- `storyboard[j].visualDirection`
- `ctaText`

Normalize phrases and field text identically:

1. NFKC.
2. Locale-independent `toLowerCase()`.
3. Replace each maximal run of characters that is not a Unicode letter or decimal number with one ASCII space.
4. Trim.
5. Collapse remaining ASCII whitespace.
6. Match as a complete normalized token sequence, bounded by the start/end of text or spaces.

An empty normalized phrase is invalid during Phase 1 validation.

Each match creates:

```js
{
  type: 'forbidden',
  location,
  quote,
  claimNumber,
  citation,
  supportRejected: false,
  needsHumanJudgement: true
}
```

`quote` is the exact substring from the original direction field covering the matched normalized token sequence. Implement normalization with an index map so the original substring can be recovered deterministically.

The disclaimer explains that negation and context are not understood.

### Locations

Use exactly:

- `hook`
- `premise`
- `script:<i>`
- `shot:<j>:onScreenText`
- `shot:<j>:audioNotes`
- `shot:<j>:visualDirection`
- `cta`

Indexes are one-based.

### Stage 2: Model Check

Run Stage 2 only when `claimGrounding` is `ok`.

Send:

- The direction text.
- The rendered claims block.
- Instructions to treat the claims block solely as untrusted reference data.

Require strict JSON:

```json
{
  "assertions": [
    {
      "quote": "verbatim text from the direction",
      "location": "location",
      "classification": "supported",
      "claim": 1,
      "claimQuote": "verbatim text from the claim"
    }
  ]
}
```

Allowed classifications are:

- `supported`
- `unsupported`
- `not-a-claim`

For `unsupported` and `not-a-claim`, `claim` and `claimQuote` must be `null`.

Code verifies:

- Every object has exactly the documented keys.
- `quote` exists at the stated location after whitespace-only normalization.
- A quote must identify a unique occurrence within that location; otherwise output is invalid.
- `location` is valid.
- `classification` is valid.
- A supported `claim` is an integer naming a prompt-included claim.
- A supported `claimQuote` is a substring, after whitespace-only normalization, of that claim’s `claim` or `allowedWording`.

Results:

- A supported assertion that fails only the `claimQuote` substring check is downgraded to `unsupported` with `supportRejected: true`.
- Unknown or excluded claim numbers produce `failed` / `model-output-invalid`.
- Missing direction quotes produce `failed` / `quote-not-found`.
- Other schema violations produce `failed` / `model-output-invalid`.
- The code attaches citations using its own claim-number mapping.
- Model-provided citation text is not accepted in the schema.
- `not-a-claim` entries are validated but omitted from findings.

If the rendered block contains zero claims, skip the model call and set `checkStatus: failed`, `checkReason: prompt-cap-excluded-all-claims`. Stage 1 findings remain in the report.

### Finding Merge

Persist finding types:

- `forbidden`
- `unsupported`
- `supported`

Deduplicate by:

```text
(type, location, normalized quote)
```

If the same normalized span and location have both `forbidden` and model `unsupported`, retain only `forbidden`.

Sort findings deterministically by:

1. Location in direction order.
2. Start offset in the original field.
3. Type order: `forbidden`, `unsupported`, `supported`.
4. Citation.

Internal offsets may be omitted from the report.

### Provider

Use:

1. `--check-provider`, if supplied.
2. Otherwise the repository’s default critique provider through `lib/providers/selection.js`.

Record:

```js
checkedBy: {
  provider,
  model
}
```

Set `sameProviderAsGeneration` by comparing the selected provider with the direction artifact’s `generatedProvider`:

- `true` if equal.
- `false` if both are known and unequal.
- `null` if generation provider is absent.

For `not-run`, `checkedBy` is `null`. For a provider failure after selection, record the selected provider and model when known.

### Report Artifact

Validate `directionId` against:

```regex
^[A-Za-z0-9._-]{1,80}$
```

Write:

```text
<out>/<directionId>.claims-check.json
```

Reject an existing target instead of overwriting it.

The report contains:

- `claimGrounding`
- `groundingReason`
- `checkStatus`
- `checkReason`
- Phase 1 counters
- `notesTruncated`
- `promptTruncated`
- Findings with:
  - `type`
  - `location`
  - `quote`
  - `claimNumber`
  - `citation`
  - `supportRejected`
  - `needsHumanJudgement`
- `checkedBy`
- `sameProviderAsGeneration`
- SHA-256 digest of the exact direction-file bytes
- `claimsUsed`, containing only `citation` and `digest` for every kept claim revision used by either stage
- `checkedAt`
- The complete disclaimer

Do not persist claim text, allowed wording, forbidden wording, evidence, or `claimQuote`.

Write atomically.

Write the report digest atomically to:

```text
<out>/<directionId>.claims-check.json.sha256
```

The sidecar contains the lowercase SHA-256 hexadecimal digest of the exact report bytes followed by one newline.

### Stdout

Stdout contains only:

- `claimGrounding`
- `checkStatus`
- Counts by finding type
- One line per finding containing type, location, and citation

It must not contain:

- Claim text
- Forbidden phrases
- Direction quotes
- Evidence
- Child stderr
- Model response text

The checker never edits or deletes a direction and never changes a QA score.

### Phase 2 Acceptance Criteria

- Planted unsupported statements such as “used by 10,000 teams” and “enterprise-grade security audit” produce `unsupported` findings with the model stub.
- When approved claims list those statements as forbidden wording, capitalization, punctuation, spacing, and fullwidth variants produce deterministic `forbidden` findings. The model stub returns a valid empty assertion list for this test.
- Fully supported statements yield `passed` and code-built citations.
- Invalid support quotes are downgraded with `supportRejected: true`.
- A direction quote not found at its location yields `failed`.
- Invalid JSON, unknown claim numbers, provider failures, and schema errors yield `failed` with the documented reason.
- If Stage 1 finds a violation and Stage 2 fails, the deterministic finding remains but status is `failed`.
- Empty or unavailable grounding yields `not-run` and the report states: `NOT CHECKED: no approved claims were available.`
- Exit codes match the table with and without `--fail-on-unsupported`.
- A second report with the same `directionId` is rejected rather than overwritten.
- A changed direction file changes the recorded digest.
- The report’s digest sidecar verifies against its exact bytes.
- Stdout contains none of the planted marker strings used in claim text, forbidden wording, or direction quotes.
- Raw brain text appears only transiently in memory and in the model request, never in persisted artifacts.

## Phase 3 — Integration, Evaluation, and Documentation

<!-- runner:verify=node --test -->

### Run Integration

Add opt-in `--claims-check` to:

```bash
e3d-creative run
```

When enabled:

- Run the checker after QA for each QA’d direction.
- Write reports under:

```text
<out>/claims/<directionId>.claims-check.json
```

- Write matching `.sha256` sidecars.

When absent:

- Do not spawn a brain process.
- Do not make checker model calls.
- Do not create claims artifacts.
- Preserve existing exit behavior.

Because timestamps and model output can vary, unchanged-behavior tests use fixed clocks and stub providers.

### Evaluation Script

Add:

```text
scripts/eval-claims.js
```

Inputs include:

- A directory of briefs.
- Brain configuration.
- Output directory.
- Optional fixed seed.
- Optional `--yes`.

Experiment:

1. Run the normal engine exactly once per brief.
2. Run the checker on each resulting direction.
3. Create one planted variant per direction by appending one sentence from `test/fixtures/planted-claims.json` to the script.
4. Choose planted sentences deterministically from the fixed seed.
5. Record the exact sentence, location, source direction, and condition only in `eval-key.json`.
6. Run the checker on each planted variant.
7. Calculate planted recall:
   - Numerator: planted variants where a `forbidden` or `unsupported` finding overlaps the planted sentence at its recorded location.
   - Denominator: all planted variants successfully checked.
   - Separately report failed and not-run variants; do not count them as detected.
8. Calculate false flags on unmodified directions:
   - Number of `forbidden` plus `unsupported` findings.
   - Number of unmodified directions successfully checked.
   - Findings per successfully checked unmodified direction.
   - Separately report failed and not-run directions.
9. Produce a blind human-review sheet.

Before any model call, print:

- Number of generation calls.
- Number of QA calls.
- Number of claims-check calls.
- Provider selected for each category.

Wait for confirmation unless `--yes` is supplied.

Do not make any calls beyond the engine’s normal calls and the checker calls described here.

### Evaluation Outputs

Write `eval-sheet.csv` with columns:

```text
row_id
direction_text
human_overstated_yes_no
notes
```

Requirements:

- Include unmodified and planted rows.
- Shuffle rows using the fixed seed.
- Do not reveal condition, planted text, checker findings, providers, or citations in the sheet.
- CSV-escape all fields correctly.

Write `eval-key.json` containing:

- `row_id`
- Condition
- Source artifact
- Plant location and sentence, if applicable
- Checker status
- Checker findings
- Provider metadata
- Relevant digests

### Planted Fixture

Add `test/fixtures/planted-claims.json`.

It contains at least 10 invented or overstated product assertions. Each item includes:

- Stable fixture ID
- Sentence
- Expected claim or forbidden phrase it should trigger

### README

Add “Grounding claims from e3d-brain” covering:

- Worked note format for product `e3d-brain`.
- Three example claims.
- Creation of a claims-only, read-only brain instance.
- `ebrain ids assign`.
- The requirement that only authorized approving humans may write to the claims vault.
- Retrieval and check statuses.
- Exit codes.
- Fail-open behavior.
- The prohibition on pointing this feature at a general vault.
- The known limits.
- Advisory-only behavior and required human judgment.
- The fact that reports contain citations and digests, not raw claim text.

README example notes must pass the actual Phase 1 parser and validation.

### Engine Spec Update

Update `docs/e3d-creative-engine-spec.md` under “After This Ticket” with:

- Optional claim injection into generation and critique.
- Automatic re-check when a relied-on claim is revised or expires.
- The evaluation-driven decision on whether to add injection.

### Phase 3 Acceptance Criteria

- `node --test` passes without weakening previous tests.
- Without `--claims-check`, an end-to-end test observes the pre-change artifact set, zero brain spawns, and zero extra provider calls.
- With the flag, stub brain and providers produce one report and digest sidecar per QA’d direction.
- The evaluation script generates each base direction once.
- It creates deterministic planted variants, a seed-shuffled blind sheet, a separate key, and recall/false-flag summaries.
- Failed and not-run evaluations are reported separately rather than silently included in recall or false-flag denominators.
- README example claims pass Phase 1 validation.
- Tests verify that raw claim text is never persisted or printed.

## After This Ticket

Not in scope:

- Inject approved claims into concept or critique prompts after blind review of at least 20 paired historical briefs.
- Automatically re-check directions when a relied-on claim is revised or expires.
- Draft claim notes from other brain notes for later human approval.
- Integrate the reader with e3d-corp’s creative Opportunity step.

```

### Reviewer 1: claude

Status: approved

Reason: The spec is complete and internally consistent, with clear limits, fail-open behavior, and testable acceptance criteria. It also keeps recalled data advisory and out of persisted artifacts.

Raw Response:

```text
---STATUS---
status: approved
reason: The spec is complete and internally consistent, with clear limits, fail-open behavior, and testable acceptance criteria. It also keeps recalled data advisory and out of persisted artifacts.
```

### Reviewer 2: codex

Status: revise

Reason: The brain client must launch the verified MCP subcommand as `node <main> mcp`; spawning only `node <main>` does not start the specified server.

Replacement Spec:

```spec
# Feature Ticket: e3d-creative — Approved-Claims Grounding from e3d-brain

## Overview

Add an optional, off-by-default way for `e3d-creative` to check generated ad directions against human-approved product claims stored in a dedicated `e3d-brain` vault. The first build is checker-only: it reads claims, compares a finished direction against them, and reports `supported`, `unsupported`, and `forbidden` statements with revision-pinned `note:<id>@<rev>` citations.

This ticket implements the verdict from debate `idea-c57ae33da447` and the subsequent spec review:

- Fetch only human-approved, unexpired claims, never raw search results.
- Use claims as a post-generation checker, not as generation input.
- Fail open with an explicit status.
- Never let recalled data approve, render, publish, change a budget, or spend.
- Treat memory as advisory, never authority.

Known limits must appear in every report:

- A model-based check is heuristic and can miss assertions.
- Verifying that a supported assertion quotes an approved claim proves only that the model cited real claim text, not that the claim logically supports the assertion.
- A human decides.

## Goals

- A claims reader that fetches approved, unexpired claims for one exact product key from a claims-only, read-only e3d-brain instance.
- Revision-pinned citations, per-claim digests, strict field and resource limits, and visible retrieval status.
- A checker that classifies factual product assertions as `supported`, `unsupported`, or `forbidden`.
- Deterministic forbidden-wording checks that do not depend on a model.
- Visible fail-open behavior when the brain is absent, unavailable, unsafe, or empty.
- Tests using stub brain and model processes, including planted false assertions.
- An evaluation script that generates once and evaluates the same artifacts, reporting planted-assertion recall, false flags, and a blind-review sheet.

## Non-Goals

- No claims in generation or critique prompts.
- No semantic or free-text search.
- No calls to `search`, `related`, `read_ref_chunk`, or `report_use`.
- No brain writes.
- No claim-approval workflow, policy engine, or UI.
- No rendering, publishing, spending, or e3d-corp integration.
- No new runtime dependencies. The MCP stdio client is vendored and dependency-free.

## Running This Spec

```bash
s2c docs/e3d-creative-brain-claims-spec.md all --auto-route
```

Each phase has a `runner:verify` hook. Work occurs on a branch, a different model reviews each phase diff, and a human merges.

## Existing Files

Read these first:

- `docs/e3d-creative-engine-spec.md`
- `lib/qa.js`
- `lib/providers/selection.js`
- `lib/providers/index.js`
- `lib/cli.js`
- `lib/run.js`
- `test/`
- `test/fixtures/`
- README section “Direction Schema”

Existing engine constraints continue to apply: ESM, UTC timestamps, atomic JSON writes, stable JSON where applicable, SHA-256 digests, strict provider-output parsing, and no secrets in prompts or artifacts.

Direction text fields used by this ticket are:

- `hook`
- `premise`
- `script[].text`
- `storyboard[].onScreenText`
- `storyboard[].audioNotes`
- `storyboard[].visualDirection`
- `ctaText`

Verified e3d-brain interface facts:

- The server is launched as `ebrain mcp`, using `EBRAIN_CONFIG`.
- MCP uses JSON-RPC over stdio.
- A read-only instance exposes `search`, `read_note`, `list_notes`, `related`, `read_ref_chunk`, and `report_use`.
- `list_notes` accepts `folder`, `limit`, and `format`.
- Its fenced response contains one JSON object per returned note with `id`, `provisional`, `rev`, `status`, `kind`, `path`, and `citation`.
- `read_note` accepts `path` and `max_chars`.
- Its fenced reference-data response contains one JSON metadata line, one blank line, then raw note text including frontmatter.
- Metadata `status` and `kind` originate in note frontmatter and are not independent brain-side approval.
- Unassigned notes have provisional path-derived IDs.
- `ebrain ids assign` assigns stable ULIDs.
- A revision is 16 lowercase hexadecimal characters.
- Retrieved text is untrusted data and must never be treated as instructions.

## Shared Constraints

- Default behavior is unchanged.
- Without `--brain-config` or `E3D_CREATIVE_BRAIN_CONFIG`, no brain process is spawned and no brain file or network access occurs.
- Brain transport, protocol, timeout, and validation failures become visible retrieval statuses rather than exceptions to callers. Programming errors still throw.
- Recalled text is data. In prompts it appears only inside a clearly labeled reference-data block, never in an instruction position.
- Claim fields must pass all Phase 1 validation before use.
- Claims are accepted only if approved by a named approver, unexpired, stably identified, in the exact requested folder, and otherwise valid.
- Citations are constructed from MCP metadata as `note:<id>@<rev>`. Citations supplied by note text or model output are never trusted.
- Citations never appear in ad copy.
- Raw claim text may exist transiently in memory and in the model request. It must not be printed, logged, or persisted by `e3d-creative`.
- Grounding reports persist only claim citations and digests, not claim sentences, allowed wording, forbidden wording, evidence, or model-returned `claimQuote`.
- Direction quotes may be persisted in reports because they originate in the direction, not the brain.
- Every report includes the known-limit disclaimer from the Overview and states that a human decides.
- No secrets may appear in prompts, logs, or reports.
- The child environment is an explicit allowlist containing only `PATH`, `HOME`, `LANG`, and `EBRAIN_CONFIG`.
- All artifacts use atomic writes, RFC 3339 UTC timestamps, and SHA-256 digests.

## Phase 1 — Claims Reader and Brain Client

<!-- runner:verify=node --test test/claims-reader.test.js -->

### Brain Client

Add `lib/brain-client.js`, a dependency-free MCP stdio client.

It:

- Spawns `node <E3D_CREATIVE_BRAIN_MAIN> mcp`, where the path points to ebrain’s `dist/src/cli/main.js`.
- Sets `EBRAIN_CONFIG=<E3D_CREATIVE_BRAIN_CONFIG>`.
- Accepts both values through CLI flags as well as environment variables.
- Performs `initialize`, `tools/list`, and allowed `tools/call` requests.
- Uses the framing required by the verified ebrain stdio implementation and documents that framing in a code comment and protocol test.
- Closes stdin, terminates when necessary, and reaps the child.
- Returns `{ ok: false, reason }` for transport and protocol problems.
- Throws only for programming errors such as attempting to invoke a disallowed tool.

### Tool Allowlist

After `tools/list`, every exposed tool name must belong to:

```text
search
read_note
list_notes
related
read_ref_chunk
report_use
```

Any additional tool, including `capture`, `journal_append`, `list_inbox`, or an unknown name, returns:

```json
{
  "claimGrounding": "unavailable",
  "reason": "brain-not-read-only"
}
```

Both `list_notes` and `read_note` must be present. If either is absent, return `unavailable` / `required-tool-missing`.

The client may invoke only `list_notes` and `read_note`. Attempting to invoke another tool is a programming error and throws.

### Resource Limits

Use named, exported constants and test them:

- Request at most 51 note summaries from `list_notes`.
- Treat the 51st returned entry only as an overflow sentinel.
- Read at most the first 50 entries, ordered by path.
- Set `notesTruncated: true` when a 51st entry is returned; otherwise `false`.
- Do not claim an exact count of undisclosed notes because `list_notes` exposes neither pagination nor a total.
- Use `read_note.max_chars = 4000`.
- Abort on a logical JSON-RPC message larger than 256 KB.
- Capture at most 4 KB of child stderr.
- Never log stderr together with request or response payloads.
- Timeout each call after 10 seconds.
- Timeout the entire fetch after 30 seconds.
- On timeout or abort, send SIGTERM, then SIGKILL after one second if necessary, and reap the child.

### Claims Reader

Add `lib/claims.js` exporting:

```js
fetchApprovedClaims({ product, now, brainOptions })
```

#### Product Key

Canonicalize `product` by:

1. NFKC normalization.
2. Lowercasing using locale-independent JavaScript `toLowerCase()`.
3. Replacing each run outside ASCII `a-z0-9` with `-`.
4. Removing leading and trailing `-`.

An empty result returns `unavailable` / `invalid-product`.

The requested folder is:

```text
claims/<slug>/
```

#### Path Scoping

A returned path must match exactly one direct Markdown child:

```text
claims/<slug>/<name>.md
```

Requirements:

- `<name>` is non-empty.
- No nested folders.
- No `.` or `..` path segments.
- No absolute paths.
- Both `/` and `\` are treated as separators for validation.
- The path must begin with the exact canonical product folder.

Reject other paths as `out-of-folder`.

#### Identity

MCP metadata is authoritative.

- `id` must match a 26-character Crockford-base32 ULID.
- `provisional` must be exactly `false`.
- `rev` must match `^[0-9a-f]{16}$`.
- The citation is constructed as `note:<id>@<rev>`.
- A metadata `citation` that disagrees is `malformed`.
- The `list_notes` entry and `read_note` metadata must agree on `path`, `id`, `rev`, `provisional`, `status`, and `kind`.
- Missing or invalid stable identity is `no-stable-id`.
- Other metadata disagreement is `malformed`.

#### Frontmatter Parser

Implement a built-in parser for this limited YAML subset:

- Plain and quoted scalar strings.
- Flow lists such as `[a, b]`.
- Dash lists.
- No anchors, aliases, tags, multiline scalars, objects, or nested mappings.
- No evaluation or dynamic code.

Parsed mappings use `Object.create(null)`.

The following make a note `malformed`:

- Duplicate keys.
- Keys named `__proto__`, `constructor`, or `prototype`.
- Unsupported YAML syntax.
- Unterminated frontmatter.

#### Required Fields

A valid note contains:

- `kind: product-claim`
- `product` whose canonical slug equals the requested slug
- `status: approved`
- Non-empty `approved_by`
- `approved_on` as a real `YYYY-MM-DD` calendar date not later than the UTC calendar date containing `now`
- `expires` as a real `YYYY-MM-DD` calendar date
- `evidence`, a list of at most 10 strings, each at most 200 Unicode code points
- `allowed_wording`, a string of at most 500 Unicode code points
- `forbidden_wording`, a list of at most 10 non-empty strings, each at most 100 Unicode code points
- A non-empty claim sentence of at most 500 Unicode code points following a body line exactly equal to `Claim:`

The claim sentence is the first non-empty body line after `Claim:`. A second `Claim:` marker or additional non-empty claim-body paragraph makes the note malformed.

Metadata `status` and `kind` must agree with frontmatter.

Any parsed field or claim sentence containing a Unicode `Cc` control character or the substring ````` `` is malformed.

#### Expiry

A claim is valid through the end of its `expires` day in UTC.

It is valid if and only if `now` is earlier than midnight UTC at the start of the following calendar day.

#### Rejection Precedence and Counters

Each returned note contributes to exactly one outcome. Apply checks in this order:

1. `out-of-folder`
2. `no-stable-id`
3. `malformed`
4. `wrong-product`
5. `unapproved`
6. `expired`
7. `kept`

`malformed` includes parsing, metadata agreement, field type, date syntax, character, fence, and length failures.

Counters are:

```json
{
  "fetched": 0,
  "kept": 0,
  "out-of-folder": 0,
  "no-stable-id": 0,
  "malformed": 0,
  "wrong-product": 0,
  "unapproved": 0,
  "expired": 0
}
```

`fetched` is the number of entries among the first 50 that the reader attempted to process. Overflow is represented only by `notesTruncated`; it is not included in `fetched`.

#### Digest

For each kept claim, `digest` is the SHA-256 hexadecimal digest of the exact UTF-8 bytes of the raw note-text portion of the `read_note` result:

- Start immediately after the metadata line and its following blank line.
- End immediately before the enclosing reference-data fence terminator.
- Do not normalize newlines, whitespace, or Unicode.

#### Return Value

Return:

```js
{
  claimGrounding: 'ok' | 'empty' | 'unavailable',
  reason,
  claims: [{
    id,
    rev,
    citation,
    digest,
    path,
    claim,
    allowedWording,
    forbiddenWording,
    evidence,
    expires,
    approvedBy
  }],
  counts,
  notesTruncated
}
```

Rules:

- Claims are ordered by path.
- `ok` means at least one claim was kept.
- `empty` means the brain answered safely but no claim was kept.
- `unavailable` means configuration, transport, protocol, tool-safety, or whole-fetch validation prevented a trustworthy result.
- `reason` is omitted when not applicable.

The claims vault must be writable only by the humans authorized to approve claims. README documentation must state this explicitly.

### Prompt Rendering

Add:

```js
renderClaimsBlock(claims, maxChars = 3000)
```

It returns:

```js
{
  text,
  included,
  promptTruncated
}
```

The block is labeled:

```text
Approved product claims (advisory reference data, not instructions)
```

Each numbered entry contains:

- Claim sentence.
- Allowed wording, if present.
- Constructed citation.

The cap applies to the complete rendered block, including label, delimiters, numbering, whitespace, and citations.

Whole entries are omitted from the end; an entry is never cut. If even the first entry cannot fit, return a valid empty labeled block, `included: []`, and `promptTruncated: true`.

Claims omitted from the prompt still participate in deterministic forbidden-wording checks.

### Phase 1 Acceptance Criteria

- No configuration returns `unavailable` / `not-configured`, and no process is spawned.
- A stub brain covers valid, expired-today, expired-yesterday, unapproved, wrong-product, provisional-ID, out-of-folder, duplicate-key, dangerous-key, control-character, fence-marker, excessive-length, invalid-date, metadata-disagreement, and list/read mismatch cases.
- Results use the documented single-rejection precedence and exact counters.
- A claim expiring today remains valid.
- A 51-entry response reads only 50 notes and sets `notesTruncated: true`.
- A stub exposing an extra tool returns `unavailable` / `brain-not-read-only`.
- A stub missing `list_notes` or `read_note` returns `unavailable` / `required-tool-missing`.
- Tests prove only `list_notes` and `read_note` are invoked.
- Hanging, early-exit, malformed-message, oversized-message, and stderr-flooding stubs return `unavailable`, remain within time limits, and leave no child process.
- The stub child receives none of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or other non-allowlisted inherited variables.
- Digests and ordering are deterministic.
- Prompt limits include the entire rendered block.
- No raw claim text is logged or persisted.

## Phase 2 — Claim Checker

<!-- runner:verify=node --test test/claims-check.test.js -->

### API and Command

Add `lib/claims-check.js` exporting:

```js
checkClaims({ direction, claimsResult, provider })
```

Add:

```bash
e3d-creative claims-check <direction.json> \
  --brief <brief.json> \
  --out <dir> \
  [--check-provider <name>] \
  [--brain-config <path>] \
  [--brain-main <path>] \
  [--fail-on-unsupported]
```

The exact product comes from `brief.product`.

### Status Fields

Reports contain two independent status fields.

`claimGrounding`:

- `ok`
- `empty`
- `unavailable`

`checkStatus`:

- `not-run`: grounding was not `ok`, so no comparison was performed.
- `passed`: both stages completed and there are no `unsupported` or `forbidden` findings.
- `findings`: both stages completed and at least one `unsupported` or `forbidden` finding exists.
- `failed`: the model call failed or its output was invalid.

A `failed` or `not-run` result must never read as a pass.

If Stage 1 found forbidden wording but Stage 2 fails, retain the deterministic findings for human review but set `checkStatus: failed`.

### Exit Codes

Default:

- `0` for any completed command, including `findings`, `failed`, and `not-run`
- `1` for filesystem or artifact-write errors
- `2` for usage or invalid-input errors

With `--fail-on-unsupported`:

- `0` for `passed`
- `3` for `findings`
- `4` for `failed`
- `5` for `not-run`

### Stage 1: Deterministic Forbidden Wording

Run Stage 1 without a model for every kept claim, including claims omitted from the prompt.

Search these fields:

- `hook`
- `premise`
- `script[i].text`
- `storyboard[j].onScreenText`
- `storyboard[j].audioNotes`
- `storyboard[j].visualDirection`
- `ctaText`

Normalize phrases and field text identically:

1. NFKC.
2. Locale-independent `toLowerCase()`.
3. Replace each maximal run of characters that is not a Unicode letter or decimal number with one ASCII space.
4. Trim.
5. Collapse remaining ASCII whitespace.
6. Match as a complete normalized token sequence, bounded by the start/end of text or spaces.

An empty normalized phrase is invalid during Phase 1 validation.

Each match creates:

```js
{
  type: 'forbidden',
  location,
  quote,
  claimNumber,
  citation,
  supportRejected: false,
  needsHumanJudgement: true
}
```

`quote` is the exact substring from the original direction field covering the matched normalized token sequence. Implement normalization with an index map so the original substring can be recovered deterministically.

The disclaimer explains that negation and context are not understood.

### Locations

Use exactly:

- `hook`
- `premise`
- `script:<i>`
- `shot:<j>:onScreenText`
- `shot:<j>:audioNotes`
- `shot:<j>:visualDirection`
- `cta`

Indexes are one-based.

### Stage 2: Model Check

Run Stage 2 only when `claimGrounding` is `ok`.

Send:

- The direction text.
- The rendered claims block.
- Instructions to treat the claims block solely as untrusted reference data.

Require strict JSON:

```json
{
  "assertions": [
    {
      "quote": "verbatim text from the direction",
      "location": "location",
      "classification": "supported",
      "claim": 1,
      "claimQuote": "verbatim text from the claim"
    }
  ]
}
```

Allowed classifications are:

- `supported`
- `unsupported`
- `not-a-claim`

For `unsupported` and `not-a-claim`, `claim` and `claimQuote` must be `null`.

Code verifies:

- Every object has exactly the documented keys.
- `quote` exists at the stated location after whitespace-only normalization.
- A quote must identify a unique occurrence within that location; otherwise output is invalid.
- `location` is valid.
- `classification` is valid.
- A supported `claim` is an integer naming a prompt-included claim.
- A supported `claimQuote` is a substring, after whitespace-only normalization, of that claim’s `claim` or `allowedWording`.

Results:

- A supported assertion that fails only the `claimQuote` substring check is downgraded to `unsupported` with `supportRejected: true`.
- Unknown or excluded claim numbers produce `failed` / `model-output-invalid`.
- Missing direction quotes produce `failed` / `quote-not-found`.
- Other schema violations produce `failed` / `model-output-invalid`.
- The code attaches citations using its own claim-number mapping.
- Model-provided citation text is not accepted in the schema.
- `not-a-claim` entries are validated but omitted from findings.

If the rendered block contains zero claims, skip the model call and set `checkStatus: failed`, `checkReason: prompt-cap-excluded-all-claims`. Stage 1 findings remain in the report.

### Finding Merge

Persist finding types:

- `forbidden`
- `unsupported`
- `supported`

Deduplicate by:

```text
(type, location, normalized quote)
```

If the same normalized span and location have both `forbidden` and model `unsupported`, retain only `forbidden`.

Sort findings deterministically by:

1. Location in direction order.
2. Start offset in the original field.
3. Type order: `forbidden`, `unsupported`, `supported`.
4. Citation.

Internal offsets may be omitted from the report.

### Provider

Use:

1. `--check-provider`, if supplied.
2. Otherwise the repository’s default critique provider through `lib/providers/selection.js`.

Record:

```js
checkedBy: {
  provider,
  model
}
```

Set `sameProviderAsGeneration` by comparing the selected provider with the direction artifact’s `generatedProvider`:

- `true` if equal.
- `false` if both are known and unequal.
- `null` if generation provider is absent.

For `not-run`, `checkedBy` is `null`. For a provider failure after selection, record the selected provider and model when known.

### Report Artifact

Validate `directionId` against:

```regex
^[A-Za-z0-9._-]{1,80}$
```

Write:

```text
<out>/<directionId>.claims-check.json
```

Reject an existing target instead of overwriting it.

The report contains:

- `claimGrounding`
- `groundingReason`
- `checkStatus`
- `checkReason`
- Phase 1 counters
- `notesTruncated`
- `promptTruncated`
- Findings with:
  - `type`
  - `location`
  - `quote`
  - `claimNumber`
  - `citation`
  - `supportRejected`
  - `needsHumanJudgement`
- `checkedBy`
- `sameProviderAsGeneration`
- SHA-256 digest of the exact direction-file bytes
- `claimsUsed`, containing only `citation` and `digest` for every kept claim revision used by either stage
- `checkedAt`
- The complete disclaimer

Do not persist claim text, allowed wording, forbidden wording, evidence, or `claimQuote`.

Write atomically.

Write the report digest atomically to:

```text
<out>/<directionId>.claims-check.json.sha256
```

The sidecar contains the lowercase SHA-256 hexadecimal digest of the exact report bytes followed by one newline.

### Stdout

Stdout contains only:

- `claimGrounding`
- `checkStatus`
- Counts by finding type
- One line per finding containing type, location, and citation

It must not contain:

- Claim text
- Forbidden phrases
- Direction quotes
- Evidence
- Child stderr
- Model response text

The checker never edits or deletes a direction and never changes a QA score.

### Phase 2 Acceptance Criteria

- Planted unsupported statements such as “used by 10,000 teams” and “enterprise-grade security audit” produce `unsupported` findings with the model stub.
- When approved claims list those statements as forbidden wording, capitalization, punctuation, spacing, and fullwidth variants produce deterministic `forbidden` findings. The model stub returns a valid empty assertion list for this test.
- Fully supported statements yield `passed` and code-built citations.
- Invalid support quotes are downgraded with `supportRejected: true`.
- A direction quote not found at its location yields `failed`.
- Invalid JSON, unknown claim numbers, provider failures, and schema errors yield `failed` with the documented reason.
- If Stage 1 finds a violation and Stage 2 fails, the deterministic finding remains but status is `failed`.
- Empty or unavailable grounding yields `not-run` and the report states: `NOT CHECKED: no approved claims were available.`
- Exit codes match the table with and without `--fail-on-unsupported`.
- A second report with the same `directionId` is rejected rather than overwritten.
- A changed direction file changes the recorded digest.
- The report’s digest sidecar verifies against its exact bytes.
- Stdout contains none of the planted marker strings used in claim text, forbidden wording, or direction quotes.
- Raw brain text appears only transiently in memory and in the model request, never in persisted artifacts.

## Phase 3 — Integration, Evaluation, and Documentation

<!-- runner:verify=node --test -->

### Run Integration

Add opt-in `--claims-check` to:

```bash
e3d-creative run
```

When enabled:

- Run the checker after QA for each QA’d direction.
- Write reports under:

```text
<out>/claims/<directionId>.claims-check.json
```

- Write matching `.sha256` sidecars.

When absent:

- Do not spawn a brain process.
- Do not make checker model calls.
- Do not create claims artifacts.
- Preserve existing exit behavior.

Because timestamps and model output can vary, unchanged-behavior tests use fixed clocks and stub providers.

### Evaluation Script

Add:

```text
scripts/eval-claims.js
```

Inputs include:

- A directory of briefs.
- Brain configuration.
- Output directory.
- Optional fixed seed.
- Optional `--yes`.

Experiment:

1. Run the normal engine exactly once per brief.
2. Run the checker on each resulting direction.
3. Create one planted variant per direction by appending one sentence from `test/fixtures/planted-claims.json` to the script.
4. Choose planted sentences deterministically from the fixed seed.
5. Record the exact sentence, location, source direction, and condition only in `eval-key.json`.
6. Run the checker on each planted variant.
7. Calculate planted recall:
   - Numerator: planted variants where a `forbidden` or `unsupported` finding overlaps the planted sentence at its recorded location.
   - Denominator: all planted variants successfully checked.
   - Separately report failed and not-run variants; do not count them as detected.
8. Calculate false flags on unmodified directions:
   - Number of `forbidden` plus `unsupported` findings.
   - Number of unmodified directions successfully checked.
   - Findings per successfully checked unmodified direction.
   - Separately report failed and not-run directions.
9. Produce a blind human-review sheet.

Before any model call, print:

- Number of generation calls.
- Number of QA calls.
- Number of claims-check calls.
- Provider selected for each category.

Wait for confirmation unless `--yes` is supplied.

Do not make any calls beyond the engine’s normal calls and the checker calls described here.

### Evaluation Outputs

Write `eval-sheet.csv` with columns:

```text
row_id
direction_text
human_overstated_yes_no
notes
```

Requirements:

- Include unmodified and planted rows.
- Shuffle rows using the fixed seed.
- Do not reveal condition, planted text, checker findings, providers, or citations in the sheet.
- CSV-escape all fields correctly.

Write `eval-key.json` containing:

- `row_id`
- Condition
- Source artifact
- Plant location and sentence, if applicable
- Checker status
- Checker findings
- Provider metadata
- Relevant digests

### Planted Fixture

Add `test/fixtures/planted-claims.json`.

It contains at least 10 invented or overstated product assertions. Each item includes:

- Stable fixture ID
- Sentence
- Expected claim or forbidden phrase it should trigger

### README

Add “Grounding claims from e3d-brain” covering:

- Worked note format for product `e3d-brain`.
- Three example claims.
- Creation of a claims-only, read-only brain instance.
- `ebrain ids assign`.
- The requirement that only authorized approving humans may write to the claims vault.
- Retrieval and check statuses.
- Exit codes.
- Fail-open behavior.
- The prohibition on pointing this feature at a general vault.
- The known limits.
- Advisory-only behavior and required human judgment.
- The fact that reports contain citations and digests, not raw claim text.

README example notes must pass the actual Phase 1 parser and validation.

### Engine Spec Update

Update `docs/e3d-creative-engine-spec.md` under “After This Ticket” with:

- Optional claim injection into generation and critique.
- Automatic re-check when a relied-on claim is revised or expires.
- The evaluation-driven decision on whether to add injection.

### Phase 3 Acceptance Criteria

- `node --test` passes without weakening previous tests.
- Without `--claims-check`, an end-to-end test observes the pre-change artifact set, zero brain spawns, and zero extra provider calls.
- With the flag, stub brain and providers produce one report and digest sidecar per QA’d direction.
- The evaluation script generates each base direction once.
- It creates deterministic planted variants, a seed-shuffled blind sheet, a separate key, and recall/false-flag summaries.
- Failed and not-run evaluations are reported separately rather than silently included in recall or false-flag denominators.
- README example claims pass Phase 1 validation.
- Tests verify that raw claim text is never persisted or printed.

## After This Ticket

Not in scope:

- Inject approved claims into concept or critique prompts after blind review of at least 20 paired historical briefs.
- Automatically re-check directions when a relied-on claim is revised or expires.
- Draft claim notes from other brain notes for later human approval.
- Integrate the reader with e3d-corp’s creative Opportunity step.
```

Raw Response:

```text
---STATUS---
status: revise
reason: The brain client must launch the verified MCP subcommand as `node <main> mcp`; spawning only `node <main>` does not start the specified server.
```spec
# Feature Ticket: e3d-creative — Approved-Claims Grounding from e3d-brain

## Overview

Add an optional, off-by-default way for `e3d-creative` to check generated ad directions against human-approved product claims stored in a dedicated `e3d-brain` vault. The first build is checker-only: it reads claims, compares a finished direction against them, and reports `supported`, `unsupported`, and `forbidden` statements with revision-pinned `note:<id>@<rev>` citations.

This ticket implements the verdict from debate `idea-c57ae33da447` and the subsequent spec review:

- Fetch only human-approved, unexpired claims, never raw search results.
- Use claims as a post-generation checker, not as generation input.
- Fail open with an explicit status.
- Never let recalled data approve, render, publish, change a budget, or spend.
- Treat memory as advisory, never authority.

Known limits must appear in every report:

- A model-based check is heuristic and can miss assertions.
- Verifying that a supported assertion quotes an approved claim proves only that the model cited real claim text, not that the claim logically supports the assertion.
- A human decides.

## Goals

- A claims reader that fetches approved, unexpired claims for one exact product key from a claims-only, read-only e3d-brain instance.
- Revision-pinned citations, per-claim digests, strict field and resource limits, and visible retrieval status.
- A checker that classifies factual product assertions as `supported`, `unsupported`, or `forbidden`.
- Deterministic forbidden-wording checks that do not depend on a model.
- Visible fail-open behavior when the brain is absent, unavailable, unsafe, or empty.
- Tests using stub brain and model processes, including planted false assertions.
- An evaluation script that generates once and evaluates the same artifacts, reporting planted-assertion recall, false flags, and a blind-review sheet.

## Non-Goals

- No claims in generation or critique prompts.
- No semantic or free-text search.
- No calls to `search`, `related`, `read_ref_chunk`, or `report_use`.
- No brain writes.
- No claim-approval workflow, policy engine, or UI.
- No rendering, publishing, spending, or e3d-corp integration.
- No new runtime dependencies. The MCP stdio client is vendored and dependency-free.

## Running This Spec

```bash
s2c docs/e3d-creative-brain-claims-spec.md all --auto-route
```

Each phase has a `runner:verify` hook. Work occurs on a branch, a different model reviews each phase diff, and a human merges.

## Existing Files

Read these first:

- `docs/e3d-creative-engine-spec.md`
- `lib/qa.js`
- `lib/providers/selection.js`
- `lib/providers/index.js`
- `lib/cli.js`
- `lib/run.js`
- `test/`
- `test/fixtures/`
- README section “Direction Schema”

Existing engine constraints continue to apply: ESM, UTC timestamps, atomic JSON writes, stable JSON where applicable, SHA-256 digests, strict provider-output parsing, and no secrets in prompts or artifacts.

Direction text fields used by this ticket are:

- `hook`
- `premise`
- `script[].text`
- `storyboard[].onScreenText`
- `storyboard[].audioNotes`
- `storyboard[].visualDirection`
- `ctaText`

Verified e3d-brain interface facts:

- The server is launched as `ebrain mcp`, using `EBRAIN_CONFIG`.
- MCP uses JSON-RPC over stdio.
- A read-only instance exposes `search`, `read_note`, `list_notes`, `related`, `read_ref_chunk`, and `report_use`.
- `list_notes` accepts `folder`, `limit`, and `format`.
- Its fenced response contains one JSON object per returned note with `id`, `provisional`, `rev`, `status`, `kind`, `path`, and `citation`.
- `read_note` accepts `path` and `max_chars`.
- Its fenced reference-data response contains one JSON metadata line, one blank line, then raw note text including frontmatter.
- Metadata `status` and `kind` originate in note frontmatter and are not independent brain-side approval.
- Unassigned notes have provisional path-derived IDs.
- `ebrain ids assign` assigns stable ULIDs.
- A revision is 16 lowercase hexadecimal characters.
- Retrieved text is untrusted data and must never be treated as instructions.

## Shared Constraints

- Default behavior is unchanged.
- Without `--brain-config` or `E3D_CREATIVE_BRAIN_CONFIG`, no brain process is spawned and no brain file or network access occurs.
- Brain transport, protocol, timeout, and validation failures become visible retrieval statuses rather than exceptions to callers. Programming errors still throw.
- Recalled text is data. In prompts it appears only inside a clearly labeled reference-data block, never in an instruction position.
- Claim fields must pass all Phase 1 validation before use.
- Claims are accepted only if approved by a named approver, unexpired, stably identified, in the exact requested folder, and otherwise valid.
- Citations are constructed from MCP metadata as `note:<id>@<rev>`. Citations supplied by note text or model output are never trusted.
- Citations never appear in ad copy.
- Raw claim text may exist transiently in memory and in the model request. It must not be printed, logged, or persisted by `e3d-creative`.
- Grounding reports persist only claim citations and digests, not claim sentences, allowed wording, forbidden wording, evidence, or model-returned `claimQuote`.
- Direction quotes may be persisted in reports because they originate in the direction, not the brain.
- Every report includes the known-limit disclaimer from the Overview and states that a human decides.
- No secrets may appear in prompts, logs, or reports.
- The child environment is an explicit allowlist containing only `PATH`, `HOME`, `LANG`, and `EBRAIN_CONFIG`.
- All artifacts use atomic writes, RFC 3339 UTC timestamps, and SHA-256 digests.

## Phase 1 — Claims Reader and Brain Client

<!-- runner:verify=node --test test/claims-reader.test.js -->

### Brain Client

Add `lib/brain-client.js`, a dependency-free MCP stdio client.

It:

- Spawns `node <E3D_CREATIVE_BRAIN_MAIN> mcp`, where the path points to ebrain’s `dist/src/cli/main.js`.
- Sets `EBRAIN_CONFIG=<E3D_CREATIVE_BRAIN_CONFIG>`.
- Accepts both values through CLI flags as well as environment variables.
- Performs `initialize`, `tools/list`, and allowed `tools/call` requests.
- Uses the framing required by the verified ebrain stdio implementation and documents that framing in a code comment and protocol test.
- Closes stdin, terminates when necessary, and reaps the child.
- Returns `{ ok: false, reason }` for transport and protocol problems.
- Throws only for programming errors such as attempting to invoke a disallowed tool.

### Tool Allowlist

After `tools/list`, every exposed tool name must belong to:

```text
search
read_note
list_notes
related
read_ref_chunk
report_use
```

Any additional tool, including `capture`, `journal_append`, `list_inbox`, or an unknown name, returns:

```json
{
  "claimGrounding": "unavailable",
  "reason": "brain-not-read-only"
}
```

Both `list_notes` and `read_note` must be present. If either is absent, return `unavailable` / `required-tool-missing`.

The client may invoke only `list_notes` and `read_note`. Attempting to invoke another tool is a programming error and throws.

### Resource Limits

Use named, exported constants and test them:

- Request at most 51 note summaries from `list_notes`.
- Treat the 51st returned entry only as an overflow sentinel.
- Read at most the first 50 entries, ordered by path.
- Set `notesTruncated: true` when a 51st entry is returned; otherwise `false`.
- Do not claim an exact count of undisclosed notes because `list_notes` exposes neither pagination nor a total.
- Use `read_note.max_chars = 4000`.
- Abort on a logical JSON-RPC message larger than 256 KB.
- Capture at most 4 KB of child stderr.
- Never log stderr together with request or response payloads.
- Timeout each call after 10 seconds.
- Timeout the entire fetch after 30 seconds.
- On timeout or abort, send SIGTERM, then SIGKILL after one second if necessary, and reap the child.

### Claims Reader

Add `lib/claims.js` exporting:

```js
fetchApprovedClaims({ product, now, brainOptions })
```

#### Product Key

Canonicalize `product` by:

1. NFKC normalization.
2. Lowercasing using locale-independent JavaScript `toLowerCase()`.
3. Replacing each run outside ASCII `a-z0-9` with `-`.
4. Removing leading and trailing `-`.

An empty result returns `unavailable` / `invalid-product`.

The requested folder is:

```text
claims/<slug>/
```

#### Path Scoping

A returned path must match exactly one direct Markdown child:

```text
claims/<slug>/<name>.md
```

Requirements:

- `<name>` is non-empty.
- No nested folders.
- No `.` or `..` path segments.
- No absolute paths.
- Both `/` and `\` are treated as separators for validation.
- The path must begin with the exact canonical product folder.

Reject other paths as `out-of-folder`.

#### Identity

MCP metadata is authoritative.

- `id` must match a 26-character Crockford-base32 ULID.
- `provisional` must be exactly `false`.
- `rev` must match `^[0-9a-f]{16}$`.
- The citation is constructed as `note:<id>@<rev>`.
- A metadata `citation` that disagrees is `malformed`.
- The `list_notes` entry and `read_note` metadata must agree on `path`, `id`, `rev`, `provisional`, `status`, and `kind`.
- Missing or invalid stable identity is `no-stable-id`.
- Other metadata disagreement is `malformed`.

#### Frontmatter Parser

Implement a built-in parser for this limited YAML subset:

- Plain and quoted scalar strings.
- Flow lists such as `[a, b]`.
- Dash lists.
- No anchors, aliases, tags, multiline scalars, objects, or nested mappings.
- No evaluation or dynamic code.

Parsed mappings use `Object.create(null)`.

The following make a note `malformed`:

- Duplicate keys.
- Keys named `__proto__`, `constructor`, or `prototype`.
- Unsupported YAML syntax.
- Unterminated frontmatter.

#### Required Fields

A valid note contains:

- `kind: product-claim`
- `product` whose canonical slug equals the requested slug
- `status: approved`
- Non-empty `approved_by`
- `approved_on` as a real `YYYY-MM-DD` calendar date not later than the UTC calendar date containing `now`
- `expires` as a real `YYYY-MM-DD` calendar date
- `evidence`, a list of at most 10 strings, each at most 200 Unicode code points
- `allowed_wording`, a string of at most 500 Unicode code points
- `forbidden_wording`, a list of at most 10 non-empty strings, each at most 100 Unicode code points
- A non-empty claim sentence of at most 500 Unicode code points following a body line exactly equal to `Claim:`

The claim sentence is the first non-empty body line after `Claim:`. A second `Claim:` marker or additional non-empty claim-body paragraph makes the note malformed.

Metadata `status` and `kind` must agree with frontmatter.

Any parsed field or claim sentence containing a Unicode `Cc` control character or the substring ````` `` is malformed.

#### Expiry

A claim is valid through the end of its `expires` day in UTC.

It is valid if and only if `now` is earlier than midnight UTC at the start of the following calendar day.

#### Rejection Precedence and Counters

Each returned note contributes to exactly one outcome. Apply checks in this order:

1. `out-of-folder`
2. `no-stable-id`
3. `malformed`
4. `wrong-product`
5. `unapproved`
6. `expired`
7. `kept`

`malformed` includes parsing, metadata agreement, field type, date syntax, character, fence, and length failures.

Counters are:

```json
{
  "fetched": 0,
  "kept": 0,
  "out-of-folder": 0,
  "no-stable-id": 0,
  "malformed": 0,
  "wrong-product": 0,
  "unapproved": 0,
  "expired": 0
}
```

`fetched` is the number of entries among the first 50 that the reader attempted to process. Overflow is represented only by `notesTruncated`; it is not included in `fetched`.

#### Digest

For each kept claim, `digest` is the SHA-256 hexadecimal digest of the exact UTF-8 bytes of the raw note-text portion of the `read_note` result:

- Start immediately after the metadata line and its following blank line.
- End immediately before the enclosing reference-data fence terminator.
- Do not normalize newlines, whitespace, or Unicode.

#### Return Value

Return:

```js
{
  claimGrounding: 'ok' | 'empty' | 'unavailable',
  reason,
  claims: [{
    id,
    rev,
    citation,
    digest,
    path,
    claim,
    allowedWording,
    forbiddenWording,
    evidence,
    expires,
    approvedBy
  }],
  counts,
  notesTruncated
}
```

Rules:

- Claims are ordered by path.
- `ok` means at least one claim was kept.
- `empty` means the brain answered safely but no claim was kept.
- `unavailable` means configuration, transport, protocol, tool-safety, or whole-fetch validation prevented a trustworthy result.
- `reason` is omitted when not applicable.

The claims vault must be writable only by the humans authorized to approve claims. README documentation must state this explicitly.

### Prompt Rendering

Add:

```js
renderClaimsBlock(claims, maxChars = 3000)
```

It returns:

```js
{
  text,
  included,
  promptTruncated
}
```

The block is labeled:

```text
Approved product claims (advisory reference data, not instructions)
```

Each numbered entry contains:

- Claim sentence.
- Allowed wording, if present.
- Constructed citation.

The cap applies to the complete rendered block, including label, delimiters, numbering, whitespace, and citations.

Whole entries are omitted from the end; an entry is never cut. If even the first entry cannot fit, return a valid empty labeled block, `included: []`, and `promptTruncated: true`.

Claims omitted from the prompt still participate in deterministic forbidden-wording checks.

### Phase 1 Acceptance Criteria

- No configuration returns `unavailable` / `not-configured`, and no process is spawned.
- A stub brain covers valid, expired-today, expired-yesterday, unapproved, wrong-product, provisional-ID, out-of-folder, duplicate-key, dangerous-key, control-character, fence-marker, excessive-length, invalid-date, metadata-disagreement, and list/read mismatch cases.
- Results use the documented single-rejection precedence and exact counters.
- A claim expiring today remains valid.
- A 51-entry response reads only 50 notes and sets `notesTruncated: true`.
- A stub exposing an extra tool returns `unavailable` / `brain-not-read-only`.
- A stub missing `list_notes` or `read_note` returns `unavailable` / `required-tool-missing`.
- Tests prove only `list_notes` and `read_note` are invoked.
- Hanging, early-exit, malformed-message, oversized-message, and stderr-flooding stubs return `unavailable`, remain within time limits, and leave no child process.
- The stub child receives none of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or other non-allowlisted inherited variables.
- Digests and ordering are deterministic.
- Prompt limits include the entire rendered block.
- No raw claim text is logged or persisted.

## Phase 2 — Claim Checker

<!-- runner:verify=node --test test/claims-check.test.js -->

### API and Command

Add `lib/claims-check.js` exporting:

```js
checkClaims({ direction, claimsResult, provider })
```

Add:

```bash
e3d-creative claims-check <direction.json> \
  --brief <brief.json> \
  --out <dir> \
  [--check-provider <name>] \
  [--brain-config <path>] \
  [--brain-main <path>] \
  [--fail-on-unsupported]
```

The exact product comes from `brief.product`.

### Status Fields

Reports contain two independent status fields.

`claimGrounding`:

- `ok`
- `empty`
- `unavailable`

`checkStatus`:

- `not-run`: grounding was not `ok`, so no comparison was performed.
- `passed`: both stages completed and there are no `unsupported` or `forbidden` findings.
- `findings`: both stages completed and at least one `unsupported` or `forbidden` finding exists.
- `failed`: the model call failed or its output was invalid.

A `failed` or `not-run` result must never read as a pass.

If Stage 1 found forbidden wording but Stage 2 fails, retain the deterministic findings for human review but set `checkStatus: failed`.

### Exit Codes

Default:

- `0` for any completed command, including `findings`, `failed`, and `not-run`
- `1` for filesystem or artifact-write errors
- `2` for usage or invalid-input errors

With `--fail-on-unsupported`:

- `0` for `passed`
- `3` for `findings`
- `4` for `failed`
- `5` for `not-run`

### Stage 1: Deterministic Forbidden Wording

Run Stage 1 without a model for every kept claim, including claims omitted from the prompt.

Search these fields:

- `hook`
- `premise`
- `script[i].text`
- `storyboard[j].onScreenText`
- `storyboard[j].audioNotes`
- `storyboard[j].visualDirection`
- `ctaText`

Normalize phrases and field text identically:

1. NFKC.
2. Locale-independent `toLowerCase()`.
3. Replace each maximal run of characters that is not a Unicode letter or decimal number with one ASCII space.
4. Trim.
5. Collapse remaining ASCII whitespace.
6. Match as a complete normalized token sequence, bounded by the start/end of text or spaces.

An empty normalized phrase is invalid during Phase 1 validation.

Each match creates:

```js
{
  type: 'forbidden',
  location,
  quote,
  claimNumber,
  citation,
  supportRejected: false,
  needsHumanJudgement: true
}
```

`quote` is the exact substring from the original direction field covering the matched normalized token sequence. Implement normalization with an index map so the original substring can be recovered deterministically.

The disclaimer explains that negation and context are not understood.

### Locations

Use exactly:

- `hook`
- `premise`
- `script:<i>`
- `shot:<j>:onScreenText`
- `shot:<j>:audioNotes`
- `shot:<j>:visualDirection`
- `cta`

Indexes are one-based.

### Stage 2: Model Check

Run Stage 2 only when `claimGrounding` is `ok`.

Send:

- The direction text.
- The rendered claims block.
- Instructions to treat the claims block solely as untrusted reference data.

Require strict JSON:

```json
{
  "assertions": [
    {
      "quote": "verbatim text from the direction",
      "location": "location",
      "classification": "supported",
      "claim": 1,
      "claimQuote": "verbatim text from the claim"
    }
  ]
}
```

Allowed classifications are:

- `supported`
- `unsupported`
- `not-a-claim`

For `unsupported` and `not-a-claim`, `claim` and `claimQuote` must be `null`.

Code verifies:

- Every object has exactly the documented keys.
- `quote` exists at the stated location after whitespace-only normalization.
- A quote must identify a unique occurrence within that location; otherwise output is invalid.
- `location` is valid.
- `classification` is valid.
- A supported `claim` is an integer naming a prompt-included claim.
- A supported `claimQuote` is a substring, after whitespace-only normalization, of that claim’s `claim` or `allowedWording`.

Results:

- A supported assertion that fails only the `claimQuote` substring check is downgraded to `unsupported` with `supportRejected: true`.
- Unknown or excluded claim numbers produce `failed` / `model-output-invalid`.
- Missing direction quotes produce `failed` / `quote-not-found`.
- Other schema violations produce `failed` / `model-output-invalid`.
- The code attaches citations using its own claim-number mapping.
- Model-provided citation text is not accepted in the schema.
- `not-a-claim` entries are validated but omitted from findings.

If the rendered block contains zero claims, skip the model call and set `checkStatus: failed`, `checkReason: prompt-cap-excluded-all-claims`. Stage 1 findings remain in the report.

### Finding Merge

Persist finding types:

- `forbidden`
- `unsupported`
- `supported`

Deduplicate by:

```text
(type, location, normalized quote)
```

If the same normalized span and location have both `forbidden` and model `unsupported`, retain only `forbidden`.

Sort findings deterministically by:

1. Location in direction order.
2. Start offset in the original field.
3. Type order: `forbidden`, `unsupported`, `supported`.
4. Citation.

Internal offsets may be omitted from the report.

### Provider

Use:

1. `--check-provider`, if supplied.
2. Otherwise the repository’s default critique provider through `lib/providers/selection.js`.

Record:

```js
checkedBy: {
  provider,
  model
}
```

Set `sameProviderAsGeneration` by comparing the selected provider with the direction artifact’s `generatedProvider`:

- `true` if equal.
- `false` if both are known and unequal.
- `null` if generation provider is absent.

For `not-run`, `checkedBy` is `null`. For a provider failure after selection, record the selected provider and model when known.

### Report Artifact

Validate `directionId` against:

```regex
^[A-Za-z0-9._-]{1,80}$
```

Write:

```text
<out>/<directionId>.claims-check.json
```

Reject an existing target instead of overwriting it.

The report contains:

- `claimGrounding`
- `groundingReason`
- `checkStatus`
- `checkReason`
- Phase 1 counters
- `notesTruncated`
- `promptTruncated`
- Findings with:
  - `type`
  - `location`
  - `quote`
  - `claimNumber`
  - `citation`
  - `supportRejected`
  - `needsHumanJudgement`
- `checkedBy`
- `sameProviderAsGeneration`
- SHA-256 digest of the exact direction-file bytes
- `claimsUsed`, containing only `citation` and `digest` for every kept claim revision used by either stage
- `checkedAt`
- The complete disclaimer

Do not persist claim text, allowed wording, forbidden wording, evidence, or `claimQuote`.

Write atomically.

Write the report digest atomically to:

```text
<out>/<directionId>.claims-check.json.sha256
```

The sidecar contains the lowercase SHA-256 hexadecimal digest of the exact report bytes followed by one newline.

### Stdout

Stdout contains only:

- `claimGrounding`
- `checkStatus`
- Counts by finding type
- One line per finding containing type, location, and citation

It must not contain:

- Claim text
- Forbidden phrases
- Direction quotes
- Evidence
- Child stderr
- Model response text

The checker never edits or deletes a direction and never changes a QA score.

### Phase 2 Acceptance Criteria

- Planted unsupported statements such as “used by 10,000 teams” and “enterprise-grade security audit” produce `unsupported` findings with the model stub.
- When approved claims list those statements as forbidden wording, capitalization, punctuation, spacing, and fullwidth variants produce deterministic `forbidden` findings. The model stub returns a valid empty assertion list for this test.
- Fully supported statements yield `passed` and code-built citations.
- Invalid support quotes are downgraded with `supportRejected: true`.
- A direction quote not found at its location yields `failed`.
- Invalid JSON, unknown claim numbers, provider failures, and schema errors yield `failed` with the documented reason.
- If Stage 1 finds a violation and Stage 2 fails, the deterministic finding remains but status is `failed`.
- Empty or unavailable grounding yields `not-run` and the report states: `NOT CHECKED: no approved claims were available.`
- Exit codes match the table with and without `--fail-on-unsupported`.
- A second report with the same `directionId` is rejected rather than overwritten.
- A changed direction file changes the recorded digest.
- The report’s digest sidecar verifies against its exact bytes.
- Stdout contains none of the planted marker strings used in claim text, forbidden wording, or direction quotes.
- Raw brain text appears only transiently in memory and in the model request, never in persisted artifacts.

## Phase 3 — Integration, Evaluation, and Documentation

<!-- runner:verify=node --test -->

### Run Integration

Add opt-in `--claims-check` to:

```bash
e3d-creative run
```

When enabled:

- Run the checker after QA for each QA’d direction.
- Write reports under:

```text
<out>/claims/<directionId>.claims-check.json
```

- Write matching `.sha256` sidecars.

When absent:

- Do not spawn a brain process.
- Do not make checker model calls.
- Do not create claims artifacts.
- Preserve existing exit behavior.

Because timestamps and model output can vary, unchanged-behavior tests use fixed clocks and stub providers.

### Evaluation Script

Add:

```text
scripts/eval-claims.js
```

Inputs include:

- A directory of briefs.
- Brain configuration.
- Output directory.
- Optional fixed seed.
- Optional `--yes`.

Experiment:

1. Run the normal engine exactly once per brief.
2. Run the checker on each resulting direction.
3. Create one planted variant per direction by appending one sentence from `test/fixtures/planted-claims.json` to the script.
4. Choose planted sentences deterministically from the fixed seed.
5. Record the exact sentence, location, source direction, and condition only in `eval-key.json`.
6. Run the checker on each planted variant.
7. Calculate planted recall:
   - Numerator: planted variants where a `forbidden` or `unsupported` finding overlaps the planted sentence at its recorded location.
   - Denominator: all planted variants successfully checked.
   - Separately report failed and not-run variants; do not count them as detected.
8. Calculate false flags on unmodified directions:
   - Number of `forbidden` plus `unsupported` findings.
   - Number of unmodified directions successfully checked.
   - Findings per successfully checked unmodified direction.
   - Separately report failed and not-run directions.
9. Produce a blind human-review sheet.

Before any model call, print:

- Number of generation calls.
- Number of QA calls.
- Number of claims-check calls.
- Provider selected for each category.

Wait for confirmation unless `--yes` is supplied.

Do not make any calls beyond the engine’s normal calls and the checker calls described here.

### Evaluation Outputs

Write `eval-sheet.csv` with columns:

```text
row_id
direction_text
human_overstated_yes_no
notes
```

Requirements:

- Include unmodified and planted rows.
- Shuffle rows using the fixed seed.
- Do not reveal condition, planted text, checker findings, providers, or citations in the sheet.
- CSV-escape all fields correctly.

Write `eval-key.json` containing:

- `row_id`
- Condition
- Source artifact
- Plant location and sentence, if applicable
- Checker status
- Checker findings
- Provider metadata
- Relevant digests

### Planted Fixture

Add `test/fixtures/planted-claims.json`.

It contains at least 10 invented or overstated product assertions. Each item includes:

- Stable fixture ID
- Sentence
- Expected claim or forbidden phrase it should trigger

### README

Add “Grounding claims from e3d-brain” covering:

- Worked note format for product `e3d-brain`.
- Three example claims.
- Creation of a claims-only, read-only brain instance.
- `ebrain ids assign`.
- The requirement that only authorized approving humans may write to the claims vault.
- Retrieval and check statuses.
- Exit codes.
- Fail-open behavior.
- The prohibition on pointing this feature at a general vault.
- The known limits.
- Advisory-only behavior and required human judgment.
- The fact that reports contain citations and digests, not raw claim text.

README example notes must pass the actual Phase 1 parser and validation.

### Engine Spec Update

Update `docs/e3d-creative-engine-spec.md` under “After This Ticket” with:

- Optional claim injection into generation and critique.
- Automatic re-check when a relied-on claim is revised or expires.
- The evaluation-driven decision on whether to add injection.

### Phase 3 Acceptance Criteria

- `node --test` passes without weakening previous tests.
- Without `--claims-check`, an end-to-end test observes the pre-change artifact set, zero brain spawns, and zero extra provider calls.
- With the flag, stub brain and providers produce one report and digest sidecar per QA’d direction.
- The evaluation script generates each base direction once.
- It creates deterministic planted variants, a seed-shuffled blind sheet, a separate key, and recall/false-flag summaries.
- Failed and not-run evaluations are reported separately rather than silently included in recall or false-flag denominators.
- README example claims pass Phase 1 validation.
- Tests verify that raw claim text is never persisted or printed.

## After This Ticket

Not in scope:

- Inject approved claims into concept or critique prompts after blind review of at least 20 paired historical briefs.
- Automatically re-check directions when a relied-on claim is revised or expires.
- Draft claim notes from other brain notes for later human approval.
- Integrate the reader with e3d-corp’s creative Opportunity step.
```
```

Round Result: not converged

At least one reviewer requested revision in round 2.

## Final Outcome

Needs human review after 2 rounds; spec-draft.md left in place.
## Round 1

### Draft Before Round

```text
# Feature Ticket: e3d-creative — Approved-Claims Grounding from e3d-brain

## Overview

Add an optional, off-by-default way for `e3d-creative` to check generated ad directions against human-approved product claims stored in a dedicated `e3d-brain` vault. The first build is checker-only: it reads claims, compares a finished direction against them, and reports `supported`, `unsupported`, and `forbidden` statements with revision-pinned `note:<id>@<rev>` citations.

This ticket implements the verdict from debate `idea-c57ae33da447` and the subsequent spec review:

- Fetch only human-approved, unexpired claims, never raw search results.
- Use claims as a post-generation checker, not as generation input.
- Fail open with an explicit status.
- Never let recalled data approve, render, publish, change a budget, or spend.
- Treat memory as advisory, never authority.

Known limits must appear in every report:

- A model-based check is heuristic and can miss assertions.
- Verifying that a supported assertion quotes an approved claim proves only that the model cited real claim text, not that the claim logically supports the assertion.
- A human decides.

## Goals

- A claims reader that fetches approved, unexpired claims for one exact product key from a claims-only, read-only e3d-brain instance.
- Revision-pinned citations, per-claim digests, strict field and resource limits, and visible retrieval status.
- A checker that classifies factual product assertions as `supported`, `unsupported`, or `forbidden`.
- Deterministic forbidden-wording checks that do not depend on a model.
- Visible fail-open behavior when the brain is absent, unavailable, unsafe, or empty.
- Tests using stub brain and model processes, including planted false assertions.
- An evaluation script that generates once and evaluates the same artifacts, reporting planted-assertion recall, false flags, and a blind-review sheet.

## Non-Goals

- No claims in generation or critique prompts.
- No semantic or free-text search.
- No calls to `search`, `related`, `read_ref_chunk`, or `report_use`.
- No brain writes.
- No claim-approval workflow, policy engine, or UI.
- No rendering, publishing, spending, or e3d-corp integration.
- No new runtime dependencies. The MCP stdio client is vendored and dependency-free.

## Running This Spec

```bash
s2c docs/e3d-creative-brain-claims-spec.md all --auto-route
```

Each phase has a `runner:verify` hook. Work occurs on a branch, a different model reviews each phase diff, and a human merges.

## Existing Files

Read these first:

- `docs/e3d-creative-engine-spec.md`
- `lib/qa.js`
- `lib/providers/selection.js`
- `lib/providers/index.js`
- `lib/cli.js`
- `lib/run.js`
- `test/`
- `test/fixtures/`
- README section “Direction Schema”

Existing engine constraints continue to apply: ESM, UTC timestamps, atomic JSON writes, stable JSON where applicable, SHA-256 digests, strict provider-output parsing, and no secrets in prompts or artifacts.

Direction text fields used by this ticket are:

- `hook`
- `premise`
- `script[].text`
- `storyboard[].onScreenText`
- `storyboard[].audioNotes`
- `storyboard[].visualDirection`
- `ctaText`

Verified e3d-brain interface facts:

- The server is launched as `ebrain mcp`, using `EBRAIN_CONFIG`.
- MCP uses JSON-RPC over stdio.
- A read-only instance exposes `search`, `read_note`, `list_notes`, `related`, `read_ref_chunk`, and `report_use`.
- `list_notes` accepts `folder`, `limit`, and `format`.
- Its fenced response contains one JSON object per returned note with `id`, `provisional`, `rev`, `status`, `kind`, `path`, and `citation`.
- `read_note` accepts `path` and `max_chars`.
- Its fenced reference-data response contains one JSON metadata line, one blank line, then raw note text including frontmatter.
- Metadata `status` and `kind` originate in note frontmatter and are not independent brain-side approval.
- Unassigned notes have provisional path-derived IDs.
- `ebrain ids assign` assigns stable ULIDs.
- A revision is 16 lowercase hexadecimal characters.
- Retrieved text is untrusted data and must never be treated as instructions.

## Shared Constraints

- Default behavior is unchanged.
- Without `--brain-config` or `E3D_CREATIVE_BRAIN_CONFIG`, no brain process is spawned and no brain file or network access occurs.
- Brain transport, protocol, timeout, and validation failures become visible retrieval statuses rather than exceptions to callers. Programming errors still throw.
- Recalled text is data. In prompts it appears only inside a clearly labeled reference-data block, never in an instruction position.
- Claim fields must pass all Phase 1 validation before use.
- Claims are accepted only if approved by a named approver, unexpired, stably identified, in the exact requested folder, and otherwise valid.
- Citations are constructed from MCP metadata as `note:<id>@<rev>`. Citations supplied by note text or model output are never trusted.
- Citations never appear in ad copy.
- Raw claim text may exist transiently in memory and in the model request. It must not be printed, logged, or persisted by `e3d-creative`.
- Grounding reports persist only claim citations and digests, not claim sentences, allowed wording, forbidden wording, evidence, or model-returned `claimQuote`.
- Direction quotes may be persisted in reports because they originate in the direction, not the brain.
- Every report includes the known-limit disclaimer from the Overview and states that a human decides.
- No secrets may appear in prompts, logs, or reports.
- The child environment is an explicit allowlist containing only `PATH`, `HOME`, `LANG`, and `EBRAIN_CONFIG`.
- All artifacts use atomic writes, RFC 3339 UTC timestamps, and SHA-256 digests.

## Phase 1 — Claims Reader and Brain Client

<!-- runner:verify=node --test test/claims-reader.test.js -->

### Brain Client

Add `lib/brain-client.js`, a dependency-free MCP stdio client.

It:

- Spawns `node <E3D_CREATIVE_BRAIN_MAIN> mcp`, where the path points to ebrain’s `dist/src/cli/main.js`.
- Sets `EBRAIN_CONFIG=<E3D_CREATIVE_BRAIN_CONFIG>`.
- Accepts both values through CLI flags as well as environment variables.
- Performs `initialize`, `tools/list`, and allowed `tools/call` requests.
- Uses the framing required by the verified ebrain stdio implementation and documents that framing in a code comment and protocol test.
- Closes stdin, terminates when necessary, and reaps the child.
- Returns `{ ok: false, reason }` for transport and protocol problems.
- Throws only for programming errors such as attempting to invoke a disallowed tool.

### Tool Allowlist

After `tools/list`, every exposed tool name must belong to:

```text
search
read_note
list_notes
related
read_ref_chunk
report_use
```

Any additional tool, including `capture`, `journal_append`, `list_inbox`, or an unknown name, returns:

```json
{
  "claimGrounding": "unavailable",
  "reason": "brain-not-read-only"
}
```

Both `list_notes` and `read_note` must be present. If either is absent, return `unavailable` / `required-tool-missing`.

The client may invoke only `list_notes` and `read_note`. Attempting to invoke another tool is a programming error and throws.

### Resource Limits

Use named, exported constants and test them:

- Request at most 51 note summaries from `list_notes`.
- Treat the 51st returned entry only as an overflow sentinel.
- Read at most the first 50 entries, ordered by path.
- Set `notesTruncated: true` when a 51st entry is returned; otherwise `false`.
- Do not claim an exact count of undisclosed notes because `list_notes` exposes neither pagination nor a total.
- Use `read_note.max_chars = 4000`.
- Abort on a logical JSON-RPC message larger than 256 KB.
- Capture at most 4 KB of child stderr.
- Never log stderr together with request or response payloads.
- Timeout each call after 10 seconds.
- Timeout the entire fetch after 30 seconds.
- On timeout or abort, send SIGTERM, then SIGKILL after one second if necessary, and reap the child.

### Claims Reader

Add `lib/claims.js` exporting:

```js
fetchApprovedClaims({ product, now, brainOptions })
```

#### Product Key

Canonicalize `product` by:

1. NFKC normalization.
2. Lowercasing using locale-independent JavaScript `toLowerCase()`.
3. Replacing each run outside ASCII `a-z0-9` with `-`.
4. Removing leading and trailing `-`.

An empty result returns `unavailable` / `invalid-product`.

The requested folder is:

```text
claims/<slug>/
```

#### Path Scoping

A returned path must match exactly one direct Markdown child:

```text
claims/<slug>/<name>.md
```

Requirements:

- `<name>` is non-empty.
- No nested folders.
- No `.` or `..` path segments.
- No absolute paths.
- Both `/` and `\` are treated as separators for validation.
- The path must begin with the exact canonical product folder.

Reject other paths as `out-of-folder`.

#### Identity

MCP metadata is authoritative.

- `id` must match a 26-character Crockford-base32 ULID.
- `provisional` must be exactly `false`.
- `rev` must match `^[0-9a-f]{16}$`.
- The citation is constructed as `note:<id>@<rev>`.
- A metadata `citation` that disagrees is `malformed`.
- The `list_notes` entry and `read_note` metadata must agree on `path`, `id`, `rev`, `provisional`, `status`, and `kind`.
- Missing or invalid stable identity is `no-stable-id`.
- Other metadata disagreement is `malformed`.

#### Frontmatter Parser

Implement a built-in parser for this limited YAML subset:

- Plain and quoted scalar strings.
- Flow lists such as `[a, b]`.
- Dash lists.
- No anchors, aliases, tags, multiline scalars, objects, or nested mappings.
- No evaluation or dynamic code.

Parsed mappings use `Object.create(null)`.

The following make a note `malformed`:

- Duplicate keys.
- Keys named `__proto__`, `constructor`, or `prototype`.
- Unsupported YAML syntax.
- Unterminated frontmatter.

#### Required Fields

A valid note contains:

- `kind: product-claim`
- `product` whose canonical slug equals the requested slug
- `status: approved`
- Non-empty `approved_by`
- `approved_on` as a real `YYYY-MM-DD` calendar date not later than the UTC calendar date containing `now`
- `expires` as a real `YYYY-MM-DD` calendar date
- `evidence`, a list of at most 10 strings, each at most 200 Unicode code points
- `allowed_wording`, a string of at most 500 Unicode code points
- `forbidden_wording`, a list of at most 10 non-empty strings, each at most 100 Unicode code points
- A non-empty claim sentence of at most 500 Unicode code points following a body line exactly equal to `Claim:`

The claim sentence is the first non-empty body line after `Claim:`. A second `Claim:` marker or additional non-empty claim-body paragraph makes the note malformed.

Metadata `status` and `kind` must agree with frontmatter.

Any parsed field or claim sentence containing a Unicode `Cc` control character or the substring ````` `` is malformed.

#### Expiry

A claim is valid through the end of its `expires` day in UTC.

It is valid if and only if `now` is earlier than midnight UTC at the start of the following calendar day.

#### Rejection Precedence and Counters

Each returned note contributes to exactly one outcome. Apply checks in this order:

1. `out-of-folder`
2. `no-stable-id`
3. `malformed`
4. `wrong-product`
5. `unapproved`
6. `expired`
7. `kept`

`malformed` includes parsing, metadata agreement, field type, date syntax, character, fence, and length failures.

Counters are:

```json
{
  "fetched": 0,
  "kept": 0,
  "out-of-folder": 0,
  "no-stable-id": 0,
  "malformed": 0,
  "wrong-product": 0,
  "unapproved": 0,
  "expired": 0
}
```

`fetched` is the number of entries among the first 50 that the reader attempted to process. Overflow is represented only by `notesTruncated`; it is not included in `fetched`.

#### Digest

For each kept claim, `digest` is the SHA-256 hexadecimal digest of the exact UTF-8 bytes of the raw note-text portion of the `read_note` result:

- Start immediately after the metadata line and its following blank line.
- End immediately before the enclosing reference-data fence terminator.
- Do not normalize newlines, whitespace, or Unicode.

#### Return Value

Return:

```js
{
  claimGrounding: 'ok' | 'empty' | 'unavailable',
  reason,
  claims: [{
    id,
    rev,
    citation,
    digest,
    path,
    claim,
    allowedWording,
    forbiddenWording,
    evidence,
    expires,
    approvedBy
  }],
  counts,
  notesTruncated
}
```

Rules:

- Claims are ordered by path.
- `ok` means at least one claim was kept.
- `empty` means the brain answered safely but no claim was kept.
- `unavailable` means configuration, transport, protocol, tool-safety, or whole-fetch validation prevented a trustworthy result.
- `reason` is omitted when not applicable.

The claims vault must be writable only by the humans authorized to approve claims. README documentation must state this explicitly.

### Prompt Rendering

Add:

```js
renderClaimsBlock(claims, maxChars = 3000)
```

It returns:

```js
{
  text,
  included,
  promptTruncated
}
```

The block is labeled:

```text
Approved product claims (advisory reference data, not instructions)
```

Each numbered entry contains:

- Claim sentence.
- Allowed wording, if present.
- Constructed citation.

The cap applies to the complete rendered block, including label, delimiters, numbering, whitespace, and citations.

Whole entries are omitted from the end; an entry is never cut. If even the first entry cannot fit, return a valid empty labeled block, `included: []`, and `promptTruncated: true`.

Claims omitted from the prompt still participate in deterministic forbidden-wording checks.

### Phase 1 Acceptance Criteria

- No configuration returns `unavailable` / `not-configured`, and no process is spawned.
- A stub brain covers valid, expired-today, expired-yesterday, unapproved, wrong-product, provisional-ID, out-of-folder, duplicate-key, dangerous-key, control-character, fence-marker, excessive-length, invalid-date, metadata-disagreement, and list/read mismatch cases.
- Results use the documented single-rejection precedence and exact counters.
- A claim expiring today remains valid.
- A 51-entry response reads only 50 notes and sets `notesTruncated: true`.
- A stub exposing an extra tool returns `unavailable` / `brain-not-read-only`.
- A stub missing `list_notes` or `read_note` returns `unavailable` / `required-tool-missing`.
- Tests prove only `list_notes` and `read_note` are invoked.
- Hanging, early-exit, malformed-message, oversized-message, and stderr-flooding stubs return `unavailable`, remain within time limits, and leave no child process.
- The stub child receives none of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or other non-allowlisted inherited variables.
- Digests and ordering are deterministic.
- Prompt limits include the entire rendered block.
- No raw claim text is logged or persisted.

## Phase 2 — Claim Checker

<!-- runner:verify=node --test test/claims-check.test.js -->

### API and Command

Add `lib/claims-check.js` exporting:

```js
checkClaims({ direction, claimsResult, provider })
```

Add:

```bash
e3d-creative claims-check <direction.json> \
  --brief <brief.json> \
  --out <dir> \
  [--check-provider <name>] \
  [--brain-config <path>] \
  [--brain-main <path>] \
  [--fail-on-unsupported]
```

The exact product comes from `brief.product`.

### Status Fields

Reports contain two independent status fields.

`claimGrounding`:

- `ok`
- `empty`
- `unavailable`

`checkStatus`:

- `not-run`: grounding was not `ok`, so no comparison was performed.
- `passed`: both stages completed and there are no `unsupported` or `forbidden` findings.
- `findings`: both stages completed and at least one `unsupported` or `forbidden` finding exists.
- `failed`: the model call failed or its output was invalid.

A `failed` or `not-run` result must never read as a pass.

If Stage 1 found forbidden wording but Stage 2 fails, retain the deterministic findings for human review but set `checkStatus: failed`.

### Exit Codes

Default:

- `0` for any completed command, including `findings`, `failed`, and `not-run`
- `1` for filesystem or artifact-write errors
- `2` for usage or invalid-input errors

With `--fail-on-unsupported`:

- `0` for `passed`
- `3` for `findings`
- `4` for `failed`
- `5` for `not-run`

### Stage 1: Deterministic Forbidden Wording

Run Stage 1 without a model for every kept claim, including claims omitted from the prompt.

Search these fields:

- `hook`
- `premise`
- `script[i].text`
- `storyboard[j].onScreenText`
- `storyboard[j].audioNotes`
- `storyboard[j].visualDirection`
- `ctaText`

Normalize phrases and field text identically:

1. NFKC.
2. Locale-independent `toLowerCase()`.
3. Replace each maximal run of characters that is not a Unicode letter or decimal number with one ASCII space.
4. Trim.
5. Collapse remaining ASCII whitespace.
6. Match as a complete normalized token sequence, bounded by the start/end of text or spaces.

An empty normalized phrase is invalid during Phase 1 validation.

Each match creates:

```js
{
  type: 'forbidden',
  location,
  quote,
  claimNumber,
  citation,
  supportRejected: false,
  needsHumanJudgement: true
}
```

`quote` is the exact substring from the original direction field covering the matched normalized token sequence. Implement normalization with an index map so the original substring can be recovered deterministically.

The disclaimer explains that negation and context are not understood.

### Locations

Use exactly:

- `hook`
- `premise`
- `script:<i>`
- `shot:<j>:onScreenText`
- `shot:<j>:audioNotes`
- `shot:<j>:visualDirection`
- `cta`

Indexes are one-based.

### Stage 2: Model Check

Run Stage 2 only when `claimGrounding` is `ok`.

Send:

- The direction text.
- The rendered claims block.
- Instructions to treat the claims block solely as untrusted reference data.

Require strict JSON:

```json
{
  "assertions": [
    {
      "quote": "verbatim text from the direction",
      "location": "location",
      "classification": "supported",
      "claim": 1,
      "claimQuote": "verbatim text from the claim"
    }
  ]
}
```

Allowed classifications are:

- `supported`
- `unsupported`
- `not-a-claim`

For `unsupported` and `not-a-claim`, `claim` and `claimQuote` must be `null`.

Code verifies:

- Every object has exactly the documented keys.
- `quote` exists at the stated location after whitespace-only normalization.
- A quote must identify a unique occurrence within that location; otherwise output is invalid.
- `location` is valid.
- `classification` is valid.
- A supported `claim` is an integer naming a prompt-included claim.
- A supported `claimQuote` is a substring, after whitespace-only normalization, of that claim’s `claim` or `allowedWording`.

Results:

- A supported assertion that fails only the `claimQuote` substring check is downgraded to `unsupported` with `supportRejected: true`.
- Unknown or excluded claim numbers produce `failed` / `model-output-invalid`.
- Missing direction quotes produce `failed` / `quote-not-found`.
- Other schema violations produce `failed` / `model-output-invalid`.
- The code attaches citations using its own claim-number mapping.
- Model-provided citation text is not accepted in the schema.
- `not-a-claim` entries are validated but omitted from findings.

If the rendered block contains zero claims, skip the model call and set `checkStatus: failed`, `checkReason: prompt-cap-excluded-all-claims`. Stage 1 findings remain in the report.

### Finding Merge

Persist finding types:

- `forbidden`
- `unsupported`
- `supported`

Deduplicate by:

```text
(type, location, normalized quote)
```

If the same normalized span and location have both `forbidden` and model `unsupported`, retain only `forbidden`.

Sort findings deterministically by:

1. Location in direction order.
2. Start offset in the original field.
3. Type order: `forbidden`, `unsupported`, `supported`.
4. Citation.

Internal offsets may be omitted from the report.

### Provider

Use:

1. `--check-provider`, if supplied.
2. Otherwise the repository’s default critique provider through `lib/providers/selection.js`.

Record:

```js
checkedBy: {
  provider,
  model
}
```

Set `sameProviderAsGeneration` by comparing the selected provider with the direction artifact’s `generatedProvider`:

- `true` if equal.
- `false` if both are known and unequal.
- `null` if generation provider is absent.

For `not-run`, `checkedBy` is `null`. For a provider failure after selection, record the selected provider and model when known.

### Report Artifact

Validate `directionId` against:

```regex
^[A-Za-z0-9._-]{1,80}$
```

Write:

```text
<out>/<directionId>.claims-check.json
```

Reject an existing target instead of overwriting it.

The report contains:

- `claimGrounding`
- `groundingReason`
- `checkStatus`
- `checkReason`
- Phase 1 counters
- `notesTruncated`
- `promptTruncated`
- Findings with:
  - `type`
  - `location`
  - `quote`
  - `claimNumber`
  - `citation`
  - `supportRejected`
  - `needsHumanJudgement`
- `checkedBy`
- `sameProviderAsGeneration`
- SHA-256 digest of the exact direction-file bytes
- `claimsUsed`, containing only `citation` and `digest` for every kept claim revision used by either stage
- `checkedAt`
- The complete disclaimer

Do not persist claim text, allowed wording, forbidden wording, evidence, or `claimQuote`.

Write atomically.

Write the report digest atomically to:

```text
<out>/<directionId>.claims-check.json.sha256
```

The sidecar contains the lowercase SHA-256 hexadecimal digest of the exact report bytes followed by one newline.

### Stdout

Stdout contains only:

- `claimGrounding`
- `checkStatus`
- Counts by finding type
- One line per finding containing type, location, and citation

It must not contain:

- Claim text
- Forbidden phrases
- Direction quotes
- Evidence
- Child stderr
- Model response text

The checker never edits or deletes a direction and never changes a QA score.

### Phase 2 Acceptance Criteria

- Planted unsupported statements such as “used by 10,000 teams” and “enterprise-grade security audit” produce `unsupported` findings with the model stub.
- When approved claims list those statements as forbidden wording, capitalization, punctuation, spacing, and fullwidth variants produce deterministic `forbidden` findings. The model stub returns a valid empty assertion list for this test.
- Fully supported statements yield `passed` and code-built citations.
- Invalid support quotes are downgraded with `supportRejected: true`.
- A direction quote not found at its location yields `failed`.
- Invalid JSON, unknown claim numbers, provider failures, and schema errors yield `failed` with the documented reason.
- If Stage 1 finds a violation and Stage 2 fails, the deterministic finding remains but status is `failed`.
- Empty or unavailable grounding yields `not-run` and the report states: `NOT CHECKED: no approved claims were available.`
- Exit codes match the table with and without `--fail-on-unsupported`.
- A second report with the same `directionId` is rejected rather than overwritten.
- A changed direction file changes the recorded digest.
- The report’s digest sidecar verifies against its exact bytes.
- Stdout contains none of the planted marker strings used in claim text, forbidden wording, or direction quotes.
- Raw brain text appears only transiently in memory and in the model request, never in persisted artifacts.

## Phase 3 — Integration, Evaluation, and Documentation

<!-- runner:verify=node --test -->

### Run Integration

Add opt-in `--claims-check` to:

```bash
e3d-creative run
```

When enabled:

- Run the checker after QA for each QA’d direction.
- Write reports under:

```text
<out>/claims/<directionId>.claims-check.json
```

- Write matching `.sha256` sidecars.

When absent:

- Do not spawn a brain process.
- Do not make checker model calls.
- Do not create claims artifacts.
- Preserve existing exit behavior.

Because timestamps and model output can vary, unchanged-behavior tests use fixed clocks and stub providers.

### Evaluation Script

Add:

```text
scripts/eval-claims.js
```

Inputs include:

- A directory of briefs.
- Brain configuration.
- Output directory.
- Optional fixed seed.
- Optional `--yes`.

Experiment:

1. Run the normal engine exactly once per brief.
2. Run the checker on each resulting direction.
3. Create one planted variant per direction by appending one sentence from `test/fixtures/planted-claims.json` to the script.
4. Choose planted sentences deterministically from the fixed seed.
5. Record the exact sentence, location, source direction, and condition only in `eval-key.json`.
6. Run the checker on each planted variant.
7. Calculate planted recall:
   - Numerator: planted variants where a `forbidden` or `unsupported` finding overlaps the planted sentence at its recorded location.
   - Denominator: all planted variants successfully checked.
   - Separately report failed and not-run variants; do not count them as detected.
8. Calculate false flags on unmodified directions:
   - Number of `forbidden` plus `unsupported` findings.
   - Number of unmodified directions successfully checked.
   - Findings per successfully checked unmodified direction.
   - Separately report failed and not-run directions.
9. Produce a blind human-review sheet.

Before any model call, print:

- Number of generation calls.
- Number of QA calls.
- Number of claims-check calls.
- Provider selected for each category.

Wait for confirmation unless `--yes` is supplied.

Do not make any calls beyond the engine’s normal calls and the checker calls described here.

### Evaluation Outputs

Write `eval-sheet.csv` with columns:

```text
row_id
direction_text
human_overstated_yes_no
notes
```

Requirements:

- Include unmodified and planted rows.
- Shuffle rows using the fixed seed.
- Do not reveal condition, planted text, checker findings, providers, or citations in the sheet.
- CSV-escape all fields correctly.

Write `eval-key.json` containing:

- `row_id`
- Condition
- Source artifact
- Plant location and sentence, if applicable
- Checker status
- Checker findings
- Provider metadata
- Relevant digests

### Planted Fixture

Add `test/fixtures/planted-claims.json`.

It contains at least 10 invented or overstated product assertions. Each item includes:

- Stable fixture ID
- Sentence
- Expected claim or forbidden phrase it should trigger

### README

Add “Grounding claims from e3d-brain” covering:

- Worked note format for product `e3d-brain`.
- Three example claims.
- Creation of a claims-only, read-only brain instance.
- `ebrain ids assign`.
- The requirement that only authorized approving humans may write to the claims vault.
- Retrieval and check statuses.
- Exit codes.
- Fail-open behavior.
- The prohibition on pointing this feature at a general vault.
- The known limits.
- Advisory-only behavior and required human judgment.
- The fact that reports contain citations and digests, not raw claim text.

README example notes must pass the actual Phase 1 parser and validation.

### Engine Spec Update

Update `docs/e3d-creative-engine-spec.md` under “After This Ticket” with:

- Optional claim injection into generation and critique.
- Automatic re-check when a relied-on claim is revised or expires.
- The evaluation-driven decision on whether to add injection.

### Phase 3 Acceptance Criteria

- `node --test` passes without weakening previous tests.
- Without `--claims-check`, an end-to-end test observes the pre-change artifact set, zero brain spawns, and zero extra provider calls.
- With the flag, stub brain and providers produce one report and digest sidecar per QA’d direction.
- The evaluation script generates each base direction once.
- It creates deterministic planted variants, a seed-shuffled blind sheet, a separate key, and recall/false-flag summaries.
- Failed and not-run evaluations are reported separately rather than silently included in recall or false-flag denominators.
- README example claims pass Phase 1 validation.
- Tests verify that raw claim text is never persisted or printed.

## After This Ticket

Not in scope:

- Inject approved claims into concept or critique prompts after blind review of at least 20 paired historical briefs.
- Automatically re-check directions when a relied-on claim is revised or expires.
- Draft claim notes from other brain notes for later human approval.
- Integrate the reader with e3d-corp’s creative Opportunity step.

```

### Reviewer 1: claude

Status: approved

Reason: The spec is detailed, internally consistent, and testable, and its safeguards (fail-open, read-only allowlist, no claim text persisted, human decides) are well specified.

Raw Response:

```text
---STATUS---
status: approved
reason: The spec is detailed, internally consistent, and testable, and its safeguards (fail-open, read-only allowlist, no claim text persisted, human decides) are well specified.
```

### Reviewer 2: codex

Status: approved

Reason: The draft is internally consistent, implementable, security-conscious, and provides sufficiently precise validation, failure, artifact, and acceptance requirements.

Raw Response:

```text
---STATUS---
status: approved
reason: The draft is internally consistent, implementable, security-conscious, and provides sufficiently precise validation, failure, artifact, and acceptance requirements.
```

## Final Outcome

Converged in round 1.
