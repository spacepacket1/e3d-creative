# Phase 2 Summary

- Phase: 2
- Title: Claim Checker
- Provider: codex
- Model: gpt-5.4
- Completed: 2026-10-17T10:53:02-0700
- Exit status: 0

## Implementation Handoff

Changes:
- Added `lib/claims-check.js` with `checkClaims()`, strict model-output validation, deterministic forbidden-wording matching with quote recovery, finding merge/dedupe/sort rules, stdout formatting, and report serialization helpers.
- Added `claims-check` to `lib/cli.js`, including `--brief`, `--check-provider`, `--brain-config`, `--brain-main`, and `--fail-on-unsupported`.
- Wired report writing for `<directionId>.claims-check.json` plus `.sha256` sidecar, with no-overwrite behavior, exact direction-byte digesting, and strict exit-code mapping.
- Updated `bin/e3d-creative` to honor command-specific `error.exitCode` values.
- Added `test/claims-check.test.js` covering unsupported, forbidden, supported, downgraded support, model/provider failure modes, not-run behavior, digest/sidecar behavior, overwrite rejection, stdout hygiene, and strict exit codes.

Decisions:
- `checkReason` is the exact sentence `NOT CHECKED: no approved claims were available.` for both `empty` and `unavailable` grounding, while `groundingReason` preserves the underlying fetch reason when present.
- Model findings always record code-built citations only; unsupported findings use `citation: null`, and stdout renders that as `-`.
- The report persists only the required fields plus `counts`, `directionDigest`, `claimsUsed`, `checkedAt`, and the full disclaimer; no claim text, forbidden wording, evidence, or model `claimQuote` is written.
- No-overwrite writes use temp files plus hard-link creation in the target directory so exact bytes are preserved without replacing an existing artifact.

Tests run:
- `node --test test/claims-check.test.js`
- `node --test test/script-critique.test.js`

Unresolved follow-ups:
- None within Phase 2 scope.

## Verification
- passed: `node --test test/claims-check.test.js`

## Worktree Snapshot
- ` M .spec2code/manifest.tsv`
- ` M .spec2code/summaries/phase-1.md`
- ` M .spec2code/summaries/phase-2.md`
- ` M README.md`
- ` M bin/e3d-creative`
- ` M lib/cli.js`
- `?? .e3d-pilot/runs/manual-2026-10-15-brain-claims/`
- `?? lib/brain-client.js`
- `?? lib/claims-check.js`
- `?? lib/claims.js`
- `?? test/claims-check.test.js`
- `?? test/claims-reader.test.js`
- `?? test/fixtures/brain-stub.js`
