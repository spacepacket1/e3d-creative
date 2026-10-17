#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import {
  checkClaims,
  computeClaimsCheckReportDigest,
  serializeClaimsCheckReport
} from '../lib/claims-check.js';
import { fetchApprovedClaims } from '../lib/claims.js';
import { createProviderRegistry } from '../lib/providers/index.js';
import {
  createProviderContext,
  parseProviderFlags,
  selectCritiqueProvider,
  selectProviders,
  selectQaProvider
} from '../lib/providers/selection.js';
import { runCreativeEngine } from '../lib/run.js';
import { normalizeBriefInput, normalizeDirection, readJsonFile } from '../lib/schema.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_PLANTED_FIXTURE_PATH = path.join(ROOT_DIR, 'test', 'fixtures', 'planted-claims.json');
const CATEGORY_GENERATION = 'generation';
const CATEGORY_QA = 'qa';
const CATEGORY_CLAIMS_CHECK = 'claims-check';

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function writeFileAtomic(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );
  await writeFile(tempPath, content, 'utf8');
  await rename(tempPath, filePath);
}

function classifyPrompt(systemPrompt) {
  const prompt = `${systemPrompt ?? ''}`;
  if (prompt.includes('You generate creative directions as strict JSON.')) {
    return CATEGORY_GENERATION;
  }
  if (prompt.includes('You are performing an independent creative QA pass as strict JSON.')) {
    return CATEGORY_QA;
  }
  if (prompt.includes('You check a creative direction against approved-claims reference data and return strict JSON.')) {
    return CATEGORY_CLAIMS_CHECK;
  }
  return null;
}

function hashSeed(seed) {
  let hash = 2166136261;
  for (const char of `${seed}`) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createPrng(seed) {
  let state = hashSeed(seed) || 0x6d2b79f5;
  return () => {
    state = Math.imul(state ^ (state >>> 15), state | 1);
    state ^= state + Math.imul(state ^ (state >>> 7), state | 61);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, seed) {
  const prng = createPrng(seed);
  const copy = items.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(prng() * (index + 1));
    const temp = copy[index];
    copy[index] = copy[swapIndex];
    copy[swapIndex] = temp;
  }
  return copy;
}

function csvEscape(value) {
  const text = `${value ?? ''}`;
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildDirectionText(direction) {
  const lines = [
    `Hook: ${direction.hook}`,
    `Premise: ${direction.premise}`,
    'Script:'
  ];
  for (const line of direction.script) {
    lines.push(line.text);
  }
  lines.push('Storyboard:');
  for (const shot of direction.storyboard) {
    lines.push(`${shot.timecodeStart}-${shot.timecodeEnd} | ${shot.onScreenText} | ${shot.audioNotes} | ${shot.visualDirection}`);
  }
  lines.push(`CTA: ${direction.ctaText}`);
  return lines.join('\n');
}

function parseEvalArgs(argv) {
  const { options: cliOptions, rest: providerRest } = parseProviderFlags(argv);
  const values = {};
  let yes = false;
  const rest = [];
  const valueFlags = ['--briefs', '--out', '--brain-config', '--brain-main', '--seed', '--check-provider'];

  for (let index = 0; index < providerRest.length; index += 1) {
    const arg = providerRest[index];
    if (arg === '--yes') {
      yes = true;
      continue;
    }

    const flag = valueFlags.find((name) => arg === name || arg.startsWith(`${name}=`));
    if (!flag) {
      rest.push(arg);
      continue;
    }

    if (arg === flag) {
      values[flag] = providerRest[index + 1];
      index += 1;
    } else {
      values[flag] = arg.slice(flag.length + 1);
    }
  }

  if (rest.length > 0) {
    throw new Error(`unexpected argument: ${rest[0]}`);
  }
  if (!values['--briefs']) {
    throw new Error('missing --briefs <dir>');
  }
  if (!values['--out']) {
    throw new Error('missing --out <dir>');
  }

  return {
    briefDir: path.resolve(values['--briefs']),
    outDir: path.resolve(values['--out']),
    brainConfig: values['--brain-config'],
    brainMain: values['--brain-main'],
    seed: values['--seed'] ?? 'claims-eval-default-seed',
    checkProvider: values['--check-provider'],
    yes,
    cliOptions
  };
}

async function loadBriefEntries(briefDir) {
  const entries = await readdir(briefDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  if (files.length === 0) {
    throw new Error(`no brief JSON files found in ${briefDir}`);
  }

  return files.map((fileName, index) => ({
    fileName,
    filePath: path.join(briefDir, fileName),
    briefId: `${String(index + 1).padStart(2, '0')}-${fileName.replace(/\.json$/i, '')}`
  }));
}

async function loadPlantedFixtures(filePath = DEFAULT_PLANTED_FIXTURE_PATH) {
  const parsed = await readJsonFile(filePath);
  if (!Array.isArray(parsed) || parsed.length < 10) {
    throw new Error('planted claims fixture must contain at least 10 items');
  }

  return parsed.map((item, index) => {
    if (
      item === null ||
      typeof item !== 'object' ||
      Array.isArray(item) ||
      typeof item.id !== 'string' ||
      item.id.trim() === '' ||
      typeof item.sentence !== 'string' ||
      item.sentence.trim() === '' ||
      typeof item.expectedTrigger !== 'string' ||
      item.expectedTrigger.trim() === ''
    ) {
      throw new Error(`planted claims fixture item ${index + 1} is invalid`);
    }
    return {
      id: item.id.trim(),
      sentence: item.sentence.trim(),
      expectedTrigger: item.expectedTrigger.trim()
    };
  });
}

function summarizeProviders(briefs, cliOptions, checkProviderOverride) {
  const generation = new Set();
  const qa = new Set();
  const claimsCheck = new Set();

  for (const brief of briefs) {
    const selected = selectProviders({ brief, cliOptions });
    generation.add(selected.conceptGeneration);
    qa.add(selectQaProvider({
      generatedProvider: selected.conceptGeneration,
      critiqueProvider: selected.critique,
      brief,
      cliOptions
    }));
    claimsCheck.add(checkProviderOverride ?? selectCritiqueProvider({
      generatedProvider: selected.conceptGeneration,
      brief
    }));
  }

  return {
    generation: Array.from(generation).sort(),
    qa: Array.from(qa).sort(),
    claimsCheck: Array.from(claimsCheck).sort()
  };
}

function formatProviderSet(values) {
  return values.length === 1 ? values[0] : values.join(', ');
}

async function confirmRun({ briefCount, providers, yes, stdout = process.stdout, stdin = process.stdin }) {
  const lines = [
    `claims eval plan: ${briefCount} brief${briefCount === 1 ? '' : 's'}`,
    `generation calls: ${briefCount}`,
    'qa calls: one QA model call per keep-verdict direction produced by the normal engine',
    'claims-check calls: two per QA’d direction (base and planted)',
    `generation provider(s): ${formatProviderSet(providers.generation)}`,
    `qa provider(s): ${formatProviderSet(providers.qa)}`,
    `claims-check provider(s): ${formatProviderSet(providers.claimsCheck)}`
  ];
  stdout.write(`${lines.join('\n')}\n`);

  if (yes) {
    return true;
  }

  const rl = readline.createInterface({
    input: stdin,
    output: stdout
  });
  try {
    const answer = await rl.question('Proceed? [y/N] ');
    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

function createCountingRegistry(baseRegistry, counters) {
  return Object.fromEntries(
    Object.entries(baseRegistry).map(([name, provider]) => [name, {
      ...provider,
      async generate(request) {
        const category = classifyPrompt(request?.systemPrompt);
        if (category && Object.hasOwn(counters, category)) {
          counters[category] += 1;
        }
        return provider.generate(request);
      }
    }])
  );
}

function buildFullClaimsReport(report, directionDigest, checkedAt) {
  return {
    claimGrounding: report.claimGrounding,
    groundingReason: report.groundingReason,
    checkStatus: report.checkStatus,
    checkReason: report.checkReason,
    counts: report.counts,
    notesTruncated: report.notesTruncated,
    promptTruncated: report.promptTruncated,
    findings: report.findings,
    checkedBy: report.checkedBy,
    sameProviderAsGeneration: report.sameProviderAsGeneration,
    directionDigest,
    claimsUsed: report.claimsUsed,
    checkedAt,
    disclaimer: report.disclaimer
  };
}

function chooseFixture(fixtures, seed, index) {
  const prng = createPrng(`${seed}:${index}`);
  return fixtures[Math.floor(prng() * fixtures.length)];
}

function createPlantedDirection(direction, sentence) {
  const planted = structuredClone(direction);
  const targetIndex = planted.script.length - 1;
  const original = planted.script[targetIndex].text;
  planted.script[targetIndex].text = `${original} ${sentence}`.trim();
  return {
    direction: normalizeDirection(planted),
    location: `script:${targetIndex + 1}`
  };
}

function normalizeComparableText(value) {
  return `${value ?? ''}`
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Decimal_Number}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function plantedSentenceDetected(report, plantLocation, sentence) {
  if (report.checkStatus !== 'passed' && report.checkStatus !== 'findings') {
    return false;
  }
  const normalizedSentence = normalizeComparableText(sentence);
  return report.findings.some((finding) => {
    if (finding.location !== plantLocation) {
      return false;
    }
    if (finding.type !== 'forbidden' && finding.type !== 'unsupported') {
      return false;
    }
    const normalizedQuote = normalizeComparableText(finding.quote);
    return normalizedQuote !== '' && normalizedSentence.includes(normalizedQuote);
  });
}

function countFalseFlags(report) {
  return report.findings.filter((finding) =>
    finding.type === 'forbidden' || finding.type === 'unsupported'
  ).length;
}

function buildSummary(rows) {
  const plantedRows = rows.filter((row) => row.condition === 'planted');
  const baseRows = rows.filter((row) => row.condition === 'unmodified');
  const plantedChecked = plantedRows.filter((row) => row.checkerStatus === 'passed' || row.checkerStatus === 'findings');
  const plantedDetected = plantedChecked.filter((row) => row.detected).length;
  const baseChecked = baseRows.filter((row) => row.checkerStatus === 'passed' || row.checkerStatus === 'findings');
  const falseFlagFindings = baseChecked.reduce((sum, row) => sum + row.falseFlagCount, 0);

  return {
    plantedRecall: {
      detected: plantedDetected,
      checked: plantedChecked.length,
      failed: plantedRows.filter((row) => row.checkerStatus === 'failed').length,
      notRun: plantedRows.filter((row) => row.checkerStatus === 'not-run').length,
      recall: plantedChecked.length === 0 ? null : plantedDetected / plantedChecked.length
    },
    falseFlags: {
      findings: falseFlagFindings,
      checked: baseChecked.length,
      failed: baseRows.filter((row) => row.checkerStatus === 'failed').length,
      notRun: baseRows.filter((row) => row.checkerStatus === 'not-run').length,
      findingsPerCheckedDirection: baseChecked.length === 0 ? null : falseFlagFindings / baseChecked.length
    }
  };
}

function buildSheetCsv(rows) {
  const header = ['row_id', 'direction_text', 'human_overstated_yes_no', 'notes'];
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push([
      csvEscape(row.row_id),
      csvEscape(row.direction_text),
      '',
      ''
    ].join(','));
  }
  return `${lines.join('\n')}\n`;
}

function buildKeyRows(rows) {
  return rows.map((row) => ({
    row_id: row.row_id,
    condition: row.condition,
    sourceArtifact: row.sourceArtifact,
    plant: row.plant,
    checkerStatus: row.checkerStatus,
    checkerFindings: row.checkerFindings,
    providerMetadata: row.providerMetadata,
    digests: row.digests
  }));
}

async function writeClaimsReportArtifact({ report, reportPath, checkedAt, directionBytes }) {
  const fullReport = buildFullClaimsReport(report, sha256Hex(directionBytes), checkedAt);
  const reportText = serializeClaimsCheckReport(fullReport);
  const reportDigest = computeClaimsCheckReportDigest(reportText);
  await writeFileAtomic(reportPath, reportText);
  await writeFileAtomic(`${reportPath}.sha256`, `${reportDigest}\n`);
  return {
    fullReport,
    reportDigest
  };
}

export async function runClaimsEvaluation(options, dependencies = {}) {
  const {
    briefDir,
    outDir,
    brainConfig,
    brainMain,
    seed = 'claims-eval-default-seed',
    yes = false,
    cliOptions = {},
    checkProvider
  } = options;

  const stdout = dependencies.stdout ?? process.stdout;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const fetchApprovedClaimsImpl = dependencies.fetchApprovedClaimsImpl ?? fetchApprovedClaims;
  const briefs = await loadBriefEntries(briefDir);
  const plantedFixtures = await loadPlantedFixtures(dependencies.plantedFixturePath);
  const normalizedBriefs = [];

  for (const entry of briefs) {
    const brief = await normalizeBriefInput(await readJsonFile(entry.filePath), {
      baseDir: path.dirname(entry.filePath)
    });
    normalizedBriefs.push({ ...entry, brief });
  }

  const providers = summarizeProviders(normalizedBriefs.map((entry) => entry.brief), cliOptions, checkProvider);
  const confirmed = await (dependencies.confirmRunImpl ?? confirmRun)({
    briefCount: normalizedBriefs.length,
    providers,
    yes,
    stdout,
    stdin: dependencies.stdin ?? process.stdin
  });
  if (!confirmed) {
    stdout.write('Cancelled.\n');
    return {
      cancelled: true
    };
  }

  const counters = {
    [CATEGORY_GENERATION]: 0,
    [CATEGORY_QA]: 0,
    [CATEGORY_CLAIMS_CHECK]: 0
  };
  const baseRegistry = dependencies.providerRegistry ?? createProviderRegistry(dependencies.providerOptions ?? {});
  const countingRegistry = createCountingRegistry(baseRegistry, counters);
  const keyRows = [];
  const sheetRows = [];

  for (let briefIndex = 0; briefIndex < normalizedBriefs.length; briefIndex += 1) {
    const briefEntry = normalizedBriefs[briefIndex];
    const briefOutDir = path.join(outDir, 'briefs', briefEntry.briefId);
    const providerContext = createProviderContext({
      brief: briefEntry.brief,
      cliOptions,
      registry: countingRegistry
    });
    const runResult = await runCreativeEngine({
      brief: briefEntry.brief,
      outDir: briefOutDir,
      cliOptions,
      providerContext,
      now
    });

    const claimsResult = await fetchApprovedClaimsImpl({
      product: briefEntry.brief.product,
      brainOptions: {
        brainConfig,
        brainMain
      }
    });

    const generatedProvider = runResult.concepts.provider ?? providerContext.selection.conceptGeneration;
    const checkProviderName = checkProvider ?? selectCritiqueProvider({
      generatedProvider,
      brief: briefEntry.brief
    });
    const checkerProvider = claimsResult.claimGrounding === 'ok'
      ? providerContext.registry[checkProviderName]
      : null;

    if (claimsResult.claimGrounding === 'ok' && (!checkerProvider || typeof checkerProvider.generate !== 'function')) {
      throw new Error('provider for claims-check does not implement generate');
    }

    for (let directionIndex = 0; directionIndex < runResult.qa.directions.length; directionIndex += 1) {
      const qaEntry = runResult.qa.directions[directionIndex];
      const directionPath = path.join(runResult.qaDir, qaEntry.expandedDirectionFile);
      const directionBytes = await readFile(directionPath);
      const direction = normalizeDirection(JSON.parse(directionBytes.toString('utf8')));
      const baseReport = await checkClaims({
        direction: {
          ...direction,
          generatedProvider
        },
        claimsResult,
        provider: checkerProvider
      });
      const baseReportPath = path.join(briefOutDir, 'claims-base', `${direction.directionId}.claims-check.json`);
      const baseArtifact = await writeClaimsReportArtifact({
        report: baseReport,
        reportPath: baseReportPath,
        checkedAt: now(),
        directionBytes
      });
      const baseRowId = `${briefEntry.briefId}-${String(directionIndex + 1).padStart(2, '0')}-base`;
      sheetRows.push({
        row_id: baseRowId,
        direction_text: buildDirectionText(direction)
      });
      keyRows.push({
        row_id: baseRowId,
        condition: 'unmodified',
        sourceArtifact: path.relative(outDir, directionPath),
        plant: null,
        checkerStatus: baseArtifact.fullReport.checkStatus,
        checkerFindings: baseArtifact.fullReport.findings,
        providerMetadata: {
          generationProvider: generatedProvider,
          qaProvider: runResult.qa.qaProvider,
          claimsCheckProvider: checkProviderName,
          checkedBy: baseArtifact.fullReport.checkedBy
        },
        digests: {
          directionDigest: baseArtifact.fullReport.directionDigest,
          reportDigest: baseArtifact.reportDigest
        },
        falseFlagCount: countFalseFlags(baseArtifact.fullReport),
        detected: false
      });

      const plantedFixture = chooseFixture(plantedFixtures, seed, (briefIndex * 1000) + directionIndex);
      const planted = createPlantedDirection(direction, plantedFixture.sentence);
      const plantedBytes = Buffer.from(stableJson(planted.direction), 'utf8');
      const plantedDirectionPath = path.join(
        briefOutDir,
        'claims-planted',
        `${direction.directionId}.${plantedFixture.id}.direction.json`
      );
      await writeFileAtomic(plantedDirectionPath, plantedBytes.toString('utf8'));
      const plantedReport = await checkClaims({
        direction: {
          ...planted.direction,
          generatedProvider
        },
        claimsResult,
        provider: checkerProvider
      });
      const plantedReportPath = path.join(
        briefOutDir,
        'claims-planted',
        `${direction.directionId}.${plantedFixture.id}.claims-check.json`
      );
      const plantedArtifact = await writeClaimsReportArtifact({
        report: plantedReport,
        reportPath: plantedReportPath,
        checkedAt: now(),
        directionBytes: plantedBytes
      });
      const plantedRowId = `${briefEntry.briefId}-${String(directionIndex + 1).padStart(2, '0')}-plant`;
      sheetRows.push({
        row_id: plantedRowId,
        direction_text: buildDirectionText(planted.direction)
      });
      keyRows.push({
        row_id: plantedRowId,
        condition: 'planted',
        sourceArtifact: path.relative(outDir, plantedDirectionPath),
        plant: {
          location: planted.location,
          sentence: plantedFixture.sentence,
          fixtureId: plantedFixture.id,
          expectedTrigger: plantedFixture.expectedTrigger,
          sourceDirection: path.relative(outDir, directionPath)
        },
        checkerStatus: plantedArtifact.fullReport.checkStatus,
        checkerFindings: plantedArtifact.fullReport.findings,
        providerMetadata: {
          generationProvider: generatedProvider,
          qaProvider: runResult.qa.qaProvider,
          claimsCheckProvider: checkProviderName,
          checkedBy: plantedArtifact.fullReport.checkedBy
        },
        digests: {
          sourceDirectionDigest: baseArtifact.fullReport.directionDigest,
          plantedDirectionDigest: plantedArtifact.fullReport.directionDigest,
          reportDigest: plantedArtifact.reportDigest
        },
        falseFlagCount: 0,
        detected: plantedSentenceDetected(plantedArtifact.fullReport, planted.location, plantedFixture.sentence)
      });
    }
  }

  const shuffledSheetRows = shuffle(sheetRows, `${seed}:sheet`);
  const summary = buildSummary(keyRows);
  const evalSheetPath = path.join(outDir, 'eval-sheet.csv');
  const evalKeyPath = path.join(outDir, 'eval-key.json');
  const evalSummaryPath = path.join(outDir, 'eval-summary.json');
  await writeFileAtomic(evalSheetPath, buildSheetCsv(shuffledSheetRows));
  await writeFileAtomic(evalKeyPath, stableJson({
    seed,
    rows: buildKeyRows(keyRows)
  }));
  await writeFileAtomic(evalSummaryPath, stableJson({
    seed,
    counters,
    summary
  }));

  stdout.write(
    [
      `claims eval complete: ${normalizedBriefs.length} brief${normalizedBriefs.length === 1 ? '' : 's'} -> ${outDir}`,
      `generation calls: ${counters[CATEGORY_GENERATION]}`,
      `qa calls: ${counters[CATEGORY_QA]}`,
      `claims-check calls: ${counters[CATEGORY_CLAIMS_CHECK]}`,
      `planted recall: ${summary.plantedRecall.detected}/${summary.plantedRecall.checked}`,
      `false flags: ${summary.falseFlags.findings}/${summary.falseFlags.checked}`
    ].join('\n') + '\n'
  );

  return {
    outDir,
    seed,
    counters,
    summary,
    keyRows,
    sheetRows: shuffledSheetRows
  };
}

export async function main(argv, dependencies = {}) {
  const options = parseEvalArgs(argv);
  return runClaimsEvaluation(options, dependencies);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
