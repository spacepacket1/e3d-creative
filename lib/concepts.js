import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeDirection } from './schema.js';
import { createProviderContext, generateForCallSite } from './providers/selection.js';

const MIN_DIRECTIONS = 3;
const MAX_ATTEMPTS = 2;
const PREMISE_SIMILARITY_THRESHOLD = 0.88;
const TOKEN_JACCARD_THRESHOLD = 0.75;

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

function escapeJsonString(value) {
  return JSON.stringify(value);
}

function buildBriefTraceabilitySummary(brief) {
  const lines = [
    `product: ${brief.product}`,
    `audience: ${brief.audience}`,
    `objective: ${brief.objective}`,
    `baselineRef: ${brief.baselineRef === null ? 'null' : brief.baselineRef}`,
    `constraints: ${brief.constraints.length === 0 ? '(none)' : brief.constraints.join(' | ')}`,
    `spendCeiling: ${brief.spendCeiling === null ? 'null' : brief.spendCeiling}`,
    `metric: ${brief.metric}`,
    `threshold: ${brief.threshold}`
  ];

  return lines.join('\n');
}

export function buildConceptGenerationPrompts(brief) {
  const systemPrompt = [
    'You generate creative directions as strict JSON.',
    'Return only valid JSON with the shape {"directions":[...]} and no markdown fences.',
    `Return at least ${MIN_DIRECTIONS} directions.`,
    'Each direction must include directionId, hook, premise, audiencePsychology, script, storyboard, ctaText, confidence, and rationale.',
    'The directions must be genuinely distinct in audience psychology, not just different wording of one idea.',
    'Push for different emotional levers, objections, and motivations across the returned directions.',
    'Script tagging must stay internally consistent: only tag a line as "fact" when it is directly traceable to the brief fields provided by the user.',
    'If a statement goes beyond the brief, tag it as "claim" or "hypothesis" instead of "fact".',
    'Do not invent testimonials, revenue outcomes, or unsupported performance claims.'
  ].join('\n');

  const userPrompt = [
    'Generate creative directions from this brief.',
    'Brief:',
    buildBriefTraceabilitySummary(brief),
    '',
    'Output rules:',
    `- Return JSON only: {"directions":[...]}.`,
    `- Include at least ${MIN_DIRECTIONS} directions.`,
    '- Make each premise materially different from the others.',
    '- Make each audiencePsychology section explicitly describe a different viewer mindset or buying resistance pattern.',
    '- Keep script lines concise and tag each line as fact, claim, or hypothesis.',
    '- No fact-tagged line may rely on information outside this brief.'
  ].join('\n');

  return { systemPrompt, userPrompt };
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

function parseDirectionsPayload(text) {
  let parsed;
  try {
    parsed = JSON.parse(extractJsonText(text));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`concept generation returned invalid JSON (${reason})`);
  }

  const directions = Array.isArray(parsed) ? parsed : parsed?.directions;
  if (!Array.isArray(directions)) {
    throw new Error('concept generation must return a JSON array of directions or {"directions":[...]}');
  }
  if (directions.length < MIN_DIRECTIONS) {
    throw new Error(`concept generation must return at least ${MIN_DIRECTIONS} directions`);
  }
  return directions;
}

function normalizeComparableText(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function textToTrigrams(value) {
  const comparable = normalizeComparableText(value).replace(/\s+/g, ' ');
  if (comparable.length < 3) {
    return new Set(comparable ? [comparable] : []);
  }

  const grams = new Set();
  for (let index = 0; index <= comparable.length - 3; index += 1) {
    grams.add(comparable.slice(index, index + 3));
  }
  return grams;
}

function tokenSet(value) {
  return new Set(
    normalizeComparableText(value)
      .split(' ')
      .filter(Boolean)
  );
}

function sorensenDiceSimilarity(left, right) {
  if (left.size === 0 && right.size === 0) {
    return 1;
  }

  let intersection = 0;
  for (const gram of left) {
    if (right.has(gram)) {
      intersection += 1;
    }
  }

  return (2 * intersection) / (left.size + right.size);
}

function jaccardSimilarity(left, right) {
  const union = new Set([...left, ...right]);
  if (union.size === 0) {
    return 1;
  }

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }

  return intersection / union.size;
}

export function findNearDuplicatePremises(directions) {
  for (let leftIndex = 0; leftIndex < directions.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < directions.length; rightIndex += 1) {
      const left = directions[leftIndex];
      const right = directions[rightIndex];
      const leftComparable = normalizeComparableText(left.premise);
      const rightComparable = normalizeComparableText(right.premise);

      if (leftComparable === rightComparable) {
        return {
          leftIndex,
          rightIndex,
          similarity: 1,
          reason: 'exact normalized match'
        };
      }

      const dice = sorensenDiceSimilarity(textToTrigrams(left.premise), textToTrigrams(right.premise));
      const jaccard = jaccardSimilarity(tokenSet(left.premise), tokenSet(right.premise));

      if (dice >= PREMISE_SIMILARITY_THRESHOLD || jaccard >= TOKEN_JACCARD_THRESHOLD) {
        return {
          leftIndex,
          rightIndex,
          similarity: Number(Math.max(dice, jaccard).toFixed(3)),
          reason: 'near-duplicate premise similarity'
        };
      }
    }
  }

  return null;
}

function collectBriefTokens(brief) {
  return tokenSet([
    brief.product,
    brief.audience,
    brief.objective,
    brief.baselineRef ?? '',
    brief.constraints.join(' '),
    brief.spendCeiling === null ? '' : String(brief.spendCeiling),
    brief.metric,
    brief.threshold
  ].join(' '));
}

export function assertFactTraceability(direction, brief) {
  const briefTokens = collectBriefTokens(brief);

  direction.script.forEach((line, index) => {
    if (line.tag !== 'fact') {
      return;
    }

    const lineTokens = [...tokenSet(line.text)].filter((token) => token.length >= 4 || /^\d+$/.test(token));
    const hasOverlap = lineTokens.some((token) => briefTokens.has(token));
    if (!hasOverlap) {
      throw new Error(
        `direction ${direction.directionId} script[${index}] is tagged fact but is not traceable to the brief`
      );
    }
  });
}

function assertUniqueDirectionIds(directions) {
  const seen = new Set();
  for (const direction of directions) {
    if (seen.has(direction.directionId)) {
      throw new Error(`duplicate directionId returned: ${direction.directionId}`);
    }
    seen.add(direction.directionId);
  }
}

export function normalizeGeneratedDirections(rawDirections, brief) {
  const directions = rawDirections.map((direction) => normalizeDirection(direction));
  assertUniqueDirectionIds(directions);
  directions.forEach((direction) => assertFactTraceability(direction, brief));
  return directions;
}

function createManifest({ brief, directions, provider, model, generatedAt }) {
  const briefJson = stableJson(brief);

  return {
    brief,
    briefDigest: sha256Hex(briefJson),
    provider,
    model,
    generatedAt,
    directions: directions.map(({ direction, fileName, digest }) => ({
      directionId: direction.directionId,
      file: fileName,
      digest
    }))
  };
}

export async function generateConcepts(options) {
  const {
    brief,
    outDir,
    providerContext = createProviderContext({ brief }),
    model,
    now = () => new Date().toISOString()
  } = options;

  if (!brief || typeof brief !== 'object') {
    throw new Error('brief is required');
  }
  if (typeof outDir !== 'string' || outDir.trim() === '') {
    throw new Error('outDir is required');
  }

  const { systemPrompt, userPrompt } = buildConceptGenerationPrompts(brief);
  const provider = providerContext.selection.conceptGeneration;

  let lastDuplicate = null;
  let lastDirections = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const response = await generateForCallSite(providerContext, 'conceptGeneration', {
      systemPrompt,
      userPrompt,
      model
    });

    const rawDirections = parseDirectionsPayload(response.text);
    const directions = normalizeGeneratedDirections(rawDirections, brief);
    lastDirections = directions;
    const duplicate = findNearDuplicatePremises(directions);

    if (!duplicate) {
      const generatedAt = now();
      const materializedDirections = directions.map((direction) => {
        const fileName = `${direction.directionId}.json`;
        const filePath = path.join(outDir, fileName);
        const json = stableJson(direction);
        const digest = sha256Hex(json);

        return {
          direction,
          fileName,
          filePath,
          digest
        };
      });

      await mkdir(outDir, { recursive: true });
      for (const item of materializedDirections) {
        await writeJsonAtomic(item.filePath, item.direction);
      }

      const manifest = createManifest({
        brief,
        directions: materializedDirections,
        provider,
        model: response.model ?? model ?? 'unknown',
        generatedAt
      });
      const manifestPath = path.join(outDir, 'concepts-manifest.json');
      await writeJsonAtomic(manifestPath, manifest);

      return {
        directions,
        manifest,
        manifestPath,
        provider,
        model: response.model ?? model ?? 'unknown',
        usage: response.usage ?? null
      };
    }

    lastDuplicate = duplicate;
  }

  const leftPremise = escapeJsonString(lastDirections ? lastDirections[lastDuplicate.leftIndex].premise : '');
  const rightPremise = escapeJsonString(lastDirections ? lastDirections[lastDuplicate.rightIndex].premise : '');
  throw new Error(
    `concept diversity check failed after ${MAX_ATTEMPTS} attempts: directions ${lastDuplicate.leftIndex + 1} and ${lastDuplicate.rightIndex + 1} have ${lastDuplicate.reason} (${lastDuplicate.similarity}). Premises: ${leftPremise} vs ${rightPremise}`
  );
}
