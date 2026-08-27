import {
  createJwtClockSkewRetryFetch,
  isTransientJwtClockSkewError,
  isTransientJwtClockSkewPayload,
  JWT_CLOCK_SKEW_MAX_ATTEMPTS,
  jwtClockSkewBackoffMs,
} from './supabase-jwt-clock-skew-retry';

describe('supabase JWT clock-skew retry (§5.9 / #37)', () => {
  it('detects Auth-style and PostgREST PGRST303 payloads only', () => {
    expect(isTransientJwtClockSkewPayload('JWT issued at future')).toBe(true);
    expect(
      isTransientJwtClockSkewPayload(
        JSON.stringify({ code: 'PGRST303', message: 'JWT issued at future' }),
      ),
    ).toBe(true);
    expect(
      isTransientJwtClockSkewPayload(
        JSON.stringify({ code: 'PGRST303', message: 'other' }),
      ),
    ).toBe(true);
    expect(
      isTransientJwtClockSkewPayload(
        JSON.stringify({ code: '42501', message: 'permission denied' }),
      ),
    ).toBe(false);
    expect(isTransientJwtClockSkewPayload('{"message":"User not found"}')).toBe(
      false,
    );
  });

  it('detects thrown error shapes (message or PGRST303 code)', () => {
    expect(
      isTransientJwtClockSkewError({ message: 'JWT issued at future', status: 401 }),
    ).toBe(true);
    expect(isTransientJwtClockSkewError({ code: 'PGRST303', message: 'x' })).toBe(
      true,
    );
    expect(isTransientJwtClockSkewError({ code: '42501', message: 'denied' })).toBe(
      false,
    );
    expect(isTransientJwtClockSkewError({ message: 'User not found' })).toBe(false);
  });

  it('reuses ensureAuthUser backoff: 250ms * attempt', () => {
    expect(jwtClockSkewBackoffMs(1)).toBe(250);
    expect(jwtClockSkewBackoffMs(2)).toBe(500);
    expect(jwtClockSkewBackoffMs(5)).toBe(1250);
  });

  it('retries only on skew responses then returns success', async () => {
    jest.useFakeTimers();
    const calls: number[] = [];
    const baseFetch = jest.fn(async () => {
      calls.push(calls.length + 1);
      if (calls.length < 3) {
        return new Response(
          JSON.stringify({ code: 'PGRST303', message: 'JWT issued at future' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ id: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const wrapped = createJwtClockSkewRetryFetch(baseFetch);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const pending = wrapped('https://example.test/rest/v1/companies', {
      method: 'GET',
    });
    await jest.runAllTimersAsync();
    const response = await pending;

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 'ok' });
    expect(calls).toEqual([1, 2, 3]);
    expect(warn).toHaveBeenCalledTimes(2);

    warn.mockRestore();
    jest.useRealTimers();
  });

  it('does not retry unrelated 401/403 or 4xx errors', async () => {
    const baseFetch = jest.fn(async () => {
      return new Response(JSON.stringify({ code: '42501', message: 'permission denied' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const wrapped = createJwtClockSkewRetryFetch(baseFetch);
    const response = await wrapped('https://example.test/rest/v1/companies');

    expect(response.status).toBe(401);
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });

  it('stops after max attempts and returns the last skew response', async () => {
    jest.useFakeTimers();
    const baseFetch = jest.fn(async () => {
      return new Response(JSON.stringify({ message: 'JWT issued at future' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const wrapped = createJwtClockSkewRetryFetch(baseFetch);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const pending = wrapped('https://example.test/auth/v1/admin/users/x');
    await jest.runAllTimersAsync();
    const response = await pending;

    expect(response.status).toBe(403);
    expect(baseFetch).toHaveBeenCalledTimes(JWT_CLOCK_SKEW_MAX_ATTEMPTS);
    expect(warn).toHaveBeenCalledTimes(JWT_CLOCK_SKEW_MAX_ATTEMPTS - 1);

    warn.mockRestore();
    jest.useRealTimers();
  });
});
