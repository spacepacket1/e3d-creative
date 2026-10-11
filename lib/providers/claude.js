import { resolveApiKey } from './keys.js';

const DEFAULT_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const DEFAULT_KEY_FILE = '~/.config/e3d-pilot/anthropic-api-key';
const DEFAULT_MODEL = 'claude-sonnet-4-5';

function extractText(data) {
  const parts = Array.isArray(data.content) ? data.content : [];
  return parts
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

export function createClaudeProvider(options = {}) {
  const {
    fetchImpl = globalThis.fetch,
    endpoint = DEFAULT_ENDPOINT,
    defaultModel = DEFAULT_MODEL,
    maxTokens = 4096,
    env = process.env,
    apiKey,
    apiKeyFile,
    readFileImpl
  } = options;

  return {
    name: 'claude',
    async generate({ systemPrompt, userPrompt, model } = {}) {
      if (typeof fetchImpl !== 'function') {
        throw new Error('fetch implementation is required');
      }
      if (typeof systemPrompt !== 'string' || systemPrompt.trim() === '') {
        throw new Error('systemPrompt is required');
      }
      if (typeof userPrompt !== 'string' || userPrompt.trim() === '') {
        throw new Error('userPrompt is required');
      }

      const key = apiKey ?? await resolveApiKey({
        env,
        envVarNames: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'],
        keyFileEnvVarNames: ['E3D_CLAUDE_API_KEY_FILE', 'S2C_CLAUDE_API_KEY_FILE'],
        keyFilePath: apiKeyFile,
        defaultKeyFilePath: DEFAULT_KEY_FILE,
        readFileImpl
      });

      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': key
        },
        body: JSON.stringify({
          model: model ?? defaultModel,
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: [
            { role: 'user', content: userPrompt }
          ]
        })
      });

      if (!response.ok) {
        throw new Error(`claude provider request failed with status ${response.status}`);
      }

      const data = await response.json();
      return {
        text: extractText(data),
        usage: data.usage ?? null
      };
    }
  };
}
