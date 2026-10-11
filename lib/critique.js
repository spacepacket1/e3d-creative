import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeDirection, readJsonFile, validateBriefInput } from './schema.js';
import { createProviderContext, selectCritiqueProvider } from './providers/selection.js';

const MAX_CRITIQUE_ROUNDS = 2;
const CRITIQUE_VERDICTS = new Set(['keep', 'revise', 'reject']);
const FOLLOW_UP_VERDICTS = new Set(['revise', 'reject']);
const RETAIN_EXISTING_VERDICT = 'retain-existing-creative';

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

function parseCritiquePayload(text) {
  let parsed;
  try {
    parsed = JSON.parse(extractJsonText(text));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`critique returned invalid JSON (${reason})`);
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('critique must return a JSON object');
  }

  const verdict = parsed.verdict;
  if (!CRITIQUE_VERDICTS.has(verdict)) {
    throw new Error('critique verdict must be one of keep, revise, reject');
  }
  if (typeof parsed.reasoning !== 'string' || parsed.reasoning.trim() === '') {
    throw new Error('critique reasoning must be a non-empty string');
  }
  if (parsed.dissent !== undefined && typeof parsed.dissent !== 'string') {
    throw new Error('critique dissent must be omitted or a string');
  }

  return {
    verdict,
    reasoning: parsed.reasoning.trim(),
    dissent: typeof parsed.dissent === 'string' ? parsed.dissent.trim() : ''
  };
}

function validateManifestBrief(brief) {
  const { valid, errors } = validateBriefInput(brief);
  if (!valid) {
    throw new Error(`concepts manifest brief is invalid:\n- ${errors.join('\n- ')}`);
  }
  return brief;
}

export function buildCritiqueVerdictOptions(brief) {
  const verdicts = ['keep', 'revise', 'reject'];
  if (brief?.baselineRef !== null) {
    verdicts.push(RETAIN_EXISTING_VERDICT);
  }
  return verdicts;
}

function buildBriefSummary(brief) {
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

function buildDirectionSummary(direction) {
  return stableJson(direction).trimEnd();
}

export function buildCritiquePrompts({ brief, direction, round, priorRound = null }) {
  const availableVerdicts = buildCritiqueVerdictOptions(brief);
  const baselineInstruction = brief.baselineRef === null
    ? 'No baseline creative exists, so only evaluate the new direction on its own merits.'
    : 'A baseline creative exists. "retain existing creative / do nothing" is a legitimate option if the new direction is weaker than the baseline.';
  const followUpInstruction = priorRound === null
    ? 'This is round 1. Critique the direction independently.'
    : [
        'This is round 2, the final bounded debate round.',
        `Round 1 verdict: ${priorRound.verdict}`,
        `Round 1 reasoning: ${priorRound.reasoning}`,
        `Round 1 dissent: ${priorRound.dissent || '(none)'}`,
        'Reconsider once. If you still disagree, state the new verdict plainly rather than averaging toward the middle.'
      ].join('\n');

  const systemPrompt = [
    'You critique a generated creative direction as strict JSON.',
    'Return only valid JSON with the shape {"verdict":"keep|revise|reject","reasoning":"...","dissent":"..."} and no markdown fences.',
    'Verdict must be exactly one of keep, revise, reject.',
    'Do not sand off bold ideas into bland compromises. If the direction is polarizing but promising, say keep or revise plainly.',
    'When the generator confidence seems unjustified, include explicit disagreement text in dissent.',
    'If the baseline is stronger and should simply be retained, use verdict "reject" and explain that retaining the existing creative is the better move.'
  ].join('\n');

  const userPrompt = [
    `Round: ${round}`,
    'Available verdict options:',
    ...availableVerdicts.map((verdict) => `- ${verdict}`),
    '',
    baselineInstruction,
    followUpInstruction,
    '',
    `Generator confidence: ${direction.confidence}`,
    '',
    'Brief:',
    buildBriefSummary(brief),
    '',
    'Direction:',
    buildDirectionSummary(direction)
  ].join('\n');

  return { systemPrompt, userPrompt, availableVerdicts };
}

function critiqueDisagreesWithGenerationConfidence(direction, verdict) {
  if (direction.confidence >= 0.67) {
    return verdict !== 'keep';
  }
  if (direction.confidence <= 0.33) {
    return verdict === 'keep';
  }
  return false;
}

function createFallbackDissent(direction, verdict) {
  return `Generator confidence was ${direction.confidence}, but the critique verdict is ${verdict}.`;
}

function shouldRunSecondRound(roundRecord) {
  return FOLLOW_UP_VERDICTS.has(roundRecord.verdict) || roundRecord.disagreesWithGenerationConfidence;
}

async function loadConceptsBundle(conceptsDir) {
  const manifestPath = path.join(conceptsDir, 'concepts-manifest.json');
  const manifest = await readJsonFile(manifestPath);
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('concepts manifest must be a JSON object');
  }
  if (typeof manifest.provider !== 'string' || manifest.provider.trim() === '') {
    throw new Error('concepts manifest missing provider');
  }
  if (!Array.isArray(manifest.directions) || manifest.directions.length === 0) {
    throw new Error('concepts manifest missing directions');
  }
  if (!('brief' in manifest)) {
    throw new Error('concepts manifest missing brief snapshot; regenerate concepts with the current version');
  }

  const brief = validateManifestBrief(manifest.brief);
  const directions = [];

  for (const entry of manifest.directions) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('concepts manifest direction entry must be an object');
    }
    if (typeof entry.directionId !== 'string' || entry.directionId.trim() === '') {
      throw new Error('concepts manifest direction entry missing directionId');
    }
    if (typeof entry.file !== 'string' || entry.file.trim() === '') {
      throw new Error(`concepts manifest entry ${entry.directionId} missing file`);
    }
    if (typeof entry.digest !== 'string' || entry.digest.length !== 64) {
      throw new Error(`concepts manifest entry ${entry.directionId} missing digest`);
    }

    const filePath = path.join(conceptsDir, entry.file);
    const direction = normalizeDirection(await readJsonFile(filePath));
    directions.push({
      direction,
      filePath,
      sourceFile: entry.file,
      sourceDigest: entry.digest
    });
  }

  return {
    manifest,
    manifestPath,
    manifestDigest: sha256Hex(stableJson(manifest)),
    brief,
    directions
  };
}

function createRoundArtifact({
  direction,
  source,
  provider,
  responseModel,
  round,
  critique,
  availableVerdicts,
  critiquedAt
}) {
  const disagreesWithGenerationConfidence = critiqueDisagreesWithGenerationConfidence(
    direction,
    critique.verdict
  );

  return {
    directionId: direction.directionId,
    round,
    verdict: critique.verdict,
    reasoning: critique.reasoning,
    dissent: disagreesWithGenerationConfidence
      ? critique.dissent || createFallbackDissent(direction, critique.verdict)
      : critique.dissent,
    availableVerdicts,
    sourceDirection: source,
    provider,
    model: responseModel,
    critiquedAt,
    disagreesWithGenerationConfidence
  };
}

function createCritiqueSummary({ direction, source, provider, availableVerdicts, rounds }) {
  const disputed = rounds.length === 2 && rounds[0].verdict !== rounds[1].verdict;
  const surfacedVerdicts = disputed
    ? rounds.map((round) => ({
        round: round.round,
        verdict: round.verdict,
        reasoning: round.reasoning,
        dissent: round.dissent
      }))
    : [{
        round: rounds[rounds.length - 1].round,
        verdict: rounds[rounds.length - 1].verdict,
        reasoning: rounds[rounds.length - 1].reasoning,
        dissent: rounds[rounds.length - 1].dissent
      }];

  return {
    directionId: direction.directionId,
    critiqueProvider: provider,
    availableVerdicts,
    sourceDirection: source,
    debateStatus: disputed ? 'disputed' : 'consensus',
    finalVerdict: disputed ? null : rounds[rounds.length - 1].verdict,
    surfacedVerdicts,
    rounds
  };
}

export async function critiqueConcepts(options) {
  const {
    conceptsDir,
    outDir,
    cliOptions = {},
    providerContext = null,
    model,
    now = () => new Date().toISOString()
  } = options;

  if (typeof conceptsDir !== 'string' || conceptsDir.trim() === '') {
    throw new Error('conceptsDir is required');
  }
  if (typeof outDir !== 'string' || outDir.trim() === '') {
    throw new Error('outDir is required');
  }

  const bundle = await loadConceptsBundle(path.resolve(conceptsDir));
  const critiqueProvider = selectCritiqueProvider({
    generatedProvider: bundle.manifest.provider,
    brief: bundle.brief,
    cliOptions
  });
  const resolvedProviderContext = providerContext ?? createProviderContext({
    brief: bundle.brief,
    cliOptions
  });
  const provider = resolvedProviderContext.registry[critiqueProvider];
  if (!provider || typeof provider.generate !== 'function') {
    throw new Error('provider for critique does not implement generate');
  }

  await mkdir(outDir, { recursive: true });
  const critiquedDirections = [];

  for (const item of bundle.directions) {
    const availableVerdicts = buildCritiqueVerdictOptions(bundle.brief);
    const source = {
      file: item.sourceFile,
      digest: item.sourceDigest,
      provider: bundle.manifest.provider,
      model: bundle.manifest.model ?? 'unknown'
    };
    const rounds = [];
    let priorRound = null;

    for (let round = 1; round <= MAX_CRITIQUE_ROUNDS; round += 1) {
      const prompts = buildCritiquePrompts({
        brief: bundle.brief,
        direction: item.direction,
        round,
        priorRound
      });
      const response = await provider.generate({
        systemPrompt: prompts.systemPrompt,
        userPrompt: prompts.userPrompt,
        model
      });
      const roundArtifact = createRoundArtifact({
        direction: item.direction,
        source,
        provider: critiqueProvider,
        responseModel: response.model ?? model ?? 'unknown',
        round,
        critique: parseCritiquePayload(response.text),
        availableVerdicts,
        critiquedAt: now()
      });
      const roundFile = `${item.direction.directionId}.critique.round-${round}.json`;
      const roundFilePath = path.join(outDir, roundFile);
      await writeJsonAtomic(roundFilePath, roundArtifact);
      const roundDigest = sha256Hex(stableJson(roundArtifact));

      rounds.push({
        ...roundArtifact,
        file: roundFile,
        digest: roundDigest
      });

      priorRound = roundArtifact;
      if (!shouldRunSecondRound(roundArtifact)) {
        break;
      }
    }

    const summary = createCritiqueSummary({
      direction: item.direction,
      source,
      provider: critiqueProvider,
      availableVerdicts,
      rounds
    });
    const summaryFile = `${item.direction.directionId}.critique.json`;
    const summaryFilePath = path.join(outDir, summaryFile);
    await writeJsonAtomic(summaryFilePath, summary);
    const summaryDigest = sha256Hex(stableJson(summary));

    critiquedDirections.push({
      directionId: item.direction.directionId,
      sourceDirection: source,
      critiqueFile: summaryFile,
      critiqueDigest: summaryDigest,
      debateStatus: summary.debateStatus,
      finalVerdict: summary.finalVerdict,
      surfacedVerdicts: summary.surfacedVerdicts,
      rounds: rounds.map((round) => ({
        round: round.round,
        file: round.file,
        digest: round.digest,
        provider: round.provider,
        model: round.model,
        critiquedAt: round.critiquedAt,
        verdict: round.verdict
      }))
    });
  }

  const manifest = {
    briefDigest: bundle.manifest.briefDigest,
    brief: bundle.brief,
    sourceConceptsManifest: path.basename(bundle.manifestPath),
    sourceConceptsManifestDigest: bundle.manifestDigest,
    generatedProvider: bundle.manifest.provider,
    critiqueProvider,
    directions: critiquedDirections
  };
  const manifestPath = path.join(outDir, 'critique-manifest.json');
  await writeJsonAtomic(manifestPath, manifest);

  return {
    critiqueProvider,
    manifest,
    manifestPath,
    directions: critiquedDirections
  };
}
