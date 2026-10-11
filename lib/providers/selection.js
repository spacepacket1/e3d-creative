import { createProviderRegistry, PROVIDER_NAMES } from './index.js';

const CALL_SITES = new Set(['conceptGeneration', 'critique', 'qa']);
const ALTERNATE_PROVIDERS = Object.freeze({
  claude: 'openai',
  openai: 'claude'
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeProviderName(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string' || !PROVIDER_NAMES.includes(value)) {
    throw new Error(`${fieldName}: must be one of ${PROVIDER_NAMES.join(', ')}`);
  }
  return value;
}

function readBriefProviderSelection(brief = {}) {
  const raw = isPlainObject(brief.providerSelection) ? brief.providerSelection : {};
  const legacyRaw = isPlainObject(brief.providers) ? brief.providers : {};

  return {
    conceptGeneration: normalizeProviderName(
      raw.conceptGeneration ?? raw.concept ?? legacyRaw.conceptGeneration ?? legacyRaw.concept,
      'providerSelection.conceptGeneration'
    ),
    critique: normalizeProviderName(
      raw.critique ?? legacyRaw.critique,
      'providerSelection.critique'
    ),
    qa: normalizeProviderName(
      raw.qa ?? legacyRaw.qa,
      'providerSelection.qa'
    )
  };
}

export function parseProviderFlags(argv) {
  const options = {};
  const rest = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--concept-provider') {
      options.conceptProvider = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--concept-provider=')) {
      options.conceptProvider = arg.slice('--concept-provider='.length);
    } else if (arg === '--critique-provider') {
      options.critiqueProvider = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--critique-provider=')) {
      options.critiqueProvider = arg.slice('--critique-provider='.length);
    } else if (arg === '--qa-provider') {
      options.qaProvider = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--qa-provider=')) {
      options.qaProvider = arg.slice('--qa-provider='.length);
    } else {
      rest.push(arg);
    }
  }

  return { options, rest };
}

export function selectProviders({ brief = {}, cliOptions = {} } = {}) {
  const briefSelection = readBriefProviderSelection(brief);
  const conceptGeneration = normalizeProviderName(
    cliOptions.conceptProvider,
    'conceptProvider'
  ) ?? briefSelection.conceptGeneration ?? 'claude';
  const critique = normalizeProviderName(
    cliOptions.critiqueProvider,
    'critiqueProvider'
  ) ?? briefSelection.critique ?? 'openai';
  const qa = normalizeProviderName(
    cliOptions.qaProvider,
    'qaProvider'
  ) ?? briefSelection.qa ?? conceptGeneration;

  return { conceptGeneration, critique, qa };
}

export function getAlternateProviderName(providerName) {
  const normalized = normalizeProviderName(providerName, 'providerName');
  return ALTERNATE_PROVIDERS[normalized];
}

export function selectCritiqueProvider({ generatedProvider, brief = {}, cliOptions = {} } = {}) {
  const briefSelection = readBriefProviderSelection(brief);
  const explicitSelection = normalizeProviderName(
    cliOptions.critiqueProvider,
    'critiqueProvider'
  ) ?? briefSelection.critique;

  if (explicitSelection) {
    return explicitSelection;
  }

  if (generatedProvider) {
    return getAlternateProviderName(generatedProvider);
  }

  return 'openai';
}

export function selectQaProvider({
  generatedProvider,
  critiqueProvider,
  brief = {},
  cliOptions = {}
} = {}) {
  const briefSelection = readBriefProviderSelection(brief);
  const explicitSelection = normalizeProviderName(
    cliOptions.qaProvider,
    'qaProvider'
  ) ?? briefSelection.qa;

  if (explicitSelection) {
    return explicitSelection;
  }

  if (generatedProvider && critiqueProvider && generatedProvider !== critiqueProvider) {
    return generatedProvider;
  }

  if (critiqueProvider) {
    return getAlternateProviderName(critiqueProvider);
  }

  if (generatedProvider) {
    return generatedProvider;
  }

  return 'claude';
}

export function createProviderContext(options = {}) {
  const {
    brief,
    cliOptions,
    registry = createProviderRegistry(options.providerOptions ?? {})
  } = options;

  return {
    selection: selectProviders({ brief, cliOptions }),
    registry
  };
}

export async function generateForCallSite(context, callSite, request) {
  if (!CALL_SITES.has(callSite)) {
    throw new Error(`unknown provider call site: ${callSite}`);
  }

  const providerName = context.selection[callSite];
  const provider = context.registry[providerName];
  if (!provider || typeof provider.generate !== 'function') {
    throw new Error(`provider for ${callSite} does not implement generate`);
  }

  return provider.generate(request);
}
