import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { main } from '../lib/cli.js';
import { extractJson, normalizeEvidence, parseIdeas, parseSelection, runWildcard, buildWildcardPrompts } from '../lib/wildcard.js';

const evidence = {
  date: '2026-11-08',
  items: [
    { id: 'e1', section: 'signals', text: 'Three AI teams raised funding yesterday and are hiring evaluators.' },
    { id: 'e2', section: 'listening', text: 'A Hacker News thread asks how to tell which model to trust.' }
  ]
};

const goodIdea = {
  kind: 'practical',
  lens: 'outsider',
  title: 'Second-opinion booth',
  idea: 'Borrow the pharmacy counter: offer a free 10-minute second opinion on one decision.',
  whyNow: 'The thread shows people asking for exactly that.',
  evidenceRefs: ['e2'],
  risk: 'Unverified that anyone wants it live.',
  firstTest: 'Reply to the thread offering one free second opinion.'
};

// Mirrors the real providers: both prompt fields are required non-empty strings.
function assertRequest(req) {
  assert.equal(typeof req?.systemPrompt, 'string');
  assert.ok(req.systemPrompt.trim() !== '', 'systemPrompt is required');
  assert.equal(typeof req?.userPrompt, 'string');
  assert.ok(req.userPrompt.trim() !== '', 'userPrompt is required');
}

const moonIdea = {
  kind: 'moonshot',
  lens: 'stunt',
  title: 'Debate the balloon',
  idea: 'Run a live public debate on a decision nobody can agree on and let the audience watch the models disagree.',
  whyNow: 'People are asking which model to trust.',
  evidenceRefs: ['e2'],
  risk: 'Worst case: a flat, embarrassing live failure.',
  costNote: 'About a day of work, no ad spend.',
  firstTest: 'Rehearse privately with three friends first.'
};

function stubContext({ generate, critique }) {
  return {
    selection: { conceptGeneration: 'a', critique: 'b', qa: 'a' },
    registry: {
      a: { generate: async (req) => { assertRequest(req); return { text: generate }; } },
      b: { generate: async (req) => { assertRequest(req); return { text: critique }; } }
    }
  };
}

test('extractJson tolerates prose and fences around the JSON, and rejects non-JSON', () => {
  assert.deepEqual(extractJson('{"a": 1}'), { a: 1 });
  assert.deepEqual(extractJson('Here are the ideas:\n```json\n{"a": 1}\n```\nHope that helps.'), { a: 1 });
  assert.deepEqual(extractJson('Sure! {"a": {"b": 2}} Let me know.'), { a: { b: 2 } });
  assert.throws(() => extractJson('I cannot help with that.'), /no JSON/);
});

test('invalid JSON errors include the start of the reply for diagnosis', () => {
  const ev = normalizeEvidence(evidence);
  assert.throws(() => parseIdeas('I am sorry, but I cannot do that.', ev), /starts: "I am sorry/);
});

test('normalizeEvidence rejects duplicate ids and empty text', () => {
  assert.throws(() => normalizeEvidence({ items: [{ id: 'x', text: 'a' }, { id: 'x', text: 'b' }] }), /duplicate/);
  assert.throws(() => normalizeEvidence({ items: [{ id: 'x', text: '' }] }), /non-empty/);
  assert.throws(() => normalizeEvidence({}), /items/);
});

test('parseIdeas drops ideas that cite evidence that does not exist', () => {
  const ev = normalizeEvidence(evidence);
  const { ideas, dropped } = parseIdeas(JSON.stringify({ ideas: [goodIdea, { ...goodIdea, title: 'Ghost', evidenceRefs: ['nope'] }] }), ev);
  assert.equal(ideas.length, 1);
  assert.equal(dropped.length, 1);
  assert.match(dropped[0].reason, /evidenceRefs/);
});

test('parseIdeas enforces the moonshot rules', () => {
  const ev = normalizeEvidence(evidence);
  const { ideas, dropped } = parseIdeas(JSON.stringify({ ideas: [
    goodIdea,
    moonIdea,
    { ...moonIdea, title: 'Second moonshot' },
    { ...moonIdea, title: 'No cost', costNote: '' },
    { ...goodIdea, title: 'Wrong lens', lens: 'stunt' },
    { ...moonIdea, title: 'Wrong lens 2', lens: 'outsider' }
  ] }), ev);
  assert.deepEqual(ideas.map((i) => i.title), ['Second-opinion booth', 'Debate the balloon']);
  assert.equal(dropped.length, 4);
  assert.equal(ideas[1].costNote, 'About a day of work, no ad spend.');
});

test('parseSelection validates indices, kinds and limits', () => {
  const ideas = [goodIdea, { ...goodIdea, title: 'b' }, { ...goodIdea, title: 'c' }, moonIdea];
  assert.deepEqual(parseSelection('{"practical": [0, 1], "moonshot": 3, "reasons": []}', ideas).practical, [0, 1]);
  assert.equal(parseSelection('{"practical": [], "moonshot": null}', ideas).moonshot, null);
  assert.throws(() => parseSelection('{"practical": [0, 1, 2], "moonshot": null}', ideas), /more than/);
  assert.throws(() => parseSelection('{"practical": [3], "moonshot": null}', ideas), /practical ideas/);
  assert.throws(() => parseSelection('{"practical": [], "moonshot": 0}', ideas), /moonshot/);
  assert.throws(() => parseSelection('{"practical": [9], "moonshot": null}', ideas), /practical ideas/);
  assert.throws(() => parseSelection('{"pick": 0}', ideas), /needs/);
});

test('prompt tells the model to return an empty list rather than a weak idea', () => {
  const prompts = buildWildcardPrompts({ evidence: normalizeEvidence(evidence), contextNotes: [] });
  assert.match(prompts.systemPrompt, /ideas": \[\]/);
  assert.match(prompts.systemPrompt, /MOONSHOT|moonshot/);
  assert.match(prompts.systemPrompt, /must not deceive/);
  assert.match(prompts.userPrompt, /\[e1\]/);
});

test('returns practical ideas and a moonshot when the skeptic keeps them', async () => {
  const result = await runWildcard({
    evidence,
    providerContext: stubContext({ generate: JSON.stringify({ ideas: [goodIdea, moonIdea] }), critique: '{"practical": [0], "moonshot": 1, "reasons": []}' })
  });
  assert.equal(result.status, 'ideas');
  assert.equal(result.practical.length, 1);
  assert.equal(result.moonshot.title, 'Debate the balloon');
});

test('returns only a moonshot, or only practical ideas, when that is all that survives', async () => {
  const gen = JSON.stringify({ ideas: [goodIdea, moonIdea] });
  const onlyMoon = await runWildcard({ evidence, providerContext: stubContext({ generate: gen, critique: '{"practical": [], "moonshot": 1}' }) });
  assert.equal(onlyMoon.status, 'ideas');
  assert.equal(onlyMoon.practical.length, 0);
  const onlyPractical = await runWildcard({ evidence, providerContext: stubContext({ generate: gen, critique: '{"practical": [0], "moonshot": null}' }) });
  assert.equal(onlyPractical.moonshot, null);
  assert.equal(onlyPractical.practical.length, 1);
});

test('returns none when the generator has no idea', async () => {
  const result = await runWildcard({ evidence, providerContext: stubContext({ generate: '{"ideas": []}', critique: 'unused' }) });
  assert.equal(result.status, 'none');
  assert.equal(result.reason, 'no-grounded-idea');
});

test('returns none when the skeptic rejects everything', async () => {
  const result = await runWildcard({
    evidence,
    providerContext: stubContext({ generate: JSON.stringify({ ideas: [goodIdea, moonIdea] }), critique: '{"practical": [], "moonshot": null, "reasons": ["generic"]}' })
  });
  assert.equal(result.status, 'none');
  assert.equal(result.reason, 'skeptic-rejected-all');
});

test('fails closed when the skeptic response is unusable', async () => {
  const result = await runWildcard({
    evidence,
    providerContext: stubContext({ generate: JSON.stringify({ ideas: [goodIdea, moonIdea] }), critique: 'sure, ship it' })
  });
  assert.equal(result.status, 'none');
  assert.match(result.reason, /skeptic-failed/);
});

test('returns none for empty evidence without calling a model', async () => {
  const result = await runWildcard({ evidence: { items: [] }, providerContext: { selection: {}, registry: {} } });
  assert.equal(result.status, 'none');
  assert.equal(result.reason, 'no-evidence');
});

test('wildcard CLI writes wildcard.json and records the brain status', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wildcard-'));
  const evidencePath = path.join(dir, 'evidence.json');
  const { writeFile } = await import('node:fs/promises');
  await writeFile(evidencePath, JSON.stringify(evidence));
  await main(['wildcard', evidencePath, '--out', path.join(dir, 'out')], {
    providerContext: stubContext({ generate: JSON.stringify({ ideas: [goodIdea, moonIdea] }), critique: '{"practical": [0], "moonshot": 1, "reasons": []}' }),
    fetchContextNotesImpl: async () => ({ notes: [{ path: 'notes/x.md', text: 'x' }], status: 'ok', reason: null }),
    now: () => '2026-11-08T00:00:00.000Z'
  });
  const report = JSON.parse(await readFile(path.join(dir, 'out', 'wildcard.json'), 'utf8'));
  assert.equal(report.status, 'ideas');
  assert.equal(report.moonshot.kind, 'moonshot');
  assert.deepEqual(report.brain, { status: 'ok', reason: null, notes: ['notes/x.md'] });
  assert.match(report.disclaimer, /not claims-checked/);
});
