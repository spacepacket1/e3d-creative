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

<!-- runner:model=codex:gpt-5.4 -->
<!-- pilot:touches=lib/brain-client.js -->
<!-- pilot:touches=lib/claims.js -->
<!-- pilot:touches=test/claims-reader.test.js -->
<!-- pilot:touches=test/fixtures/** -->

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

### Acceptance Criteria

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

<!-- runner:model=codex:gpt-5.4 -->
<!-- pilot:touches=lib/claims-check.js -->
<!-- pilot:touches=lib/cli.js -->
<!-- pilot:touches=test/claims-check.test.js -->
<!-- pilot:touches=test/fixtures/** -->

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

### Acceptance Criteria

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

<!-- runner:model=codex:gpt-5.4 -->
<!-- pilot:touches=lib/run.js -->
<!-- pilot:touches=lib/cli.js -->
<!-- pilot:touches=scripts/eval-claims.js -->
<!-- pilot:touches=test/** -->
<!-- pilot:touches=README.md -->
<!-- pilot:touches=docs/e3d-creative-engine-spec.md -->

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

### Acceptance Criteria

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
