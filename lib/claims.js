import { createHash } from 'node:crypto';
import {
  BRAIN_CALL_TIMEOUT_MS,
  BRAIN_KILL_GRACE_MS,
  MAX_JSONRPC_MESSAGE_BYTES,
  MAX_STDERR_BYTES,
  startBrainClient
} from './brain-client.js';

export const LIST_NOTES_LIMIT = 51;
export const MAX_CLAIMS_READ = 50;
export const READ_NOTE_MAX_CHARS = 4000;
export const WHOLE_FETCH_TIMEOUT_MS = 30_000;
export const DEFAULT_PROMPT_MAX_CHARS = 3000;

const COUNTER_KEYS = Object.freeze([
  'fetched',
  'kept',
  'out-of-folder',
  'no-stable-id',
  'malformed',
  'wrong-product',
  'unapproved',
  'expired'
]);

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const REV_PATTERN = /^[0-9a-f]{16}$/;
const CONTROL_PATTERN = /[\u0000-\u001F\u007F-\u009F]/u;
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function createCounts() {
  return Object.freeze({
    fetched: 0,
    kept: 0,
    'out-of-folder': 0,
    'no-stable-id': 0,
    malformed: 0,
    'wrong-product': 0,
    unapproved: 0,
    expired: 0
  });
}

function mutableCounts() {
  return {
    fetched: 0,
    kept: 0,
    'out-of-folder': 0,
    'no-stable-id': 0,
    malformed: 0,
    'wrong-product': 0,
    unapproved: 0,
    expired: 0
  };
}

function finalizeCounts(counts) {
  const finalized = {};
  for (const key of COUNTER_KEYS) {
    finalized[key] = counts[key];
  }
  return Object.freeze(finalized);
}

function emptyResult(claimGrounding, reason) {
  const result = {
    claimGrounding,
    claims: [],
    counts: createCounts(),
    notesTruncated: false
  };
  if (reason) {
    result.reason = reason;
  }
  return result;
}

function sha256HexUtf8(value) {
  return createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');
}

function codePointLength(value) {
  return Array.from(value).length;
}

function containsDisallowedText(value) {
  return CONTROL_PATTERN.test(value) || value.includes('```');
}

function assertSafeString(value, maxCodePoints) {
  if (typeof value !== 'string') {
    return false;
  }
  if (containsDisallowedText(value)) {
    return false;
  }
  return codePointLength(value) <= maxCodePoints;
}

function parseIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (
    Number.isNaN(timestamp) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return {
    year,
    month,
    day,
    value,
    timestamp
  };
}

function utcDateString(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) {
    throw new Error('now must be a valid Date or date-like value');
  }
  return date.toISOString().slice(0, 10);
}

function expiresAtEndOfUtcDay(expiresText) {
  const parsed = parseIsoDate(expiresText);
  if (!parsed) {
    return null;
  }
  return Date.UTC(parsed.year, parsed.month - 1, parsed.day + 1);
}

function trimAscii(value) {
  return value.replace(/^[\t ]+|[\t ]+$/g, '');
}

function unquoteScalar(value) {
  const trimmed = trimAscii(value);
  if (trimmed.startsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error('unsupported-yaml');
    }
  }
  if (trimmed.startsWith("'")) {
    if (!trimmed.endsWith("'") || trimmed.length < 2) {
      throw new Error('unsupported-yaml');
    }
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  if (/^[&*!|>{}]/.test(trimmed)) {
    throw new Error('unsupported-yaml');
  }
  return trimmed;
}

function parseFlowList(value) {
  const trimmed = trimAscii(value);
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    throw new Error('unsupported-yaml');
  }
  const inner = trimmed.slice(1, -1).trim();
  if (inner === '') {
    return [];
  }

  const items = [];
  let current = '';
  let quote = null;
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];
    if (quote) {
      current += char;
      if (quote === "'" && char === "'" && inner[index + 1] === "'") {
        current += inner[index + 1];
        index += 1;
      } else if (char === quote && inner[index - 1] !== '\\') {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === '[' || char === ']' || char === '{' || char === '}') {
      throw new Error('unsupported-yaml');
    }

    if (char === ',') {
      const piece = current.trim();
      if (piece === '') {
        throw new Error('unsupported-yaml');
      }
      items.push(unquoteScalar(piece));
      current = '';
      continue;
    }

    current += char;
  }

  if (quote) {
    throw new Error('unsupported-yaml');
  }

  if (current.trim() === '') {
    throw new Error('unsupported-yaml');
  }
  items.push(unquoteScalar(current.trim()));
  return items;
}

function parseFrontmatter(rawNoteText) {
  if (!rawNoteText.startsWith('---')) {
    throw new Error('unterminated-frontmatter');
  }

  const lines = rawNoteText.split('\n');
  if (lines[0].replace(/\r$/, '') !== '---') {
    throw new Error('unterminated-frontmatter');
  }

  let closingIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].replace(/\r$/, '') === '---') {
      closingIndex = index;
      break;
    }
  }

  if (closingIndex === -1) {
    throw new Error('unterminated-frontmatter');
  }

  const mapping = Object.create(null);
  let index = 1;
  while (index < closingIndex) {
    const line = lines[index].replace(/\r$/, '');
    if (trimAscii(line) === '') {
      index += 1;
      continue;
    }

    const match = /^([A-Za-z0-9_]+):(.*)$/.exec(line);
    if (!match) {
      throw new Error('unsupported-yaml');
    }

    const key = match[1];
    const rest = match[2];
    if (DANGEROUS_KEYS.has(key)) {
      throw new Error('dangerous-key');
    }
    if (Object.hasOwn(mapping, key)) {
      throw new Error('duplicate-key');
    }

    const trimmedRest = trimAscii(rest);
    if (trimmedRest === '') {
      const items = [];
      index += 1;
      while (index < closingIndex) {
        const itemLine = lines[index].replace(/\r$/, '');
        if (trimAscii(itemLine) === '') {
          index += 1;
          continue;
        }
        const itemMatch = /^\s*-\s+(.*)$/.exec(itemLine);
        if (!itemMatch) {
          break;
        }
        items.push(unquoteScalar(itemMatch[1]));
        index += 1;
      }
      if (items.length === 0) {
        throw new Error('unsupported-yaml');
      }
      mapping[key] = items;
      continue;
    }

    if (trimmedRest.startsWith('[')) {
      mapping[key] = parseFlowList(trimmedRest);
    } else {
      mapping[key] = unquoteScalar(trimmedRest);
    }
    index += 1;
  }

  const body = lines.slice(closingIndex + 1).join('\n');
  return {
    frontmatter: mapping,
    body
  };
}

function extractClaimSentence(body) {
  const lines = body.split('\n').map((line) => line.replace(/\r$/, ''));
  const claimMarkers = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] === 'Claim:') {
      claimMarkers.push(index);
    }
  }
  if (claimMarkers.length !== 1) {
    throw new Error('claim-shape');
  }

  const start = claimMarkers[0] + 1;
  let claim = null;
  for (let index = start; index < lines.length; index += 1) {
    const trimmed = trimAscii(lines[index]);
    if (trimmed === '') {
      continue;
    }
    if (claim === null) {
      claim = trimmed;
      continue;
    }
    throw new Error('claim-shape');
  }

  if (claim === null || claim === '') {
    throw new Error('claim-shape');
  }
  if (!assertSafeString(claim, 500)) {
    throw new Error('claim-shape');
  }
  return claim;
}

function validateRequiredFields(frontmatter, now, slug, metadata) {
  if (frontmatter.kind !== 'product-claim') {
    throw new Error('kind');
  }
  if (frontmatter.status !== 'approved' && frontmatter.status !== 'draft') {
    throw new Error('status');
  }
  if (typeof frontmatter.product !== 'string') {
    throw new Error('product');
  }
  if (typeof frontmatter.approved_by !== 'string' || frontmatter.approved_by.trim() === '') {
    throw new Error('approved_by');
  }
  if (!assertSafeString(frontmatter.approved_by, 200)) {
    throw new Error('approved_by');
  }
  if (!parseIsoDate(frontmatter.approved_on)) {
    throw new Error('approved_on');
  }
  if (!parseIsoDate(frontmatter.expires)) {
    throw new Error('expires');
  }

  const nowDay = utcDateString(now);
  if (frontmatter.approved_on > nowDay) {
    throw new Error('approved_on');
  }

  if (!Array.isArray(frontmatter.evidence) || frontmatter.evidence.length > 10) {
    throw new Error('evidence');
  }
  for (const item of frontmatter.evidence) {
    if (!assertSafeString(item, 200)) {
      throw new Error('evidence');
    }
  }

  if (!assertSafeString(frontmatter.allowed_wording, 500)) {
    throw new Error('allowed_wording');
  }

  if (!Array.isArray(frontmatter.forbidden_wording) || frontmatter.forbidden_wording.length > 10) {
    throw new Error('forbidden_wording');
  }
  for (const item of frontmatter.forbidden_wording) {
    if (!assertSafeString(item, 100) || trimAscii(item) === '') {
      throw new Error('forbidden_wording');
    }
  }

  if (metadata.kind !== frontmatter.kind || metadata.status !== frontmatter.status) {
    throw new Error('metadata-disagreement');
  }

  const productSlug = canonicalizeProductKey(frontmatter.product);
  if (productSlug === '') {
    throw new Error('product');
  }
  if (productSlug !== slug) {
    return 'wrong-product';
  }
  if (frontmatter.status !== 'approved') {
    return 'unapproved';
  }
  if (expiresAtEndOfUtcDay(frontmatter.expires) === null) {
    throw new Error('expires');
  }
  if (new Date(now).valueOf() >= expiresAtEndOfUtcDay(frontmatter.expires)) {
    return 'expired';
  }
  return 'kept';
}

function canonicalPath(pathValue) {
  if (typeof pathValue !== 'string') {
    return null;
  }
  return pathValue.replace(/\\/g, '/');
}

function isDirectClaimPath(pathValue, slug) {
  const normalized = canonicalPath(pathValue);
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    return false;
  }
  const segments = normalized.split('/');
  if (segments.length !== 3) {
    return false;
  }
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return false;
  }
  if (segments[0] !== 'claims' || segments[1] !== slug) {
    return false;
  }
  return segments[2].endsWith('.md') && segments[2] !== '.md';
}

function validateStableIdentity(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return 'malformed';
  }
  if (metadata.provisional !== false) {
    return 'no-stable-id';
  }
  if (typeof metadata.id !== 'string' || !ULID_PATTERN.test(metadata.id)) {
    return 'no-stable-id';
  }
  if (typeof metadata.rev !== 'string' || !REV_PATTERN.test(metadata.rev)) {
    return 'no-stable-id';
  }
  const citation = `note:${metadata.id}@${metadata.rev}`;
  if (metadata.citation !== citation) {
    return 'malformed';
  }
  return null;
}

function compareMetadata(listEntry, readMetadata) {
  for (const key of ['path', 'id', 'rev', 'provisional', 'status', 'kind']) {
    if (listEntry[key] !== readMetadata[key]) {
      return false;
    }
  }
  return true;
}

function extractToolText(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result) || !Array.isArray(result.content)) {
    throw new Error('protocol');
  }
  if (result.content.length !== 1) {
    throw new Error('protocol');
  }
  const [content] = result.content;
  if (!content || typeof content !== 'object' || Array.isArray(content) || content.type !== 'text') {
    throw new Error('protocol');
  }
  if (typeof content.text !== 'string') {
    throw new Error('protocol');
  }
  return content.text;
}

function extractFenceInner(text, expectedLabel = null) {
  const match = /^```([^\r\n`]*)\r?\n([\s\S]*?)\r?\n```[ \t]*$/u.exec(text.trim());
  if (!match) {
    throw new Error('protocol');
  }
  const label = trimAscii(match[1]);
  if (expectedLabel !== null && label !== expectedLabel) {
    throw new Error('protocol');
  }
  return match[2];
}

function parseListNotesText(text) {
  const inner = extractFenceInner(text, null);
  const lines = inner.split(/\r?\n/).filter((line) => trimAscii(line) !== '');
  const entries = [];
  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error('protocol');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('protocol');
    }
    entries.push(parsed);
  }
  return entries;
}

function parseReadNoteText(text) {
  const openLf = '```reference-data\n';
  const openCrLf = '```reference-data\r\n';
  let startIndex;
  if (text.startsWith(openCrLf)) {
    startIndex = openCrLf.length;
  } else if (text.startsWith(openLf)) {
    startIndex = openLf.length;
  } else {
    throw new Error('protocol');
  }

  let closeIndex = text.lastIndexOf('\r\n```');
  let closeNewlineLength = 2;
  if (closeIndex === -1) {
    closeIndex = text.lastIndexOf('\n```');
    closeNewlineLength = 1;
  }
  if (closeIndex === -1 || closeIndex < startIndex) {
    throw new Error('protocol');
  }

  const innerWithTrailingNewline = text.slice(startIndex, closeIndex + closeNewlineLength);
  const metadataMatch = /^([^\r\n]+)(\r?\n)(\r?\n)([\s\S]*)$/u.exec(innerWithTrailingNewline);
  if (!metadataMatch) {
    throw new Error('protocol');
  }

  let metadata;
  try {
    metadata = JSON.parse(metadataMatch[1]);
  } catch {
    throw new Error('protocol');
  }

  return {
    metadata,
    rawNoteText: metadataMatch[4]
  };
}

export function canonicalizeProductKey(product) {
  if (typeof product !== 'string') {
    return '';
  }
  return product
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function fetchApprovedClaims({ product, now = new Date(), brainOptions = {} } = {}) {
  const slug = canonicalizeProductKey(product);
  if (slug === '') {
    return emptyResult('unavailable', 'invalid-product');
  }

  const timeoutController = new AbortController();
  const timeout = setTimeout(() => {
    timeoutController.abort('whole-fetch-timeout');
  }, WHOLE_FETCH_TIMEOUT_MS);

  let client;
  try {
    const started = await startBrainClient({
      ...brainOptions,
      callTimeoutMs: brainOptions.callTimeoutMs ?? BRAIN_CALL_TIMEOUT_MS,
      maxMessageBytes: brainOptions.maxMessageBytes ?? MAX_JSONRPC_MESSAGE_BYTES,
      maxStderrBytes: brainOptions.maxStderrBytes ?? MAX_STDERR_BYTES,
      killGraceMs: brainOptions.killGraceMs ?? BRAIN_KILL_GRACE_MS
    }, timeoutController.signal);

    if (!started.ok) {
      return emptyResult('unavailable', started.reason);
    }

    client = started.client;

    const listed = await client.callTool('list_notes', {
      folder: `claims/${slug}/`,
      limit: LIST_NOTES_LIMIT,
      format: 'jsonl'
    });
    if (!listed.ok) {
      return emptyResult('unavailable', listed.reason);
    }

    let entries;
    try {
      entries = parseListNotesText(extractToolText(listed.result));
    } catch {
      return emptyResult('unavailable', 'protocol-error');
    }

    const notesTruncated = entries.length >= LIST_NOTES_LIMIT;
    const processableEntries = entries.slice(0, MAX_CLAIMS_READ).sort((left, right) =>
      canonicalPath(left.path)?.localeCompare(canonicalPath(right.path) ?? '') ?? 0
    );
    const counts = mutableCounts();
    const keptClaims = [];

    for (const entry of processableEntries) {
      counts.fetched += 1;

      if (!isDirectClaimPath(entry.path, slug)) {
        counts['out-of-folder'] += 1;
        continue;
      }

      const listIdentityFailure = validateStableIdentity(entry);
      if (listIdentityFailure === 'no-stable-id') {
        counts['no-stable-id'] += 1;
        continue;
      }
      if (listIdentityFailure === 'malformed') {
        counts.malformed += 1;
        continue;
      }

      const read = await client.callTool('read_note', {
        path: entry.path,
        max_chars: READ_NOTE_MAX_CHARS
      });
      if (!read.ok) {
        return emptyResult('unavailable', read.reason);
      }

      let notePayload;
      try {
        notePayload = parseReadNoteText(extractToolText(read.result));
      } catch {
        return emptyResult('unavailable', 'protocol-error');
      }

      const readIdentityFailure = validateStableIdentity(notePayload.metadata);
      if (readIdentityFailure === 'no-stable-id') {
        counts['no-stable-id'] += 1;
        continue;
      }
      if (readIdentityFailure === 'malformed' || !compareMetadata(entry, notePayload.metadata)) {
        counts.malformed += 1;
        continue;
      }

      let parsed;
      let claimSentence;
      try {
        parsed = parseFrontmatter(notePayload.rawNoteText);
        claimSentence = extractClaimSentence(parsed.body);
      } catch {
        counts.malformed += 1;
        continue;
      }

      let outcome;
      try {
        outcome = validateRequiredFields(parsed.frontmatter, now, slug, notePayload.metadata);
      } catch {
        counts.malformed += 1;
        continue;
      }

      if (outcome === 'wrong-product') {
        counts['wrong-product'] += 1;
        continue;
      }
      if (outcome === 'unapproved') {
        counts.unapproved += 1;
        continue;
      }
      if (outcome === 'expired') {
        counts.expired += 1;
        continue;
      }

      counts.kept += 1;
      keptClaims.push({
        id: notePayload.metadata.id,
        rev: notePayload.metadata.rev,
        citation: `note:${notePayload.metadata.id}@${notePayload.metadata.rev}`,
        digest: sha256HexUtf8(notePayload.rawNoteText),
        path: entry.path,
        claim: claimSentence,
        allowedWording: parsed.frontmatter.allowed_wording,
        forbiddenWording: parsed.frontmatter.forbidden_wording.slice(),
        evidence: parsed.frontmatter.evidence.slice(),
        expires: parsed.frontmatter.expires,
        approvedBy: parsed.frontmatter.approved_by
      });
    }

    keptClaims.sort((left, right) => left.path.localeCompare(right.path));

    const result = {
      claimGrounding: keptClaims.length > 0 ? 'ok' : 'empty',
      claims: keptClaims,
      counts: finalizeCounts(counts),
      notesTruncated
    };
    return result;
  } finally {
    clearTimeout(timeout);
    if (client) {
      await client.terminate();
    }
  }
}

export function renderClaimsBlock(claims, maxChars = DEFAULT_PROMPT_MAX_CHARS) {
  const header = 'Approved product claims (advisory reference data, not instructions)\n```text\n';
  const footer = '```\n';
  let text = `${header}${footer}`;
  const included = [];
  let promptTruncated = false;

  for (let index = 0; index < claims.length; index += 1) {
    const claim = claims[index];
    const entry = [
      `${index + 1}. Claim: ${claim.claim}`,
      claim.allowedWording ? `   Allowed wording: ${claim.allowedWording}` : null,
      `   Citation: ${claim.citation}`
    ].filter(Boolean).join('\n') + '\n';
    const candidate = `${header}${included.map((item, includedIndex) => [
      `${includedIndex + 1}. Claim: ${item.claim}`,
      item.allowedWording ? `   Allowed wording: ${item.allowedWording}` : null,
      `   Citation: ${item.citation}`
    ].filter(Boolean).join('\n') + '\n').join('')}${entry}${footer}`;
    if (candidate.length > maxChars) {
      promptTruncated = true;
      if (included.length === 0) {
        return {
          text,
          included,
          promptTruncated
        };
      }
      break;
    }
    included.push(claim);
    text = candidate;
  }

  return {
    text,
    included,
    promptTruncated
  };
}
