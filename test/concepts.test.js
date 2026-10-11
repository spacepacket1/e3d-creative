import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildConceptGenerationPrompts,
  findNearDuplicatePremises,
  generateConcepts,
  normalizeGeneratedDirections
} from '../lib/concepts.js';
import { normalizeBriefInput, readJsonFile } from '../lib/schema.js';

const fixturesDir = path.join(process.cwd(), 'test', 'fixtures');

async function loadBrief() {
  const brief = await readJsonFile(path.join(fixturesDir, 'brief-valid.json'));
  return normalizeBriefInput(brief, { baseDir: fixturesDir });
}

function createConceptBatch(premises) {
  return {
    directions: premises.map((premise, index) => ({
      directionId: `direction-${index + 1}`,
      hook: `Hook ${index + 1}`,
      premise,
      audiencePsychology: [
        'Skeptical operators want competence before polish.',
        'Time-starved owners respond to operational relief.',
        'Status-conscious buyers want to look sharper than slower competitors.'
      ][index],
      script: [
        {
          tag: 'fact',
          text: 'OppScan helps owners of small HVAC shops evaluate opportunities.'
        },
        {
          tag: 'claim',
          text: `This angle can make the offer feel more relevant to mindset ${index + 1}.`
        },
        {
          tag: 'hypothesis',
          text: `A different emotional framing may improve stop-scroll performance for concept ${index + 1}.`
        }
      ],
      storyboard: [
        {
          timecodeStart: '00:00',
          timecodeEnd: '00:03',
          visualDirection: `Visual beat ${index + 1}A`,
          audioNotes: `Audio beat ${index + 1}A`,
          onScreenText: `Text beat ${index + 1}A`
        },
        {
          timecodeStart: '00:03',
          timecodeEnd: '00:09',
          visualDirection: `Visual beat ${index + 1}B`,
          audioNotes: `Audio beat ${index + 1}B`,
          onScreenText: `Text beat ${index + 1}B`
        }
      ],
      ctaText: `CTA ${index + 1}`,
      confidence: 0.7 + (index * 0.05),
      rationale: `Rationale ${index + 1}`
    }))
  };
}

test('concept prompts explicitly require audience-psychology diversity and fact-tag consistency', async () => {
  const brief = await loadBrief();
  const { systemPrompt, userPrompt } = buildConceptGenerationPrompts(brief);

  assert.match(systemPrompt, /genuinely distinct in audience psychology/i);
  assert.match(systemPrompt, /only tag a line as "fact" when it is directly traceable to the brief/i);
  assert.match(userPrompt, /different viewer mindset or buying resistance pattern/i);
  assert.match(userPrompt, /No fact-tagged line may rely on information outside this brief/i);
});

test('near-duplicate premise detection is deterministic', () => {
  const duplicate = findNearDuplicatePremises([
    { premise: 'Lead with operator frustration, then show a tighter decision loop.' },
    { premise: 'Lead with operator frustration, then show a tighter decision-making loop.' },
    { premise: 'Turn the ad into a competitive-status flex for shops that want to look faster.' }
  ]);

  assert.ok(duplicate);
  assert.equal(duplicate.leftIndex, 0);
  assert.equal(duplicate.rightIndex, 1);
});

test('fact-tag sanity check rejects untraceable lines before writing files', async () => {
  const brief = await loadBrief();

  assert.throws(() => normalizeGeneratedDirections([
    {
      directionId: 'direction-1',
      hook: 'Hook 1',
      premise: 'Premise 1',
      audiencePsychology: 'Audience 1',
      script: [
        { tag: 'fact', text: 'Lantern pilots whisper to velvet glaciers.' }
      ],
      storyboard: [
        {
          timecodeStart: '00:00',
          timecodeEnd: '00:03',
          visualDirection: 'Visual',
          audioNotes: 'Audio',
          onScreenText: 'Text'
        }
      ],
      ctaText: 'CTA',
      confidence: 0.5,
      rationale: 'Why'
    },
    {
      directionId: 'direction-2',
      hook: 'Hook 2',
      premise: 'Premise 2',
      audiencePsychology: 'Audience 2',
      script: [
        { tag: 'fact', text: 'Lantern pilots whisper to velvet glaciers.' }
      ],
      storyboard: [
        {
          timecodeStart: '00:00',
          timecodeEnd: '00:03',
          visualDirection: 'Visual',
          audioNotes: 'Audio',
          onScreenText: 'Text'
        }
      ],
      ctaText: 'CTA',
      confidence: 0.5,
      rationale: 'Why'
    },
    {
      directionId: 'direction-3',
      hook: 'Hook 3',
      premise: 'Premise 3',
      audiencePsychology: 'Audience 3',
      script: [
        { tag: 'fact', text: 'Lantern pilots whisper to velvet glaciers.' }
      ],
      storyboard: [
        {
          timecodeStart: '00:00',
          timecodeEnd: '00:03',
          visualDirection: 'Visual',
          audioNotes: 'Audio',
          onScreenText: 'Text'
        }
      ],
      ctaText: 'CTA',
      confidence: 0.5,
      rationale: 'Why'
    }
  ], brief), /not traceable to the brief/);
});

test('concept generation fails loudly after one regeneration when premises stay near-duplicate', async () => {
  const brief = await loadBrief();
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'e3d-concepts-dup-'));
  const payload = JSON.stringify(createConceptBatch([
    'Lead with operator frustration, then show a tighter decision loop.',
    'Lead with operator frustration, then show a tighter decision-making loop.',
    'Lead with operator frustration first, then show the tighter decision loop.'
  ]));

  let calls = 0;
  const providerContext = {
    selection: { conceptGeneration: 'openai', critique: 'claude' },
    registry: {
      openai: {
        async generate(request) {
          calls += 1;
          return { text: payload, usage: { output_tokens: 10 }, model: 'stub-concepts-v1' };
        }
      }
    }
  };

  await assert.rejects(
    generateConcepts({
      brief,
      outDir,
      providerContext,
      now: () => '2026-10-11T15:00:00.000Z'
    }),
    /concept diversity check failed after 2 attempts/i
  );

  assert.equal(calls, 2);
});

test('concept generation writes three distinct validated directions and a provenance manifest', async () => {
  const brief = await loadBrief();
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'e3d-concepts-ok-'));
  const payload = JSON.stringify(createConceptBatch([
    'Start with operator skepticism and prove the workflow is grounded in real shop pain.',
    'Frame the ad around reclaiming owner time from chaotic opportunity triage.',
    'Position the product as the sharper, more disciplined alternative to generic AI noise.'
  ]));

  let capturedRequest = null;
  const providerContext = {
    selection: { conceptGeneration: 'claude', critique: 'openai' },
    registry: {
      claude: {
        async generate(request) {
          capturedRequest = request;
          return { text: payload, usage: { output_tokens: 11 }, model: 'stub-claude-concepts' };
        }
      }
    }
  };

  const result = await generateConcepts({
    brief,
    outDir,
    providerContext,
    now: () => '2026-10-11T15:30:00.000Z'
  });

  assert.equal(result.directions.length, 3);
  assert.equal(result.provider, 'claude');
  assert.equal(result.model, 'stub-claude-concepts');
  assert.match(capturedRequest.systemPrompt, /genuinely distinct in audience psychology/i);
  assert.match(capturedRequest.userPrompt, /No fact-tagged line may rely on information outside this brief/i);

  const manifestPath = path.join(outDir, 'concepts-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(manifest.briefDigest.length, 64);
  assert.equal(manifest.provider, 'claude');
  assert.equal(manifest.model, 'stub-claude-concepts');
  assert.equal(manifest.generatedAt, '2026-10-11T15:30:00.000Z');
  assert.equal(manifest.directions.length, 3);

  for (const entry of manifest.directions) {
    const filePath = path.join(outDir, entry.file);
    const content = await readFile(filePath, 'utf8');
    assert.equal(entry.digest.length, 64);
    assert.equal(entry.digest, createHash('sha256').update(content).digest('hex'));
    const parsed = JSON.parse(content);
    assert.equal(parsed.directionId, entry.directionId);
  }
});
