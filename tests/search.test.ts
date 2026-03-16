import { describe, test, expect } from 'bun:test';
import { cosineSimilarity } from '../src/core/search';

describe('cosineSimilarity', () => {
  test('returns 1.0 for identical vectors', () => {
    const v = [1, 2, 3, 4, 5];
    const score = cosineSimilarity(v, v);
    expect(score).toBeCloseTo(1.0, 5);
  });

  test('returns -1.0 for opposite vectors', () => {
    const a = [1, 0, 0];
    const b = [-1, 0, 0];
    const score = cosineSimilarity(a, b);
    expect(score).toBeCloseTo(-1.0, 5);
  });

  test('returns 0.0 for orthogonal vectors', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    const score = cosineSimilarity(a, b);
    expect(score).toBeCloseTo(0.0, 5);
  });

  test('returns 0.0 for zero vectors', () => {
    const a = [0, 0, 0];
    const b = [1, 2, 3];
    const score = cosineSimilarity(a, b);
    expect(score).toBe(0);
  });

  test('handles similar vectors with high score', () => {
    const a = [1, 2, 3];
    const b = [1.1, 2.1, 3.1];
    const score = cosineSimilarity(a, b);
    expect(score).toBeGreaterThan(0.99);
  });

  test('handles dissimilar vectors with low score', () => {
    const a = [1, 0, 0, 0];
    const b = [0, 0, 0, 1];
    const score = cosineSimilarity(a, b);
    expect(score).toBeCloseTo(0.0, 5);
  });

  test('throws on dimension mismatch', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow('dimension mismatch');
  });

  test('is scale-invariant', () => {
    const a = [1, 2, 3];
    const b = [10, 20, 30];
    const score = cosineSimilarity(a, b);
    expect(score).toBeCloseTo(1.0, 5);
  });
});
