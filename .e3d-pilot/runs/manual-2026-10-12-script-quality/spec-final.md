# Script-Quality Critique/Revision Loop

## Overview

Cast's script features (live transcript/improve and prompt-to-podcast, in the separate e3d/spacepacket repo) are single-pass LLM calls with no critique, revision, or quality gate. e3d-creative already has a generate -> critique (keep/revise/reject + reasoning) -> revise discipline in `lib/critique.js`, but its rubric is ad-specific (spendCeiling/metric/threshold). This spec adds a second, non-ad rubric focused on script quality (hook strength, persuasion/psychology, wording and copywriting craft, audience fit), exposed as a library module and a CLI command in this repo. It must preserve Cast's strict `Label: text` speaker-line format through every revision round, and support two inputs: improving an existing script/transcript, and writing a new script from a one-sentence topic. Wiring into `spacepacket/server/pod2vidRoutes.js` is out of scope here, since that file lives in another repo.

## Goals

- A new library module `lib/script-critique.js` that runs a bounded generate/improve -> critique -> revise loop for scripts.
- A script-specific rubric (hook, psychology, wording, audience fit) with a keep/revise/reject verdict and structured reasoning. Production/video polish is at most a minor, secondary criterion.
- A deterministic validator for the `Label: text` speaker-line format, applied to every draft and revision. A revision that breaks the format is rejected and the prior valid script is kept.
- Two modes: `improve` (existing script text) and `write` (one-sentence topic).
- A CLI command `e3d-creative script-critique`.
- Reuse the existing provider layer (`lib/providers/*`), including its selection and fallback behavior. Offline tests use stubbed providers only.

## Non-Goals

- No changes to the spacepacket/e3d repo or `pod2vidRoutes.js`.
- No changes to the existing ad critique loop's behavior, the brief schema, or the `run` pipeline.
- No rendering, spend authority, or new provider adapters.
- No changes to `.github/workflows/**` or `LICENSE`.

## Existing Files

- `lib/critique.js`: existing keep/revise/reject debate loop. Read first, reuse its patterns and helpers where practical, and do not alter its behavior.
- `lib/providers/index.js`, `lib/providers/selection.js`, `lib/providers/claude.js`, `lib/providers/openai.js`: provider calling and selection.
- `lib/cli.js`, `bin/e3d-creative`: CLI dispatch.
- `lib/schema.js`: validation helpers and error style.
- `test/critique.test.js`, `test/provider.test.js`: examples of how provider stubs are used in tests.
- `README.md`: CLI and docs.

## Shared Constraints

- Match the existing code style (CommonJS or ESM as used by the repo, error types, atomic JSON writes).
- Tests must run offline with stubbed providers. `npm test` must pass.
- Total change must stay within about 20 files and 700 lines.
- Never touch `.github/workflows/**` or `LICENSE`.

## Phase 1 - Speaker-line format validator and script rubric

<!-- runner:model=claude:claude-sonnet-5-5 -->
<!-- pilot:touches=lib/script-critique.js -->
<!-- pilot:touches=test/script-critique.test.js -->
<!-- runner:read=lib/critique.js -->
<!-- runner:read=lib/schema.js -->
<!-- runner:verify=npm test -->

### Requirements

- Create `lib/script-critique.js` exporting `validateSpeakerLines(text)`. It returns `{ ok, errors, lines }`. Every non-blank line must match `Label: text`, where Label is a non-empty speaker label without a colon and text is non-empty. Blank lines are ignored. Empty scripts are invalid.
- Export `SCRIPT_RUBRIC`, a frozen object of the criteria: `hook`, `psychology`, `wording`, `audienceFit` (primary), and `production` (secondary, explicitly lower weight). Each has a short description used in prompts.
- Export `normalizeScriptVerdict(raw)`. It validates a critique result of the form `{ verdict: 'keep'|'revise'|'reject', scores: {<criterion>: 1-5}, reasoning: string, revisionNotes: string }`. It throws on an invalid shape, in the repo's existing error style.
- Add `test/script-critique.test.js` covering valid and invalid speaker lines (missing colon, empty text, blank lines, empty input) and verdict normalization.

### Acceptance Criteria

- `validateSpeakerLines` accepts well-formed multi-speaker scripts and rejects the malformed cases above with useful error messages.
- `normalizeScriptVerdict` rejects unknown verdicts and out-of-range scores.
- `npm test` passes.

## Phase 2 - Bounded critique/revision loop

<!-- runner:model=claude:claude-sonnet-5-5 -->
<!-- pilot:touches=lib/script-critique.js -->
<!-- pilot:touches=test/script-critique.test.js -->
<!-- runner:read=lib/critique.js -->
<!-- runner:read=lib/providers/index.js -->
<!-- runner:read=lib/providers/selection.js -->
<!-- runner:read=test/critique.test.js -->
<!-- runner:verify=npm test -->

### Requirements

- Export `runScriptLoop({ mode, input, audience, maxRounds, providers })`, where `mode` is `'improve'` (`input` is the existing script/transcript) or `'write'` (`input` is a one-sentence topic). `audience` is optional. `maxRounds` defaults to 2 and is capped at a small constant.
- Flow:
  1. Produce a draft: in `write` mode, generate from the topic. In `improve` mode, the input is the initial draft.
  2. Critique it against `SCRIPT_RUBRIC` through the provider layer.
  3. On `revise`, request a revision using the critique's notes.
  4. Repeat until `keep`, `reject`, or the round cap.
- The generation, critique, and revision prompts must state the `Label: text` format requirement explicitly. Every draft and revision is run through `validateSpeakerLines`. An invalid revision is discarded and the last valid script is kept, with the failure recorded in the result.
- In `improve` mode, an input that is not valid speaker-line format is rejected up front with a clear error. Do not rewrite it silently.
- Return `{ script, verdict, rounds: [{ round, verdict, scores, reasoning, revisionNotes, formatOk }], finalScores }`. Reuse the existing provider selection and fallback. Do not read API keys directly.
- Extend `test/script-critique.test.js` using stubbed providers. Cover: write mode reaching keep; improve mode revising once; a revision that breaks the format being discarded; the round cap; reject; and invalid improve input.

### Acceptance Criteria

- Both modes work end to end against stubs, and the output script always passes `validateSpeakerLines`.
- The loop never exceeds `maxRounds` revisions.
- Existing ad-critique tests are unchanged and pass.
- `npm test` passes.

## Phase 3 - CLI command and docs

<!-- runner:model=claude:claude-sonnet-5-5 -->
<!-- pilot:touches=lib/cli.js -->
<!-- pilot:touches=README.md -->
<!-- pilot:touches=test/script-critique.test.js -->
<!-- runner:read=lib/cli.js -->
<!-- runner:verify=npm test -->

### Requirements

- Add `e3d-creative script-critique (--script <file> | --topic <text>) --out <dir> [--audience <text>] [--max-rounds <n>] [--critique-provider <claude|openai>] [--concept-provider <claude|openai>]` in `lib/cli.js`. Exactly one of `--script` and `--topic` is required, and passing both or neither is a usage error.
- The command writes `script.txt` (the final script) and `script-critique.json` (the rounds and scores) atomically into `--out`, following the existing output-writing helpers.
- Add a CLI-level test with stubbed providers, following the repo's existing CLI test style, covering the success path and the usage errors.
- Update `README.md` with the new command in the CLI listing and a short section describing the rubric, the speaker-line format guarantee, and the two modes. State that wiring into Cast's `pod2vidRoutes.js` happens in the spacepacket repo.

### Acceptance Criteria

- `e3d-creative script-critique --topic "..." --out <dir>` runs with stub providers in tests and writes both output files.
- Usage errors give a non-zero exit and a clear message.
- The README documents the command.
- `npm test` passes.
