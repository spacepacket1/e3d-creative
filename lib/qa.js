import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createProviderContext, selectQaProvider } from './providers/selection.js';
import { normalizeDirection, readJsonFile, validateBriefInput } from './schema.js';

export const QA_HEURISTIC_DISCLAIMER =
  'QA rubric scores are heuristic assessments only, not evidence that an ad will convert.';

export const QA_RUBRIC_DIMENSIONS = Object.freeze([
  { id: 'stopScrollHook', label: 'stop-scroll hook' },
  { id: 'narrativeArc', label: 'narrative arc' },
  { id: 'clarityOfValueProp', label: 'clarity of value prop' },
  { id: 'authenticity', label: 'authenticity' },
  { id: 'productionQualityExpectation', label: 'production-quality expectation' },
  { id: 'factualDefensibility', label: 'factual defensibility' },
  { id: 'brandFit', label: 'brand fit' },
  { id: 'ctaStrength', label: 'CTA strength' },
  { id: 'audienceFit', label: 'audience fit' }
]);

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

function extractJsonText(rawText) {
  const trimmed = rawText.trim();
  if (trimmed.startsWith('```')) {
    const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (match) {
      return match[1];
    }
  }
  return trimmed;
}

function validateManifestBrief(brief) {
  const { valid, errors } = validateBriefInput(brief);
  if (!valid) {
    throw new Error(`manifest brief is invalid:\n- ${errors.join('\n- ')}`);
  }
  return brief;
}

function summarizeBrief(brief) {
  return [
    `product: ${brief.product}`,
    `audience: ${brief.audience}`,
    `objective: ${brief.objective}`,
    `baselineRef: ${brief.baselineRef === null ? 'null' : brief.baselineRef}`,
    `constraints: ${brief.constraints.length === 0 ? '(none)' : brief.constraints.join(' | ')}`,
    `spendCeiling: ${brief.spendCeiling === null ? 'null' : brief.spendCeiling}`,
    `metric: ${brief.metric}`,
    `threshold: ${brief.threshold}`
  ].join('\n');
}

function summarizeDirection(direction) {
  return stableJson(direction).trimEnd();
}

function summarizeCritique(critiqueSummary) {
  return stableJson({
    debateStatus: critiqueSummary.debateStatus,
    finalVerdict: critiqueSummary.finalVerdict,
    surfacedVerdicts: critiqueSummary.surfacedVerdicts
  }).trimEnd();
}

async function loadConceptsBundle(conceptsDir) {
  const manifestPath = path.join(conceptsDir, 'concepts-manifest.json');
  const manifest = await readJsonFile(manifestPath);
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('concepts manifest must be a JSON object');
  }
  if (!Array.isArray(manifest.directions) || manifest.directions.length === 0) {
    throw new Error('concepts manifest missing directions');
  }
  if (typeof manifest.provider !== 'string' || manifest.provider.trim() === '') {
    throw new Error('concepts manifest missing provider');
  }
  if (!('brief' in manifest)) {
    throw new Error('concepts manifest missing brief snapshot; regenerate concepts with the current version');
  }

  const brief = validateManifestBrief(manifest.brief);
  const directions = [];

  for (const entry of manifest.directions) {
    const filePath = path.join(conceptsDir, entry.file);
    directions.push({
      direction: normalizeDirection(await readJsonFile(filePath)),
      sourceFile: entry.file,
      sourceDigest: entry.digest
    });
  }

  return {
    brief,
    manifest,
    manifestPath,
    manifestDigest: sha256Hex(stableJson(manifest)),
    directions
  };
}

async function loadCritiqueBundle(critiqueDir) {
  const manifestPath = path.join(critiqueDir, 'critique-manifest.json');
  const manifest = await readJsonFile(manifestPath);
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('critique manifest must be a JSON object');
  }
  if (!Array.isArray(manifest.directions)) {
    throw new Error('critique manifest missing directions');
  }

  const summaries = new Map();
  for (const entry of manifest.directions) {
    const summaryFile = path.join(critiqueDir, entry.critiqueFile);
    const summary = await readJsonFile(summaryFile);
    summaries.set(entry.directionId, {
      ...summary,
      critiqueFile: entry.critiqueFile,
      critiqueDigest: entry.critiqueDigest
    });
  }

  return {
    manifest,
    manifestPath,
    manifestDigest: sha256Hex(stableJson(manifest)),
    summaries
  };
}

export function buildQaPrompts({ brief, direction, critiqueSummary }) {
  const rubricList = QA_RUBRIC_DIMENSIONS.map(
    ({ id, label }) => `- ${id}: ${label}`
  ).join('\n');

  const systemPrompt = [
    'You are performing an independent creative QA pass as strict JSON.',
    'Return only valid JSON with the shape {"storyboard":[...],"rubric":{...},"summary":"...","overallScore":number} and no markdown fences.',
    'This must be a fresh evaluation pass, not a restatement of the generation or critique prompts.',
    'Preserve the existing storyboard shot count and timecodes exactly.',
    'For each shot, make visualDirection concrete with style references, framing, motion, lighting, and production cues.',
    'For each shot, make audioNotes concrete with pacing notes and sound-design cues.',
    'Keep onScreenText explicit and concise for the exact shot.',
    'Score each rubric dimension from 1 to 5 and include a short reasoning string.',
    'Do not invent factual claims that the brief does not support.'
  ].join('\n');

  const userPrompt = [
    'Expand the storyboard for a keep-verdict direction, then score it against the QA rubric.',
    '',
    'Brief:',
    summarizeBrief(brief),
    '',
    'Direction:',
    summarizeDirection(direction),
    '',
    'Critique summary:',
    summarizeCritique(critiqueSummary),
    '',
    'Rubric dimensions:',
    rubricList,
    '',
    'Output rules:',
    '- Return JSON only.',
    '- Preserve shot count and each shot timecodeStart/timecodeEnd exactly.',
    '- Each storyboard shot must contain timecodeStart, timecodeEnd, visualDirection, audioNotes, onScreenText.',
    '- visualDirection must include concrete style references and production cues.',
    '- audioNotes must include pacing notes and sound-design cues.',
    '- onScreenText must state the explicit text to display for that shot.',
    '- The summary should explain the strongest risk or gap, not generic praise.'
  ].join('\n');

  return { systemPrompt, userPrompt };
}

function parseQaPayload(text, originalStoryboard) {
  let parsed;
  try {
    parsed = JSON.parse(extractJsonText(text));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`qa returned invalid JSON (${reason})`);
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('qa must return a JSON object');
  }

  if (!Array.isArray(parsed.storyboard) || parsed.storyboard.length !== originalStoryboard.length) {
    throw new Error('qa storyboard must preserve shot count exactly');
  }

  const storyboard = parsed.storyboard.map((shot, index) => {
    const originalShot = originalStoryboard[index];
    if (shot === null || typeof shot !== 'object' || Array.isArray(shot)) {
      throw new Error(`qa storyboard[${index}] must be an object`);
    }

    const timecodeStart = `${shot.timecodeStart ?? ''}`.trim();
    const timecodeEnd = `${shot.timecodeEnd ?? ''}`.trim();
    const visualDirection = `${shot.visualDirection ?? ''}`.trim();
    const audioNotes = `${shot.audioNotes ?? ''}`.trim();
    const onScreenText = `${shot.onScreenText ?? ''}`.trim();

    if (timecodeStart !== originalShot.timecodeStart || timecodeEnd !== originalShot.timecodeEnd) {
      throw new Error(`qa storyboard[${index}] must preserve original timecodes`);
    }
    if (!visualDirection || !audioNotes || !onScreenText) {
      throw new Error(`qa storyboard[${index}] must include non-empty visualDirection, audioNotes, and onScreenText`);
    }

    return {
      timecodeStart,
      timecodeEnd,
      visualDirection,
      audioNotes,
      onScreenText
    };
  });

  const rubric = {};
  for (const { id, label } of QA_RUBRIC_DIMENSIONS) {
    const entry = parsed.rubric?.[id];
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`qa rubric.${id} (${label}) must be an object`);
    }
    if (!Number.isInteger(entry.score) || entry.score < 1 || entry.score > 5) {
      throw new Error(`qa rubric.${id}.score must be an integer between 1 and 5`);
    }
    if (typeof entry.reasoning !== 'string' || entry.reasoning.trim() === '') {
      throw new Error(`qa rubric.${id}.reasoning must be a non-empty string`);
    }
    rubric[id] = {
      label,
      score: entry.score,
      reasoning: entry.reasoning.trim()
    };
  }

  if (typeof parsed.summary !== 'string' || parsed.summary.trim() === '') {
    throw new Error('qa summary must be a non-empty string');
  }

  const overallScore = typeof parsed.overallScore === 'number' && Number.isFinite(parsed.overallScore)
    ? Number(parsed.overallScore.toFixed(2))
    : Number(
        (
          QA_RUBRIC_DIMENSIONS.reduce((total, { id }) => total + rubric[id].score, 0) /
          QA_RUBRIC_DIMENSIONS.length
        ).toFixed(2)
      );

  return {
    storyboard,
    rubric,
    overallScore,
    summary: parsed.summary.trim()
  };
}

function createQaArtifact({
  direction,
  critiqueSummary,
  qaProvider,
  responseModel,
  sourceDirection,
  expandedDirectionFile,
  expandedDirectionDigest,
  qa,
  qaScoredAt
}) {
  return {
    directionId: direction.directionId,
    sourceDirection,
    sourceCritique: {
      file: critiqueSummary.critiqueFile,
      digest: critiqueSummary.critiqueDigest,
      critiqueProvider: critiqueSummary.critiqueProvider,
      finalVerdict: critiqueSummary.finalVerdict,
      debateStatus: critiqueSummary.debateStatus
    },
    expandedDirectionFile,
    expandedDirectionDigest,
    rubric: qa.rubric,
    overallScore: qa.overallScore,
    summary: qa.summary,
    disclaimer: QA_HEURISTIC_DISCLAIMER,
    qaProvider,
    model: responseModel,
    qaScoredAt
  };
}

export function formatQaCliSummary(result) {
  const lines = [
    `qa generated: ${result.directions.length} keep-verdict direction${result.directions.length === 1 ? '' : 's'} -> ${result.outDir} (${result.qaProvider})`
  ];

  for (const direction of result.directions) {
    lines.push(`${direction.directionId}: overall ${direction.overallScore}/5`);
  }

  if (result.skipped.length > 0) {
    lines.push(`skipped: ${result.skipped.length} non-keep direction${result.skipped.length === 1 ? '' : 's'}`);
  }

  lines.push(QA_HEURISTIC_DISCLAIMER);
  return `${lines.join('\n')}\n`;
}

export async function qaDirections(options) {
  const {
    conceptsDir,
    critiqueDir,
    outDir,
    cliOptions = {},
    providerContext = null,
    model,
    now = () => new Date().toISOString()
  } = options;

  if (typeof conceptsDir !== 'string' || conceptsDir.trim() === '') {
    throw new Error('conceptsDir is required');
  }
  if (typeof critiqueDir !== 'string' || critiqueDir.trim() === '') {
    throw new Error('critiqueDir is required');
  }
  if (typeof outDir !== 'string' || outDir.trim() === '') {
    throw new Error('outDir is required');
  }

  const conceptsBundle = await loadConceptsBundle(path.resolve(conceptsDir));
  const critiqueBundle = await loadCritiqueBundle(path.resolve(critiqueDir));
  const qaProvider = selectQaProvider({
    generatedProvider: conceptsBundle.manifest.provider,
    critiqueProvider: critiqueBundle.manifest.critiqueProvider,
    brief: conceptsBundle.brief,
    cliOptions
  });
  const resolvedProviderContext = providerContext ?? createProviderContext({
    brief: conceptsBundle.brief,
    cliOptions
  });
  const provider = resolvedProviderContext.registry[qaProvider];
  if (!provider || typeof provider.generate !== 'function') {
    throw new Error('provider for qa does not implement generate');
  }

  await mkdir(outDir, { recursive: true });

  const processedDirections = [];
  const skippedDirections = [];

  for (const item of conceptsBundle.directions) {
    const critiqueSummary = critiqueBundle.summaries.get(item.direction.directionId);
    if (!critiqueSummary) {
      throw new Error(`critique summary missing for direction ${item.direction.directionId}`);
    }

    if (critiqueSummary.finalVerdict !== 'keep') {
      skippedDirections.push({
        directionId: item.direction.directionId,
        finalVerdict: critiqueSummary.finalVerdict,
        debateStatus: critiqueSummary.debateStatus
      });
      continue;
    }

    const prompts = buildQaPrompts({
      brief: conceptsBundle.brief,
      direction: item.direction,
      critiqueSummary
    });
    const response = await provider.generate({
      systemPrompt: prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
      model
    });
    const qa = parseQaPayload(response.text, item.direction.storyboard);
    const expandedDirection = normalizeDirection({
      ...item.direction,
      storyboard: qa.storyboard
    });
    const expandedDirectionFile = `${item.direction.directionId}.visual-direction.json`;
    const expandedDirectionPath = path.join(outDir, expandedDirectionFile);
    await writeJsonAtomic(expandedDirectionPath, expandedDirection);
    const expandedDirectionDigest = sha256Hex(stableJson(expandedDirection));

    const qaArtifact = createQaArtifact({
      direction: item.direction,
      critiqueSummary,
      qaProvider,
      responseModel: response.model ?? model ?? 'unknown',
      sourceDirection: {
        file: item.sourceFile,
        digest: item.sourceDigest,
        provider: conceptsBundle.manifest.provider,
        model: conceptsBundle.manifest.model ?? 'unknown'
      },
      expandedDirectionFile,
      expandedDirectionDigest,
      qa,
      qaScoredAt: now()
    });
    const qaFile = `${item.direction.directionId}.qa.json`;
    const qaPath = path.join(outDir, qaFile);
    await writeJsonAtomic(qaPath, qaArtifact);
    const qaDigest = sha256Hex(stableJson(qaArtifact));

    processedDirections.push({
      directionId: item.direction.directionId,
      expandedDirectionFile,
      expandedDirectionDigest,
      qaFile,
      qaDigest,
      overallScore: qaArtifact.overallScore,
      summary: qaArtifact.summary,
      disclaimer: qaArtifact.disclaimer
    });
  }

  const manifest = {
    brief: conceptsBundle.brief,
    briefDigest: conceptsBundle.manifest.briefDigest,
    sourceConceptsManifest: path.basename(conceptsBundle.manifestPath),
    sourceConceptsManifestDigest: conceptsBundle.manifestDigest,
    sourceCritiqueManifest: path.basename(critiqueBundle.manifestPath),
    sourceCritiqueManifestDigest: critiqueBundle.manifestDigest,
    generatedProvider: conceptsBundle.manifest.provider,
    critiqueProvider: critiqueBundle.manifest.critiqueProvider,
    qaProvider,
    disclaimer: QA_HEURISTIC_DISCLAIMER,
    directions: processedDirections,
    skippedDirections
  };
  const manifestPath = path.join(outDir, 'qa-manifest.json');
  await writeJsonAtomic(manifestPath, manifest);

  return {
    outDir: path.resolve(outDir),
    qaProvider,
    manifest,
    manifestPath,
    directions: processedDirections,
    skipped: skippedDirections
  };
}
