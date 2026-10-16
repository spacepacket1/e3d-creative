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
e3d-creative run <brief.json> --out <dir> [--concept-provider <claude|openai>] [--critique-provider <claude|openai>] [--qa-provider <claude|openai>]
e3d-creative script-critique (--script <file> | --topic <text>) --out <dir> [--audience <text>] [--max-rounds <n>] [--critique-provider <claude|openai>] [--concept-provider <claude|openai>]
```

Notes:

- `concepts` writes `>=3` direction files plus `concepts-manifest.json`.
- `critique` writes bounded debate rounds and `critique-manifest.json`.
- `qa` scores only keep-verdict directions and writes `qa-manifest.json`.
- `package` emits both `rich-artifact.json` and `cast-compatible.json`.
- `cast-compatible.json` includes `unconsumedByCurrentPipeline` so dropped rich fields are explicit.
- `package --list` prints each packaged direction id, verdict, QA score, and digest.
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
- `S2C_CLAUDE_API_KEY_FILE`
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

## License

[MIT](LICENSE) © 2026 FutCo LLC. Part of the [FutCo](https://futco.ai/projects) open-source ecosystem.
