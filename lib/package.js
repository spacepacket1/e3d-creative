import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeDirection, readJsonFile } from './schema.js';

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );
  await writeFile(tempPath, stableJson(value), 'utf8');
  await rename(tempPath, filePath);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function transcriptTextFromDirection(direction) {
  return direction.script.map((line) => line.text).join('\n');
}

function normalizeQaArtifact(qaArtifact) {
  if (!isPlainObject(qaArtifact)) {
    throw new Error('qa artifact must be a JSON object');
  }
  if (typeof qaArtifact.directionId !== 'string' || qaArtifact.directionId.trim() === '') {
    throw new Error('qa artifact missing directionId');
  }
  if (!isPlainObject(qaArtifact.sourceCritique)) {
    throw new Error(`qa artifact ${qaArtifact.directionId} missing sourceCritique`);
  }
  if (!isPlainObject(qaArtifact.rubric)) {
    throw new Error(`qa artifact ${qaArtifact.directionId} missing rubric`);
  }
  if (typeof qaArtifact.summary !== 'string' || qaArtifact.summary.trim() === '') {
    throw new Error(`qa artifact ${qaArtifact.directionId} missing summary`);
  }
  if (typeof qaArtifact.disclaimer !== 'string' || qaArtifact.disclaimer.trim() === '') {
    throw new Error(`qa artifact ${qaArtifact.directionId} missing disclaimer`);
  }

  return {
    ...qaArtifact,
    directionId: qaArtifact.directionId.trim(),
    summary: qaArtifact.summary.trim(),
    disclaimer: qaArtifact.disclaimer.trim()
  };
}

function buildRichArtifact({
  direction,
  qaArtifact,
  qaArtifactFile,
  qaArtifactDigest,
  packagedAt
}) {
  return {
    directionId: direction.directionId,
    packagedAt,
    verdict: {
      finalVerdict: qaArtifact.sourceCritique.finalVerdict ?? null,
      debateStatus: qaArtifact.sourceCritique.debateStatus ?? 'unknown'
    },
    direction,
    qa: {
      rubric: qaArtifact.rubric,
      overallScore: qaArtifact.overallScore,
      summary: qaArtifact.summary,
      disclaimer: qaArtifact.disclaimer
    },
    provenance: {
      sourceDirection: qaArtifact.sourceDirection,
      sourceCritique: qaArtifact.sourceCritique,
      sourceQaArtifact: {
        file: qaArtifactFile,
        digest: qaArtifactDigest,
        qaProvider: qaArtifact.qaProvider ?? 'unknown',
        model: qaArtifact.model ?? 'unknown',
        qaScoredAt: qaArtifact.qaScoredAt ?? null
      }
    }
  };
}

function buildUnconsumedFieldList(richArtifact) {
  const fields = new Set([
    'hook',
    'premise',
    'audiencePsychology',
    'ctaText',
    'confidence',
    'rationale',
    'verdict.finalVerdict',
    'verdict.debateStatus',
    'qa.rubric',
    'qa.overallScore',
    'qa.summary',
    'qa.disclaimer'
  ]);

  if (Array.isArray(richArtifact.direction.script) && richArtifact.direction.script.length > 0) {
    fields.add('script.tag');
    fields.add('script.text');
  }

  if (Array.isArray(richArtifact.direction.storyboard) && richArtifact.direction.storyboard.length > 0) {
    fields.add('shot.timecodeStart');
    fields.add('shot.timecodeEnd');
    fields.add('shot.visualDirection');
    fields.add('shot.audioNotes');
    fields.add('shot.onScreenText');
  }

  fields.delete('script.text');
  return [...fields].sort();
}

function buildCastCompatibleReduction({ richArtifact, richArtifactDigest }) {
  return {
    kind: 'cast_job',
    version: 1,
    jobId: `e3d-creative-${richArtifact.directionId}-${richArtifactDigest.slice(0, 12)}`,
    input: {
      kind: 'transcript',
      text: transcriptTextFromDirection(richArtifact.direction)
    },
    sourceDirectionId: richArtifact.directionId,
    sourceRichArtifactDigest: richArtifactDigest,
    unconsumedByCurrentPipeline: buildUnconsumedFieldList(richArtifact)
  };
}

async function loadPackageManifest(manifestPath) {
  try {
    const manifest = await readJsonFile(manifestPath);
    if (!isPlainObject(manifest) || !Array.isArray(manifest.directions)) {
      throw new Error('package manifest must contain a directions array');
    }
    return manifest;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return {
        packagedWith: 'e3d-creative',
        directions: []
      };
    }
    throw error;
  }
}

function upsertManifestEntry(manifest, entry) {
  const directions = manifest.directions.filter(
    (current) => current.directionId !== entry.directionId
  );
  directions.push(entry);
  directions.sort((left, right) => left.directionId.localeCompare(right.directionId));
  return {
    ...manifest,
    directions
  };
}

export function formatPackageList(manifest, outDir) {
  const lines = [
    `packaged directions: ${manifest.directions.length} -> ${path.resolve(outDir)}`
  ];

  for (const entry of manifest.directions) {
    const verdict = entry.finalVerdict ?? entry.debateStatus;
    lines.push(
      `${entry.directionId}\t${verdict}\tqa ${entry.qaOverallScore}/5\t${entry.richArtifactDigest}`
    );
  }

  return `${lines.join('\n')}\n`;
}

export async function packageDirection(options) {
  const {
    directionPath,
    outDir,
    now = () => new Date().toISOString()
  } = options;

  if (typeof directionPath !== 'string' || directionPath.trim() === '') {
    throw new Error('directionPath is required');
  }
  if (typeof outDir !== 'string' || outDir.trim() === '') {
    throw new Error('outDir is required');
  }

  const resolvedDirectionPath = path.resolve(directionPath);
  const direction = normalizeDirection(await readJsonFile(resolvedDirectionPath));
  const directionDir = path.dirname(resolvedDirectionPath);
  const qaArtifactPath = path.join(directionDir, `${direction.directionId}.qa.json`);
  const qaArtifactRaw = await readJsonFile(qaArtifactPath).catch((error) => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new Error(
        `qa artifact missing for direction ${direction.directionId}; package requires Phase 5 visual-direction output`
      );
    }
    throw error;
  });
  const qaArtifact = normalizeQaArtifact(qaArtifactRaw);
  if (qaArtifact.directionId !== direction.directionId) {
    throw new Error(
      `qa artifact directionId mismatch: expected ${direction.directionId}, got ${qaArtifact.directionId}`
    );
  }

  const qaArtifactFile = path.basename(qaArtifactPath);
  const qaArtifactDigest = sha256Hex(await readFile(qaArtifactPath, 'utf8'));
  const packagedAt = now();
  const richArtifact = buildRichArtifact({
    direction,
    qaArtifact,
    qaArtifactFile,
    qaArtifactDigest,
    packagedAt
  });
  const richArtifactJson = stableJson(richArtifact);
  const richArtifactDigest = sha256Hex(richArtifactJson);
  const castCompatible = buildCastCompatibleReduction({
    richArtifact,
    richArtifactDigest
  });
  const castCompatibleDigest = sha256Hex(stableJson(castCompatible));

  const bundleDir = path.join(path.resolve(outDir), direction.directionId);
  const richArtifactPath = path.join(bundleDir, 'rich-artifact.json');
  const castCompatiblePath = path.join(bundleDir, 'cast-compatible.json');

  await writeJsonAtomic(richArtifactPath, richArtifact);
  await writeJsonAtomic(castCompatiblePath, castCompatible);

  const manifestPath = path.join(path.resolve(outDir), 'package-manifest.json');
  const manifestEntry = {
    directionId: direction.directionId,
    packagedAt,
    debateStatus: richArtifact.verdict.debateStatus,
    finalVerdict: richArtifact.verdict.finalVerdict,
    qaOverallScore: richArtifact.qa.overallScore,
    qaSummary: richArtifact.qa.summary,
    richArtifactFile: path.relative(path.resolve(outDir), richArtifactPath),
    richArtifactDigest,
    castCompatibleFile: path.relative(path.resolve(outDir), castCompatiblePath),
    castCompatibleDigest
  };
  const manifest = upsertManifestEntry(await loadPackageManifest(manifestPath), manifestEntry);
  await writeJsonAtomic(manifestPath, manifest);

  return {
    directionId: direction.directionId,
    outDir: path.resolve(outDir),
    bundleDir,
    richArtifactPath,
    richArtifactDigest,
    castCompatiblePath,
    castCompatibleDigest,
    manifestPath,
    manifest,
    castCompatible
  };
}
