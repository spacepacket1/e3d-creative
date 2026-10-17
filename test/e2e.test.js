import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { main } from '../lib/cli.js';
import { normalizeBriefInput, readJsonFile } from '../lib/schema.js';

const rootDir = process.cwd();
const examplesDir = path.join(rootDir, 'examples');
const fixturesDir = path.join(rootDir, 'test', 'fixtures');
const brainStubPath = path.join(fixturesDir, 'brain-stub.js');

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

function createStubProviderContext({ checkAssertions = () => [], callCounters } = {}) {
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
  const counters = callCounters ?? {
    generation: 0,
    critique: 0,
    qa: 0,
    claimsCheck: 0
  };

  return {
    selection: {
      conceptGeneration: 'claude',
      critique: 'openai',
      qa: 'claude'
    },
    registry: {
      claude: {
        name: 'claude',
        async generate(request) {
          if (request.systemPrompt.includes('You generate creative directions as strict JSON.')) {
            counters.generation += 1;
            return {
              text: JSON.stringify(createConceptBatch()),
              usage: { output_tokens: 1 },
              model: 'stub-claude-concepts'
            };
          }

          counters.qa += 1;
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
        name: 'openai',
        async generate(request) {
          if (request.systemPrompt.includes('You check a creative direction against approved-claims reference data and return strict JSON.')) {
            counters.claimsCheck += 1;
            return {
              text: JSON.stringify({
                assertions: checkAssertions(request)
              }),
              usage: { completion_tokens: 1 },
              model: 'stub-openai-check'
            };
          }

          counters.critique += 1;
          const response = critiqueSequence[critiqueIndex];
          critiqueIndex += 1;
          return {
            text: JSON.stringify(response),
            usage: { completion_tokens: 1 },
            model: 'stub-openai-critique'
          };
        }
      }
    },
    callCounters: counters
  };
}

function metadataFor(pathValue, overrides = {}) {
  const metadata = {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    provisional: false,
    rev: '0123456789abcdef',
    status: 'approved',
    kind: 'product-claim',
    path: pathValue,
    ...overrides
  };
  metadata.citation = `note:${metadata.id}@${metadata.rev}`;
  return metadata;
}

function claimNoteText({
  product = 'OppScan (sanitized sample)',
  claim = 'OppScan helps owners of small HVAC shops evaluate opportunities.',
  allowedWording = 'Describe it as helping owners evaluate opportunities.',
  forbiddenWording = ['guaranteed close rate increase'],
  approvedBy = 'Ada Lovelace',
  approvedOn = '2026-10-10',
  expires = '2026-12-31'
} = {}) {
  const forbiddenText = forbiddenWording.map((item) => `  - ${JSON.stringify(item)}`).join('\n');
  return [
    '---',
    'kind: product-claim',
    `product: ${JSON.stringify(product)}`,
    'status: "approved"',
    `approved_by: ${JSON.stringify(approvedBy)}`,
    `approved_on: ${JSON.stringify(approvedOn)}`,
    `expires: ${JSON.stringify(expires)}`,
    'evidence:',
    '  - "Reviewed by product team."',
    `allowed_wording: ${JSON.stringify(allowedWording)}`,
    'forbidden_wording:',
    forbiddenText,
    '---',
    '',
    'Claim:',
    claim
  ].join('\n') + '\n';
}

async function createBrainScenario(scenario) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'e3d-phase3-brain-'));
  const configPath = path.join(dir, 'brain-config.json');
  const recordPath = path.join(dir, 'record.json');
  await writeFile(configPath, JSON.stringify({ ...scenario, recordPath }, null, 2), 'utf8');
  return { configPath, recordPath };
}

async function readRecord(recordPath) {
  return JSON.parse(await readFile(recordPath, 'utf8'));
}

async function listRelativeFiles(dir, relativeDir = '') {
  const entries = await readdir(path.join(dir, relativeDir), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listRelativeFiles(dir, relativePath));
      continue;
    }
    files.push(relativePath);
  }
  return files.sort();
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

test('run command without --claims-check preserves the pre-change artifact set and makes no claims calls', async () => {
  const briefPath = path.join(examplesDir, 'sample-brief.json');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'e3d-e2e-run-'));
  const providerContext = createStubProviderContext();
  let fetchClaimsCalls = 0;
  const output = await captureStdout(async () => {
    await main(['run', briefPath, '--out', outDir], {
      providerContext,
      now: () => '2026-10-11T20:00:00.000Z',
      fetchApprovedClaimsImpl: async () => {
        fetchClaimsCalls += 1;
        throw new Error('claims fetch should not run without --claims-check');
      }
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

  assert.equal(fetchClaimsCalls, 0);
  assert.deepEqual(providerContext.callCounters, {
    generation: 1,
    critique: 4,
    qa: 2,
    claimsCheck: 0
  });
  await assert.rejects(() => access(path.join(outDir, 'claims')));
  assert.equal((await listRelativeFiles(outDir)).some((file) => file.startsWith('claims/')), false);
});

test('run command with --claims-check writes one report and digest sidecar per QA direction', async () => {
  const briefPath = path.join(examplesDir, 'sample-brief.json');
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'e3d-e2e-run-claims-'));
  const providerContext = createStubProviderContext({
    checkAssertions: () => ([
      {
        quote: 'OppScan helps owners of small HVAC shops evaluate opportunities.',
        location: 'script:1',
        classification: 'supported',
        claim: 1,
        claimQuote: 'helps owners of small HVAC shops evaluate opportunities'
      }
    ])
  });
  const { configPath, recordPath } = await createBrainScenario({
    tools: ['search', 'read_note', 'list_notes', 'related', 'read_ref_chunk', 'report_use'],
    listEntries: [
      metadataFor('claims/oppscan-sanitized-sample/approved.md')
    ],
    readNotes: {
      'claims/oppscan-sanitized-sample/approved.md': {
        metadata: metadataFor('claims/oppscan-sanitized-sample/approved.md'),
        noteText: claimNoteText()
      }
    }
  });

  const output = await captureStdout(async () => {
    await main([
      'run',
      briefPath,
      '--out',
      outDir,
      '--claims-check',
      '--brain-main',
      brainStubPath,
      '--brain-config',
      configPath
    ], {
      providerContext,
      now: () => '2026-10-17T20:00:00.000Z'
    });
  });

  assert.match(output, /claims:/i);

  const qaManifest = await readJsonFile(path.join(outDir, 'qa', 'qa-manifest.json'));
  const claimFiles = await readdir(path.join(outDir, 'claims'));
  assert.equal(claimFiles.length, qaManifest.directions.length * 2);
  assert.equal(providerContext.callCounters.claimsCheck, qaManifest.directions.length);

  for (const item of qaManifest.directions) {
    const reportPath = path.join(outDir, 'claims', `${item.directionId}.claims-check.json`);
    const digestPath = `${reportPath}.sha256`;
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    const digest = await readFile(digestPath, 'utf8');
    assert.equal(report.claimGrounding, 'ok');
    assert.equal(report.checkStatus, 'passed');
    assert.equal(report.checkedBy.provider, 'openai');
    assert.match(digest, /^[0-9a-f]{64}\n$/);
  }

  const record = await readRecord(recordPath);
  assert.equal(record.calls.some((call) => call.method === 'tools/call' && call.params?.name === 'list_notes'), true);
  assert.equal(record.calls.some((call) => call.method === 'tools/call' && call.params?.name === 'read_note'), true);
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
  assert.match(readme, /Grounding claims from e3d-brain/i);
  assert.match(readme, /ebrain ids assign/i);
  assert.match(readme, /claims-only, read-only/i);
  assert.match(readme, /authorized approving humans/i);
  assert.match(readme, /advisory-only/i);
  assert.match(readme, /fail-open/i);
  assert.match(readme, /no rendering/i);
  assert.match(readme, /no e3d-corp integration/i);
  assert.match(readme, /no spend authority/i);
  assert.match(readme, /examples\/sample-brief\.json/);
});
