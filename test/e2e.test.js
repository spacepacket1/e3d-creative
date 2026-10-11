import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { main } from '../lib/cli.js';
import { normalizeBriefInput, readJsonFile } from '../lib/schema.js';

const rootDir = process.cwd();
const examplesDir = path.join(rootDir, 'examples');

function createConceptBatch() {
  return {
    directions: [
      {
        directionId: 'direction-1',
        hook: 'Start on the owner killing bad jobs before they steal the day.',
        premise: 'Lead with operator skepticism, then prove the workflow is grounded in real HVAC shop pain.',
        audiencePsychology: 'Skeptical operators need concrete workflow specificity before they trust any AI positioning.',
        script: [
          {
            tag: 'fact',
            text: 'OppScan helps owners of small HVAC shops evaluate opportunities.'
          },
          {
            tag: 'claim',
            text: 'This angle may make the product feel like a disciplined filter instead of generic automation.'
          }
        ],
        storyboard: [
          {
            timecodeStart: '00:00',
            timecodeEnd: '00:03',
            visualDirection: 'Owner triages a whiteboard and inbox at the dispatch desk.',
            audioNotes: 'Dry, direct read with no hype.',
            onScreenText: 'Stop chasing every job.'
          },
          {
            timecodeStart: '00:03',
            timecodeEnd: '00:08',
            visualDirection: 'Opportunity list narrows to the jobs worth quoting.',
            audioNotes: 'Pace opens as the workflow clarifies.',
            onScreenText: 'See the work worth pursuing.'
          }
        ],
        ctaText: 'See which jobs are actually worth chasing.',
        confidence: 0.84,
        rationale: 'Operational specificity gives the brief its strongest factual footing.'
      },
      {
        directionId: 'direction-2',
        hook: 'Contrast frantic multitasking with a calmer close-of-day plan.',
        premise: 'Frame the ad around reclaiming owner time from chaotic opportunity triage.',
        audiencePsychology: 'Time-starved owners respond to relief from constant context switching and rework.',
        script: [
          {
            tag: 'fact',
            text: 'OppScan helps owners of small HVAC shops evaluate opportunities.'
          },
          {
            tag: 'hypothesis',
            text: 'A calmer rhythm may feel more credible than a louder performance promise.'
          }
        ],
        storyboard: [
          {
            timecodeStart: '00:00',
            timecodeEnd: '00:03',
            visualDirection: 'Notification chaos drops away as the owner focuses on the next best jobs.',
            audioNotes: 'Start tense, then release into steadier pacing.',
            onScreenText: 'Get your time back.'
          }
        ],
        ctaText: 'Spend less time sorting and more time closing.',
        confidence: 0.77,
        rationale: 'The time-recovery message matches the audience’s daily frustration.'
      },
      {
        directionId: 'direction-3',
        hook: 'Make the buyer feel sharper than shops still guessing.',
        premise: 'Position the product as the disciplined alternative to generic AI noise.',
        audiencePsychology: 'Status-conscious buyers want to look faster and more disciplined than slower competitors.',
        script: [
          {
            tag: 'fact',
            text: 'OppScan helps owners of small HVAC shops evaluate opportunities.'
          },
          {
            tag: 'claim',
            text: 'This framing may build a stronger competitive identity if the proof stays concrete.'
          }
        ],
        storyboard: [
          {
            timecodeStart: '00:00',
            timecodeEnd: '00:03',
            visualDirection: 'Split-screen of disciplined versus chaotic decision-making.',
            audioNotes: 'Sharper, more assertive delivery.',
            onScreenText: 'Move faster than shops still guessing.'
          }
        ],
        ctaText: 'Choose the disciplined path.',
        confidence: 0.81,
        rationale: 'Competitive posture creates a distinct angle, but it is easier to overstate.'
      }
    ]
  };
}

function createQaPayload(direction) {
  return JSON.stringify({
    storyboard: direction.storyboard.map((shot, index) => ({
      timecodeStart: shot.timecodeStart,
      timecodeEnd: shot.timecodeEnd,
      visualDirection: `Style references: modern trade-documentary realism with clean overlays and precise macro details. Shot ${index + 1} keeps the HVAC context visible, sharpens the framing around the decision moment, and uses natural light plus restrained motion for credibility.`,
      audioNotes: `Pacing note: cut decisively into this beat and leave room for the line to land. Sound-design cues: grounded shop tone, one notification tap, and a restrained whoosh into the next beat.`,
      onScreenText: `${shot.onScreenText} | Overlay: ${direction.ctaText}`
    })),
    rubric: {
      stopScrollHook: { score: 5, reasoning: 'The opening beat is immediate and operationally specific.' },
      narrativeArc: { score: 4, reasoning: 'The treatment escalates cleanly from pain to payoff.' },
      clarityOfValueProp: { score: 5, reasoning: 'The product role is explicit without excess abstraction.' },
      authenticity: { score: 4, reasoning: 'The trade setting feels grounded, though execution still depends on casting discipline.' },
      productionQualityExpectation: { score: 4, reasoning: 'The shot notes are concrete enough for a modern generator or production team.' },
      factualDefensibility: { score: 5, reasoning: 'The treatment stays inside the factual bounds of the brief.' },
      brandFit: { score: 4, reasoning: 'The tone stays practical and aligned with HVAC-owner decision making.' },
      ctaStrength: { score: 4, reasoning: 'The CTA is clear even if it could be slightly more urgent.' },
      audienceFit: { score: 5, reasoning: 'The concept speaks directly to small-shop owners juggling opportunity triage.' }
    },
    summary: 'The strongest versions stay specific about owner workflow and avoid over-stylizing the execution.',
    overallScore: direction.directionId === 'direction-1' ? 4.44 : 4.11
  });
}

function createStubProviderContext() {
  const directions = new Map(
    createConceptBatch().directions.map((direction) => [direction.directionId, direction])
  );
  const critiqueSequence = [
    { verdict: 'keep', reasoning: 'The workflow specificity is strong enough to keep.', dissent: '' },
    { verdict: 'keep', reasoning: 'The time-recovery framing is credible and clear.', dissent: '' },
    { verdict: 'reject', reasoning: 'The competitive posturing outruns the product proof.', dissent: 'Confidence is ahead of the evidence.' },
    { verdict: 'reject', reasoning: 'A second pass still leaves the proof too abstract.', dissent: 'The rebuttal did not fix the evidence gap.' }
  ];
  let critiqueIndex = 0;

  return {
    selection: {
      conceptGeneration: 'claude',
      critique: 'openai',
      qa: 'claude'
    },
    registry: {
      claude: {
        async generate(request) {
          if (request.systemPrompt.includes('You generate creative directions as strict JSON.')) {
            return {
              text: JSON.stringify(createConceptBatch()),
              usage: { output_tokens: 1 },
              model: 'stub-claude-concepts'
            };
          }

          const directionId = request.userPrompt.includes('"directionId": "direction-2"')
            ? 'direction-2'
            : 'direction-1';
          return {
            text: createQaPayload(directions.get(directionId)),
            usage: { output_tokens: 1 },
            model: 'stub-claude-qa'
          };
        }
      },
      openai: {
        async generate() {
          const response = critiqueSequence[critiqueIndex];
          critiqueIndex += 1;
          return {
            text: JSON.stringify(response),
            usage: { completion_tokens: 1 },
            model: 'stub-openai-critique'
          };
        }
      }
    }
  };
}

async function captureStdout(run) {
  let output = '';
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk, encoding, callback) => {
    output += String(chunk);
    if (typeof encoding === 'function') {
      encoding();
    } else if (typeof callback === 'function') {
      callback();
    }
    return true;
  };

  try {
    await run();
  } finally {
    process.stdout.write = originalWrite;
  }

  return output;
}

test('run command executes phases 3-6 end to end against stub providers with the sample brief', async () => {
  const briefPath = path.join(examplesDir, 'sample-brief.json');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'e3d-e2e-run-'));
  const output = await captureStdout(async () => {
    await main(['run', briefPath, '--out', outDir], {
      providerContext: createStubProviderContext(),
      now: () => '2026-10-11T20:00:00.000Z'
    });
  });

  assert.match(output, /run complete: 3 directions, 2 keep verdicts, 2 packaged directions/i);

  const conceptsManifest = await readJsonFile(path.join(outDir, 'concepts', 'concepts-manifest.json'));
  const critiqueManifest = await readJsonFile(path.join(outDir, 'critique', 'critique-manifest.json'));
  const qaManifest = await readJsonFile(path.join(outDir, 'qa', 'qa-manifest.json'));
  const packageManifest = await readJsonFile(path.join(outDir, 'package', 'package-manifest.json'));

  assert.equal(conceptsManifest.directions.length, 3);
  assert.ok(critiqueManifest.directions.some((direction) => direction.finalVerdict === 'keep'));
  assert.ok(qaManifest.directions.length >= 1);
  assert.ok(qaManifest.directions.every((direction) => typeof direction.overallScore === 'number'));
  assert.ok(packageManifest.directions.length >= 1);

  const firstPackage = packageManifest.directions[0];
  const castCompatible = await readJsonFile(path.join(outDir, 'package', firstPackage.castCompatibleFile));
  assert.ok(Array.isArray(castCompatible.unconsumedByCurrentPipeline));
  assert.ok(castCompatible.unconsumedByCurrentPipeline.length > 0);
  assert.ok(castCompatible.unconsumedByCurrentPipeline.includes('shot.visualDirection'));
});

test('sample brief validates and README documents the current offline scope and usage', async () => {
  const briefPath = path.join(examplesDir, 'sample-brief.json');
  const brief = await readJsonFile(briefPath);
  const normalizedBrief = await normalizeBriefInput(brief, { baseDir: examplesDir });
  assert.equal(normalizedBrief.baselineRef, null);

  const readme = await readFile(path.join(rootDir, 'README.md'), 'utf8');
  assert.match(readme, /## Brief Schema/);
  assert.match(readme, /## Direction Schema/);
  assert.match(readme, /## CLI/);
  assert.match(readme, /## Provider Configuration/);
  assert.match(readme, /no rendering/i);
  assert.match(readme, /no e3d-corp integration/i);
  assert.match(readme, /no spend authority/i);
  assert.match(readme, /examples\/sample-brief\.json/);
});
