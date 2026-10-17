import { spawn } from 'node:child_process';

export const BRAIN_TOOL_ALLOWLIST = Object.freeze([
  'search',
  'read_note',
  'list_notes',
  'related',
  'read_ref_chunk',
  'report_use'
]);

export const BRAIN_INVOKABLE_TOOLS = Object.freeze(['list_notes', 'read_note']);
export const MAX_JSONRPC_MESSAGE_BYTES = 256 * 1024;
export const MAX_STDERR_BYTES = 4 * 1024;
export const BRAIN_CALL_TIMEOUT_MS = 10_000;
export const BRAIN_KILL_GRACE_MS = 1_000;

const JSONRPC_VERSION = '2.0';

function safeReason(reason) {
  return reason ?? 'transport-error';
}

function withResolvers() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createExplicitEnv(brainConfig, envSource) {
  const env = {};
  for (const key of ['PATH', 'HOME', 'LANG']) {
    if (typeof envSource[key] === 'string' && envSource[key] !== '') {
      env[key] = envSource[key];
    }
  }
  env.EBRAIN_CONFIG = brainConfig;
  return env;
}

function extractToolNames(result) {
  if (!Array.isArray(result?.tools)) {
    return null;
  }

  const names = [];
  for (const tool of result.tools) {
    if (!tool || typeof tool !== 'object' || Array.isArray(tool) || typeof tool.name !== 'string') {
      return null;
    }
    names.push(tool.name);
  }
  return names;
}

function parseResponseEnvelope(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return null;
  }
  if (message.jsonrpc !== JSONRPC_VERSION) {
    return null;
  }
  return message;
}

export function resolveBrainOptions(brainOptions = {}, env = process.env) {
  const brainMain = brainOptions.brainMain ?? brainOptions.mainPath ?? env.E3D_CREATIVE_BRAIN_MAIN;
  const brainConfig = brainOptions.brainConfig ?? brainOptions.configPath ?? env.E3D_CREATIVE_BRAIN_CONFIG;

  if (typeof brainMain !== 'string' || brainMain.trim() === '') {
    return null;
  }
  if (typeof brainConfig !== 'string' || brainConfig.trim() === '') {
    return null;
  }

  return {
    brainMain,
    brainConfig
  };
}

class BrainClient {
  constructor(options) {
    this.brainMain = options.brainMain;
    this.brainConfig = options.brainConfig;
    this.spawnImpl = options.spawnImpl ?? spawn;
    this.envSource = options.envSource ?? process.env;
    this.callTimeoutMs = options.callTimeoutMs ?? BRAIN_CALL_TIMEOUT_MS;
    this.maxMessageBytes = options.maxMessageBytes ?? MAX_JSONRPC_MESSAGE_BYTES;
    this.maxStderrBytes = options.maxStderrBytes ?? MAX_STDERR_BYTES;
    this.child = null;
    this.buffer = Buffer.alloc(0);
    this.nextRequestId = 1;
    this.pending = new Map();
    this.closed = false;
    this.failedReason = null;
    this.stderr = '';
    this.exitDeferred = withResolvers();
    this.exposedTools = Object.freeze([]);
  }

  async start(signal) {
    try {
      this.child = this.spawnImpl(process.execPath, [this.brainMain, 'mcp'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: createExplicitEnv(this.brainConfig, this.envSource)
      });
    } catch {
      return { ok: false, reason: 'transport-error' };
    }

    this.child.stdout.on('data', (chunk) => {
      this.onStdout(chunk);
    });

    this.child.stderr.on('data', (chunk) => {
      if (this.stderr.length >= this.maxStderrBytes) {
        return;
      }
      const remaining = this.maxStderrBytes - this.stderr.length;
      this.stderr += chunk.toString('utf8', 0, remaining);
    });

    this.child.on('error', () => {
      this.fail('transport-error');
    });

    this.child.on('exit', (code, signalName) => {
      this.closed = true;
      this.exitDeferred.resolve({ code, signalName });
      if (!this.failedReason && code !== 0 && signalName === null) {
        this.fail('transport-error');
      } else {
        this.rejectPending(this.failedReason ?? 'transport-error');
      }
    });

    const abortHandler = () => {
      this.fail(signal?.reason === 'whole-fetch-timeout' ? 'timed-out' : 'transport-error');
      void this.terminate();
    };

    if (signal) {
      if (signal.aborted) {
        abortHandler();
      } else {
        signal.addEventListener('abort', abortHandler, { once: true });
      }
    }

    if (this.failedReason) {
      return { ok: false, reason: this.failedReason };
    }

    const initialized = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'e3d-creative',
        version: '0.1.0'
      }
    });

    if (!initialized.ok) {
      await this.terminate();
      return initialized;
    }

    this.notify('notifications/initialized', {});

    const listed = await this.request('tools/list', {});
    if (!listed.ok) {
      await this.terminate();
      return listed;
    }

    const toolNames = extractToolNames(listed.result);
    if (toolNames === null) {
      this.fail('protocol-error');
      await this.terminate();
      return { ok: false, reason: 'protocol-error' };
    }

    for (const name of toolNames) {
      if (!BRAIN_TOOL_ALLOWLIST.includes(name)) {
        await this.terminate();
        return { ok: false, reason: 'brain-not-read-only' };
      }
    }

    if (!toolNames.includes('list_notes') || !toolNames.includes('read_note')) {
      await this.terminate();
      return { ok: false, reason: 'required-tool-missing' };
    }

    this.exposedTools = Object.freeze(toolNames.slice());
    return { ok: true, client: this };
  }

  notify(method, params) {
    if (this.failedReason || !this.child?.stdin?.writable) {
      return;
    }
    const payload = {
      jsonrpc: JSONRPC_VERSION,
      method,
      params
    };
    this.writeMessage(payload);
  }

  async request(method, params) {
    if (this.failedReason) {
      return { ok: false, reason: this.failedReason };
    }
    if (!this.child?.stdin?.writable) {
      return { ok: false, reason: 'transport-error' };
    }

    const id = this.nextRequestId;
    this.nextRequestId += 1;

    const pending = withResolvers();
    const timeout = setTimeout(() => {
      this.fail('timed-out');
      void this.terminate();
    }, this.callTimeoutMs);

    this.pending.set(id, {
      resolve: pending.resolve,
      reject: pending.reject,
      timeout
    });

    try {
      this.writeMessage({
        jsonrpc: JSONRPC_VERSION,
        id,
        method,
        params
      });
    } catch {
      clearTimeout(timeout);
      this.pending.delete(id);
      this.fail('transport-error');
      void this.terminate();
      return { ok: false, reason: 'transport-error' };
    }

    try {
      const response = await pending.promise;
      const envelope = parseResponseEnvelope(response);
      if (!envelope || envelope.id !== id) {
        this.fail('protocol-error');
        void this.terminate();
        return { ok: false, reason: 'protocol-error' };
      }
      if ('error' in envelope) {
        this.fail('protocol-error');
        void this.terminate();
        return { ok: false, reason: 'protocol-error' };
      }
      return {
        ok: true,
        result: envelope.result
      };
    } catch (reason) {
      return {
        ok: false,
        reason: safeReason(reason)
      };
    }
  }

  async callTool(name, args) {
    if (!BRAIN_INVOKABLE_TOOLS.includes(name)) {
      throw new Error(`brain tool is not invokable: ${name}`);
    }

    const response = await this.request('tools/call', {
      name,
      arguments: args
    });

    if (!response.ok) {
      return response;
    }

    return {
      ok: true,
      result: response.result
    };
  }

  writeMessage(payload) {
    const json = JSON.stringify(payload);
    const body = Buffer.from(json, 'utf8');
    if (body.length > this.maxMessageBytes) {
      throw new Error('message too large');
    }

    // MCP stdio here uses LSP-style framing: ASCII headers, CRLFCRLF, then the
    // exact UTF-8 JSON body bytes declared by Content-Length.
    const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8');
    this.child.stdin.write(Buffer.concat([header, body]));
  }

  onStdout(chunk) {
    if (this.failedReason) {
      return;
    }

    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length > 0) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        return;
      }

      const headerText = this.buffer.subarray(0, headerEnd).toString('utf8');
      const match = /^Content-Length:\s*(\d+)$/im.exec(headerText);
      if (!match) {
        this.fail('protocol-error');
        void this.terminate();
        return;
      }

      const contentLength = Number(match[1]);
      if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > this.maxMessageBytes) {
        this.fail('protocol-error');
        void this.terminate();
        return;
      }

      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + contentLength;
      if (this.buffer.length < messageEnd) {
        return;
      }

      const body = this.buffer.subarray(messageStart, messageEnd);
      this.buffer = this.buffer.subarray(messageEnd);

      let parsed;
      try {
        parsed = JSON.parse(body.toString('utf8'));
      } catch {
        this.fail('protocol-error');
        void this.terminate();
        return;
      }

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof parsed.id !== 'number') {
        this.fail('protocol-error');
        void this.terminate();
        return;
      }

      const entry = this.pending.get(parsed.id);
      if (!entry) {
        this.fail('protocol-error');
        void this.terminate();
        return;
      }

      clearTimeout(entry.timeout);
      this.pending.delete(parsed.id);
      entry.resolve(parsed);
    }
  }

  fail(reason) {
    if (this.failedReason) {
      return;
    }
    this.failedReason = safeReason(reason);
    this.rejectPending(this.failedReason);
  }

  rejectPending(reason) {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timeout);
      this.pending.delete(id);
      entry.reject(reason);
    }
  }

  async terminate() {
    if (!this.child) {
      return;
    }

    if (!this.child.killed && this.child.stdin?.writable) {
      this.child.stdin.end();
    }

    const settled = await Promise.race([
      this.exitDeferred.promise,
      new Promise((resolve) => setTimeout(() => resolve(null), 50))
    ]);
    if (settled) {
      return;
    }

    if (!this.child.killed) {
      this.child.kill('SIGTERM');
    }

    const exitResult = await Promise.race([
      this.exitDeferred.promise,
      new Promise((resolve) => setTimeout(() => resolve(null), BRAIN_KILL_GRACE_MS))
    ]);

    if (!exitResult && !this.child.killed) {
      this.child.kill('SIGKILL');
    }

    await this.exitDeferred.promise.catch(() => {});
  }
}

export async function startBrainClient(brainOptions = {}, signal) {
  const resolved = resolveBrainOptions(brainOptions, brainOptions.envSource ?? process.env);
  if (!resolved) {
    return { ok: false, reason: 'not-configured' };
  }

  const client = new BrainClient({
    ...brainOptions,
    ...resolved
  });

  return client.start(signal);
}
