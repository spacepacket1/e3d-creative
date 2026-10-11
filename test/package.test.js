import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { main } from '../lib/cli.js';
import { generateConcepts } from '../lib/concepts.js';
import { critiqueConcepts } from '../lib/critique.js';
import { packageDirection } from '../lib/package.js';
import { qaDirections } from '../lib/qa.js';
import { normalizeBriefInput, readJsonFile } from '../lib/schema.js';

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
            visualDirection: 'Owner triages leads at a cluttered desk.',
            audioNotes: 'Dry, direct voiceover.',
            onScreenText: 'Stop guessing.'
          },
          {
            timecodeStart: '00:03',
            timecodeEnd: '00:08',
            visualDirection: 'Lead list narrows to the most promising jobs.',
            audioNotes: 'Pace opens slightly.',
            onScreenText: 'See the jobs worth chasing.'
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
            audioNotes: 'Start stressed, then soften.',
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
            visualDirection: 'Split-screen of disciplined versus chaotic decision-making.',
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

async function createConceptsDir({ brief }) {
  const conceptsDir = await mkdtemp(path.join(os.tmpdir(), 'e3d-package-concepts-'));
  const payload = JSON.stringify(createConceptBatch());

  await generateConcepts({
    brief,
    outDir: conceptsDir,
    providerContext: {
      selection: {
        conceptGeneration: 'claude',
        critique: 'openai',
        qa: 'claude'
      },
      registry: {
        claude: {
          async generate() {
            return {
              text: payload,
              usage: { output_tokens: 1 },
              model: 'stub-claude-concepts'
            };
          }
        }
      }
    },
    now: () => '2026-10-11T19:00:00.000Z'
  });

  return conceptsDir;
}

async function createCritiqueDir({ conceptsDir }) {
  const critiqueDir = await mkdtemp(path.join(os.tmpdir(), 'e3d-package-critique-'));
  const sequence = [
    { verdict: 'keep', reasoning: 'Strong operational specificity.', dissent: '' },
    { verdict: 'keep', reasoning: 'The time-savings angle is credible enough to keep.', dissent: '' },
    { verdict: 'reject', reasoning: 'Competitive posturing outruns the product proof.', dissent: 'Confidence is too high for this level of support.' },
    { verdict: 'reject', reasoning: 'Even after reconsideration, the concept remains too abstract.', dissent: 'The rebuttal did not fix the evidence gap.' }
  ];
  let index = 0;

  await critiqueConcepts({
    conceptsDir,
    outDir: critiqueDir,
    providerContext: {
      registry: {
        openai: {
          async generate() {
            const response = sequence[index];
            index += 1;
            return {
              text: JSON.stringify(response),
              model: 'stub-openai-critique'
            };
          }
        }
      }
    },
    now: () => '2026-10-11T19:10:00.000Z'
  });

  return critiqueDir;
}

function createQaPayload(direction) {
  return JSON.stringify({
    storyboard: direction.storyboard.map((shot, index) => ({
      timecodeStart: shot.timecodeStart,
      timecodeEnd: shot.timecodeEnd,
      visualDirection: `Style references: modern trade-documentary realism with polished macro inserts. Shot ${index + 1} keeps the HVAC context visible, sharpens framing around the decision moment, and uses natural light plus precise overlays for clarity.`,
      audioNotes: `Pacing note: cut decisively into this shot and leave room for the line to land. Sound-design cues: grounded shop tone, one notification tap, and a restrained whoosh into the next beat.`,
      onScreenText: `${shot.onScreenText} | Overlay: ${direction.ctaText}`
    })),
    rubric: {
      stopScrollHook: { score: 5, reasoning: 'The first beat is immediate and operationally specific.' },
      narrativeArc: { score: 4, reasoning: 'The structure escalates from pain to focus to payoff with only minor compression risk.' },
      clarityOfValueProp: { score: 5, reasoning: 'The product role is explicit and easy to infer from the shot plan.' },
      authenticity: { score: 4, reasoning: 'The trade context feels grounded, though execution still depends on casting discipline.' },
      productionQualityExpectation: { score: 4, reasoning: 'The visual notes are premium enough to brief a modern generator or production team.' },
      factualDefensibility: { score: 5, reasoning: 'Nothing in the treatment exceeds what the brief supports.' },
      brandFit: { score: 4, reasoning: 'The tone stays practical and aligned with a product for HVAC owners.' },
      ctaStrength: { score: 4, reasoning: 'The CTA is clear, though it could be slightly more urgent.' },
      audienceFit: { score: 5, reasoning: 'The concept speaks directly to small-shop owners juggling opportunity triage.' }
    },
    summary: 'The concept is strongest when it stays specific about owner workflow; avoid over-stylizing the execution.',
    overallScore: direction.directionId === 'direction-1' ? 4.44 : 4.11
  });
}

async function createQaDir({ conceptsDir, critiqueDir }) {
  const qaDir = await mkdtemp(path.join(os.tmpdir(), 'e3d-package-qa-'));
  const directions = new Map(
    createConceptBatch().directions.map((direction) => [direction.directionId, direction])
  );

  await qaDirections({
    conceptsDir,
    critiqueDir,
    outDir: qaDir,
    providerContext: {
      registry: {
        claude: {
          async generate(request) {
            const directionId = request.userPrompt.includes('"directionId": "direction-2"')
              ? 'direction-2'
              : 'direction-1';
            return {
              text: createQaPayload(directions.get(directionId)),
              model: 'stub-claude-qa'
            };
          }
        }
      }
    },
    now: () => '2026-10-11T19:20:00.000Z'
  });

  return qaDir;
}

async function createPhaseFiveOutputs() {
  const brief = await loadBrief();
  const conceptsDir = await createConceptsDir({ brief });
  const critiqueDir = await createCritiqueDir({ conceptsDir });
  const qaDir = await createQaDir({ conceptsDir, critiqueDir });

  return {
    qaDir,
    directionOnePath: path.join(qaDir, 'direction-1.visual-direction.json'),
    directionTwoPath: path.join(qaDir, 'direction-2.visual-direction.json')
  };
}

function assertCastManifestShape(reduction) {
  assert.equal(reduction.kind, 'cast_job');
  assert.equal(reduction.version, 1);
  assert.equal(typeof reduction.jobId, 'string');
  assert.match(reduction.jobId, /^e3d-creative-direction-/);
  assert.deepEqual(Object.keys(reduction.input).sort(), ['kind', 'text']);
  assert.equal(reduction.input.kind, 'transcript');
  assert.equal(typeof reduction.input.text, 'string');
  assert.ok(reduction.input.text.length > 0);
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

test('packaging emits a cast-compatible reduction with the expected cast_job transcript shape', async () => {
  const { directionOnePath } = await createPhaseFiveOutputs();
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'e3d-package-out-'));

  const result = await packageDirection({
    directionPath: directionOnePath,
    outDir,
    now: () => '2026-10-11T19:30:00.000Z'
  });

  const reduction = JSON.parse(await readFile(result.castCompatiblePath, 'utf8'));
  const richArtifact = JSON.parse(await readFile(result.richArtifactPath, 'utf8'));

  assertCastManifestShape(reduction);
  assert.equal(
    reduction.input.text,
    [
      'OppScan helps owners of small HVAC shops evaluate opportunities.',
      'This angle could make the tool feel less like generic automation.'
    ].join('\n')
  );
  assert.equal(reduction.sourceDirectionId, 'direction-1');
  assert.equal(reduction.sourceRichArtifactDigest, result.richArtifactDigest);
  assert.equal(
    result.richArtifactDigest,
    createHash('sha256').update(await readFile(result.richArtifactPath, 'utf8')).digest('hex')
  );
  assert.equal(richArtifact.qa.overallScore, 4.44);
  assert.equal(richArtifact.verdict.finalVerdict, 'keep');
});

test('unconsumedByCurrentPipeline lists every rich field dropped by the transcript-only reduction', async () => {
  const { directionOnePath } = await createPhaseFiveOutputs();
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'e3d-package-drops-'));

  const result = await packageDirection({
    directionPath: directionOnePath,
    outDir,
    now: () => '2026-10-11T19:40:00.000Z'
  });
  const reduction = JSON.parse(await readFile(result.castCompatiblePath, 'utf8'));

  assert.deepEqual(reduction.unconsumedByCurrentPipeline, [
    'audiencePsychology',
    'confidence',
    'ctaText',
    'hook',
    'premise',
    'qa.disclaimer',
    'qa.overallScore',
    'qa.rubric',
    'qa.summary',
    'rationale',
    'script.tag',
    'shot.audioNotes',
    'shot.onScreenText',
    'shot.timecodeEnd',
    'shot.timecodeStart',
    'shot.visualDirection',
    'verdict.debateStatus',
    'verdict.finalVerdict'
  ]);
});

test('--list output shows each packaged direction id, verdict, QA score summary, and digest', async () => {
  const { directionOnePath, directionTwoPath } = await createPhaseFiveOutputs();
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'e3d-package-list-'));

  await packageDirection({
    directionPath: directionOnePath,
    outDir,
    now: () => '2026-10-11T19:50:00.000Z'
  });

  const output = await captureStdout(async () => {
    await main(['package', directionTwoPath, '--out', outDir, '--list']);
  });
  const manifest = JSON.parse(await readFile(path.join(outDir, 'package-manifest.json'), 'utf8'));

  assert.match(output, /packaged directions: 2 ->/);
  assert.match(output, /direction-1\tkeep\tqa 4\.44\/5\t[0-9a-f]{64}/);
  assert.match(output, /direction-2\tkeep\tqa 4\.11\/5\t[0-9a-f]{64}/);
  assert.equal(manifest.directions.length, 2);
  assert.equal(manifest.directions[0].finalVerdict, 'keep');
  assert.equal(manifest.directions[1].finalVerdict, 'keep');
});
