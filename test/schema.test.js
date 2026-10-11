import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  normalizeBriefInput,
  normalizeDirection,
  readJsonFile,
  validateBriefInput,
  validateDirection
} from '../lib/schema.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');
const cliPath = path.join(process.cwd(), 'bin', 'e3d-creative');

async function loadFixture(name) {
  return readJsonFile(path.join(fixturesDir, name));
}

test('brief fixtures validate as expected', async () => {
  const cases = [
    { name: 'brief-valid.json', valid: true },
    { name: 'brief-invalid-shape.json', valid: false }
  ];

  for (const testCase of cases) {
    const brief = await loadFixture(testCase.name);
    const result = validateBriefInput(brief);
    assert.equal(result.valid, testCase.valid, testCase.name);
  }
});

test('direction fixtures validate as expected', async () => {
  const cases = [
    { name: 'direction-valid.json', valid: true },
    { name: 'direction-invalid.json', valid: false }
  ];

  for (const testCase of cases) {
    const direction = await loadFixture(testCase.name);
    const result = validateDirection(direction);
    assert.equal(result.valid, testCase.valid, testCase.name);
  }
});

test('normalizeBriefInput trims values and accepts reachable baselineRef', async () => {
  const brief = await loadFixture('brief-valid.json');
  const normalized = await normalizeBriefInput(brief, { baseDir: fixturesDir });

  assert.equal(normalized.product, 'OppScan');
  assert.equal(normalized.baselineRef, './baseline.txt');
  assert.deepEqual(normalized.constraints, [
    'No invented customer revenue claims',
    'Keep the tone direct and operator-focused'
  ]);
});

test('normalizeBriefInput fails closed when baselineRef is unreachable', async () => {
  const brief = await loadFixture('brief-invalid-missing-baseline.json');

  await assert.rejects(
    normalizeBriefInput(brief, { baseDir: fixturesDir }),
    (error) => error instanceof Error && error.message.includes('blocked: baseline unreachable')
  );
});

test('normalizeDirection trims valid direction content', async () => {
  const direction = await loadFixture('direction-valid.json');
  const normalized = normalizeDirection(direction);

  assert.equal(normalized.script[0].tag, 'fact');
  assert.equal(normalized.storyboard[0].timecodeStart, '00:00');
  assert.equal(normalized.confidence, 0.74);
});

test('CLI validates a brief file', async () => {
  const filePath = path.join(fixturesDir, 'brief-valid.json');
  const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath, 'validate-brief', filePath], {
    cwd: process.cwd()
  });

  assert.match(stdout, /brief valid:/);
  assert.equal(stderr, '');
});

test('CLI surfaces blocked baseline errors clearly', async () => {
  const filePath = path.join(fixturesDir, 'brief-invalid-missing-baseline.json');

  await assert.rejects(
    execFileAsync(process.execPath, [cliPath, 'validate-brief', filePath], {
      cwd: process.cwd()
    }),
    (error) => {
      assert.match(error.stderr, /blocked: baseline unreachable/);
      return true;
    }
  );
});

test('CLI validates a direction file', async () => {
  const filePath = path.join(fixturesDir, 'direction-valid.json');
  const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath, 'validate-direction', filePath], {
    cwd: process.cwd()
  });

  assert.match(stdout, /direction valid:/);
  assert.equal(stderr, '');
});
