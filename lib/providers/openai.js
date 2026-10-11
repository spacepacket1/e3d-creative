import { resolveApiKey } from './keys.js';

const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_KEY_FILE = '~/.config/e3d-pilot/openai-api-key';
const DEFAULT_MODEL = 'gpt-5.4';

function extractText(data) {
  const message = data?.choices?.[0]?.message;
  if (typeof message?.content === 'string') {
    return message.content.trim();
  }
  if (Array.isArray(message?.content)) {
    return message.content
      .filter((part) => part && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n')
      .trim();
  }
  return '';
}

export function createOpenAIProvider(options = {}) {
  const {
    fetchImpl = globalThis.fetch,
    endpoint = DEFAULT_ENDPOINT,
    defaultModel = DEFAULT_MODEL,
    env = process.env,
    apiKey,
    apiKeyFile,
    readFileImpl
  } = options;

  return {
    name: 'openai',
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

      const resolvedModel = model ?? defaultModel;
      const key = apiKey ?? await resolveApiKey({
        env,
        envVarNames: ['OPENAI_API_KEY', 'CODEX_API_KEY'],
        keyFileEnvVarNames: ['E3D_OPENAI_API_KEY_FILE', 'OPENAI_API_KEY_FILE', 'S2C_OPENAI_API_KEY_FILE'],
        keyFilePath: apiKeyFile,
        defaultKeyFilePath: DEFAULT_KEY_FILE,
        readFileImpl
      });

      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${key}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: resolvedModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ]
        })
      });

      if (!response.ok) {
        throw new Error(`openai provider request failed with status ${response.status}`);
      }

      const data = await response.json();
      return {
        text: extractText(data),
        usage: data.usage ?? null,
        model: resolvedModel
      };
    }
  };
}
