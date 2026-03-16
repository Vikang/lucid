import { describe, test, expect } from 'bun:test';
import { LucidError, ApiKeyError, ProviderError, ValidationError } from '../src/utils/errors';

describe('LucidError', () => {
  test('has correct name and code', () => {
    const err = new LucidError('test message', 'TEST_CODE');
    expect(err.name).toBe('LucidError');
    expect(err.code).toBe('TEST_CODE');
    expect(err.message).toBe('test message');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(LucidError);
  });
});

describe('ApiKeyError', () => {
  test('has correct name and code', () => {
    const err = new ApiKeyError('missing key');
    expect(err.name).toBe('ApiKeyError');
    expect(err.code).toBe('API_KEY_ERROR');
    expect(err.message).toBe('missing key');
    expect(err).toBeInstanceOf(LucidError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('ProviderError', () => {
  test('has correct name and code', () => {
    const err = new ProviderError('bad provider');
    expect(err.name).toBe('ProviderError');
    expect(err.code).toBe('PROVIDER_ERROR');
    expect(err.message).toBe('bad provider');
    expect(err).toBeInstanceOf(LucidError);
  });
});

describe('ValidationError', () => {
  test('has correct name and code', () => {
    const err = new ValidationError('bad input');
    expect(err.name).toBe('ValidationError');
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toBe('bad input');
    expect(err).toBeInstanceOf(LucidError);
  });
});
