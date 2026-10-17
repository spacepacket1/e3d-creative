# e3d-creative

`e3d-creative` is an offline-first CLI and library that turns a structured brief
into distinct creative directions, critiques them, expands kept directions into
shot-level visual guidance, and packages a transcript-only reduction for the
current `e3d-cast` pipeline.

## Scope Boundary

Current scope is deliberately narrow:

- no rendering
- no e3d-corp integration
- no hosting, billing, or web UI
- no autonomous publishing and no spend authority
- no new e3d-pod2vid provider adapter

The output is planning and packaging artifacts only. QA scores are heuristic
assessments, not evidence that an ad will convert.

## Quick Start

Validate a brief:

```bash
bin/e3d-creative validate-brief examples/sample-brief.json
```

Run the full offline pipeline:

```bash
bin/e3d-creative run examples/sample-brief.json --out /tmp/e3d-sample
```

Run individual phases:

```bash
bin/e3d-creative concepts examples/sample-brief.json --out /tmp/e3d-sample/concepts
bin/e3d-creative critique /tmp/e3d-sample/concepts --out /tmp/e3d-sample/critique
bin/e3d-creative qa /tmp/e3d-sample/concepts /tmp/e3d-sample/critique --out /tmp/e3d-sample/qa
bin/e3d-creative package /tmp/e3d-sample/qa/direction-1.visual-direction.json --out /tmp/e3d-sample/package --list
```

`run` creates four subdirectories under the output root:

- `concepts/`
- `critique/`
- `qa/`
- `package/`

Each phase writes JSON atomically and records digests in a manifest so outputs
remain provenance-friendly.

## Brief Schema

Briefs are JSON objects with these required fields:

```json
{
  "product": "string",
  "audience": "string",
  "objective": "string",
  "baselineRef": "string or null",
  "constraints": ["string"],
  "spendCeiling": "number or null",
  "metric": "string",
  "threshold": "string"
}
```

Rules:

- `product`, `audience`, `objective`, `metric`, and `threshold` must be non-empty strings.
- `baselineRef` must be explicit: either `null` or a readable local path / `file:` URL.
- If `baselineRef` is present but unreadable, validation fails closed with a blocked error.
- `constraints` must be an array of non-empty strings.
- `spendCeiling` must be a number or `null`.

Worked example:

- `examples/sample-brief.json` is a fictionalized HVAC brief based on the OppScan use case and is used as the end-to-end smoke fixture.

## Direction Schema

Each generated direction is normalized to this shape:

```json
{
  "directionId": "string",
  "hook": "string",
  "premise": "string",
  "audiencePsychology": "string",
  "script": [
    {
      "tag": "fact | claim | hypothesis",
      "text": "string"
    }
  ],
  "storyboard": [
    {
      "timecodeStart": "string",
      "timecodeEnd": "string",
      "visualDirection": "string",
      "audioNotes": "string",
      "onScreenText": "string"
    }
  ],
  "ctaText": "string",
  "confidence": 0.0,
  "rationale": "string"
}
```

Phase 5 writes `*.visual-direction.json` files that keep the same schema while
making each shot’s `visualDirection`, `audioNotes`, and `onScreenText` concrete
enough for a human or future adapter to brief production from.

## CLI

```text
e3d-creative validate-brief <file>
e3d-creative validate-direction <file>
e3d-creative concepts <brief.json> --out <dir> [--concept-provider <claude|openai>]
e3d-creative critique <concepts-dir> --out <dir> [--critique-provider <claude|openai>]
e3d-creative qa <concepts-dir> <critique-dir> --out <dir> [--qa-provider <claude|openai>]
e3d-creative package <qa-dir>/<id>.visual-direction.json --out <dir> [--list]
e3d-creative run <brief.json> --out <dir> [--concept-provider <claude|openai>] [--critique-provider <claude|openai>] [--qa-provider <claude|openai>] [--claims-check] [--check-provider <claude|openai>] [--brain-config <path>] [--brain-main <path>]
e3d-creative claims-check <direction.json> --brief <brief.json> --out <dir> [--check-provider <claude|openai>] [--brain-config <path>] [--brain-main <path>] [--fail-on-unsupported]
e3d-creative script-critique (--script <file> | --topic <text>) --out <dir> [--audience <text>] [--max-rounds <n>] [--critique-provider <claude|openai>] [--concept-provider <claude|openai>]
```

Notes:

- `concepts` writes `>=3` direction files plus `concepts-manifest.json`.
- `critique` writes bounded debate rounds and `critique-manifest.json`.
- `qa` scores only keep-verdict directions and writes `qa-manifest.json`.
- `package` emits both `rich-artifact.json` and `cast-compatible.json`.
- `cast-compatible.json` includes `unconsumedByCurrentPipeline` so dropped rich fields are explicit.
- `package --list` prints each packaged direction id, verdict, QA score, and digest.
- `run --claims-check` adds advisory claims-check reports under `<out>/claims/` and preserves the existing exit behavior.
- `claims-check` writes `<directionId>.claims-check.json` plus a `.sha256` sidecar.
- `script-critique` writes `script.txt` and `script-critique.json`; see below.

### Script critique

`script-critique` runs a bounded critique/revision loop over a spoken script.

- **Rubric** (scored 1-5): hook, psychology, wording, and audience fit are primary; production is secondary.
- **Speaker-line format guarantee**: every non-blank line of the final script is `Label: text`. A revision that breaks this format is discarded and the last valid script is kept.
- **Modes**: `--script <file>` improves an existing script (the input must already be in `Label: text` format); `--topic <text>` writes a draft first, then critiques it. Exactly one of the two is required.
- `--max-rounds` bounds revisions (default 2, capped at 3). `script-critique.json` records each round's verdict, scores, and notes.

Wiring this into Cast's `pod2vidRoutes.js` happens in the spacepacket repo, not here.

## Provider Configuration

Supported providers:

- `claude`
- `openai`

Provider choice is per phase through CLI flags. Current defaults are:

- concepts: `claude`
- critique: `openai`
- QA: follows the concept provider unless overridden

API keys resolve from environment first, then from key files.

Claude lookup order:

- `ANTHROPIC_API_KEY`
- `CLAUDE_API_KEY`
- `E3D_CLAUDE_API_KEY_FILE`
- `E3D_CODE_CLAUDE_API_KEY_FILE`
- `S2C_CLAUDE_API_KEY_FILE` (pre-rename name of the same variable)
- default key file: `~/.config/e3d-pilot/anthropic-api-key`

OpenAI lookup order:

- `OPENAI_API_KEY`
- `CODEX_API_KEY`
- `E3D_OPENAI_API_KEY_FILE`
- `OPENAI_API_KEY_FILE`
- `S2C_OPENAI_API_KEY_FILE`
- default key file: `~/.config/e3d-pilot/openai-api-key`

Key files may be either bare secrets or shell-style export lines such as:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

## Output Artifacts

The full run keeps both rich and reduced outputs:

- rich concept, critique, QA, and packaging manifests with SHA-256 digests
- per-direction `rich-artifact.json` records with storyboard-level visual direction and QA data
- per-direction `cast-compatible.json` reductions shaped for `input.kind = "transcript"`

The transcript reduction intentionally does not pretend to preserve shot-level
visual guidance. Dropped fields are listed in
`unconsumedByCurrentPipeline`, including fields such as
`shot.visualDirection` and `shot.audioNotes`.

## Grounding Claims From e3d-brain

Approved-claims grounding is opt-in and advisory. It is designed for a dedicated
claims-only `e3d-brain` vault, not a general knowledge vault.

### Worked note format

The reader expects note bodies that validate as product-claim notes and stable
brain metadata with assigned ids. After humans approve or revise notes, run:

```bash
ebrain ids assign /path/to/claims-vault
```

Example approved notes for product `e3d-brain`:

```reference-data
{"id":"01ARZ3NDEKTSV4RRFFQ69G5FAV","provisional":false,"rev":"0123456789abcdef","status":"approved","kind":"product-claim","path":"claims/e3d-brain/retrieval-only.md","citation":"note:01ARZ3NDEKTSV4RRFFQ69G5FAV@0123456789abcdef"}

---
kind: product-claim
product: "e3d-brain"
status: "approved"
approved_by: "Ada Lovelace"
approved_on: "2026-10-10"
expires: "2026-12-31"
evidence:
  - "Internal product review notes, October 2026."
allowed_wording: "Say it retrieves approved internal notes for review."
forbidden_wording:
  - "It knows everything your company knows."
---

Claim:
e3d-brain retrieves approved internal notes for review workflows.
```

```reference-data
{"id":"01ARZ3NDEKTSV4RRFFQ69G5FAW","provisional":false,"rev":"fedcba9876543210","status":"approved","kind":"product-claim","path":"claims/e3d-brain/claims-only-vault.md","citation":"note:01ARZ3NDEKTSV4RRFFQ69G5FAW@fedcba9876543210"}

---
kind: product-claim
product: "e3d-brain"
status: "approved"
approved_by: "Grace Hopper"
approved_on: "2026-10-10"
expires: "2026-12-31"
evidence:
  - "Product design review signed off by the claims workflow owners."
allowed_wording: "Describe it as operating against a claims-only vault."
forbidden_wording:
  - "Point it at any general vault."
---

Claim:
e3d-brain can be configured against a claims-only vault for approved product claims.
```

```reference-data
{"id":"01ARZ3NDEKTSV4RRFFQ69G5FAX","provisional":false,"rev":"1111111111111111","status":"approved","kind":"product-claim","path":"claims/e3d-brain/human-approval.md","citation":"note:01ARZ3NDEKTSV4RRFFQ69G5FAX@1111111111111111"}

---
kind: product-claim
product: "e3d-brain"
status: "approved"
approved_by: "Katherine Johnson"
approved_on: "2026-10-10"
expires: "2026-12-31"
evidence:
  - "Launch checklist reviewed with the approving operators."
allowed_wording: "Say humans approve the claims before use."
forbidden_wording:
  - "Approval is automatic."
---

Claim:
Only approved claim notes created by human approvers are eligible for grounding.
```

### Vault setup

- Create a dedicated claims-only, read-only brain instance whose notes live under `claims/<product-slug>/`.
- Give `e3d-creative` read-only access to that instance.
- Only authorized approving humans may write to the claims vault.
- Do not point this feature at a general vault, mixed research vault, or any writable-by-automation vault.

### Running checks

Run a single check:

```bash
e3d-creative claims-check direction.json --brief brief.json --out /tmp/claims-check --brain-main /path/to/e3d-brain --brain-config /path/to/brain-config.json
```

Run the full engine with post-QA checks:

```bash
e3d-creative run brief.json --out /tmp/e3d-run --claims-check --brain-main /path/to/e3d-brain --brain-config /path/to/brain-config.json
```

Retrieval status values:

- `ok`: approved claims were loaded and the checker can run.
- `empty`: the scoped claims folder was reachable but no approved claims were usable.
- `unavailable`: the brain instance was not configured or could not be read safely.

Check status values:

- `passed`: no forbidden or unsupported findings.
- `findings`: one or more forbidden or unsupported findings were recorded.
- `failed`: the checker attempted a run but the provider or model output failed validation.
- `not-run`: no checker model call was made because grounding was `empty` or `unavailable`.

Exit codes for `claims-check`:

- `0`: passed, findings, or default unsupported results when `--fail-on-unsupported` is not set.
- `3`: unsupported findings with `--fail-on-unsupported`.
- `4`: failed.
- `5`: not-run.

`run --claims-check` is fail-open. It writes advisory reports but preserves the
engine's normal run exit behavior.

Report files: `claims-check` refuses to overwrite an existing report. `run --claims-check` follows `run`'s own
rule: running it again into the same `--out` directory replaces that directory's artifacts, claims reports
included. Within one run, two directions with the same `directionId` are rejected rather than overwriting each
other.

The brain client speaks e3d-brain's MCP stdio transport (one JSON object per line) and reads `list_notes` and
`read_note` results as e3d-brain returns them. `test/brain-real.test.js` checks this against a real e3d-brain
(set `E3D_CREATIVE_TEST_EBRAIN_MAIN` to its `dist/src/cli/main.js`); the stub-based tests cannot catch a mismatch
with the real server.

### Limits and handling

- Reports contain citations, digests, and findings metadata; they do not persist raw approved-claim text.
- This is advisory-only behavior and required human judgment still applies before any public claim is shipped.
- A passed check does not prove a claim is true, complete, current, or legally safe.
- A failed or not-run check should block trust, not replace review.
- Known limits: the checker only sees retrieved approved notes, it can miss subtle paraphrases, and it does not auto-recheck when a relied-on claim later changes or expires.

## License

[MIT](LICENSE) © 2026 FutCo LLC. Part of the [FutCo](https://futco.ai/projects) open-source ecosystem.
