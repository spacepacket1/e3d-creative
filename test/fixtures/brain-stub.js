import { readFileSync, writeFileSync } from 'node:fs';

const scenarioPath = process.env.EBRAIN_CONFIG;
if (!scenarioPath) {
  if (process.argv.length <= 2) {
    process.exit(0);
  }
  process.exit(2);
}

const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'));
const record = {
  pid: process.pid,
  argv: process.argv.slice(2),
  env: Object.fromEntries(Object.entries(process.env).sort(([left], [right]) => left.localeCompare(right))),
  calls: [],
  rawFrames: [],
  terminatedBy: null
};

function flushRecord() {
  if (scenario.recordPath) {
    writeFileSync(scenario.recordPath, JSON.stringify(record, null, 2));
  }
}

process.on('SIGTERM', () => {
  record.terminatedBy = 'SIGTERM';
  flushRecord();
  process.exit(0);
});

process.on('exit', () => {
  flushRecord();
});

if (scenario.mode === 'exit-early') {
  process.exit(1);
}

if (scenario.mode === 'stderr-flood') {
  process.stderr.write('E'.repeat(10_000));
  process.exit(1);
}

function sendMessage(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8');
  process.stdout.write(Buffer.concat([header, body]));
}

function sendGarbage() {
  const body = Buffer.from('not-json', 'utf8');
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8');
  process.stdout.write(Buffer.concat([header, body]));
}

function sendOversize(id) {
  const payload = {
    jsonrpc: '2.0',
    id,
    result: {
      content: [
        {
          type: 'text',
          text: 'x'.repeat(300_000)
        }
      ]
    }
  };
  sendMessage(payload);
}

function toolResultText(name, args) {
  if (name === 'list_notes') {
    return `\`\`\`jsonl\n${(scenario.listEntries ?? []).map((entry) => JSON.stringify(entry)).join('\n')}\n\`\`\``;
  }
  if (name === 'read_note') {
    const note = scenario.readNotes?.[args.path];
    if (!note) {
      return '```reference-data\n{}\n\n---\n---\nClaim:\nmissing\n```';
    }
    return `\`\`\`reference-data\n${JSON.stringify(note.metadata)}\n\n${note.noteText}\`\`\``;
  }
  throw new Error(`unexpected tool request: ${name}`);
}

function handleRequest(message) {
  record.calls.push(message);

  if (scenario.mode === 'hang') {
    return;
  }
  if (scenario.mode === 'garbage') {
    sendGarbage();
    return;
  }
  if (scenario.mode === 'oversize') {
    sendOversize(message.id);
    return;
  }

  if (message.method === 'initialize') {
    sendMessage({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2024-11-05',
        serverInfo: {
          name: 'brain-stub',
          version: '0.0.0'
        }
      }
    });
    return;
  }

  if (message.method === 'tools/list') {
    sendMessage({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        tools: (scenario.tools ?? []).map((name) => ({ name }))
      }
    });
    return;
  }

  if (message.method === 'tools/call') {
    sendMessage({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        content: [
          {
            type: 'text',
            text: toolResultText(message.params?.name, message.params?.arguments ?? {})
          }
        ]
      }
    });
    return;
  }
}

let buffer = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length > 0) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) {
      return;
    }

    const header = buffer.subarray(0, headerEnd).toString('utf8');
    const match = /^Content-Length:\s*(\d+)$/im.exec(header);
    if (!match) {
      process.exit(1);
    }

    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (buffer.length < bodyEnd) {
      return;
    }

    const frame = buffer.subarray(0, bodyEnd);
    record.rawFrames.push(frame.toString('utf8'));
    const body = buffer.subarray(bodyStart, bodyEnd);
    buffer = buffer.subarray(bodyEnd);

    const message = JSON.parse(body.toString('utf8'));
    handleRequest(message);
  }
});

process.stdin.on('end', () => {
  flushRecord();
  process.exit(0);
});
