import { createProviderContext, generateForCallSite } from './providers/selection.js';

const DEFAULT_MAX_ROUNDS = 2;
const MAX_ROUNDS_CAP = 3;
const SPEAKER_LINE = /^([^:]+):\s*(.*)$/;
const SCRIPT_VERDICTS = new Set(['keep', 'revise', 'reject']);

export const SCRIPT_RUBRIC = Object.freeze({
  hook: Object.freeze({
    weight: 'primary',
    description: 'Opening grabs attention within the first lines and earns the next line.'
  }),
  psychology: Object.freeze({
    weight: 'primary',
    description: 'Uses motivation, tension, and emotional beats that move the listener credibly.'
  }),
  wording: Object.freeze({
    weight: 'primary',
    description: 'Spoken lines are natural, specific, and concise, with distinct speaker voices.'
  }),
  audienceFit: Object.freeze({
    weight: 'primary',
    description: 'Tone, references, and claims fit the stated audience and objective.'
  }),
  production: Object.freeze({
    weight: 'secondary',
    description: 'Practical to record or shoot (length, pacing, cast size); lower weight than the primary criteria.'
  })
});

export function validateSpeakerLines(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, errors: ['script: must contain at least one speaker line'], lines: [] };
  }

  const errors = [];
  const lines = [];

  text.split(/\r?\n/).forEach((raw, index) => {
    if (raw.trim() === '') {
      return;
    }
    const lineNumber = index + 1;
    const match = SPEAKER_LINE.exec(raw);
    if (!match) {
      errors.push(`line ${lineNumber}: expected "Label: text" but found no speaker label before a colon`);
      return;
    }
    const speaker = match[1].trim();
    const lineText = match[2].trim();
    if (speaker === '') {
      errors.push(`line ${lineNumber}: speaker label must be non-empty`);
    } else if (lineText === '') {
      errors.push(`line ${lineNumber}: text after "${speaker}:" must be non-empty`);
    } else {
      lines.push({ line: lineNumber, speaker, text: lineText });
    }
  });

  return { ok: errors.length === 0, errors, lines };
}

export function normalizeScriptVerdict(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('script critique must be an object');
  }
  if (!SCRIPT_VERDICTS.has(raw.verdict)) {
    throw new Error('script critique verdict must be one of keep, revise, reject');
  }
  if (raw.scores === null || typeof raw.scores !== 'object' || Array.isArray(raw.scores)) {
    throw new Error('script critique scores must be an object');
  }

  const scores = {};
  for (const key of Object.keys(raw.scores)) {
    if (!Object.hasOwn(SCRIPT_RUBRIC, key)) {
      throw new Error(`script critique scores has unknown criterion ${key}`);
    }
  }
  for (const key of Object.keys(SCRIPT_RUBRIC)) {
    const score = raw.scores[key];
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      throw new Error(`script critique score ${key} must be an integer from 1 to 5`);
    }
    scores[key] = score;
  }

  if (typeof raw.reasoning !== 'string' || raw.reasoning.trim() === '') {
    throw new Error('script critique reasoning must be a non-empty string');
  }
  if (typeof raw.revisionNotes !== 'string') {
    throw new Error('script critique revisionNotes must be a string');
  }

  return {
    verdict: raw.verdict,
    scores,
    reasoning: raw.reasoning.trim(),
    revisionNotes: raw.revisionNotes.trim()
  };
}

const FORMAT_REQUIREMENT = [
  'Format requirement: every non-blank line must be a spoken line in the form "Label: text",',
  'with a non-empty speaker label before the first colon and non-empty text after it.',
  'No stage directions, headings, markdown, or unlabeled lines.'
].join(' ');

function stripFences(text) {
  const trimmed = String(text ?? '').trim();
  const match = trimmed.match(/^```[a-z]*\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function describeRubric() {
  return Object.entries(SCRIPT_RUBRIC)
    .map(([key, { weight, description }]) => `- ${key} (${weight}): ${description}`)
    .join('\n');
}

export function buildScriptGenerationPrompts({ topic, audience }) {
  return {
    systemPrompt: [
      'You write short spoken scripts for video or audio.',
      FORMAT_REQUIREMENT,
      'Return only the script text.'
    ].join('\n'),
    userPrompt: [
      `Topic: ${topic}`,
      `Audience: ${audience ?? '(unspecified)'}`,
      '',
      'Write the script now, in "Label: text" format only.'
    ].join('\n')
  };
}

export function buildScriptCritiquePrompts({ script, audience, round }) {
  return {
    systemPrompt: [
      'You critique a spoken script against a rubric and return strict JSON.',
      'Return only JSON shaped {"verdict":"keep|revise|reject","scores":{"hook":1-5,"psychology":1-5,"wording":1-5,"audienceFit":1-5,"production":1-5},"reasoning":"...","revisionNotes":"..."} with no markdown fences.',
      'Scores are integers from 1 to 5. Verdict must be exactly keep, revise, or reject.',
      'When verdict is revise, revisionNotes must give concrete changes. Revised scripts must keep the "Label: text" line format.',
      'Rubric:',
      describeRubric()
    ].join('\n'),
    userPrompt: [
      `Round: ${round}`,
      `Audience: ${audience ?? '(unspecified)'}`,
      FORMAT_REQUIREMENT,
      '',
      'Script:',
      script
    ].join('\n')
  };
}

export function buildScriptRevisionPrompts({ script, audience, revisionNotes }) {
  return {
    systemPrompt: [
      'You revise spoken scripts according to critique notes.',
      FORMAT_REQUIREMENT,
      'Return only the full revised script text.'
    ].join('\n'),
    userPrompt: [
      `Audience: ${audience ?? '(unspecified)'}`,
      '',
      'Current script:',
      script,
      '',
      'Revision notes:',
      revisionNotes || '(none given; improve against the rubric)',
      '',
      'Return the complete revised script, in "Label: text" format only.'
    ].join('\n')
  };
}

function parseScriptCritique(text) {
  let parsed;
  try {
    parsed = JSON.parse(stripFences(text));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`script critique returned invalid JSON (${reason})`);
  }
  return normalizeScriptVerdict(parsed);
}

export async function runScriptLoop({ mode, input, audience, maxRounds, providers } = {}) {
  if (mode !== 'improve' && mode !== 'write') {
    throw new Error('mode must be "improve" or "write"');
  }
  if (typeof input !== 'string' || input.trim() === '') {
    throw new Error('input is required');
  }
  const limit = maxRounds === undefined
    ? DEFAULT_MAX_ROUNDS
    : Math.min(MAX_ROUNDS_CAP, Math.max(0, Math.floor(Number(maxRounds)) || 0));
  const context = providers ?? createProviderContext({});

  let script;
  if (mode === 'improve') {
    const check = validateSpeakerLines(input);
    if (!check.ok) {
      throw new Error(`input script is not valid "Label: text" format:\n- ${check.errors.join('\n- ')}`);
    }
    script = input.trim();
  } else {
    const prompts = buildScriptGenerationPrompts({ topic: input.trim(), audience });
    const response = await generateForCallSite(context, 'conceptGeneration', prompts);
    script = stripFences(response.text);
    const check = validateSpeakerLines(script);
    if (!check.ok) {
      throw new Error(`generated draft is not valid "Label: text" format:\n- ${check.errors.join('\n- ')}`);
    }
  }

  const rounds = [];
  let finalScores = null;
  let verdict = 'revise';
  let revisions = 0;

  for (let round = 1; ; round += 1) {
    const prompts = buildScriptCritiquePrompts({ script, audience, round });
    const response = await generateForCallSite(context, 'critique', prompts);
    const critique = parseScriptCritique(response.text);
    finalScores = critique.scores;
    verdict = critique.verdict;
    const record = {
      round,
      verdict: critique.verdict,
      scores: critique.scores,
      reasoning: critique.reasoning,
      revisionNotes: critique.revisionNotes,
      formatOk: true
    };
    rounds.push(record);

    if (critique.verdict !== 'revise' || revisions >= limit) {
      break;
    }

    revisions += 1;
    const revPrompts = buildScriptRevisionPrompts({
      script,
      audience,
      revisionNotes: critique.revisionNotes
    });
    const revResponse = await generateForCallSite(context, 'conceptGeneration', revPrompts);
    const revised = stripFences(revResponse.text);
    const check = validateSpeakerLines(revised);
    if (check.ok) {
      script = revised;
    } else {
      record.formatOk = false;
      record.formatErrors = check.errors;
    }
  }

  return { script, verdict, rounds, finalScores };
}
