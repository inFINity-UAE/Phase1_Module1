/**
 * [feature-spec.md §5.9 / decision #37] Opaque `sb_secret_…` keys cause the
 * hosted API Gateway to mint a short-lived JWT (iat ≈ now) per request. When
 * that issuer clock is briefly ahead of GoTrue/PostgREST, the validator
 * rejects with "JWT issued at future" (PostgREST code PGRST303).
 *
 * Retry at the fetch layer so every call through the secret-key client —
 * Auth Admin, PostgREST, and any future path — inherits the same narrow
 * transient handling without per-call-site wrappers.
 */

export const JWT_CLOCK_SKEW_MAX_ATTEMPTS = 5;

/** Same backoff as the former ensureAuthUser helper: 250ms * attempt. */
export function jwtClockSkewBackoffMs(attempt: number): number {
  return 250 * attempt;
}

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error ?? '');
}

/**
 * Detect the specific gateway/validator clock-skew failure — not a general
 * auth/network retry. Matches AuthApiError messages and PostgREST PGRST303.
 */
export function isTransientJwtClockSkewError(error: unknown): boolean {
  if (/JWT issued at future/i.test(errorMessage(error))) {
    return true;
  }
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String((error as { code: unknown }).code) === 'PGRST303';
  }
  return false;
}

/** Body/text detector used by the fetch wrapper (HTTP layer). */
export function isTransientJwtClockSkewPayload(text: string): boolean {
  if (/JWT issued at future/i.test(text)) {
    return true;
  }
  try {
    const json = JSON.parse(text) as {
      code?: unknown;
      message?: unknown;
      msg?: unknown;
    };
    if (json.code === 'PGRST303') {
      return true;
    }
    const msg = String(json.message ?? json.msg ?? '');
    return /JWT issued at future/i.test(msg);
  } catch {
    return false;
  }
}

async function responseIsTransientJwtClockSkew(
  response: Response,
): Promise<boolean> {
  if (response.ok) {
    return false;
  }
  try {
    const text = await response.clone().text();
    return isTransientJwtClockSkewPayload(text);
  } catch {
    return false;
  }
}

/**
 * Wrap `fetch` so secret-key client traffic retries only on the §5.9 skew
 * signature. Pass into `createClient(url, key, { global: { fetch } })`.
 */
export function createJwtClockSkewRetryFetch(
  baseFetch: typeof fetch = globalThis.fetch.bind(globalThis),
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let lastResponse: Response | undefined;

    for (let attempt = 1; attempt <= JWT_CLOCK_SKEW_MAX_ATTEMPTS; attempt += 1) {
      // Clone Request each attempt so body streams remain readable on retry.
      const requestInput =
        typeof input === 'string' || input instanceof URL ? input : input.clone();

      const response = await baseFetch(requestInput, init);

      if (
        !(await responseIsTransientJwtClockSkew(response)) ||
        attempt === JWT_CLOCK_SKEW_MAX_ATTEMPTS
      ) {
        return response;
      }

      lastResponse = response;
      const delayMs = jwtClockSkewBackoffMs(attempt);
      // eslint-disable-next-line no-console
      console.warn(
        `[jwt-skew-retry] attempt ${attempt}/${JWT_CLOCK_SKEW_MAX_ATTEMPTS} hit transient JWT clock skew; retrying in ${delayMs}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    return lastResponse!;
  };
}
