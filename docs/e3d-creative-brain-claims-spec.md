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

Run with e3d-code's default provider and auto-routing:

```bash
e3d-code docs/e3d-creative-brain-claims-spec.md all --auto-route
```

Each phase has a `runner:verify` hook. Build on a branch; a different model reviews each phase diff; a human merges.

## Existing Files (read first)

- `docs/e3d-creative-engine-spec.md` — shared constraints (UTC timestamps, atomic JSON writes, SHA-256 digests, no secrets in prompts, the claims guardrails) apply here unchanged.
- `lib/qa.js` — the independent QA pass this checker resembles: provider selection via `lib/providers/selection.js`, `writeJsonAtomic`, `sha256Hex`, `stableJson`, strict parsing of model output (`parseQaPayload`). QA artifacts record `generatedProvider`.
- `lib/providers/selection.js`, `lib/providers/index.js` — how a provider is chosen per phase and called with `generate`.
- `lib/cli.js` — command parsing; new commands are added here. `lib/run.js` — the end-to-end `run`.
- `test/` and `test/fixtures/` — test style (`node --test`, fixtures, stub providers).
- The direction shape (README "Direction Schema"): `directionId`, `hook`, `premise`, `audiencePsychology`, `script[]` of `{tag, text}`, `storyboard[]` of `{timecodeStart, timecodeEnd, visualDirection, audioNotes, onScreenText}`, `ctaText`, `rationale`.
- e3d-brain facts this ticket relies on (verified against running instances on 2026-10-15): the MCP server speaks JSON-RPC over stdio as newline-delimited JSON (one JSON object per line, not Content-Length framing) (`ebrain mcp`, config from `EBRAIN_CONFIG`). A read-only instance's `tools/list` returns exactly `search`, `read_note`, `list_notes`, `related`, `read_ref_chunk`, `report_use`, with no write tools (`capture` and `journal_append` appear only in inbox and journal instances). `list_notes` takes `folder`, `limit`, `format` (`compact` or `full`; any other value is rejected) and returns, inside a fenced text block, one JSON object per note with `id`, `provisional`, `rev`, `status`, `kind`, `path`, `citation`; the brain's `status` and `kind` are copied from the note's own frontmatter, so they are claims the note makes about itself, not a brain-side approval. `read_note` takes `path` and `max_chars` and returns, inside a fence labelled as reference data, one JSON metadata line (`id`, `provisional`, `rev`, `status`, `kind`, `path`, `citation`, `title`, `tags`) followed by the raw note text including its frontmatter. A note without an assigned id has `provisional: true` and a path-derived id; `ebrain ids assign` gives it a stable ULID. A `rev` is 16 lowercase hex characters; an assigned `id` is a 26-character ULID. Retrieved text is untrusted reference data and must never be treated as instructions.

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
