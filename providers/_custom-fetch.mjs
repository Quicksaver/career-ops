// Retry-aware fetch helpers for providers/_custom.mjs.

export const FETCH_TIMEOUT_MS = 10_000;
export const FETCH_MAX_ATTEMPTS = 4;
export const FETCH_RETRY_BASE_DELAY_MS = 750;
export const FETCH_RETRY_JITTER_RATIO = 0.2;

// 409 is intentionally excluded: conflicts are usually state errors that
// repeat on identical requests, unlike throttling and transient server errors.
export const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

const RETRYABLE_FETCH_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeMaxAttempts(maxAttempts) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError(`maxAttempts must be a positive integer, got ${maxAttempts}`);
  }
  return maxAttempts;
}

export function retryDelayMs(retryNumber, random = Math.random) {
  const baseDelay = FETCH_RETRY_BASE_DELAY_MS * (2 ** Math.max(0, retryNumber - 1));
  const jitter = 1 - FETCH_RETRY_JITTER_RATIO + (random() * FETCH_RETRY_JITTER_RATIO * 2);
  return Math.round(baseDelay * jitter);
}

export function isRetryableFetchError(error, { abortIsRetryable = false } = {}) {
  if (error?.status && RETRYABLE_HTTP_STATUSES.has(error.status)) return true;
  if (error?.name === 'AbortError') return abortIsRetryable;

  const errorCode = error?.cause?.code || error?.cause?.name || error?.code || error?.name;
  if (errorCode && RETRYABLE_FETCH_ERROR_CODES.has(errorCode)) return true;

  return error instanceof TypeError && /^(fetch failed|failed to fetch)$/i.test(error.message || '');
}

export async function fetchJsonWithRetry(url, {
  fetchImpl = fetch,
  sleepFn = sleep,
  randomFn = Math.random,
  timeoutMs = FETCH_TIMEOUT_MS,
  maxAttempts = FETCH_MAX_ATTEMPTS,
  buildHeaders = () => ({}),
  configureOptions = () => {},
} = {}) {
  const attempts = normalizeMaxAttempts(maxAttempts);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const baseOptions = {
        signal: controller.signal,
        headers: buildHeaders(url) || {},
      };
      const options = configureOptions(url, baseOptions) || baseOptions;

      const res = await fetchImpl(url, options);
      if (!res.ok) {
        const error = new Error(`HTTP ${res.status}`);
        error.status = res.status;
        throw error;
      }

      return await res.json();
    } catch (error) {
      clearTimeout(timer);

      if (attempt >= attempts || !isRetryableFetchError(error, { abortIsRetryable: true })) {
        throw error;
      }

      await sleepFn(retryDelayMs(attempt, randomFn));
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error('fetchJsonWithRetry: exhausted retry attempts unexpectedly');
}
