import path from 'node:path';
import { normalizeBriefInput, normalizeDirection, readJsonFile } from './schema.js';
import { generateConcepts } from './concepts.js';
import { createProviderContext, parseProviderFlags } from './providers/selection.js';
import { critiqueConcepts } from './critique.js';
import { formatQaCliSummary, qaDirections } from './qa.js';
import { formatPackageList, packageDirection } from './package.js';

function usage() {
  return [
    'Usage:',
    '  e3d-creative validate-brief <file>',
    '  e3d-creative validate-direction <file>',
    '  e3d-creative concepts <brief.json> --out <dir> [--concept-provider <name>]',
    '  e3d-creative critique <concepts-dir> --out <dir> [--critique-provider <name>]',
    '  e3d-creative qa <concepts-dir> <critique-dir> --out <dir> [--qa-provider <name>]',
    '  e3d-creative package <qa-dir>/<id>.visual-direction.json --out <dir> [--list]',
    '    (requires the co-located <id>.qa.json that `qa` writes next to it)'
  ].join('\n');
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

export async function main(argv) {
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

  throw new Error(`unknown command: ${command}\n${usage()}`);
}
