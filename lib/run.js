import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  assertUniqueReportId,
  checkClaims,
  computeClaimsCheckReportDigest,
  serializeClaimsCheckReport
} from './claims-check.js';
import { fetchApprovedClaims } from './claims.js';
import { generateConcepts } from './concepts.js';
import { critiqueConcepts } from './critique.js';
import { packageDirection } from './package.js';
import { selectCritiqueProvider } from './providers/selection.js';
import { qaDirections } from './qa.js';
import { normalizeDirection } from './schema.js';

function countKeepVerdicts(critiqueResult) {
  return critiqueResult.directions.filter((direction) => direction.finalVerdict === 'keep').length;
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

async function runClaimsCheckIntegration({
  brief,
  concepts,
  qa,
  qaDir,
  outDir,
  providerContext,
  cliOptions,
  claimsCheck,
  now,
  fetchApprovedClaimsImpl
}) {
  if (!claimsCheck?.enabled || qa.directions.length === 0) {
    return {
      claimsDir: null,
      reports: []
    };
  }

  const claimsResult = await fetchApprovedClaimsImpl({
    product: brief.product,
    brainOptions: {
      brainConfig: claimsCheck.brainConfig,
      brainMain: claimsCheck.brainMain
    }
  });

  const generatedProvider = concepts.provider ?? providerContext?.selection?.conceptGeneration;
  const checkProviderName = claimsCheck.checkProvider ?? selectCritiqueProvider({
    generatedProvider,
    brief
  });
  const provider = claimsResult.claimGrounding === 'ok'
    ? providerContext?.registry?.[checkProviderName]
    : null;

  const claimsDir = path.join(outDir, 'claims');
  const reports = [];
  const seenDirectionIds = new Set();

  for (const item of qa.directions) {
    const directionPath = path.join(qaDir, item.expandedDirectionFile);
    const directionBytes = await readFile(directionPath);
    const direction = normalizeDirection(JSON.parse(directionBytes.toString('utf8')));
    const report = await checkClaims({
      direction: {
        ...direction,
        generatedProvider
      },
      claimsResult,
      provider
    });

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
      checkedAt: now(),
      disclaimer: report.disclaimer
    };
    assertUniqueReportId(seenDirectionIds, direction.directionId);
    const reportText = serializeClaimsCheckReport(fullReport);
    const reportDigest = computeClaimsCheckReportDigest(reportText);
    const reportFile = `${direction.directionId}.claims-check.json`;
    const reportPath = path.join(claimsDir, reportFile);
    await writeFileAtomic(reportPath, reportText);
    await writeFileAtomic(`${reportPath}.sha256`, `${reportDigest}\n`);
    reports.push({
      directionId: direction.directionId,
      reportFile,
      reportDigest,
      checkStatus: fullReport.checkStatus,
      claimGrounding: fullReport.claimGrounding
    });
  }

  return {
    claimsDir,
    reports
  };
}

export function formatRunCliSummary(result) {
  const lines = [
    `run complete: ${result.concepts.directions.length} directions, ${result.keepCount} keep verdict${result.keepCount === 1 ? '' : 's'}, ${result.packagedDirections.length} packaged direction${result.packagedDirections.length === 1 ? '' : 's'} -> ${result.outDir}`,
    `concepts: ${result.conceptsDir}`,
    `critique: ${result.critiqueDir}`,
    `qa: ${result.qaDir}`,
    `package: ${result.packageDir}`
  ];

  if (result.claimsDir) {
    lines.push(`claims: ${result.claimsDir}`);
  }

  return `${lines.join('\n')}\n`;
}

export async function runCreativeEngine(options) {
  const {
    brief,
    outDir,
    cliOptions = {},
    claimsCheck = null,
    providerContext,
    now = () => new Date().toISOString(),
    fetchApprovedClaimsImpl = fetchApprovedClaims
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

  const claims = await runClaimsCheckIntegration({
    brief,
    concepts,
    qa,
    qaDir,
    outDir: resolvedOutDir,
    providerContext,
    cliOptions,
    claimsCheck,
    now,
    fetchApprovedClaimsImpl
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
    claimsDir: claims.claimsDir,
    claimsChecks: claims.reports,
    packagedDirections,
    keepCount: countKeepVerdicts(critique)
  };
}
