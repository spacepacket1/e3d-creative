import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  BRAIN_CALL_TIMEOUT_MS,
  BRAIN_INVOKABLE_TOOLS,
  BRAIN_TOOL_ALLOWLIST,
  MAX_JSONRPC_MESSAGE_BYTES,
  MAX_STDERR_BYTES,
  startBrainClient
} from '../lib/brain-client.js';
import {
  canonicalizeProductKey,
  DEFAULT_PROMPT_MAX_CHARS,
  fetchApprovedClaims,
  LIST_NOTES_LIMIT,
  MAX_CLAIMS_READ,
  READ_NOTE_MAX_CHARS,
  renderClaimsBlock,
  WHOLE_FETCH_TIMEOUT_MS
} from '../lib/claims.js';

const fixturesDir = path.join(process.cwd(), 'test', 'fixtures');
const brainStubPath = path.join(fixturesDir, 'brain-stub.js');
const NOW = new Date('2026-10-17T12:00:00.000Z');

function sha256HexUtf8(value) {
  return createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');
}

function metadataFor(pathValue, overrides = {}) {
  const base = {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    provisional: false,
    rev: '0123456789abcdef',
    status: 'approved',
    kind: 'product-claim',
    path: pathValue
  };
  const metadata = { ...base, ...overrides };
  metadata.citation = `note:${metadata.id}@${metadata.rev}`;
  return metadata;
}

function claimNoteText({
  product = 'Widget Pro',
  status = 'approved',
  approvedBy = 'Ada Lovelace',
  approvedOn = '2026-10-10',
  expires = '2026-10-20',
  evidence = ['Sales calls mention this repeatedly.'],
  allowedWording = 'Say it as faster triage.',
  forbiddenWording = ['10,000 teams', 'enterprise-grade security audit'],
  claim = 'Widget Pro helps teams qualify leads faster.',
  extraFrontmatter = '',
  tail = ''
} = {}) {
  const evidenceText = evidence.map((item) => `  - ${JSON.stringify(item)}`).join('\n');
  const forbiddenText = forbiddenWording.map((item) => `  - ${JSON.stringify(item)}`).join('\n');

  return [
    '---',
    'kind: product-claim',
    `product: ${JSON.stringify(product)}`,
    `status: ${JSON.stringify(status)}`,
    `approved_by: ${JSON.stringify(approvedBy)}`,
    `approved_on: ${JSON.stringify(approvedOn)}`,
    `expires: ${JSON.stringify(expires)}`,
    'evidence:',
    evidenceText,
    `allowed_wording: ${JSON.stringify(allowedWording)}`,
    'forbidden_wording:',
    forbiddenText,
    extraFrontmatter,
    '---',
    '',
    'Claim:',
    claim,
    tail
  ].filter((line) => line !== '').join('\n') + '\n';
}

async function createScenario(scenario) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'e3d-claims-'));
  const configPath = path.join(dir, 'brain-config.json');
  const recordPath = path.join(dir, 'record.json');
  await writeFile(configPath, JSON.stringify({ ...scenario, recordPath }, null, 2), 'utf8');
  return {
    dir,
    configPath,
    recordPath
  };
}

async function readRecord(recordPath) {
  return JSON.parse(await readFile(recordPath, 'utf8'));
}

function createBrainOptions(configPath, overrides = {}) {
  return {
    brainMain: brainStubPath,
    brainConfig: configPath,
    ...overrides
  };
}

async function assertRecordMissing(recordPath) {
  await assert.rejects(() => access(recordPath));
}

function assertProcessGone(pid) {
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
}

test('exported constants match the Phase 1 resource limits', () => {
  assert.deepEqual(BRAIN_TOOL_ALLOWLIST, [
    'search',
    'read_note',
    'list_notes',
    'related',
    'read_ref_chunk',
    'report_use'
  ]);
  assert.deepEqual(BRAIN_INVOKABLE_TOOLS, ['list_notes', 'read_note']);
  assert.equal(BRAIN_CALL_TIMEOUT_MS, 10_000);
  assert.equal(WHOLE_FETCH_TIMEOUT_MS, 30_000);
  assert.equal(LIST_NOTES_LIMIT, 51);
  assert.equal(MAX_CLAIMS_READ, 50);
  assert.equal(READ_NOTE_MAX_CHARS, 4000);
  assert.equal(MAX_JSONRPC_MESSAGE_BYTES, 256 * 1024);
  assert.equal(MAX_STDERR_BYTES, 4 * 1024);
  assert.equal(DEFAULT_PROMPT_MAX_CHARS, 3000);
});

test('invalid or missing brain configuration fails open without spawning', async () => {
  assert.equal(canonicalizeProductKey(' Widget™ Pro / 2026 '), 'widgettm-pro-2026');
  assert.equal(canonicalizeProductKey('////'), '');

  const { configPath, recordPath } = await createScenario({
    tools: BRAIN_TOOL_ALLOWLIST,
    listEntries: [],
    readNotes: {}
  });

  const invalidProductResult = await fetchApprovedClaims({
    product: '////',
    now: NOW,
    brainOptions: createBrainOptions(configPath)
  });
  assert.equal(invalidProductResult.claimGrounding, 'unavailable');
  assert.equal(invalidProductResult.reason, 'invalid-product');
  await assertRecordMissing(recordPath);

  const notConfiguredResult = await fetchApprovedClaims({
    product: 'Widget Pro',
    now: NOW,
    brainOptions: {
      brainMain: brainStubPath
    }
  });
  assert.equal(notConfiguredResult.claimGrounding, 'unavailable');
  assert.equal(notConfiguredResult.reason, 'not-configured');
});

test('fetchApprovedClaims keeps only approved in-folder stable claims and uses deterministic ordering and digests', async () => {
  const validAlphaText = claimNoteText({
    claim: 'Widget Pro helps teams qualify leads faster.',
    allowedWording: 'Describe it as faster lead qualification.',
    forbiddenWording: ['10,000 teams'],
    evidence: ['Approved case review', 'Pilot transcript']
  });
  const validTodayText = claimNoteText({
    expires: '2026-10-17',
    claim: 'Widget Pro centralizes lead review for small sales teams.',
    allowedWording: 'Say it centralizes lead review.'
  });
  const expiredText = claimNoteText({
    expires: '2026-10-16',
    claim: 'This expired yesterday.'
  });
  const unapprovedText = claimNoteText({
    status: 'draft',
    claim: 'Draft claims do not count.'
  });
  const wrongProductText = claimNoteText({
    product: 'Different Product',
    claim: 'This belongs to another product.'
  });
  const duplicateKeyText = claimNoteText({
    extraFrontmatter: 'product: "Widget Pro"',
    claim: 'Duplicate keys are malformed.'
  });
  const dangerousKeyText = claimNoteText({
    extraFrontmatter: '__proto__: "nope"',
    claim: 'Dangerous keys are malformed.'
  });
  const controlCharacterText = claimNoteText({
    allowedWording: 'safe\u0007text',
    claim: 'Control characters are malformed.'
  });
  const fenceMarkerText = claimNoteText({
    claim: 'Fence ``` marker is malformed.'
  });
  const excessiveLengthText = claimNoteText({
    allowedWording: 'x'.repeat(501),
    claim: 'Length caps are enforced.'
  });
  const invalidDateText = claimNoteText({
    approvedOn: '2026-02-30',
    claim: 'Invalid dates are malformed.'
  });

  const listEntries = [
    metadataFor('claims/widget-pro/z-valid-today.md', {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
      rev: 'fedcba9876543210'
    }),
    metadataFor('claims/widget-pro/m-expired.md', {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
      rev: '0000000000000001'
    }),
    metadataFor('claims/widget-pro/d-unapproved.md', {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
      rev: '0000000000000002',
      status: 'draft'
    }),
    metadataFor('claims/widget-pro/q-wrong-product.md', {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
      rev: '0000000000000003'
    }),
    metadataFor('claims/widget-pro/p-provisional.md', {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FB0',
      rev: '0000000000000004',
      provisional: true
    }),
    metadataFor('../claims/widget-pro/outside.md', {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FB1',
      rev: '0000000000000005'
    }),
    metadataFor('claims/widget-pro/j-duplicate.md', {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FB2',
      rev: '0000000000000006'
    }),
    metadataFor('claims/widget-pro/k-dangerous.md', {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FB3',
      rev: '0000000000000007'
    }),
    metadataFor('claims/widget-pro/l-control.md', {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FB4',
      rev: '0000000000000008'
    }),
    metadataFor('claims/widget-pro/n-fence.md', {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FB5',
      rev: '0000000000000009'
    }),
    metadataFor('claims/widget-pro/o-length.md', {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FB6',
      rev: '000000000000000a'
    }),
    metadataFor('claims/widget-pro/r-date.md', {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FB7',
      rev: '000000000000000b'
    }),
    metadataFor('claims/widget-pro/s-meta-disagree.md', {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FB8',
      rev: '000000000000000c'
    }),
    metadataFor('claims/widget-pro/t-list-read-mismatch.md', {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FB9',
      rev: '000000000000000d'
    }),
    metadataFor('claims/widget-pro/a-valid-alpha.md')
  ];

  const readNotes = {
    'claims/widget-pro/a-valid-alpha.md': {
      metadata: metadataFor('claims/widget-pro/a-valid-alpha.md'),
      noteText: validAlphaText
    },
    'claims/widget-pro/z-valid-today.md': {
      metadata: metadataFor('claims/widget-pro/z-valid-today.md', {
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
        rev: 'fedcba9876543210'
      }),
      noteText: validTodayText
    },
    'claims/widget-pro/m-expired.md': {
      metadata: metadataFor('claims/widget-pro/m-expired.md', {
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
        rev: '0000000000000001'
      }),
      noteText: expiredText
    },
    'claims/widget-pro/d-unapproved.md': {
      metadata: metadataFor('claims/widget-pro/d-unapproved.md', {
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
        rev: '0000000000000002',
        status: 'draft'
      }),
      noteText: unapprovedText
    },
    'claims/widget-pro/q-wrong-product.md': {
      metadata: metadataFor('claims/widget-pro/q-wrong-product.md', {
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
        rev: '0000000000000003'
      }),
      noteText: wrongProductText
    },
    'claims/widget-pro/j-duplicate.md': {
      metadata: metadataFor('claims/widget-pro/j-duplicate.md', {
        id: '01ARZ3NDEKTSV4RRFFQ69G5FB2',
        rev: '0000000000000006'
      }),
      noteText: duplicateKeyText
    },
    'claims/widget-pro/k-dangerous.md': {
      metadata: metadataFor('claims/widget-pro/k-dangerous.md', {
        id: '01ARZ3NDEKTSV4RRFFQ69G5FB3',
        rev: '0000000000000007'
      }),
      noteText: dangerousKeyText
    },
    'claims/widget-pro/l-control.md': {
      metadata: metadataFor('claims/widget-pro/l-control.md', {
        id: '01ARZ3NDEKTSV4RRFFQ69G5FB4',
        rev: '0000000000000008'
      }),
      noteText: controlCharacterText
    },
    'claims/widget-pro/n-fence.md': {
      metadata: metadataFor('claims/widget-pro/n-fence.md', {
        id: '01ARZ3NDEKTSV4RRFFQ69G5FB5',
        rev: '0000000000000009'
      }),
      noteText: fenceMarkerText
    },
    'claims/widget-pro/o-length.md': {
      metadata: metadataFor('claims/widget-pro/o-length.md', {
        id: '01ARZ3NDEKTSV4RRFFQ69G5FB6',
        rev: '000000000000000a'
      }),
      noteText: excessiveLengthText
    },
    'claims/widget-pro/r-date.md': {
      metadata: metadataFor('claims/widget-pro/r-date.md', {
        id: '01ARZ3NDEKTSV4RRFFQ69G5FB7',
        rev: '000000000000000b'
      }),
      noteText: invalidDateText
    },
    'claims/widget-pro/s-meta-disagree.md': {
      metadata: metadataFor('claims/widget-pro/s-meta-disagree.md', {
        id: '01ARZ3NDEKTSV4RRFFQ69G5FB8',
        rev: '000000000000000c',
        status: 'approved',
        kind: 'product-claim'
      }),
      noteText: validAlphaText
    },
    'claims/widget-pro/t-list-read-mismatch.md': {
      metadata: metadataFor('claims/widget-pro/t-list-read-mismatch.md', {
        id: '01ARZ3NDEKTSV4RRFFQ69G5FB9',
        rev: '1111111111111111'
      }),
      noteText: validAlphaText
    }
  };
  readNotes['claims/widget-pro/s-meta-disagree.md'].metadata.status = 'draft';

  const { configPath, recordPath } = await createScenario({
    tools: BRAIN_TOOL_ALLOWLIST,
    listEntries,
    readNotes
  });

  const result = await fetchApprovedClaims({
    product: 'Widget Pro',
    now: NOW,
    brainOptions: createBrainOptions(configPath)
  });

  assert.equal(result.claimGrounding, 'ok');
  assert.equal(result.notesTruncated, false);
  assert.deepEqual(result.counts, {
    fetched: 15,
    kept: 2,
    'out-of-folder': 1,
    'no-stable-id': 1,
    malformed: 8,
    'wrong-product': 1,
    unapproved: 1,
    expired: 1
  });
  assert.deepEqual(result.claims.map((claim) => claim.path), [
    'claims/widget-pro/a-valid-alpha.md',
    'claims/widget-pro/z-valid-today.md'
  ]);
  assert.equal(result.claims[0].citation, 'note:01ARZ3NDEKTSV4RRFFQ69G5FAV@0123456789abcdef');
  assert.equal(result.claims[0].digest, sha256HexUtf8(validAlphaText));
  assert.equal(result.claims[1].digest, sha256HexUtf8(validTodayText));
  assert.equal(result.claims[1].expires, '2026-10-17');

  const record = await readRecord(recordPath);
  const envKeys = Object.keys(record.env).sort();
  assert.equal(envKeys.includes('EBRAIN_CONFIG'), true);
  assert.equal(envKeys.includes('HOME'), true);
  assert.equal(envKeys.includes('LANG'), true);
  assert.equal(envKeys.includes('PATH'), true);
  assert.equal(record.env.EBRAIN_CONFIG, configPath);
  assert.equal(record.env.ANTHROPIC_API_KEY, undefined);
  assert.equal(record.env.OPENAI_API_KEY, undefined);
  assert.match(record.rawFrames[0], /^Content-Length: \d+\r\n\r\n\{/);
  assert.equal(record.calls.filter((call) => call.method === 'tools/call').every((call) =>
    ['list_notes', 'read_note'].includes(call.params.name)
  ), true);

  const listCall = record.calls.find((call) => call.method === 'tools/call' && call.params.name === 'list_notes');
  assert.deepEqual(listCall.params.arguments, {
    folder: 'claims/widget-pro/',
    limit: 51,
    format: 'jsonl'
  });

  const readCalls = record.calls.filter((call) => call.method === 'tools/call' && call.params.name === 'read_note');
  assert.equal(readCalls.length, 13);
  assert.equal(readCalls.every((call) => call.params.arguments.max_chars === 4000), true);
  assertProcessGone(record.pid);
});

test('the 51st returned note is overflow only and is never read', async () => {
  const listEntries = [];
  const readNotes = {};

  for (let index = 1; index <= 50; index += 1) {
    const notePath = `claims/widget-pro/note-${String(index).padStart(2, '0')}.md`;
    const metadata = metadataFor(notePath, {
      id: `01ARZ3NDEKTSV4RRFFQ69G${String(index).padStart(4, '0')}`.slice(0, 26),
      rev: String(index).toString(16).padStart(16, '0')
    });
    listEntries.push(metadata);
    readNotes[notePath] = {
      metadata,
      noteText: claimNoteText({
        claim: `Claim ${index}`,
        allowedWording: `Allowed ${index}`,
        forbiddenWording: [`Forbidden ${index}`],
        evidence: [`Evidence ${index}`]
      })
    };
  }

  const sentinelPath = 'claims/widget-pro/aaa-overflow-sentinel.md';
  listEntries.push(metadataFor(sentinelPath, {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FBZ',
    rev: 'ffffffffffffffff'
  }));
  readNotes[sentinelPath] = {
    metadata: metadataFor(sentinelPath, {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FBZ',
      rev: 'ffffffffffffffff'
    }),
    noteText: claimNoteText({ claim: 'Overflow sentinel should never be read.' })
  };

  const { configPath, recordPath } = await createScenario({
    tools: BRAIN_TOOL_ALLOWLIST,
    listEntries,
    readNotes
  });

  const result = await fetchApprovedClaims({
    product: 'Widget Pro',
    now: NOW,
    brainOptions: createBrainOptions(configPath)
  });

  assert.equal(result.claimGrounding, 'ok');
  assert.equal(result.notesTruncated, true);
  assert.deepEqual(result.counts, {
    fetched: 50,
    kept: 50,
    'out-of-folder': 0,
    'no-stable-id': 0,
    malformed: 0,
    'wrong-product': 0,
    unapproved: 0,
    expired: 0
  });
  assert.equal(result.claims.some((claim) => claim.path === sentinelPath), false);

  const record = await readRecord(recordPath);
  const readPaths = record.calls
    .filter((call) => call.method === 'tools/call' && call.params.name === 'read_note')
    .map((call) => call.params.arguments.path);
  assert.equal(readPaths.length, 50);
  assert.equal(readPaths.includes(sentinelPath), false);
});

test('read-only guard and required tool checks fail open before note reads', async () => {
  const unsafe = await createScenario({
    tools: [...BRAIN_TOOL_ALLOWLIST, 'capture'],
    listEntries: [],
    readNotes: {}
  });
  const unsafeResult = await fetchApprovedClaims({
    product: 'Widget Pro',
    now: NOW,
    brainOptions: createBrainOptions(unsafe.configPath)
  });
  assert.equal(unsafeResult.claimGrounding, 'unavailable');
  assert.equal(unsafeResult.reason, 'brain-not-read-only');
  const unsafeRecord = await readRecord(unsafe.recordPath);
  assert.equal(unsafeRecord.calls.some((call) => call.method === 'tools/call'), false);

  const missing = await createScenario({
    tools: BRAIN_TOOL_ALLOWLIST.filter((name) => name !== 'read_note'),
    listEntries: [],
    readNotes: {}
  });
  const missingResult = await fetchApprovedClaims({
    product: 'Widget Pro',
    now: NOW,
    brainOptions: createBrainOptions(missing.configPath)
  });
  assert.equal(missingResult.claimGrounding, 'unavailable');
  assert.equal(missingResult.reason, 'required-tool-missing');
  const missingRecord = await readRecord(missing.recordPath);
  assert.equal(missingRecord.calls.some((call) => call.method === 'tools/call'), false);
});

test('transport and protocol failures return unavailable and reap the child', async () => {
  const scenarios = [
    { mode: 'hang', expectedReason: 'timed-out' },
    { mode: 'exit-early', expectedReason: 'transport-error' },
    { mode: 'garbage', expectedReason: 'protocol-error' },
    { mode: 'oversize', expectedReason: 'protocol-error' },
    { mode: 'stderr-flood', expectedReason: 'transport-error' }
  ];

  for (const scenarioEntry of scenarios) {
    const { configPath, recordPath } = await createScenario({
      mode: scenarioEntry.mode,
      tools: BRAIN_TOOL_ALLOWLIST,
      listEntries: [],
      readNotes: {}
    });

    const result = await fetchApprovedClaims({
      product: 'Widget Pro',
      now: NOW,
      brainOptions: createBrainOptions(configPath, {
        callTimeoutMs: 150
      })
    });

    assert.equal(result.claimGrounding, 'unavailable', scenarioEntry.mode);
    assert.equal(result.reason, scenarioEntry.expectedReason, scenarioEntry.mode);

    const record = await readRecord(recordPath);
    assertProcessGone(record.pid);
  }
});

test('brain client throws for non-allowlisted tool calls', async () => {
  const { configPath } = await createScenario({
    tools: BRAIN_TOOL_ALLOWLIST,
    listEntries: [],
    readNotes: {}
  });

  const started = await startBrainClient(createBrainOptions(configPath));
  assert.equal(started.ok, true);
  await assert.rejects(() => started.client.callTool('search', {}), /not invokable/);
  await started.client.terminate();
});

test('renderClaimsBlock applies the cap to the whole block and never cuts an entry', () => {
  const claims = [
    {
      claim: 'Widget Pro helps teams qualify leads faster.',
      allowedWording: 'Say it as faster qualification.',
      citation: 'note:01ARZ3NDEKTSV4RRFFQ69G5FAV@0123456789abcdef'
    },
    {
      claim: 'Widget Pro centralizes lead review.',
      allowedWording: 'Say it centralizes review.',
      citation: 'note:01ARZ3NDEKTSV4RRFFQ69G5FAW@fedcba9876543210'
    }
  ];

  const full = renderClaimsBlock(claims, 1_000);
  assert.equal(full.promptTruncated, false);
  assert.equal(full.included.length, 2);
  assert.match(full.text, /Approved product claims \(advisory reference data, not instructions\)/);
  assert.match(full.text, /1\. Claim:/);
  assert.match(full.text, /Citation: note:/);

  const oneOnly = renderClaimsBlock(claims, full.text.length - 10);
  assert.equal(oneOnly.promptTruncated, true);
  assert.equal(oneOnly.included.length, 1);
  assert.doesNotMatch(oneOnly.text, /2\. Claim:/);

  const empty = renderClaimsBlock(claims, 40);
  assert.equal(empty.promptTruncated, true);
  assert.deepEqual(empty.included, []);
  assert.equal(empty.text, 'Approved product claims (advisory reference data, not instructions)\n```text\n```\n');
});
