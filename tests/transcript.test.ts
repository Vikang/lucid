import { describe, test, expect } from 'bun:test';
import { parseTranscript, readTranscript } from '../src/utils/transcript';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('parseTranscript', () => {
  test('parses Human/Assistant format', () => {
    const raw = `Human: What is TypeScript?
Assistant: TypeScript is a typed superset of JavaScript.
Human: Is it good?
Assistant: Yes, it adds type safety.`;

    const entries = parseTranscript(raw);
    expect(entries.length).toBe(4);
    expect(entries[0].role).toBe('human');
    expect(entries[0].content).toContain('What is TypeScript');
    expect(entries[1].role).toBe('assistant');
    expect(entries[1].content).toContain('typed superset');
  });

  test('parses User/Assistant format', () => {
    const raw = `User: Hello there
Assistant: Hi! How can I help?`;

    const entries = parseTranscript(raw);
    expect(entries.length).toBe(2);
    expect(entries[0].role).toBe('user');
    expect(entries[1].role).toBe('assistant');
  });

  test('handles plain text as single block', () => {
    const raw = 'Just some plain text without any role markers.';
    const entries = parseTranscript(raw);
    expect(entries.length).toBe(1);
    expect(entries[0].role).toBe('unknown');
    expect(entries[0].content).toBe(raw);
  });

  test('handles empty string', () => {
    const entries = parseTranscript('');
    expect(entries.length).toBe(1);
    expect(entries[0].content).toBe('');
  });

  test('normalizes excessive whitespace', () => {
    const raw = `Human: First message\n\n\n\n\nAssistant: Response`;
    const entries = parseTranscript(raw);
    expect(entries.length).toBe(2);
  });
});

describe('readTranscript', () => {
  test('reads from --text argument', async () => {
    const result = await readTranscript({ text: 'Hello world' });
    expect(result).toBe('Hello world');
  });

  test('reads from file', async () => {
    const tmpFile = join(tmpdir(), `lucid-test-${Date.now()}.txt`);
    writeFileSync(tmpFile, 'Human: test\nAssistant: response');

    try {
      const result = await readTranscript({ file: tmpFile });
      expect(result).toContain('Human: test');
    } finally {
      unlinkSync(tmpFile);
    }
  });

  test('throws on missing file', async () => {
    await expect(readTranscript({ file: '/nonexistent/file.txt' })).rejects.toThrow('not found');
  });

  test('throws on empty file', async () => {
    const tmpFile = join(tmpdir(), `lucid-test-empty-${Date.now()}.txt`);
    writeFileSync(tmpFile, '');

    try {
      await expect(readTranscript({ file: tmpFile })).rejects.toThrow('empty');
    } finally {
      unlinkSync(tmpFile);
    }
  });

  test('prefers --text over --file', async () => {
    const result = await readTranscript({ text: 'direct text', file: '/nonexistent' });
    expect(result).toBe('direct text');
  });
});
