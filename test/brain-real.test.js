// Opt-in test against a REAL e3d-brain: the stub in test/fixtures mirrors what we believe the server speaks, and this
// test checks the belief. It caught the wrong framing (Content-Length instead of one JSON object per line), the wrong
// list_notes format value, and the wrong result wrapping, none of which a stub-only test can see.
//
//   E3D_CREATIVE_TEST_EBRAIN_MAIN=/path/to/e3d-brain/dist/src/cli/main.js node --test test/brain-real.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fetchApprovedClaims } from '../lib/claims.js';

const brainMain = process.env.E3D_CREATIVE_TEST_EBRAIN_MAIN;

function claimNote(status) {
  return [
    '---',
    'kind: product-claim',
    'product: "Real Brain Product"',
    `status: "${status}"`,
    'approved_by: "Test Approver"',
    'approved_on: "2026-01-01"',
    'expires: "2099-01-01"',
    'evidence:',
    '  - "url:https://example.com/evidence"',
    'allowed_wording: "Say it is real."',
    'forbidden_wording:',
    '  - "fake claim"',
    '---',
    '',
    'Claim:',
    `This ${status} claim is read from a real e3d-brain.`,
    ''
  ].join('\n');
}

test('fetchApprovedClaims works against a real read-only e3d-brain', { skip: !brainMain }, async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'e3d-real-brain-'));
  const vault = path.join(base, 'vault');
  const config = path.join(base, 'config.json');
  const state = path.join(base, 'state');
  const env = { ...process.env, EBRAIN_CONFIG: config };
  const ebrain = (...args) => execFileSync('node', [brainMain, ...args], { env, encoding: 'utf8' });

  ebrain('init', '--vault', vault, '--principal', 'tester', '--mode', 'read-only', '--config', config, '--state-dir', state);
  const dir = path.join(vault, 'claims', 'real-brain-product');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'approved.md'), claimNote('approved'));
  await writeFile(path.join(dir, 'draft.md'), claimNote('draft'));
  ebrain('ids', 'assign');
  ebrain('reindex');

  const result = await fetchApprovedClaims({
    product: 'Real Brain Product',
    now: new Date('2026-10-17T00:00:00Z'),
    brainOptions: { brainConfig: config, brainMain }
  });

  assert.equal(result.claimGrounding, 'ok', JSON.stringify(result));
  assert.equal(result.counts.fetched, 2);
  assert.equal(result.counts.kept, 1);
  assert.equal(result.counts.unapproved, 1);
  assert.equal(result.claims.length, 1);
  assert.match(result.claims[0].citation, /^note:[0-9A-Z]{26}@[0-9a-f]{16}$/);
  assert.match(result.claims[0].claim, /read from a real e3d-brain/);

  // The digest is the SHA-256 of the note text exactly as stored (ids assign rewrote the file with an id).
  const onDisk = await readFile(path.join(dir, 'approved.md'));
  assert.equal(result.claims[0].digest, createHash('sha256').update(onDisk).digest('hex'));
});
