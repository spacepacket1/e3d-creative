import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { main } from '../lib/cli.js';
import {
  checkClaims,
  CLAIMS_CHECK_DISCLAIMER,
  CLAIMS_NOT_CHECKED_REASON,
  computeClaimsCheckReportDigest
} from '../lib/claims-check.js';

function createDirection(overrides = {}) {
  return {
    directionId: 'claim-check-01',
    hook: 'Used by 10,000 teams who hate tab chaos.',
    premise: 'This workflow helps a small team act faster without adding more dashboards.',
    audiencePsychology: 'Operators want specifics.',
    script: [
      { tag: 'fact', text: 'The workflow centralizes lead review for one revenue team.' },
      { tag: 'claim', text: 'Enterprise-grade security audit included.' }
    ],
    storyboard: [
      {
        timecodeStart: '00:00',
        timecodeEnd: '00:03',
        visualDirection: 'A clean dashboard collapses five tabs into one.',
        audioNotes: 'VO says the workflow helps a small team act faster.',
        onScreenText: 'Used by 10,000 teams'
      }
    ],
    ctaText: 'Book a demo.',
    confidence: 0.64,
    rationale: 'Keep it grounded.',
    ...overrides
  };
}

function createClaimsResult(overrides = {}) {
  return {
    claimGrounding: 'ok',
    claims: [
      {
        citation: 'note:01ARZ3NDEKTSV4RRFFQ69G5FAV@0123456789abcdef',
        digest: 'digest-a',
        claim: 'The workflow helps a small team act faster.',
        allowedWording: 'Describe it as helping a small team act faster.',
        forbiddenWording: ['10,000 teams', 'enterprise-grade security audit'],
        evidence: [],
        expires: '2026-12-01',
        approvedBy: 'Ada'
      },
      {
        citation: 'note:01ARZ3NDEKTSV4RRFFQ69G5FAW@fedcba9876543210',
        digest: 'digest-b',
        claim: 'The workflow centralizes lead review for one revenue team.',
        allowedWording: 'Say it centralizes lead review.',
        forbiddenWording: ['security certified'],
        evidence: [],
        expires: '2026-12-01',
        approvedBy: 'Ada'
      }
    ],
    counts: {
      fetched: 2,
      kept: 2,
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

function stubProvider(text, model = 'stub-check-model') {
  return {
    name: 'openai',
    async generate() {
      return { text, model };
    }
  };
}

async function captureCli(args, dependencies = {}) {
  let stdout = '';
  const originalWrite = process.stdout.write;
  const originalExitCode = process.exitCode;
  process.exitCode = undefined;
  process.stdout.write = (chunk) => {
    stdout += String(chunk);
    return true;
  };

  try {
    await main(args, dependencies);
    return { stdout, exitCode: process.exitCode ?? 0 };
  } finally {
    process.stdout.write = originalWrite;
    process.exitCode = originalExitCode;
  }
}

test('unsupported planted statements produce unsupported findings', async () => {
  const result = await checkClaims({
    direction: createDirection(),
    claimsResult: createClaimsResult({
      claims: createClaimsResult().claims.map((claim) => ({
        ...claim,
        forbiddenWording: ['different forbidden wording']
      }))
    }),
    provider: stubProvider(JSON.stringify({
      assertions: [
        {
          quote: 'Used by 10,000 teams',
          location: 'hook',
          classification: 'unsupported',
          claim: null,
          claimQuote: null
        },
        {
          quote: 'Enterprise-grade security audit included.',
          location: 'script:2',
          classification: 'unsupported',
          claim: null,
          claimQuote: null
        }
      ]
    }))
  });

  assert.equal(result.checkStatus, 'findings');
  assert.equal(result.findings.filter((finding) => finding.type === 'unsupported').length, 2);
  assert.equal(result.findings.some((finding) => finding.quote === 'Used by 10,000 teams'), true);
  assert.equal(result.claimsUsed.length, 2);
});

test('forbidden wording matches across capitalization punctuation spacing and fullwidth variants', async () => {
  const direction = createDirection({
    hook: 'USED BY １０，０００   TEAMS!!!',
    script: [
      { tag: 'fact', text: 'enterprise... grade   security audit' }
    ],
    storyboard: [
      {
        timecodeStart: '00:00',
        timecodeEnd: '00:03',
        visualDirection: 'A clean dashboard collapses five tabs into one.',
        audioNotes: 'VO says the workflow helps a small team act faster.',
        onScreenText: ''
      }
    ]
  });

  const result = await checkClaims({
    direction,
    claimsResult: createClaimsResult(),
    provider: stubProvider(JSON.stringify({ assertions: [] }))
  });

  assert.equal(result.checkStatus, 'findings');
  const forbidden = result.findings.filter((finding) => finding.type === 'forbidden');
  assert.equal(forbidden.length, 2);
  assert.deepEqual(forbidden.map((finding) => finding.location), ['hook', 'script:1']);
  assert.equal(forbidden[0].quote, '１０，０００   TEAMS');
  assert.equal(forbidden[1].quote, 'enterprise... grade   security audit');
});

test('supported findings use code-built citations and a clean report passes', async () => {
  const result = await checkClaims({
    direction: createDirection({
      hook: 'This workflow helps a small team act faster.',
      script: [{ tag: 'fact', text: 'The workflow centralizes lead review for one revenue team.' }],
      storyboard: [
        {
          timecodeStart: '00:00',
          timecodeEnd: '00:03',
          visualDirection: 'A clean dashboard collapses five tabs into one.',
          audioNotes: 'VO keeps it factual.',
          onScreenText: ''
        }
      ],
      ctaText: 'Book a demo.',
      premise: 'Operator focus.',
      audiencePsychology: 'Specificity matters.',
      rationale: 'Grounded.'
    }),
    claimsResult: createClaimsResult({
      claims: createClaimsResult().claims.map((claim) => ({
        ...claim,
        forbiddenWording: ['different forbidden wording']
      }))
    }),
    provider: stubProvider(JSON.stringify({
      assertions: [
        {
          quote: 'This workflow helps a small team act faster.',
          location: 'hook',
          classification: 'supported',
          claim: 1,
          claimQuote: 'helps a small team act faster'
        },
        {
          quote: 'The workflow centralizes lead review for one revenue team.',
          location: 'script:1',
          classification: 'supported',
          claim: 2,
          claimQuote: 'centralizes lead review'
        }
      ]
    }))
  });

  assert.equal(result.checkStatus, 'passed');
  assert.deepEqual(result.findings.map((finding) => finding.type), ['supported', 'supported']);
  assert.equal(result.findings[0].citation, createClaimsResult().claims[0].citation);
  assert.equal(result.findings[1].citation, createClaimsResult().claims[1].citation);
});

test('invalid support quotes are downgraded with supportRejected true', async () => {
  const result = await checkClaims({
    direction: createDirection({
      hook: 'This workflow helps a small team act faster.',
      script: [{ tag: 'fact', text: 'The workflow centralizes lead review for one revenue team.' }],
      storyboard: [
        {
          timecodeStart: '00:00',
          timecodeEnd: '00:03',
          visualDirection: 'A clean dashboard collapses five tabs into one.',
          audioNotes: 'VO keeps it factual.',
          onScreenText: ''
        }
      ]
    }),
    claimsResult: createClaimsResult({
      claims: createClaimsResult().claims.map((claim) => ({
        ...claim,
        forbiddenWording: ['different forbidden wording']
      }))
    }),
    provider: stubProvider(JSON.stringify({
      assertions: [
        {
          quote: 'This workflow helps a small team act faster.',
          location: 'hook',
          classification: 'supported',
          claim: 1,
          claimQuote: 'totally unrelated proof text'
        }
      ]
    }))
  });

  assert.equal(result.checkStatus, 'findings');
  assert.deepEqual(result.findings.map((finding) => finding.type), ['unsupported']);
  assert.equal(result.findings[0].supportRejected, true);
  assert.equal(result.findings[0].citation, createClaimsResult().claims[0].citation);
});

test('quote-not-found, invalid JSON, unknown claims, schema errors, and provider failures fail closed', async () => {
  const direction = createDirection({
    hook: 'This workflow helps a small team act faster.',
    script: [{ tag: 'fact', text: 'The workflow centralizes lead review for one revenue team.' }],
    storyboard: [
      {
        timecodeStart: '00:00',
        timecodeEnd: '00:03',
        visualDirection: 'A clean dashboard collapses five tabs into one.',
        audioNotes: 'VO keeps it factual.',
        onScreenText: ''
      }
    ]
  });
  const claimsResult = createClaimsResult({
    claims: createClaimsResult().claims.map((claim) => ({
      ...claim,
      forbiddenWording: ['different forbidden wording']
    }))
  });

  const cases = [
    {
      provider: stubProvider('not json'),
      reason: 'model-output-invalid'
    },
    {
      provider: stubProvider(JSON.stringify({
        assertions: [
          {
            quote: 'Missing from the direction',
            location: 'hook',
            classification: 'unsupported',
            claim: null,
            claimQuote: null
          }
        ]
      })),
      reason: 'quote-not-found'
    },
    {
      provider: stubProvider(JSON.stringify({
        assertions: [
          {
            quote: 'This workflow helps a small team act faster.',
            location: 'hook',
            classification: 'supported',
            claim: 99,
            claimQuote: 'helps a small team act faster'
          }
        ]
      })),
      reason: 'model-output-invalid'
    },
    {
      provider: stubProvider(JSON.stringify({
        assertions: [
          {
            quote: 'This workflow helps a small team act faster.',
            location: 'hook',
            classification: 'supported',
            claim: null,
            claimQuote: null
          }
        ]
      })),
      reason: 'model-output-invalid'
    },
    {
      provider: {
        name: 'openai',
        async generate() {
          throw new Error('provider exploded');
        }
      },
      reason: 'provider-failed'
    }
  ];

  for (const entry of cases) {
    const result = await checkClaims({
      direction,
      claimsResult,
      provider: entry.provider
    });
    assert.equal(result.checkStatus, 'failed');
    assert.equal(result.checkReason, entry.reason);
  }
});

test('stage one findings remain when stage two fails', async () => {
  const result = await checkClaims({
    direction: createDirection(),
    claimsResult: createClaimsResult(),
    provider: stubProvider('not json')
  });

  assert.equal(result.checkStatus, 'failed');
  assert.equal(result.findings.some((finding) => finding.type === 'forbidden'), true);
});

test('empty and unavailable grounding yield not-run with the required message', async () => {
  for (const claimsResult of [
    createClaimsResult({ claimGrounding: 'empty', claims: [], reason: undefined }),
    createClaimsResult({ claimGrounding: 'unavailable', claims: [], reason: 'not-configured' })
  ]) {
    const result = await checkClaims({
      direction: createDirection(),
      claimsResult
    });
    assert.equal(result.checkStatus, 'not-run');
    assert.equal(result.checkReason, CLAIMS_NOT_CHECKED_REASON);
    assert.equal(result.checkedBy, null);
  }
});

test('claims-check CLI writes report and digest without leaking claim text or model text', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'e3d-claims-check-cli-'));
  const directionPath = path.join(dir, 'direction.json');
  const briefPath = path.join(dir, 'brief.json');
  const outDir = path.join(dir, 'out');

  const claimMarker = 'MARKER CLAIM ALPHA';
  const forbiddenMarker = 'FORBIDDEN WORDING 999';
  const directionQuoteMarker = 'VISIBLE DIRECTION QUOTE';
  const direction = createDirection({
    generatedProvider: 'claude',
    hook: directionQuoteMarker,
    premise: 'This workflow helps a small team act faster.',
    storyboard: [
      {
        timecodeStart: '00:00',
        timecodeEnd: '00:03',
        visualDirection: 'A clean dashboard collapses five tabs into one.',
        audioNotes: 'VO keeps it factual.',
        onScreenText: ''
      }
    ]
  });
  const claimsResult = createClaimsResult({
    claims: [
      {
        ...createClaimsResult().claims[0],
        claim: claimMarker,
        allowedWording: 'Describe it as helping a small team act faster.',
        forbiddenWording: [forbiddenMarker]
      }
    ]
  });
  const providerContext = {
    registry: {
      openai: {
        name: 'openai',
        async generate() {
          return {
            text: JSON.stringify({
              assertions: [
                {
                  quote: 'This workflow helps a small team act faster.',
                  location: 'premise',
                  classification: 'supported',
                  claim: 1,
                  claimQuote: 'Describe it as helping a small team act faster.'
                }
              ]
            }),
            model: 'stub-openai-check'
          };
        }
      }
    }
  };

  await writeFile(directionPath, `${JSON.stringify(direction, null, 2)}\n`, 'utf8');
  await writeFile(briefPath, `${JSON.stringify({
    product: 'Widget Pro',
    audience: 'Operators',
    objective: 'Bookings',
    baselineRef: null,
    constraints: ['Stay factual'],
    spendCeiling: null,
    metric: 'Meetings',
    threshold: 'Increase'
  }, null, 2)}\n`, 'utf8');

  const run = await captureCli(
    ['claims-check', directionPath, '--brief', briefPath, '--out', outDir, '--check-provider', 'openai'],
    {
      fetchApprovedClaimsImpl: async () => claimsResult,
      providerContext,
      now: () => '2026-10-17T20:00:00.000Z'
    }
  );

  assert.equal(run.exitCode, 0);
  assert.equal(run.stdout.includes(claimMarker), false);
  assert.equal(run.stdout.includes(forbiddenMarker), false);
  assert.equal(run.stdout.includes(directionQuoteMarker), false);
  assert.equal(run.stdout.includes('stub-openai-check'), false);

  const reportPath = path.join(outDir, 'claim-check-01.claims-check.json');
  const digestPath = `${reportPath}.sha256`;
  const reportText = await readFile(reportPath, 'utf8');
  const digestText = await readFile(digestPath, 'utf8');
  const report = JSON.parse(reportText);

  assert.equal(report.claimGrounding, 'ok');
  assert.equal(report.checkStatus, 'passed');
  assert.equal(report.checkedBy.provider, 'openai');
  assert.equal(report.checkedBy.model, 'stub-openai-check');
  assert.equal(report.sameProviderAsGeneration, false);
  assert.equal(report.disclaimer, CLAIMS_CHECK_DISCLAIMER);
  assert.equal(reportText.includes(claimMarker), false);
  assert.equal(reportText.includes(forbiddenMarker), false);
  assert.equal(digestText, `${computeClaimsCheckReportDigest(reportText)}\n`);

  const overwrite = captureCli(
    ['claims-check', directionPath, '--brief', briefPath, '--out', outDir, '--check-provider', 'openai'],
    {
      fetchApprovedClaimsImpl: async () => claimsResult,
      providerContext
    }
  );
  await assert.rejects(overwrite, /refusing to overwrite existing artifact/);
});

test('claims-check CLI digest follows exact direction bytes and fail-on-unsupported exit codes match the table', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'e3d-claims-check-cli-'));
  const briefPath = path.join(dir, 'brief.json');
  const outA = path.join(dir, 'out-a');
  const outB = path.join(dir, 'out-b');

  await writeFile(briefPath, `${JSON.stringify({
    product: 'Widget Pro',
    audience: 'Operators',
    objective: 'Bookings',
    baselineRef: null,
    constraints: ['Stay factual'],
    spendCeiling: null,
    metric: 'Meetings',
    threshold: 'Increase'
  }, null, 2)}\n`, 'utf8');

  const providerContext = {
    registry: {
      openai: {
        name: 'openai',
        async generate() {
          return {
            text: JSON.stringify({
              assertions: [
                {
                  quote: 'Used by 10,000 teams',
                  location: 'hook',
                  classification: 'unsupported',
                  claim: null,
                  claimQuote: null
                }
              ]
            }),
            model: 'stub-openai-check'
          };
        }
      }
    }
  };

  const claimsResult = createClaimsResult({
    claims: [
      {
        ...createClaimsResult().claims[0],
        forbiddenWording: []
      }
    ]
  });

  const directionAPath = path.join(dir, 'direction-a.json');
  const directionBPath = path.join(dir, 'direction-b.json');
  await writeFile(directionAPath, `${JSON.stringify(createDirection(), null, 2)}\n`, 'utf8');
  await writeFile(directionBPath, `${JSON.stringify({ ...createDirection(), rationale: 'Grounded.  ' }, null, 2)}\n`, 'utf8');

  const runDefault = await captureCli(
    ['claims-check', directionAPath, '--brief', briefPath, '--out', outA, '--check-provider', 'openai'],
    {
      fetchApprovedClaimsImpl: async () => claimsResult,
      providerContext,
      now: () => '2026-10-17T20:00:00.000Z'
    }
  );
  assert.equal(runDefault.exitCode, 0);

  const runStrict = await captureCli(
    ['claims-check', directionBPath, '--brief', briefPath, '--out', outB, '--check-provider', 'openai', '--fail-on-unsupported'],
    {
      fetchApprovedClaimsImpl: async () => claimsResult,
      providerContext,
      now: () => '2026-10-17T20:00:00.000Z'
    }
  );
  assert.equal(runStrict.exitCode, 3);

  const reportA = JSON.parse(await readFile(path.join(outA, 'claim-check-01.claims-check.json'), 'utf8'));
  const reportB = JSON.parse(await readFile(path.join(outB, 'claim-check-01.claims-check.json'), 'utf8'));
  assert.notEqual(reportA.directionDigest, reportB.directionDigest);
});

test('claims-check CLI maps failed and not-run statuses to strict exit codes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'e3d-claims-check-cli-'));
  const directionPath = path.join(dir, 'direction.json');
  const briefPath = path.join(dir, 'brief.json');

  await writeFile(directionPath, `${JSON.stringify(createDirection(), null, 2)}\n`, 'utf8');
  await writeFile(briefPath, `${JSON.stringify({
    product: 'Widget Pro',
    audience: 'Operators',
    objective: 'Bookings',
    baselineRef: null,
    constraints: ['Stay factual'],
    spendCeiling: null,
    metric: 'Meetings',
    threshold: 'Increase'
  }, null, 2)}\n`, 'utf8');

  const failed = await captureCli(
    ['claims-check', directionPath, '--brief', briefPath, '--out', path.join(dir, 'out-failed'), '--check-provider', 'openai', '--fail-on-unsupported'],
    {
      fetchApprovedClaimsImpl: async () => createClaimsResult(),
      providerContext: {
        registry: {
          openai: {
            name: 'openai',
            async generate() {
              return { text: 'not json', model: 'stub-openai-check' };
            }
          }
        }
      }
    }
  );
  assert.equal(failed.exitCode, 4);

  const notRun = await captureCli(
    ['claims-check', directionPath, '--brief', briefPath, '--out', path.join(dir, 'out-not-run'), '--fail-on-unsupported'],
    {
      fetchApprovedClaimsImpl: async () => createClaimsResult({
        claimGrounding: 'empty',
        claims: [],
        reason: undefined
      })
    }
  );
  assert.equal(notRun.exitCode, 5);
});
