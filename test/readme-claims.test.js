import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BRAIN_TOOL_ALLOWLIST } from '../lib/brain-client.js';
import { fetchApprovedClaims } from '../lib/claims.js';

const rootDir = process.cwd();
const brainStubPath = path.join(rootDir, 'test', 'fixtures', 'brain-stub.js');
const readmePath = path.join(rootDir, 'README.md');

async function createScenario(scenario) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'e3d-readme-claims-'));
  const configPath = path.join(dir, 'brain-config.json');
  const recordPath = path.join(dir, 'record.json');
  await writeFile(configPath, JSON.stringify({ ...scenario, recordPath }, null, 2), 'utf8');
  return {
    configPath,
    recordPath
  };
}

function extractReferenceDataBlocks(readme) {
  return Array.from(readme.matchAll(/```reference-data\r?\n([\s\S]*?)```/gu), (match) => match[1]);
}

function parseReferenceDataBlock(block, index) {
  const match = /^([^\r\n]+)\r?\n\r?\n([\s\S]*)$/u.exec(block.trim());
  if (!match) {
    throw new Error(`README reference-data block ${index + 1} is malformed`);
  }
  return {
    metadata: JSON.parse(match[1]),
    noteText: `${match[2].replace(/\s+$/u, '')}\n`
  };
}

test('README claim-note examples pass the actual Phase 1 reader and validation path', async () => {
  const readme = await readFile(readmePath, 'utf8');
  const blocks = extractReferenceDataBlocks(readme);
  assert.equal(blocks.length >= 3, true);

  const parsed = blocks.slice(0, 3).map(parseReferenceDataBlock);
  const listEntries = parsed.map((entry) => entry.metadata);
  const readNotes = Object.fromEntries(
    parsed.map((entry) => [
      entry.metadata.path,
      {
        metadata: entry.metadata,
        noteText: entry.noteText
      }
    ])
  );
  const { configPath } = await createScenario({
    tools: BRAIN_TOOL_ALLOWLIST,
    listEntries,
    readNotes
  });

  const result = await fetchApprovedClaims({
    product: 'e3d-brain',
    now: new Date('2026-10-17T12:00:00.000Z'),
    brainOptions: {
      brainMain: brainStubPath,
      brainConfig: configPath
    }
  });

  assert.equal(result.claimGrounding, 'ok');
  assert.equal(result.claims.length, 3);
  assert.equal(result.counts.kept, 3);
  assert.equal(result.claims.every((claim) => claim.citation.startsWith('note:')), true);
  assert.equal(result.claims.every((claim) => claim.digest.length === 64), true);
});
