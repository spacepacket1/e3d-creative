import { createClaudeProvider } from './claude.js';
import { createOpenAIProvider } from './openai.js';

const PROVIDERS = {
  claude: createClaudeProvider,
  openai: createOpenAIProvider
};

export const PROVIDER_NAMES = Object.freeze(Object.keys(PROVIDERS));

export function assertProviderName(name) {
  if (!PROVIDER_NAMES.includes(name)) {
    throw new Error(`unknown provider: ${name}`);
  }
}

export function createProvider(name, options = {}) {
  assertProviderName(name);
  return PROVIDERS[name](options);
}

export function createProviderRegistry(options = {}) {
  return Object.fromEntries(
    PROVIDER_NAMES.map((name) => [name, createProvider(name, options[name] ?? options)])
  );
}
