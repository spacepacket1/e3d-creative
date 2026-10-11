import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { generateConcepts } from './concepts.js';
import { critiqueConcepts } from './critique.js';
import { packageDirection } from './package.js';
import { qaDirections } from './qa.js';

function countKeepVerdicts(critiqueResult) {
  return critiqueResult.directions.filter((direction) => direction.finalVerdict === 'keep').length;
}

export function formatRunCliSummary(result) {
  const lines = [
    `run complete: ${result.concepts.directions.length} directions, ${result.keepCount} keep verdict${result.keepCount === 1 ? '' : 's'}, ${result.packagedDirections.length} packaged direction${result.packagedDirections.length === 1 ? '' : 's'} -> ${result.outDir}`,
    `concepts: ${result.conceptsDir}`,
    `critique: ${result.critiqueDir}`,
    `qa: ${result.qaDir}`,
    `package: ${result.packageDir}`
  ];

  return `${lines.join('\n')}\n`;
}

export async function runCreativeEngine(options) {
  const {
    brief,
    outDir,
    cliOptions = {},
    providerContext,
    now = () => new Date().toISOString()
  } = options;

  if (!brief || typeof brief !== 'object') {
    throw new Error('brief is required');
  }
  if (typeof outDir !== 'string' || outDir.trim() === '') {
    throw new Error('outDir is required');
  }

  const resolvedOutDir = path.resolve(outDir);
  const conceptsDir = path.join(resolvedOutDir, 'concepts');
  const critiqueDir = path.join(resolvedOutDir, 'critique');
  const qaDir = path.join(resolvedOutDir, 'qa');
  const packageDir = path.join(resolvedOutDir, 'package');

  await mkdir(resolvedOutDir, { recursive: true });

  const concepts = await generateConcepts({
    brief,
    outDir: conceptsDir,
    providerContext,
    now
  });
  const critique = await critiqueConcepts({
    conceptsDir,
    outDir: critiqueDir,
    cliOptions,
    providerContext,
    now
  });
  const qa = await qaDirections({
    conceptsDir,
    critiqueDir,
    outDir: qaDir,
    cliOptions,
    providerContext,
    now
  });

  await mkdir(packageDir, { recursive: true });
  const packagedDirections = [];
  for (const direction of qa.directions) {
    packagedDirections.push(
      await packageDirection({
        directionPath: path.join(qaDir, direction.expandedDirectionFile),
        outDir: packageDir,
        now
      })
    );
  }

  return {
    outDir: resolvedOutDir,
    conceptsDir,
    critiqueDir,
    qaDir,
    packageDir,
    concepts,
    critique,
    qa,
    packagedDirections,
    keepCount: countKeepVerdicts(critique)
  };
}
