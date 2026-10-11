import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateConcepts } from '../lib/concepts.js';
import {
  buildCritiquePrompts,
  buildCritiqueVerdictOptions,
  critiqueConcepts
} from '../lib/critique.js';
import { normalizeBriefInput, normalizeDirection, readJsonFile } from '../lib/schema.js';

const fixturesDir = path.join(process.cwd(), 'test', 'fixtures');

async function loadBrief() {
  const brief = await readJsonFile(path.join(fixturesDir, 'brief-valid.json'));
  return normalizeBriefInput(brief, { baseDir: fixturesDir });
}

function createConceptBatch() {
  return {
    directions: [
      {
        directionId: 'direction-1',
        hook: 'Show the owner making decisions in under a minute.',
        premise: 'Lead with operator skepticism, then prove the workflow is grounded in real shop pain.',
        audiencePsychology: 'Skeptical operators need operational specificity before they trust AI claims.',
        script: [
          {
            tag: 'fact',
            text: 'OppScan helps owners of small HVAC shops evaluate opportunities.'
          },
          {
            tag: 'claim',
            text: 'This angle could make the tool feel less like generic automation.'
          }
        ],
        storyboard: [
          {
            timecodeStart: '00:00',
            timecodeEnd: '00:03',
            visualDirection: 'Owner triages leads on a cluttered desk.',
            audioNotes: 'Dry, direct voiceover.',
            onScreenText: 'Stop guessing.'
          }
        ],
        ctaText: 'See which jobs are actually worth chasing.',
        confidence: 0.84,
        rationale: 'High-confidence operational hook.'
      },
      {
        directionId: 'direction-2',
        hook: 'Contrast busywork with reclaimed owner time.',
        premise: 'Frame the ad around reclaiming owner time from chaotic opportunity triage.',
        audiencePsychology: 'Time-starved owners respond to relief from constant context switching.',
        script: [
          {
            tag: 'fact',
            text: 'OppScan helps owners of small HVAC shops evaluate opportunities.'
          },
          {
            tag: 'hypothesis',
            text: 'A calmer rhythm may feel more credible than hype.'
          }
        ],
        storyboard: [
          {
            timecodeStart: '00:00',
            timecodeEnd: '00:03',
            visualDirection: 'Inbox noise disappears as the owner focuses.',
            audioNotes: 'Pace opens up after the hook.',
            onScreenText: 'Get your time back.'
          }
        ],
        ctaText: 'Spend less time sorting and more time closing.',
        confidence: 0.76,
        rationale: 'Time-recovery message for overstretched owners.'
      },
      {
        directionId: 'direction-3',
        hook: 'Make the buyer feel sharper than slower competitors.',
        premise: 'Position the product as the disciplined alternative to generic AI noise.',
        audiencePsychology: 'Status-conscious buyers want to look faster and more disciplined than peers.',
        script: [
          {
            tag: 'fact',
            text: 'OppScan helps owners of small HVAC shops evaluate opportunities.'
          },
          {
            tag: 'claim',
            text: 'This framing may create a stronger competitive identity.'
          }
        ],
        storyboard: [
          {
            timecodeStart: '00:00',
            timecodeEnd: '00:03',
            visualDirection: 'Split-screen of disciplined vs. chaotic decision-making.',
            audioNotes: 'Sharper, more assertive read.',
            onScreenText: 'Move faster than the shops still guessing.'
          }
        ],
        ctaText: 'Choose the disciplined path.',
        confidence: 0.81,
        rationale: 'Competitive-status framing.'
      }
    ]
  };
}

async function createConceptsDir({ brief, generatedProvider = 'claude' }) {
  const conceptsDir = await mkdtemp(path.join(os.tmpdir(), 'e3d-critique-concepts-'));
  const conceptPayload = JSON.stringify(createConceptBatch());
  const providerContext = {
    selection: { conceptGeneration: generatedProvider, critique: generatedProvider === 'claude' ? 'openai' : 'claude' },
    registry: {
      [generatedProvider]: {
        async generate() {
          return {
            text: conceptPayload,
            usage: { output_tokens: 1 },
            model: `stub-${generatedProvider}-concepts`
          };
        }
      }
    }
  };

  await generateConcepts({
    brief,
    outDir: conceptsDir,
    providerContext,
    now: () => '2026-10-11T16:00:00.000Z'
  });

  return conceptsDir;
}

test('critique uses a different provider than generation by default, unless explicitly overridden', async () => {
  const brief = await loadBrief();
  const conceptsDir = await createConceptsDir({ brief, generatedProvider: 'claude' });

  const defaultCalls = [];
  const defaultOutDir = await mkdtemp(path.join(os.tmpdir(), 'e3d-critique-default-'));
  const defaultResult = await critiqueConcepts({
    conceptsDir,
    outDir: defaultOutDir,
    providerContext: {
      registry: {
        claude: {
          async generate() {
            defaultCalls.push('claude');
            return {
              text: JSON.stringify({ verdict: 'keep', reasoning: 'No changes needed.', dissent: '' }),
              model: 'stub-claude-critique'
            };
          }
        },
        openai: {
          async generate() {
            defaultCalls.push('openai');
            return {
              text: JSON.stringify({ verdict: 'keep', reasoning: 'No changes needed.', dissent: '' }),
              model: 'stub-openai-critique'
            };
          }
        }
      }
    },
    now: () => '2026-10-11T16:10:00.000Z'
  });

  assert.equal(defaultResult.critiqueProvider, 'openai');
  assert.deepEqual(defaultCalls, ['openai', 'openai', 'openai']);

  const overrideCalls = [];
  const overrideOutDir = await mkdtemp(path.join(os.tmpdir(), 'e3d-critique-override-'));
  const overrideResult = await critiqueConcepts({
    conceptsDir,
    outDir: overrideOutDir,
    cliOptions: { critiqueProvider: 'claude' },
    providerContext: {
      registry: {
        claude: {
          async generate() {
            overrideCalls.push('claude');
            return {
              text: JSON.stringify({ verdict: 'keep', reasoning: 'Override accepted.', dissent: '' }),
              model: 'stub-claude-critique'
            };
          }
        },
        openai: {
          async generate() {
            overrideCalls.push('openai');
            return {
              text: JSON.stringify({ verdict: 'keep', reasoning: 'Should not be used.', dissent: '' }),
              model: 'stub-openai-critique'
            };
          }
        }
      }
    },
    now: () => '2026-10-11T16:11:00.000Z'
  });

  assert.equal(overrideResult.critiqueProvider, 'claude');
  assert.deepEqual(overrideCalls, ['claude', 'claude', 'claude']);
});

test('two disagreeing critique rounds are both recorded and surfaced without averaging', async () => {
  const brief = await loadBrief();
  const conceptsDir = await createConceptsDir({ brief, generatedProvider: 'claude' });
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'e3d-critique-rounds-'));

  let calls = 0;
  const result = await critiqueConcepts({
    conceptsDir,
    outDir,
    providerContext: {
      registry: {
        openai: {
          async generate() {
            calls += 1;
            if (calls === 1) {
              return {
                text: JSON.stringify({
                  verdict: 'revise',
                  reasoning: 'Hook is promising but still too cautious for the stated objective.',
                  dissent: 'The generator is more confident than the evidence warrants.'
                }),
                model: 'stub-openai-critique'
              };
            }
            return {
              text: JSON.stringify({
                verdict: 'reject',
                reasoning: 'Even after reconsideration, the concept is still not differentiated enough.',
                dissent: 'High generation confidence does not overcome the weak strategic separation.'
              }),
              model: 'stub-openai-critique'
            };
          }
        }
      }
    },
    now: () => '2026-10-11T16:20:00.000Z'
  });

  const manifest = JSON.parse(await readFile(path.join(outDir, 'critique-manifest.json'), 'utf8'));
  const firstDirection = manifest.directions[0];

  assert.equal(result.directions[0].debateStatus, 'disputed');
  assert.equal(result.directions[0].finalVerdict, null);
  assert.equal(result.directions[0].surfacedVerdicts.length, 2);
  assert.equal(firstDirection.rounds.length, 2);
  assert.deepEqual(
    result.directions[0].surfacedVerdicts.map((entry) => entry.verdict),
    ['revise', 'reject']
  );

  for (const round of firstDirection.rounds) {
    const filePath = path.join(outDir, round.file);
    const content = await readFile(filePath, 'utf8');
    assert.equal(round.digest, createHash('sha256').update(content).digest('hex'));
  }

  const summaryPath = path.join(outDir, result.directions[0].critiqueFile);
  const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
  assert.equal(summary.debateStatus, 'disputed');
  assert.equal(summary.finalVerdict, null);
  assert.deepEqual(
    summary.surfacedVerdicts.map((entry) => entry.verdict),
    ['revise', 'reject']
  );
});

test('retain-existing-creative is offered only when baselineRef exists', async () => {
  const briefWithBaseline = await loadBrief();
  const sampleDirection = normalizeDirection(createConceptBatch().directions[0]);

  const withBaseline = buildCritiquePrompts({
    brief: briefWithBaseline,
    direction: sampleDirection,
    round: 1
  });
  assert.deepEqual(buildCritiqueVerdictOptions(briefWithBaseline), [
    'keep',
    'revise',
    'reject',
    'retain-existing-creative'
  ]);
  assert.match(withBaseline.userPrompt, /retain existing creative/i);

  const briefWithoutBaseline = {
    ...briefWithBaseline,
    baselineRef: null
  };
  const withoutBaseline = buildCritiquePrompts({
    brief: briefWithoutBaseline,
    direction: sampleDirection,
    round: 1
  });
  assert.deepEqual(buildCritiqueVerdictOptions(briefWithoutBaseline), [
    'keep',
    'revise',
    'reject'
  ]);
  assert.doesNotMatch(withoutBaseline.userPrompt, /retain existing creative/i);
});
