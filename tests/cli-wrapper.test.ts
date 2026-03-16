import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { wrapAction } from '../src/utils/cli-wrapper';
import { LucidError, ApiKeyError, ValidationError } from '../src/utils/errors';

// Capture console.error output and prevent process.exit from killing the test runner
let errorOutput: string[] = [];
const originalConsoleError = console.error;
const originalProcessExit = process.exit;

beforeEach(() => {
  errorOutput = [];
  console.error = (...args: unknown[]) => {
    errorOutput.push(args.map(String).join(' '));
  };
  // @ts-expect-error — we override process.exit to throw instead of exiting
  process.exit = (code?: number) => {
    throw new Error(`process.exit(${code})`);
  };
});

afterEach(() => {
  console.error = originalConsoleError;
  process.exit = originalProcessExit;
});

describe('wrapAction', () => {
  test('calls the wrapped function normally on success', async () => {
    let called = false;
    const wrapped = wrapAction(async () => {
      called = true;
    });

    await wrapped();
    expect(called).toBe(true);
  });

  test('catches LucidError and prints friendly message', async () => {
    const wrapped = wrapAction(async () => {
      throw new ApiKeyError('Missing OPENAI_API_KEY');
    });

    await expect(wrapped()).rejects.toThrow('process.exit(1)');
    const output = errorOutput.join('\n');
    expect(output).toContain('Missing OPENAI_API_KEY');
    expect(output).toContain('API_KEY_ERROR');
  });

  test('catches ValidationError', async () => {
    const wrapped = wrapAction(async () => {
      throw new ValidationError('Bad input');
    });

    await expect(wrapped()).rejects.toThrow('process.exit(1)');
    const output = errorOutput.join('\n');
    expect(output).toContain('Bad input');
    expect(output).toContain('VALIDATION_ERROR');
  });

  test('catches API quota errors with helpful message', async () => {
    const wrapped = wrapAction(async () => {
      throw new Error('Request failed: insufficient quota');
    });

    await expect(wrapped()).rejects.toThrow('process.exit(1)');
    const output = errorOutput.join('\n');
    expect(output).toContain('quota exceeded');
  });

  test('catches 401 errors with API key hint', async () => {
    const wrapped = wrapAction(async () => {
      throw new Error('Request failed with status 401');
    });

    await expect(wrapped()).rejects.toThrow('process.exit(1)');
    const output = errorOutput.join('\n');
    expect(output).toContain('Invalid API key');
  });

  test('catches unknown errors with generic message', async () => {
    const wrapped = wrapAction(async () => {
      throw new Error('Something totally unexpected');
    });

    await expect(wrapped()).rejects.toThrow('process.exit(1)');
    const output = errorOutput.join('\n');
    expect(output).toContain('Unexpected error');
    expect(output).toContain('Something totally unexpected');
  });

  test('handles non-Error throws', async () => {
    const wrapped = wrapAction(async () => {
      throw 'string error';
    });

    await expect(wrapped()).rejects.toThrow('process.exit(1)');
    const output = errorOutput.join('\n');
    expect(output).toContain('string error');
  });
});
