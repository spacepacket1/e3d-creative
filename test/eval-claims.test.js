import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runClaimsEvaluation } from '../scripts/eval-claims.js';

function createConceptBatch() {
  return {
    directions: [
      {
        directionId: 'direction-1',
        hook: 'Start with the operator who wants grounded product proof.',
        premise: 'Keep the product framing concrete and specific to internal research workflows.',
        audiencePsychology: 'Skeptical buyers trust specifics more than hype.',
        script: [
          {
            tag: 'fact',
            text: 'e3d-brain helps teams retrieve approved internal notes faster.'
          },
          {
            tag: 'claim',
            text: 'That grounding may make the ad feel more credible.'
          }
        ],
        storyboard: [
          {
            timecodeStart: '00:00',
            timecodeEnd: '00:03',
            visualDirection: 'A researcher moves from note chaos to one approved source.',
            audioNotes: 'Direct and practical.',
            onScreenText: 'Ground the claim.'
          }
        ],
        ctaText: 'See the approved note path.',
        confidence: 0.84,
        rationale: 'The workflow proof is strongest here.'
      },
      {
        directionId: 'direction-2',
        hook: 'Show the team moving faster because the claim source is already approved.',
        premise: 'Frame the product as disciplined retrieval, not generic generation.',
        audiencePsychology: 'Teams with review bottlenecks want less back-and-forth.',
        script: [
          {
            tag: 'fact',
            text: 'e3d-brain keeps approved claim notes in a controlled vault.'
          },
          {
            tag: 'hypothesis',
            text: 'A tighter approval loop may feel safer than broad AI promises.'
          }
        ],
        storyboard: [
          {
            timecodeStart: '00:00',
            timecodeEnd: '00:03',
            visualDirection: 'A reviewer approves notes in a narrow claims-only vault.',
            audioNotes: 'Measured pace.',
            onScreenText: 'Keep the vault narrow.'
          }
        ],
        ctaText: 'Audit the claim path.',
        confidence: 0.79,
        rationale: 'The narrowed scope supports the governance message.'
      },
      {
        directionId: 'direction-3',
        hook: 'Claim the system knows every product detail instantly.',
        premise: 'Overpromise omniscience to force a critique rejection.',
        audiencePsychology: 'This is deliberately too broad.',
        script: [
          {
            tag: 'claim',
            text: 'It knows everything about every product immediately.'
          }
        ],
        storyboard: [
          {
            timecodeStart: '00:00',
            timecodeEnd: '00:03',
            visualDirection: 'Abstract glowing UI.',
            audioNotes: 'Too grandiose.',
            onScreenText: 'Know everything.'
          }
        ],
        ctaText: 'Trust the machine.',
        confidence: 0.22,
        rationale: 'This should fail critique.'
      }
    ]
  };
}

function createQaPayload(direction) {
  return JSON.stringify({
    storyboard: direction.storyboard.map((shot) => ({
      timecodeStart: shot.timecodeStart,
      timecodeEnd: shot.timecodeEnd,
      visualDirection: `${shot.visualDirection} Keep the note source visible and documentary.`,
      audioNotes: `${shot.audioNotes} Leave room for the factual line to land.`,
      onScreenText: `${shot.onScreenText} | ${direction.ctaText}`
    })),
    rubric: {
      stopScrollHook: { score: 4, reasoning: 'Specific opening.' },
      narrativeArc: { score: 4, reasoning: 'Clear structure.' },
      clarityOfValueProp: { score: 5, reasoning: 'The product role is explicit.' },
      authenticity: { score: 4, reasoning: 'Operational and grounded.' },
      productionQualityExpectation: { score: 4, reasoning: 'The shot notes are concrete.' },
      factualDefensibility: { score: 5, reasoning: 'The script stays inside the brief.' },
      brandFit: { score: 4, reasoning: 'The governance angle fits.' },
      ctaStrength: { score: 4, reasoning: 'The CTA is explicit.' },
      audienceFit: { score: 5, reasoning: 'This speaks to review-heavy teams.' }
    },
    summary: 'Keep the factual path narrow and visible.',
    overallScore: direction.directionId === 'direction-1' ? 4.33 : 4.11
  });
}

function createPlantedFixtures() {
  return Array.from({ length: 10 }, (_, index) => ({
    id: `fixture-${String(index + 1).padStart(2, '0')}`,
    sentence: `Invented product assertion ${index + 1}: the platform ships a magical guarantee.`,
    expectedTrigger: 'unsupported'
  }));
}

function createProviderRegistry(fixtures, providerCounters) {
  const directions = new Map(
    createConceptBatch().directions.map((direction) => [direction.directionId, direction])
  );
  const critiqueSequence = [
    { verdict: 'keep', reasoning: 'The workflow specificity is strong enough to keep.', dissent: '' },
    { verdict: 'keep', reasoning: 'The governance framing is specific enough to keep.', dissent: '' },
    { verdict: 'reject', reasoning: 'The omniscience framing outruns the evidence.', dissent: 'The claim is too broad.' },
    { verdict: 'reject', reasoning: 'A second pass still overstates product knowledge.', dissent: 'The proof is missing.' }
  ];
  let critiqueIndex = 0;

  return {
    claude: {
      async generate(request) {
        if (request.systemPrompt.includes('You generate creative directions as strict JSON.')) {
          providerCounters.generation += 1;
          return {
            text: JSON.stringify(createConceptBatch()),
            usage: { output_tokens: 1 },
            model: 'stub-claude-concepts'
          };
        }

        providerCounters.qa += 1;
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
      async generate(request) {
        if (request.systemPrompt.includes('You check a creative direction against approved-claims reference data and return strict JSON.')) {
          providerCounters.claimsCheck += 1;
          const matchedFixture = fixtures.find((fixture) => request.userPrompt.includes(fixture.sentence));
          return {
            text: JSON.stringify({
              assertions: matchedFixture
                ? [
                    {
                      quote: matchedFixture.sentence,
                      location: 'script:2',
                      classification: 'unsupported',
                      claim: null,
                      claimQuote: null
                    }
                  ]
                : []
            }),
            usage: { completion_tokens: 1 },
            model: 'stub-openai-check'
          };
        }

        providerCounters.critique += 1;
        const response = critiqueSequence[critiqueIndex];
        critiqueIndex += 1;
        return {
          text: JSON.stringify(response),
          usage: { completion_tokens: 1 },
          model: 'stub-openai-critique'
        };
      }
    }
  };
}

function createClaimsResult(overrides = {}) {
  return {
    claimGrounding: 'ok',
    claims: [
      {
        citation: 'note:01ARZ3NDEKTSV4RRFFQ69G5FAV@0123456789abcdef',
        digest: 'digest-a',
        claim: 'RAW CLAIM SOURCE ALPHA',
        allowedWording: 'Say it as faster retrieval of approved notes.',
        forbiddenWording: ['magical guarantee', 'autonomous legal approval'],
        evidence: [],
        expires: '2026-12-31',
        approvedBy: 'Ada'
      }
    ],
    counts: {
      fetched: 1,
      kept: 1,
      'out-of-folder': 0,
      'no-stable-id': 0,
      malformed: 0,
      'wrong-product': 0,
      unapproved: 0,
      expired: 0
    },
    notesTruncated: false,
    ...overrides
  };
}

async function writeBrief(dir, fileName, product = 'e3d-brain') {
  await mkdir(dir, { recursive: true });
  const briefPath = path.join(dir, fileName);
  await writeFile(briefPath, `${JSON.stringify({
    product,
    audience: 'Creative operations leads',
    objective: 'Qualified meetings',
    baselineRef: null,
    constraints: ['Stay factual', 'Do not imply autonomous approval'],
    spendCeiling: null,
    metric: 'Meetings',
    threshold: 'Increase'
  }, null, 2)}\n`, 'utf8');
  return briefPath;
}

function createCapturingStdout() {
  let output = '';
  return {
    stream: {
      write(chunk) {
        output += String(chunk);
        return true;
      }
    },
    read() {
      return output;
    }
  };
}

test('claims evaluation is deterministic, writes blind outputs, and never persists raw approved-claim text', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'e3d-claims-eval-'));
  const briefDir = path.join(dir, 'briefs');
  const outDir = path.join(dir, 'out-a');
  const repeatOutDir = path.join(dir, 'out-b');
  const fixturePath = path.join(dir, 'planted-claims.json');
  const fixtures = createPlantedFixtures();
  const providerCounters = {
    generation: 0,
    critique: 0,
    qa: 0,
    claimsCheck: 0
  };
  const stdout = createCapturingStdout();
  let confirmSawZeroCalls = false;

  await writeFile(fixturePath, `${JSON.stringify(fixtures, null, 2)}\n`, 'utf8');
  await writeBrief(briefDir, 'brief-a.json');

  const result = await runClaimsEvaluation({
    briefDir,
    outDir,
    seed: 'phase-3-seed',
    yes: false
  }, {
    plantedFixturePath: fixturePath,
    providerRegistry: createProviderRegistry(fixtures, providerCounters),
    fetchApprovedClaimsImpl: async () => createClaimsResult(),
    confirmRunImpl: async ({ briefCount, providers }) => {
      confirmSawZeroCalls = Object.values(providerCounters).every((count) => count === 0);
      assert.equal(briefCount, 1);
      assert.deepEqual(providers, {
        generation: ['claude'],
        qa: ['claude'],
        claimsCheck: ['openai']
      });
      return true;
    },
    now: () => '2026-10-17T20:00:00.000Z',
    stdout: stdout.stream
  });

  assert.equal(confirmSawZeroCalls, true);
  assert.deepEqual(result.counters, {
    generation: 1,
    qa: 2,
    'claims-check': 4
  });
  assert.deepEqual(result.summary, {
    plantedRecall: {
      detected: 2,
      checked: 2,
      failed: 0,
      notRun: 0,
      recall: 1
    },
    falseFlags: {
      findings: 0,
      checked: 2,
      failed: 0,
      notRun: 0,
      findingsPerCheckedDirection: 0
    }
  });

  const sheetText = await readFile(path.join(outDir, 'eval-sheet.csv'), 'utf8');
  const keyText = await readFile(path.join(outDir, 'eval-key.json'), 'utf8');
  const summaryText = await readFile(path.join(outDir, 'eval-summary.json'), 'utf8');
  const key = JSON.parse(keyText);
  const summary = JSON.parse(summaryText);

  assert.match(sheetText, /^row_id,direction_text,human_overstated_yes_no,notes\r?\n/);
  assert.equal((sheetText.match(/01-brief-a-\d{2}-(base|plant)/g) ?? []).length, 4);
  assert.equal(sheetText.includes('RAW CLAIM SOURCE ALPHA'), false);
  assert.equal(sheetText.includes('unmodified'), false);
  assert.equal(sheetText.includes('planted'), false);
  assert.equal(sheetText.includes('note:'), false);
  assert.equal(key.rows.length, 4);
  assert.equal(key.rows.filter((row) => row.condition === 'unmodified').length, 2);
  assert.equal(key.rows.filter((row) => row.condition === 'planted').length, 2);
  assert.equal(keyText.includes('RAW CLAIM SOURCE ALPHA'), false);
  assert.deepEqual(summary.summary, result.summary);
  assert.equal(stdout.read().includes('RAW CLAIM SOURCE ALPHA'), false);
  assert.match(stdout.read(), /claims eval complete: 1 brief/i);

  const baseArtifacts = await readdir(path.join(outDir, 'briefs', '01-brief-a', 'claims-base'));
  const plantedArtifacts = await readdir(path.join(outDir, 'briefs', '01-brief-a', 'claims-planted'));
  assert.equal(baseArtifacts.length, 4);
  assert.equal(plantedArtifacts.length, 6);

  const firstBaseReportText = await readFile(
    path.join(outDir, 'briefs', '01-brief-a', 'claims-base', 'direction-1.claims-check.json'),
    'utf8'
  );
  assert.equal(firstBaseReportText.includes('RAW CLAIM SOURCE ALPHA'), false);

  const repeatStdout = createCapturingStdout();
  const repeatResult = await runClaimsEvaluation({
    briefDir,
    outDir: repeatOutDir,
    seed: 'phase-3-seed',
    yes: true
  }, {
    plantedFixturePath: fixturePath,
    providerRegistry: createProviderRegistry(fixtures, {
      generation: 0,
      critique: 0,
      qa: 0,
      claimsCheck: 0
    }),
    fetchApprovedClaimsImpl: async () => createClaimsResult(),
    now: () => '2026-10-17T20:00:00.000Z',
    stdout: repeatStdout.stream
  });

  assert.equal(await readFile(path.join(repeatOutDir, 'eval-sheet.csv'), 'utf8'), sheetText);
  assert.equal(await readFile(path.join(repeatOutDir, 'eval-key.json'), 'utf8'), keyText);
  assert.deepEqual(repeatResult.summary, result.summary);
});

test('claims evaluation reports not-run rows separately from recall and false-flag denominators', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'e3d-claims-eval-'));
  const briefDir = path.join(dir, 'briefs');
  const outDir = path.join(dir, 'out');
  const fixturePath = path.join(dir, 'planted-claims.json');
  const fixtures = createPlantedFixtures();
  const stdout = createCapturingStdout();

  await writeFile(fixturePath, `${JSON.stringify(fixtures, null, 2)}\n`, 'utf8');
  await writeBrief(briefDir, 'brief-a.json');

  const result = await runClaimsEvaluation({
    briefDir,
    outDir,
    seed: 'phase-3-not-run',
    yes: true
  }, {
    plantedFixturePath: fixturePath,
    providerRegistry: createProviderRegistry(fixtures, {
      generation: 0,
      critique: 0,
      qa: 0,
      claimsCheck: 0
    }),
    fetchApprovedClaimsImpl: async () => createClaimsResult({
      claimGrounding: 'empty',
      claims: []
    }),
    now: () => '2026-10-17T20:00:00.000Z',
    stdout: stdout.stream
  });

  assert.deepEqual(result.summary, {
    plantedRecall: {
      detected: 0,
      checked: 0,
      failed: 0,
      notRun: 2,
      recall: null
    },
    falseFlags: {
      findings: 0,
      checked: 0,
      failed: 0,
      notRun: 2,
      findingsPerCheckedDirection: null
    }
  });
  assert.deepEqual(result.counters, {
    generation: 1,
    qa: 2,
    'claims-check': 0
  });
  assert.match(stdout.read(), /claims-check calls: 0/i);

  const key = JSON.parse(await readFile(path.join(outDir, 'eval-key.json'), 'utf8'));
  assert.equal(key.rows.every((row) => row.checkerStatus === 'not-run'), true);
});
