import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateConcepts } from '../lib/concepts.js';
import { critiqueConcepts } from '../lib/critique.js';
import {
  buildQaPrompts,
  formatQaCliSummary,
  qaDirections,
  QA_HEURISTIC_DISCLAIMER
} from '../lib/qa.js';
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

async function createConceptsDir({ brief, generatedProvider = 'claude', calls = [] }) {
  const conceptsDir = await mkdtemp(path.join(os.tmpdir(), 'e3d-qa-concepts-'));
  const payload = JSON.stringify(createConceptBatch());

  await generateConcepts({
    brief,
    outDir: conceptsDir,
    providerContext: {
      selection: {
        conceptGeneration: generatedProvider,
        critique: generatedProvider === 'claude' ? 'openai' : 'claude',
        qa: generatedProvider
      },
      registry: {
        [generatedProvider]: {
          async generate(request) {
            calls.push(request);
            return {
              text: payload,
              usage: { output_tokens: 1 },
              model: `stub-${generatedProvider}-concepts`
            };
          }
        }
      }
    },
    now: () => '2026-10-11T18:00:00.000Z'
  });

  return conceptsDir;
}

async function createCritiqueDir({ conceptsDir, calls = [] }) {
  const critiqueDir = await mkdtemp(path.join(os.tmpdir(), 'e3d-qa-critique-'));
  const sequence = [
    { verdict: 'keep', reasoning: 'Strong operational specificity.', dissent: '' },
    { verdict: 'revise', reasoning: 'Needs a tighter first-three-second escalation.', dissent: 'Confidence is slightly ahead of the evidence.' },
    { verdict: 'revise', reasoning: 'The timing is still too gentle for the objective.', dissent: 'A second pass still needs a sharper hook.' },
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
          async generate(request) {
            calls.push(request);
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
    now: () => '2026-10-11T18:10:00.000Z'
  });

  return critiqueDir;
}

function createQaPayload(direction) {
  return JSON.stringify({
    storyboard: direction.storyboard.map((shot, index) => ({
      timecodeStart: shot.timecodeStart,
      timecodeEnd: shot.timecodeEnd,
      visualDirection: `Style references: contemporary handheld trade-doc realism with polished macro inserts. Shot ${index + 1} frames the HVAC owner in natural shop light, pushes in on the decision moment, and keeps tools, whiteboards, and dispatch context visible for credibility.`,
      audioNotes: `Pacing note: cut decisively into this beat and let the pause land before the next line. Sound-design cues: muted shop hum, notification taps, and one tight whoosh transition that stays grounded rather than cinematic.`,
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
    overallScore: 4.44
  });
}

test('qa prompts require storyboard expansion plus the independent rubric dimensions', async () => {
  const brief = await loadBrief();
  const direction = createConceptBatch().directions[0];
  const prompts = buildQaPrompts({
    brief,
    direction,
    critiqueSummary: {
      debateStatus: 'consensus',
      finalVerdict: 'keep',
      surfacedVerdicts: [{ round: 1, verdict: 'keep', reasoning: 'Strong operational specificity.', dissent: '' }]
    }
  });

  assert.match(prompts.systemPrompt, /fresh evaluation pass/i);
  assert.match(prompts.systemPrompt, /style references/i);
  assert.match(prompts.userPrompt, /Rubric dimensions:/);
  assert.match(prompts.userPrompt, /stopScrollHook: stop-scroll hook/);
  assert.match(prompts.userPrompt, /audioNotes must include pacing notes and sound-design cues/i);
});

test('qa uses a fresh third call and only expands keep-verdict directions', async () => {
  const brief = await loadBrief();
  const conceptCalls = [];
  const critiqueCalls = [];
  const qaCalls = [];
  const conceptsDir = await createConceptsDir({ brief, calls: conceptCalls });
  const critiqueDir = await createCritiqueDir({ conceptsDir, calls: critiqueCalls });
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'e3d-qa-out-'));

  const result = await qaDirections({
    conceptsDir,
    critiqueDir,
    outDir,
    providerContext: {
      registry: {
        claude: {
          async generate(request) {
            qaCalls.push(request);
            return {
              text: createQaPayload(createConceptBatch().directions[0]),
              model: 'stub-claude-qa'
            };
          }
        },
        openai: {
          async generate() {
            throw new Error('qa should not use openai in this scenario');
          }
        }
      }
    },
    now: () => '2026-10-11T18:20:00.000Z'
  });

  assert.equal(result.qaProvider, 'claude');
  assert.equal(result.directions.length, 1);
  assert.equal(result.skipped.length, 2);
  assert.equal(qaCalls.length, 1);
  assert.notStrictEqual(qaCalls[0], conceptCalls[0]);
  assert.notStrictEqual(qaCalls[0], critiqueCalls[0]);
  assert.notEqual(qaCalls[0].systemPrompt, conceptCalls[0].systemPrompt);
  assert.notEqual(qaCalls[0].userPrompt, critiqueCalls[0].userPrompt);
  assert.match(qaCalls[0].systemPrompt, /independent creative QA pass/i);
  assert.match(qaCalls[0].userPrompt, /Rubric dimensions:/);

  const visualDirectionPath = path.join(outDir, 'direction-1.visual-direction.json');
  const visualDirection = JSON.parse(await readFile(visualDirectionPath, 'utf8'));
  assert.match(visualDirection.storyboard[0].visualDirection, /Style references:/);
  assert.match(visualDirection.storyboard[0].audioNotes, /Pacing note:/);
  assert.match(visualDirection.storyboard[0].audioNotes, /Sound-design cues:/);

  assert.equal(
    await readFile(path.join(outDir, 'direction-2.visual-direction.json'), 'utf8').catch(() => null),
    null
  );
});

test('qa artifacts and CLI summary always include the heuristic disclaimer string', async () => {
  const brief = await loadBrief();
  const conceptsDir = await createConceptsDir({ brief });
  const critiqueDir = await createCritiqueDir({ conceptsDir });
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'e3d-qa-disclaimer-'));

  const result = await qaDirections({
    conceptsDir,
    critiqueDir,
    outDir,
    providerContext: {
      registry: {
        claude: {
          async generate() {
            return {
              text: createQaPayload(createConceptBatch().directions[0]),
              model: 'stub-claude-qa'
            };
          }
        }
      }
    },
    now: () => '2026-10-11T18:30:00.000Z'
  });

  const qaArtifact = JSON.parse(await readFile(path.join(outDir, 'direction-1.qa.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(path.join(outDir, 'qa-manifest.json'), 'utf8'));
  const cliSummary = formatQaCliSummary(result);
  const qaArtifactDigest = createHash('sha256')
    .update(await readFile(path.join(outDir, 'direction-1.qa.json'), 'utf8'))
    .digest('hex');

  assert.equal(qaArtifact.disclaimer, QA_HEURISTIC_DISCLAIMER);
  assert.equal(manifest.disclaimer, QA_HEURISTIC_DISCLAIMER);
  assert.equal(result.directions[0].disclaimer, QA_HEURISTIC_DISCLAIMER);
  assert.match(cliSummary, new RegExp(QA_HEURISTIC_DISCLAIMER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(result.directions[0].qaDigest, qaArtifactDigest);
  assert.equal(qaArtifact.expandedDirectionDigest.length, 64);
});
