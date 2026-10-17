# Phase 1 Summary

- Phase: 1
- Title: Claims Reader and Brain Client
- Provider: codex
- Model: gpt-5.4
- Completed: 2026-10-17T10:47:06-0700
- Exit status: 0

## Implementation Handoff

Changes:
- Added `lib/brain-client.js`, a dependency-free MCP stdio client for `node <brainMain> mcp` with explicit env allowlisting, Content-Length framing, tool allowlisting, per-call timeouts, frame-size caps, stderr caps, and child reap/termination handling.
- Added `lib/claims.js` with `fetchApprovedClaims()` and `renderClaimsBlock()`, including product canonicalization, in-folder path enforcement, stable-id validation, exact-digest calculation, limited YAML frontmatter parsing, claim extraction, UTC expiry handling, and exact Phase 1 counters.
- Added `test/fixtures/brain-stub.js` to emulate the MCP subset and record framing, tool calls, env, and shutdown behavior.
- Added `test/claims-reader.test.js` covering happy-path claim selection, expired-today validity, truncation sentinel handling, unsafe/missing tools, invalid product/config, protocol/transport failures, disallowed client calls, deterministic digests, and prompt rendering caps.
- Updated `README.md` with the Phase 1 trust-boundary note that any claims vault must be claims-only, read-only to `e3d-creative`, and writable only by human approvers.

Decisions:
- The client sends `initialize`, `notifications/initialized`, `tools/list`, then only `tools/call` for `list_notes` and `read_note`; any other attempted tool invocation throws as a programming error.
- `list_notes` is called with `limit: 51` and `format: "jsonl"`; only the first 50 returned entries are ever processed, with the 51st treated only as an overflow sentinel.
- Claim digests are SHA-256 over the exact UTF-8 bytes of the raw note-text portion from `read_note`, including the terminal newline before the closing fence.
- Path scoping treats both `/` and `\\` as separators and rejects nested, absolute, dot-segment, or wrong-folder paths before any note read.

Tests run:
- `node --test test/claims-reader.test.js`

Unresolved follow-ups:
- None within Phase 1 scope.

## Verification
- passed: `node --test test/claims-reader.test.js`

## Worktree Snapshot
- ` M .spec2code/manifest.tsv`
- ` M .spec2code/summaries/phase-1.md`
- ` M README.md`
- `?? .e3d-pilot/runs/manual-2026-10-15-brain-claims/`
- `?? lib/brain-client.js`
- `?? lib/claims.js`
- `?? test/claims-reader.test.js`
- `?? test/fixtures/brain-stub.js`
