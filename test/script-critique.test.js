import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCRIPT_RUBRIC,
  buildScriptCritiquePrompts,
  buildScriptGenerationPrompts,
  buildScriptRevisionPrompts,
  runScriptLoop,
  normalizeScriptVerdict,
  validateSpeakerLines
} from '../lib/script-critique.js';

const goodVerdict = () => ({
  verdict: 'revise',
  scores: { hook: 4, psychology: 3, wording: 5, audienceFit: 2, production: 1 },
  reasoning: ' Strong open. ',
  revisionNotes: ''
});

test('validateSpeakerLines accepts multi-speaker scripts and ignores blank lines', () => {
  const result = validateSpeakerLines('Anna: Hi there\n\nBen: Hello: again\r\n   \nAnna: Bye');
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.lines.map((l) => l.speaker), ['Anna', 'Ben', 'Anna']);
  assert.equal(result.lines[1].text, 'Hello: again');
  assert.equal(result.lines[2].line, 5);
});

test('validateSpeakerLines rejects missing colon, empty text, and empty label', () => {
  const result = validateSpeakerLines('Anna: ok\nno colon here\nBen:   \n: orphan');
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 3);
  assert.match(result.errors[0], /line 2/);
  assert.match(result.errors[1], /line 3.*Ben/);
  assert.match(result.errors[2], /line 4/);
  assert.equal(result.lines.length, 1);
});

test('validateSpeakerLines rejects empty input', () => {
  for (const input of ['', '  \n\n', undefined]) {
    const result = validateSpeakerLines(input);
    assert.equal(result.ok, false);
    assert.deepEqual(result.lines, []);
    assert.equal(result.errors.length, 1);
  }
});

test('SCRIPT_RUBRIC is frozen with production as secondary', () => {
  assert.ok(Object.isFrozen(SCRIPT_RUBRIC));
  assert.deepEqual(Object.keys(SCRIPT_RUBRIC), ['hook', 'psychology', 'wording', 'audienceFit', 'production']);
  assert.equal(SCRIPT_RUBRIC.production.weight, 'secondary');
  assert.equal(SCRIPT_RUBRIC.hook.weight, 'primary');
});

test('normalizeScriptVerdict returns a trimmed normalized verdict', () => {
  const result = normalizeScriptVerdict(goodVerdict());
  assert.equal(result.reasoning, 'Strong open.');
  assert.equal(result.scores.audienceFit, 2);
});

test('normalizeScriptVerdict rejects invalid shapes', () => {
  const bad = (mutate) => {
    const v = goodVerdict();
    mutate(v);
    assert.throws(() => normalizeScriptVerdict(v), /script critique/);
  };
  assert.throws(() => normalizeScriptVerdict(null), /must be an object/);
  bad((v) => { v.verdict = 'maybe'; });
  bad((v) => { v.scores.hook = 6; });
  bad((v) => { v.scores.hook = 0; });
  bad((v) => { v.scores.hook = 2.5; });
  bad((v) => { delete v.scores.production; });
  bad((v) => { v.scores.bogus = 3; });
  bad((v) => { v.reasoning = ' '; });
  bad((v) => { v.revisionNotes = 3; });
});

const stubContext = ({ generate, critiques }) => {
  const calls = { generate: 0, critique: 0 };
  const queue = [...critiques];
  const genQueue = [...generate];
  return {
    calls,
    selection: { conceptGeneration: 'claude', critique: 'openai', qa: 'claude' },
    registry: {
      claude: { generate: async () => { calls.generate += 1; return { text: genQueue.shift() }; } },
      openai: { generate: async () => { calls.critique += 1; return { text: JSON.stringify(queue.shift()) }; } }
    }
  };
};
const crit = (verdict, notes = '') => ({
  verdict,
  scores: { hook: 4, psychology: 4, wording: 4, audienceFit: 4, production: 4 },
  reasoning: 'because',
  revisionNotes: notes
});

test('runScriptLoop write mode reaches keep', async () => {
  const ctx = stubContext({ generate: ['A: hi\nB: yo'], critiques: [crit('keep')] });
  const result = await runScriptLoop({ mode: 'write', input: 'a topic', providers: ctx });
  assert.equal(result.verdict, 'keep');
  assert.equal(result.script, 'A: hi\nB: yo');
  assert.equal(result.rounds.length, 1);
  assert.deepEqual(result.finalScores, result.rounds[0].scores);
});

test('runScriptLoop improve mode revises once then keeps', async () => {
  const ctx = stubContext({ generate: ['A: better'], critiques: [crit('revise', 'punch up'), crit('keep')] });
  const result = await runScriptLoop({ mode: 'improve', input: 'A: old', providers: ctx });
  assert.equal(result.script, 'A: better');
  assert.equal(result.verdict, 'keep');
  assert.equal(result.rounds[0].revisionNotes, 'punch up');
  assert.equal(ctx.calls.generate, 1);
});

test('runScriptLoop discards a format-breaking revision', async () => {
  const ctx = stubContext({ generate: ['not a speaker line'], critiques: [crit('revise', 'x'), crit('keep')] });
  const result = await runScriptLoop({ mode: 'improve', input: 'A: old', providers: ctx });
  assert.equal(result.script, 'A: old');
  assert.equal(result.rounds[0].formatOk, false);
  assert.equal(result.rounds[1].formatOk, true);
  assert.equal(validateSpeakerLines(result.script).ok, true);
});

test('runScriptLoop never exceeds maxRounds revisions', async () => {
  const ctx = stubContext({
    generate: ['A: v1', 'A: v2', 'A: v3'],
    critiques: [crit('revise', 'n'), crit('revise', 'n'), crit('revise', 'n'), crit('revise', 'n')]
  });
  const result = await runScriptLoop({ mode: 'improve', input: 'A: v0', maxRounds: 2, providers: ctx });
  assert.equal(ctx.calls.generate, 2);
  assert.equal(result.script, 'A: v2');
  assert.equal(result.verdict, 'revise');
  assert.equal(result.rounds.length, 3);
});

test('runScriptLoop stops on reject without revising', async () => {
  const ctx = stubContext({ generate: [], critiques: [crit('reject')] });
  const result = await runScriptLoop({ mode: 'improve', input: 'A: old', providers: ctx });
  assert.equal(result.verdict, 'reject');
  assert.equal(result.script, 'A: old');
  assert.equal(ctx.calls.generate, 0);
});

test('runScriptLoop rejects invalid improve input up front', async () => {
  const ctx = stubContext({ generate: [], critiques: [] });
  await assert.rejects(
    runScriptLoop({ mode: 'improve', input: 'A: ok\nbad line', providers: ctx }),
    /not valid "Label: text".*line 2/s
  );
  assert.equal(ctx.calls.critique, 0);
});

test('runScriptLoop prompts state the Label: text requirement', () => {
  for (const p of [
    buildScriptGenerationPrompts({ topic: 't' }),
    buildScriptCritiquePrompts({ script: 'A: x', round: 1 }),
    buildScriptRevisionPrompts({ script: 'A: x', revisionNotes: 'n' })
  ]) {
    assert.match(`${p.systemPrompt}\n${p.userPrompt}`, /Label: text/);
  }
});

// CLI-level tests
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { main } from '../lib/cli.js';

async function captureCli(args, deps) {
  let output = '';
  const original = process.stdout.write;
  process.stdout.write = (chunk) => { output += String(chunk); return true; };
  try {
    await main(args, deps);
  } finally {
    process.stdout.write = original;
  }
  return output;
}

test('script-critique CLI writes script.txt and script-critique.json in topic mode', async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'e3d-script-cli-'));
  const ctx = stubContext({ generate: ['A: hi\nB: yo'], critiques: [crit('keep')] });
  const output = await captureCli(
    ['script-critique', '--topic', 'a topic', '--out', outDir],
    { providerContext: ctx }
  );
  assert.match(output, /script critique complete: verdict keep/);
  assert.equal(await readFile(path.join(outDir, 'script.txt'), 'utf8'), 'A: hi\nB: yo\n');
  const report = JSON.parse(await readFile(path.join(outDir, 'script-critique.json'), 'utf8'));
  assert.equal(report.verdict, 'keep');
  assert.equal(report.rounds.length, 1);
  assert.equal(report.finalScores.hook, 4);
});

test('script-critique CLI improves a script file', async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'e3d-script-cli-'));
  const scriptPath = path.join(outDir, 'in.txt');
  await writeFile(scriptPath, 'A: old\nB: line\n');
  const ctx = stubContext({
    generate: ['A: new\nB: line'],
    critiques: [crit('revise', 'tighten'), crit('keep')]
  });
  const out = path.join(outDir, 'out');
  await captureCli(
    ['script-critique', '--script', scriptPath, '--out', out, '--max-rounds', '1'],
    { providerContext: ctx }
  );
  assert.equal(await readFile(path.join(out, 'script.txt'), 'utf8'), 'A: new\nB: line\n');
});

test('script-critique CLI usage errors', async () => {
  const deps = { providerContext: stubContext({ generate: [], critiques: [] }) };
  await assert.rejects(captureCli(['script-critique', '--out', '/tmp/x'], deps), /exactly one of --script/);
  await assert.rejects(
    captureCli(['script-critique', '--script', 'a', '--topic', 'b', '--out', '/tmp/x'], deps),
    /exactly one of --script/
  );
  await assert.rejects(captureCli(['script-critique', '--topic', 'b'], deps), /missing --out/);
  await assert.rejects(
    captureCli(['script-critique', '--topic', 'b', '--out', '/tmp/x', '--max-rounds', 'x'], deps),
    /--max-rounds/
  );
});
