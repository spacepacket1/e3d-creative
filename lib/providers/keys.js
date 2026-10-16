import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function expandHome(filePath) {
  if (!filePath.startsWith('~/')) {
    return filePath;
  }
  return path.join(os.homedir(), filePath.slice(2));
}

function firstNonEmptyEnv(env, names) {
  for (const name of names) {
    const value = env[name];
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return null;
}

// Key files on this machine (e.g. ~/.config/e3d-pilot/anthropic-api-key, the
// same file e3d-code's E3D_CODE_CLAUDE_API_KEY_FILE sources) are shell snippets --
// `export VAR="value"` -- meant to be sourced into a shell, not read as a bare
// secret. Extract the assigned value so this reader is compatible with that
// real file format; a file that is just the bare key (no "export" line)
// still works unchanged.
function extractKeyFromFileContents(raw) {
  const trimmed = raw.trim();
  const match = trimmed.match(/^export\s+[A-Za-z_][A-Za-z0-9_]*=(.*)$/);
  if (!match) {
    return trimmed;
  }
  let value = match[1].trim();
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    value = value.slice(1, -1);
  }
  return value;
}

export async function resolveApiKey(options = {}) {
  const {
    env = process.env,
    envVarNames,
    keyFileEnvVarNames = [],
    keyFilePath,
    defaultKeyFilePath,
    readFileImpl = readFile
  } = options;

  const envKey = firstNonEmptyEnv(env, envVarNames);
  if (envKey) {
    return envKey;
  }

  const configuredKeyFile = keyFilePath ?? firstNonEmptyEnv(env, keyFileEnvVarNames) ?? defaultKeyFilePath;
  if (!configuredKeyFile) {
    throw new Error('provider API key is not configured');
  }

  try {
    const raw = await readFileImpl(expandHome(configuredKeyFile), 'utf8');
    const key = extractKeyFromFileContents(raw);
    if (key === '') {
      throw new Error('empty key file');
    }
    return key;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`provider API key is not configured (${reason})`);
  }
}
