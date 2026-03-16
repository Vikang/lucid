/**
 * Typed error classes for Lucid.
 *
 * All user-facing errors extend LucidError so CLI wrappers
 * can distinguish expected errors from unexpected crashes.
 */

export class LucidError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'LucidError';
  }
}

/** Thrown when a required API key is missing or invalid. */
export class ApiKeyError extends LucidError {
  constructor(message: string) {
    super(message, 'API_KEY_ERROR');
    this.name = 'ApiKeyError';
  }
}

/** Thrown when an unsupported provider is configured. */
export class ProviderError extends LucidError {
  constructor(message: string) {
    super(message, 'PROVIDER_ERROR');
    this.name = 'ProviderError';
  }
}

/** Thrown when input validation fails (e.g., bad LLM response). */
export class ValidationError extends LucidError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}
