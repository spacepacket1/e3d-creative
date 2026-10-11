import path from 'node:path';
import { normalizeBriefInput, normalizeDirection, readJsonFile } from './schema.js';

function usage() {
  return [
    'Usage:',
    '  e3d-creative validate-brief <file>',
    '  e3d-creative validate-direction <file>'
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

export async function main(argv) {
  const [command, filePath] = argv;

  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  if (!filePath) {
    throw new Error(`missing file path\n${usage()}`);
  }

  if (command === 'validate-brief') {
    await validateBriefCommand(filePath);
    return;
  }

  if (command === 'validate-direction') {
    await validateDirectionCommand(filePath);
    return;
  }

  throw new Error(`unknown command: ${command}\n${usage()}`);
}
