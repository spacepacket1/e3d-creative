import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createClaudeProvider } from '../lib/providers/claude.js';
import { createOpenAIProvider } from '../lib/providers/openai.js';
import { createProvider, PROVIDER_NAMES } from '../lib/providers/index.js';
import {
  createProviderContext,
  generateForCallSite,
  parseProviderFlags,
  selectProviders
} from '../lib/providers/selection.js';

function okJsonResponse(body) {
  return {
    ok: true,
    status: 200,
    async json() {
      return body;
    }
  };
}

test('provider implementations expose the same generate interface and response shape', async () => {
  const calls = [];
  const claude = createClaudeProvider({
    apiKey: 'test-claude-key',
    fetchImpl: async (url, request) => {
      calls.push({ provider: 'claude', url, request });
      return okJsonResponse({
        content: [{ type: 'text', text: 'claude text' }],
        usage: { input_tokens: 3, output_tokens: 5 }
      });
    }
  });
  const openai = createOpenAIProvider({
    apiKey: 'test-openai-key',
    fetchImpl: async (url, request) => {
      calls.push({ provider: 'openai', url, request });
      return okJsonResponse({
        choices: [{ message: { content: 'openai text' } }],
        usage: { prompt_tokens: 7, completion_tokens: 11 }
      });
    }
  });

  for (const provider of [claude, openai]) {
    assert.deepEqual(Object.keys(provider).sort(), ['generate', 'name']);
    assert.equal(typeof provider.generate, 'function');
  }

  const prompt = { systemPrompt: 'System prompt', userPrompt: 'User prompt', model: 'test-model' };
  assert.deepEqual(await claude.generate(prompt), {
    text: 'claude text',
    usage: { input_tokens: 3, output_tokens: 5 },
    model: 'test-model'
  });
  assert.deepEqual(await openai.generate(prompt), {
    text: 'openai text',
    usage: { prompt_tokens: 7, completion_tokens: 11 },
    model: 'test-model'
  });

  assert.equal(calls.length, 2);
  assert.match(calls[0].request.headers['x-api-key'], /^test-/);
  assert.match(calls[1].request.headers.authorization, /^Bearer test-/);
});

test('claude provider defaults to a model and token ceiling confirmed working against the real API', async () => {
  // Regression test for two bugs only a live (non-mocked) call surfaced:
  // the original default model ('claude-sonnet-4-5') 404s against the real
  // Anthropic API (retired), and the original default maxTokens (4096)
  // truncates concept generation's realistic multi-direction JSON output
  // mid-string. Both were fixed after a real end-to-end run against the
  // actual API, not discovered by any mocked test -- this test pins the
  // defaults so they can't silently regress back to the broken values,
  // though it still can't catch a *future* retirement of the current model
  // string the way a live call would.
  let capturedBody = null;
  const provider = createClaudeProvider({
    apiKey: 'test-claude-key',
    fetchImpl: async (_url, request) => {
      capturedBody = JSON.parse(request.body);
      return okJsonResponse({ content: [{ type: 'text', text: 'ok' }], usage: {} });
    }
  });

  await provider.generate({ systemPrompt: 'System', userPrompt: 'User' });

  assert.notEqual(capturedBody.model, 'claude-sonnet-4-5');
  assert.match(capturedBody.model, /^claude-sonnet-5/);
  assert.ok(capturedBody.max_tokens >= 8192, `expected max_tokens >= 8192, got ${capturedBody.max_tokens}`);
});

test('provider keys resolve from environment before configured key files', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'e3d-provider-'));
  const keyFile = path.join(tempDir, 'anthropic-api-key');
  await writeFile(keyFile, 'file-key\n');

  let authorization = null;
  const provider = createClaudeProvider({
    env: { ANTHROPIC_API_KEY: 'env-key', E3D_CLAUDE_API_KEY_FILE: keyFile },
    fetchImpl: async (_url, request) => {
      authorization = request.headers['x-api-key'];
      return okJsonResponse({
        content: [{ type: 'text', text: 'done' }],
        usage: {}
      });
    }
  });

  await provider.generate({ systemPrompt: 'System', userPrompt: 'User' });
  assert.equal(authorization, 'env-key');
});

test('provider keys fall back to configured key files without requiring real secrets', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'e3d-provider-'));
  const keyFile = path.join(tempDir, 'openai-api-key');
  await writeFile(keyFile, 'file-openai-key\n');

  let authorization = null;
  const provider = createOpenAIProvider({
    env: { E3D_OPENAI_API_KEY_FILE: keyFile },
    fetchImpl: async (_url, request) => {
      authorization = request.headers.authorization;
      return okJsonResponse({
        choices: [{ message: { content: 'done' } }],
        usage: {}
      });
    }
  });

  await provider.generate({ systemPrompt: 'System', userPrompt: 'User' });
  assert.equal(authorization, 'Bearer file-openai-key');
});

test('key file in the real export-line format (S2C_CLAUDE_API_KEY_FILE convention) is parsed, not used verbatim', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'e3d-provider-'));
  const keyFile = path.join(tempDir, 'anthropic-api-key');
  await writeFile(keyFile, 'export ANTHROPIC_API_KEY="sk-ant-real-looking-key-12345"\n');

  let authorization = null;
  const provider = createClaudeProvider({
    env: { E3D_CLAUDE_API_KEY_FILE: keyFile },
    fetchImpl: async (_url, request) => {
      authorization = request.headers['x-api-key'];
      return okJsonResponse({
        content: [{ type: 'text', text: 'done' }],
        usage: {}
      });
    }
  });

  await provider.generate({ systemPrompt: 'System', userPrompt: 'User' });
  assert.equal(authorization, 'sk-ant-real-looking-key-12345');
});

test('concept generation and critique can select different providers in one run', async () => {
  const calls = [];
  const registry = {
    claude: {
      async generate(request) {
        calls.push({ provider: 'claude', request });
        return { text: 'critique', usage: { tokens: 1 } };
      }
    },
    openai: {
      async generate(request) {
        calls.push({ provider: 'openai', request });
        return { text: 'concept', usage: { tokens: 2 } };
      }
    }
  };
  const context = createProviderContext({
    brief: {
      providerSelection: {
        conceptGeneration: 'openai',
        critique: 'claude'
      }
    },
    registry
  });

  const concept = await generateForCallSite(context, 'conceptGeneration', {
    systemPrompt: 'Generate',
    userPrompt: 'Brief'
  });
  const critique = await generateForCallSite(context, 'critique', {
    systemPrompt: 'Critique',
    userPrompt: 'Direction'
  });
  const qa = await generateForCallSite(context, 'qa', {
    systemPrompt: 'QA',
    userPrompt: 'Direction'
  });

  assert.equal(concept.text, 'concept');
  assert.equal(critique.text, 'critique');
  assert.equal(qa.text, 'concept');
  assert.deepEqual(calls.map((call) => call.provider), ['openai', 'claude', 'openai']);
});

test('CLI-style provider flags override brief provider selection independently', () => {
  const parsed = parseProviderFlags([
    '--concept-provider=claude',
    '--critique-provider',
    'openai',
    '--qa-provider=claude',
    'brief.json'
  ]);

  assert.deepEqual(parsed.rest, ['brief.json']);
  assert.deepEqual(selectProviders({
    brief: {
      providerSelection: {
        conceptGeneration: 'openai',
        critique: 'claude'
      }
    },
    cliOptions: parsed.options
  }), {
    conceptGeneration: 'claude',
    critique: 'openai',
    qa: 'claude'
  });
});

test('provider factory accepts only supported provider names', () => {
  assert.deepEqual(PROVIDER_NAMES, ['claude', 'openai']);
  assert.equal(createProvider('claude', { apiKey: 'x', fetchImpl: async () => okJsonResponse({ content: [] }) }).name, 'claude');
  assert.throws(() => createProvider('unknown'), /unknown provider/);
});

test('non-provider runtime code does not branch on concrete provider identity', async () => {
  const runtimeFiles = ['lib/cli.js', 'lib/schema.js'];

  for (const file of runtimeFiles) {
    const source = await readFile(path.join(process.cwd(), file), 'utf8');
    assert.doesNotMatch(source, /\b(?:claude|openai)\b/i, `${file} should not branch on provider identity`);
  }
});
