import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { access, link, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { normalizeBriefInput, normalizeDirection, readJsonFile } from './schema.js';
import { generateConcepts } from './concepts.js';
import { fetchApprovedClaims } from './claims.js';
import {
  checkClaims,
  CLAIMS_CHECK_DIRECTION_ID_PATTERN,
  computeClaimsCheckReportDigest,
  formatClaimsCheckCliSummary,
  serializeClaimsCheckReport
} from './claims-check.js';
import { createProviderContext, parseProviderFlags, selectCritiqueProvider } from './providers/selection.js';
import { critiqueConcepts } from './critique.js';
import { formatQaCliSummary, qaDirections } from './qa.js';
import { formatPackageList, packageDirection } from './package.js';
import { runScriptLoop } from './script-critique.js';
import { formatRunCliSummary, runCreativeEngine } from './run.js';

function usage() {
  return [
    'Usage:',
    '  e3d-creative validate-brief <file>',
    '  e3d-creative validate-direction <file>',
    '  e3d-creative concepts <brief.json> --out <dir> [--concept-provider <name>]',
    '  e3d-creative critique <concepts-dir> --out <dir> [--critique-provider <name>]',
    '  e3d-creative qa <concepts-dir> <critique-dir> --out <dir> [--qa-provider <name>]',
    '  e3d-creative package <qa-dir>/<id>.visual-direction.json --out <dir> [--list]',
    '    (requires the co-located <id>.qa.json that `qa` writes next to it)',
    '  e3d-creative run <brief.json> --out <dir> [--concept-provider <name>] [--critique-provider <name>] [--qa-provider <name>] [--claims-check] [--check-provider <name>] [--brain-config <path>] [--brain-main <path>]',
    '  e3d-creative claims-check <direction.json> --brief <brief.json> --out <dir> [--check-provider <name>] [--brain-config <path>] [--brain-main <path>] [--fail-on-unsupported]',
    '  e3d-creative script-critique (--script <file> | --topic <text>) --out <dir> [--audience <text>] [--max-rounds <n>] [--critique-provider <name>] [--concept-provider <name>]'
  ].join('\n');
}

function createCliError(message, exitCode = 1) {
  const error = new Error(message);
  error.exitCode = exitCode;
  return error;
}

async function validateBriefCommand(filePath) {
  const brief = await readJsonFile(filePath);
  await normalizeBriefInput(brief, { baseDir: path.dirname(path.resolve(filePath)) });
  process.stdout.write(`brief valid: ${filePath}\n`);
}

async function validateDirectionCommand(filePath) {
  const direction = await readJsonFile(filePath);
  normalizeDirection(direction);
  process.stdout.write(`direction valid: ${filePath}\n`);
}

function parseOutDir(args) {
  let outDir = null;
  const rest = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--out') {
      outDir = args[index + 1];
      index += 1;
    } else if (arg.startsWith('--out=')) {
      outDir = arg.slice('--out='.length);
    } else {
      rest.push(arg);
    }
  }

  if (!outDir) {
    throw new Error(`missing --out <dir>\n${usage()}`);
  }

  return { outDir, rest };
}

function parseListFlag(args) {
  let list = false;
  const rest = [];

  for (const arg of args) {
    if (arg === '--list') {
      list = true;
    } else {
      rest.push(arg);
    }
  }

  return { list, rest };
}

async function conceptsCommand(args) {
  const { options: cliOptions, rest: providerRest } = parseProviderFlags(args);
  const { outDir, rest } = parseOutDir(providerRest);
  const [filePath] = rest;

  if (!filePath) {
    throw new Error(`missing brief path\n${usage()}`);
  }

  const brief = await readJsonFile(filePath);
  const normalizedBrief = await normalizeBriefInput(brief, {
    baseDir: path.dirname(path.resolve(filePath))
  });
  const providerContext = createProviderContext({
    brief: normalizedBrief,
    cliOptions
  });
  const result = await generateConcepts({
    brief: normalizedBrief,
    outDir: path.resolve(outDir),
    providerContext
  });

  process.stdout.write(
    `concepts generated: ${result.directions.length} directions -> ${path.resolve(outDir)} (${result.provider}/${result.model})\n`
  );
}

async function critiqueCommand(args) {
  const { options: cliOptions, rest: providerRest } = parseProviderFlags(args);
  const { outDir, rest } = parseOutDir(providerRest);
  const [conceptsDir] = rest;

  if (!conceptsDir) {
    throw new Error(`missing concepts directory\n${usage()}`);
  }

  const result = await critiqueConcepts({
    conceptsDir: path.resolve(conceptsDir),
    outDir: path.resolve(outDir),
    cliOptions,
    providerContext: createProviderContext({ cliOptions })
  });

  process.stdout.write(
    `critique generated: ${result.directions.length} directions -> ${path.resolve(outDir)} (${result.critiqueProvider})\n`
  );
}

async function qaCommand(args) {
  const { options: cliOptions, rest: providerRest } = parseProviderFlags(args);
  const { outDir, rest } = parseOutDir(providerRest);
  const [conceptsDir, critiqueDir] = rest;

  if (!conceptsDir || !critiqueDir) {
    throw new Error(`missing concepts or critique directory\n${usage()}`);
  }

  const result = await qaDirections({
    conceptsDir: path.resolve(conceptsDir),
    critiqueDir: path.resolve(critiqueDir),
    outDir: path.resolve(outDir),
    cliOptions,
    providerContext: createProviderContext({ cliOptions })
  });

  process.stdout.write(formatQaCliSummary(result));
}

async function packageCommand(args) {
  const { list, rest: flagRest } = parseListFlag(args);
  const { outDir, rest } = parseOutDir(flagRest);
  const [directionPath] = rest;

  if (!directionPath) {
    throw new Error(`missing direction path\n${usage()}`);
  }

  const result = await packageDirection({
    directionPath: path.resolve(directionPath),
    outDir: path.resolve(outDir)
  });

  if (list) {
    process.stdout.write(formatPackageList(result.manifest, result.outDir));
    return;
  }

  process.stdout.write(
    `packaged direction: ${result.directionId} -> ${result.bundleDir}\n`
  );
}

async function runCommand(args, dependencies = {}) {
  const { options: cliOptions, rest: providerRest } = parseProviderFlags(args);
  const { values: runValues, claimsCheck, rest: claimsRest } = parseRunClaimsFlags(providerRest);
  const { outDir, rest } = parseOutDir(claimsRest);
  const [filePath] = rest;

  if (!filePath) {
    throw new Error(`missing brief path\n${usage()}`);
  }

  const brief = await readJsonFile(filePath);
  const normalizedBrief = await normalizeBriefInput(brief, {
    baseDir: path.dirname(path.resolve(filePath))
  });
  const result = await runCreativeEngine({
    brief: normalizedBrief,
    outDir: path.resolve(outDir),
    cliOptions,
    claimsCheck: claimsCheck
      ? {
          enabled: true,
          checkProvider: runValues['--check-provider'],
          brainConfig: runValues['--brain-config'],
          brainMain: runValues['--brain-main']
        }
      : null,
    providerContext: dependencies.providerContext ?? createProviderContext({
      brief: normalizedBrief,
      cliOptions
    }),
    now: dependencies.now,
    fetchApprovedClaimsImpl: dependencies.fetchApprovedClaimsImpl
  });

  process.stdout.write(formatRunCliSummary(result));
}

function parseRunClaimsFlags(args) {
  const values = {};
  let claimsCheck = false;
  const rest = [];
  const valueFlags = ['--check-provider', '--brain-config', '--brain-main'];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--claims-check') {
      claimsCheck = true;
      continue;
    }

    const flag = valueFlags.find((name) => arg === name || arg.startsWith(`${name}=`));
    if (!flag) {
      rest.push(arg);
      continue;
    }

    if (arg === flag) {
      values[flag] = args[index + 1];
      index += 1;
    } else {
      values[flag] = arg.slice(flag.length + 1);
    }
  }

  return { values, claimsCheck, rest };
}

function parseScriptCritiqueFlags(args) {
  const values = {};
  const valueFlags = ['--script', '--topic', '--audience', '--max-rounds'];
  const rest = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const flag = valueFlags.find((name) => arg === name || arg.startsWith(`${name}=`));
    if (!flag) {
      rest.push(arg);
    } else if (arg === flag) {
      values[flag] = args[index + 1];
      index += 1;
    } else {
      values[flag] = arg.slice(flag.length + 1);
    }
  }

  return { values, rest };
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

async function writeFileAtomicNoOverwrite(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );

  try {
    await writeFile(tempPath, content, 'utf8');
    await link(tempPath, filePath);
  } finally {
    await unlink(tempPath).catch(() => {});
  }
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseClaimsCheckFlags(args) {
  const values = {};
  let failOnUnsupported = false;
  const rest = [];
  const valueFlags = ['--brief', '--check-provider', '--brain-config', '--brain-main'];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--fail-on-unsupported') {
      failOnUnsupported = true;
      continue;
    }

    const flag = valueFlags.find((name) => arg === name || arg.startsWith(`${name}=`));
    if (!flag) {
      rest.push(arg);
      continue;
    }

    if (arg === flag) {
      values[flag] = args[index + 1];
      index += 1;
    } else {
      values[flag] = arg.slice(flag.length + 1);
    }
  }

  return { values, failOnUnsupported, rest };
}

function claimsCheckExitCode(report, failOnUnsupported) {
  if (!failOnUnsupported) {
    return 0;
  }
  if (report.checkStatus === 'passed') {
    return 0;
  }
  if (report.checkStatus === 'findings') {
    return 3;
  }
  if (report.checkStatus === 'failed') {
    return 4;
  }
  if (report.checkStatus === 'not-run') {
    return 5;
  }
  return 0;
}

async function ensureAbsent(filePath) {
  try {
    await access(filePath);
    throw createCliError(`refusing to overwrite existing artifact: ${filePath}`, 1);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
}

async function claimsCheckCommand(args, dependencies = {}) {
  const { values, failOnUnsupported, rest: flagRest } = parseClaimsCheckFlags(args);
  const { outDir, rest } = parseOutDir(flagRest);
  const [directionPath] = rest;

  if (!directionPath) {
    throw createCliError(`missing direction path\n${usage()}`, 2);
  }
  if (!values['--brief'] || values['--brief'].startsWith('--')) {
    throw createCliError(`missing --brief <brief.json>\n${usage()}`, 2);
  }
  if (rest.length > 1) {
    throw createCliError(`unexpected argument: ${rest[1]}\n${usage()}`, 2);
  }

  const resolvedDirectionPath = path.resolve(directionPath);
  const resolvedBriefPath = path.resolve(values['--brief']);
  const resolvedOutDir = path.resolve(outDir);

  const directionBytes = await readFile(resolvedDirectionPath);
  let rawDirection;
  let rawBrief;
  try {
    rawDirection = JSON.parse(directionBytes.toString('utf8'));
    rawBrief = await readJsonFile(resolvedBriefPath);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw createCliError(`invalid JSON input: ${error.message}`, 2);
    }
    throw error;
  }

  let direction;
  let brief;
  try {
    direction = normalizeDirection(rawDirection);
    brief = await normalizeBriefInput(rawBrief, {
      baseDir: path.dirname(resolvedBriefPath)
    });
  } catch (error) {
    throw createCliError(error instanceof Error ? error.message : String(error), 2);
  }

  if (!CLAIMS_CHECK_DIRECTION_ID_PATTERN.test(direction.directionId)) {
    throw createCliError('directionId must match ^[A-Za-z0-9._-]{1,80}$', 2);
  }

  const reportPath = path.join(resolvedOutDir, `${direction.directionId}.claims-check.json`);
  const digestPath = `${reportPath}.sha256`;
  await ensureAbsent(reportPath);
  await ensureAbsent(digestPath);

  const claimsResult = await (dependencies.fetchApprovedClaimsImpl ?? fetchApprovedClaims)({
    product: brief.product,
    brainOptions: {
      brainConfig: values['--brain-config'],
      brainMain: values['--brain-main']
    }
  });

  let report;
  if (claimsResult.claimGrounding !== 'ok') {
    report = await checkClaims({
      direction: {
        ...direction,
        generatedProvider: rawDirection.generatedProvider
      },
      claimsResult
    });
  } else {
    const selectedProviderName = values['--check-provider'] ?? selectCritiqueProvider({
      generatedProvider: typeof rawDirection.generatedProvider === 'string'
        ? rawDirection.generatedProvider.trim()
        : undefined,
      brief
    });
    const providerContext = dependencies.providerContext ?? createProviderContext({
      brief,
      cliOptions: { critiqueProvider: selectedProviderName }
    });
    const provider = providerContext.registry[selectedProviderName];
    if (!provider || typeof provider.generate !== 'function') {
      throw createCliError(`provider for claims-check does not implement generate`, 2);
    }

    report = await checkClaims({
      direction: {
        ...direction,
        generatedProvider: rawDirection.generatedProvider
      },
      claimsResult,
      provider
    });
  }

  const fullReport = {
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
    directionDigest: sha256Hex(directionBytes),
    claimsUsed: report.claimsUsed,
    checkedAt: (dependencies.now ?? (() => new Date().toISOString()))(),
    disclaimer: report.disclaimer
  };

  const reportText = serializeClaimsCheckReport(fullReport);
  const reportDigest = computeClaimsCheckReportDigest(reportText);
  await writeFileAtomicNoOverwrite(reportPath, reportText);
  await writeFileAtomicNoOverwrite(digestPath, `${reportDigest}\n`);

  process.stdout.write(formatClaimsCheckCliSummary(fullReport));
  process.exitCode = claimsCheckExitCode(fullReport, failOnUnsupported);
}

async function scriptCritiqueCommand(args, dependencies = {}) {
  const { options: cliOptions, rest: providerRest } = parseProviderFlags(args);
  const { outDir, rest: flagRest } = parseOutDir(providerRest);
  const { values, rest } = parseScriptCritiqueFlags(flagRest);

  if (rest.length > 0) {
    throw new Error(`unexpected argument: ${rest[0]}\n${usage()}`);
  }
  const hasScript = values['--script'] !== undefined;
  const hasTopic = values['--topic'] !== undefined;
  if (hasScript === hasTopic) {
    throw new Error(`exactly one of --script <file> or --topic <text> is required\n${usage()}`);
  }
  const source = hasScript ? values['--script'] : values['--topic'];
  if (!source || source.startsWith('--')) {
    throw new Error(`missing value for ${hasScript ? '--script' : '--topic'}\n${usage()}`);
  }

  let maxRounds;
  if (values['--max-rounds'] !== undefined) {
    maxRounds = Number(values['--max-rounds']);
    if (!/^\d+$/.test(values['--max-rounds']) || !Number.isInteger(maxRounds)) {
      throw new Error(`--max-rounds must be a non-negative integer\n${usage()}`);
    }
  }

  const input = hasScript ? await readFile(path.resolve(source), 'utf8') : source;
  const result = await runScriptLoop({
    mode: hasScript ? 'improve' : 'write',
    input,
    audience: values['--audience'],
    maxRounds,
    providers: dependencies.providerContext ?? createProviderContext({ cliOptions })
  });

  const resolvedOut = path.resolve(outDir);
  const report = {
    mode: hasScript ? 'improve' : 'write',
    verdict: result.verdict,
    finalScores: result.finalScores,
    rounds: result.rounds
  };
  await writeFileAtomic(path.join(resolvedOut, 'script.txt'), `${result.script}\n`);
  await writeFileAtomic(
    path.join(resolvedOut, 'script-critique.json'),
    `${JSON.stringify(report, null, 2)}\n`
  );

  process.stdout.write(
    `script critique complete: verdict ${result.verdict}, ${result.rounds.length} critique rounds -> ${resolvedOut}\n`
  );
}

export async function main(argv, dependencies = {}) {
  const [command, ...rest] = argv;

  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  if (command === 'validate-brief') {
    const [filePath] = rest;
    if (!filePath) {
      throw new Error(`missing file path\n${usage()}`);
    }
    await validateBriefCommand(filePath);
    return;
  }

  if (command === 'validate-direction') {
    const [filePath] = rest;
    if (!filePath) {
      throw new Error(`missing file path\n${usage()}`);
    }
    await validateDirectionCommand(filePath);
    return;
  }

  if (command === 'concepts') {
    await conceptsCommand(rest);
    return;
  }

  if (command === 'critique') {
    await critiqueCommand(rest);
    return;
  }

  if (command === 'qa') {
    await qaCommand(rest);
    return;
  }

  if (command === 'package') {
    await packageCommand(rest);
    return;
  }

  if (command === 'run') {
    await runCommand(rest, dependencies);
    return;
  }

  if (command === 'claims-check') {
    await claimsCheckCommand(rest, dependencies);
    return;
  }

  if (command === 'script-critique') {
    await scriptCritiqueCommand(rest, dependencies);
    return;
  }

  throw new Error(`unknown command: ${command}\n${usage()}`);
}
