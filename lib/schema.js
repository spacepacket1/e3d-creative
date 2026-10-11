import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_TAGS = new Set(['fact', 'claim', 'hypothesis']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isNullableNonEmptyString(value) {
  return value === null || isNonEmptyString(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => isNonEmptyString(item));
}

function normalizeString(value) {
  return value.trim();
}

function normalizeStringArray(value) {
  return value.map((item) => item.trim());
}

async function assertReachableBaselineRef(baselineRef, baseDir) {
  if (baselineRef === null) {
    return;
  }

  let filePath = null;

  try {
    const url = new URL(baselineRef);
    if (url.protocol !== 'file:') {
      throw new Error(`baselineRef: blocked: baseline unreachable (${baselineRef})`);
    }
    filePath = fileURLToPath(url);
  } catch (error) {
    if (error instanceof TypeError) {
      filePath = path.resolve(baseDir, baselineRef);
    } else {
      throw error;
    }
  }

  try {
    await access(filePath);
  } catch {
    throw new Error(`baselineRef: blocked: baseline unreachable (${baselineRef})`);
  }
}

export function validateBriefInput(brief) {
  const errors = [];

  if (!isPlainObject(brief)) {
    return { valid: false, errors: ['brief: must be an object'] };
  }

  if (!isNonEmptyString(brief.product)) {
    errors.push('product: must be a non-empty string');
  }
  if (!isNonEmptyString(brief.audience)) {
    errors.push('audience: must be a non-empty string');
  }
  if (!isNonEmptyString(brief.objective)) {
    errors.push('objective: must be a non-empty string');
  }
  if (brief.baselineRef === undefined || !isNullableNonEmptyString(brief.baselineRef)) {
    errors.push('baselineRef: must be null or a non-empty string');
  }
  if (!isStringArray(brief.constraints)) {
    errors.push('constraints: must be an array of non-empty strings');
  }
  if (brief.spendCeiling === undefined || (brief.spendCeiling !== null && (typeof brief.spendCeiling !== 'number' || Number.isNaN(brief.spendCeiling)))) {
    errors.push('spendCeiling: must be null or a number');
  }
  if (!isNonEmptyString(brief.metric)) {
    errors.push('metric: must be a non-empty string');
  }
  if (!isNonEmptyString(brief.threshold)) {
    errors.push('threshold: must be a non-empty string');
  }

  return { valid: errors.length === 0, errors };
}

export async function normalizeBriefInput(brief, options = {}) {
  const { valid, errors } = validateBriefInput(brief);
  if (!valid) {
    throw new Error(`Invalid brief:\n- ${errors.join('\n- ')}`);
  }

  const baseDir = options.baseDir ?? process.cwd();
  await assertReachableBaselineRef(brief.baselineRef, baseDir);

  return {
    product: normalizeString(brief.product),
    audience: normalizeString(brief.audience),
    objective: normalizeString(brief.objective),
    baselineRef: brief.baselineRef === null ? null : normalizeString(brief.baselineRef),
    constraints: normalizeStringArray(brief.constraints),
    spendCeiling: brief.spendCeiling,
    metric: normalizeString(brief.metric),
    threshold: normalizeString(brief.threshold)
  };
}

function validateScriptLine(line, index, errors) {
  const prefix = `script[${index}]`;
  if (!isPlainObject(line)) {
    errors.push(`${prefix}: must be an object`);
    return;
  }
  if (!SCRIPT_TAGS.has(line.tag)) {
    errors.push(`${prefix}.tag: must be one of "fact", "claim", or "hypothesis"`);
  }
  if (!isNonEmptyString(line.text)) {
    errors.push(`${prefix}.text: must be a non-empty string`);
  }
}

function validateStoryboardShot(shot, index, errors) {
  const prefix = `storyboard[${index}]`;
  if (!isPlainObject(shot)) {
    errors.push(`${prefix}: must be an object`);
    return;
  }
  if (!isNonEmptyString(shot.timecodeStart)) {
    errors.push(`${prefix}.timecodeStart: must be a non-empty string`);
  }
  if (!isNonEmptyString(shot.timecodeEnd)) {
    errors.push(`${prefix}.timecodeEnd: must be a non-empty string`);
  }
  if (!isNonEmptyString(shot.visualDirection)) {
    errors.push(`${prefix}.visualDirection: must be a non-empty string`);
  }
  if (!isNonEmptyString(shot.audioNotes)) {
    errors.push(`${prefix}.audioNotes: must be a non-empty string`);
  }
  // Unlike every other shot field, an empty string is a valid value here -
  // plenty of real shots have no text overlay at all, and the concept
  // generation prompt (lib/concepts.js) explicitly tells the model "empty
  // string if none". Confirmed live against the real API: the model takes
  // that instruction literally and does return "" for text-free shots, which
  // this used to reject as invalid.
  if (typeof shot.onScreenText !== 'string') {
    errors.push(`${prefix}.onScreenText: must be a string (can be empty if the shot has no on-screen text)`);
  }
}

export function validateDirection(direction) {
  const errors = [];

  if (!isPlainObject(direction)) {
    return { valid: false, errors: ['direction: must be an object'] };
  }

  if (!isNonEmptyString(direction.directionId)) {
    errors.push('directionId: must be a non-empty string');
  }
  if (!isNonEmptyString(direction.hook)) {
    errors.push('hook: must be a non-empty string');
  }
  if (!isNonEmptyString(direction.premise)) {
    errors.push('premise: must be a non-empty string');
  }
  if (!isNonEmptyString(direction.audiencePsychology)) {
    errors.push('audiencePsychology: must be a non-empty string');
  }
  if (!Array.isArray(direction.script) || direction.script.length === 0) {
    errors.push('script: must be a non-empty array');
  } else {
    direction.script.forEach((line, index) => validateScriptLine(line, index, errors));
  }
  if (!Array.isArray(direction.storyboard) || direction.storyboard.length === 0) {
    errors.push('storyboard: must be a non-empty array');
  } else {
    direction.storyboard.forEach((shot, index) => validateStoryboardShot(shot, index, errors));
  }
  if (!isNonEmptyString(direction.ctaText)) {
    errors.push('ctaText: must be a non-empty string');
  }
  if (typeof direction.confidence !== 'number' || Number.isNaN(direction.confidence)) {
    errors.push('confidence: must be a number');
  } else if (direction.confidence < 0 || direction.confidence > 1) {
    errors.push('confidence: must be between 0 and 1');
  }
  if (!isNonEmptyString(direction.rationale)) {
    errors.push('rationale: must be a non-empty string');
  }

  return { valid: errors.length === 0, errors };
}

export function normalizeDirection(direction) {
  const { valid, errors } = validateDirection(direction);
  if (!valid) {
    throw new Error(`Invalid direction:\n- ${errors.join('\n- ')}`);
  }

  return {
    directionId: normalizeString(direction.directionId),
    hook: normalizeString(direction.hook),
    premise: normalizeString(direction.premise),
    audiencePsychology: normalizeString(direction.audiencePsychology),
    script: direction.script.map((line) => ({
      tag: line.tag,
      text: normalizeString(line.text)
    })),
    storyboard: direction.storyboard.map((shot) => ({
      timecodeStart: normalizeString(shot.timecodeStart),
      timecodeEnd: normalizeString(shot.timecodeEnd),
      visualDirection: normalizeString(shot.visualDirection),
      audioNotes: normalizeString(shot.audioNotes),
      onScreenText: normalizeString(shot.onScreenText)
    })),
    ctaText: normalizeString(direction.ctaText),
    confidence: direction.confidence,
    rationale: normalizeString(direction.rationale)
  };
}

export async function readJsonFile(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}
