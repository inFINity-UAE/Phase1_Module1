import { getSupabase } from './supabase';
import type { Membership } from './session';

export type MeResponse = {
  full_name: string;
  phone: string;
  memberships: Membership[];
};

function apiBase() {
  const configured = import.meta.env.VITE_API_URL as string | undefined;
  if (configured) return configured.replace(/\/$/, '');
  // The deployed site calls its own /api. Local dev sets VITE_API_URL in .env.local.
  if (import.meta.env.DEV) return 'http://127.0.0.1:3000';
  return '/api';
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = 'Something went wrong. Try again.';
    try {
      const body = await response.json() as { message?: string | string[] };
      const raw = Array.isArray(body.message) ? body.message[0] : body.message;
      if (typeof raw === 'string' && raw.length > 0 && raw.length < 180) message = raw;
    } catch {
      /* keep the generic message */
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

/** Signup has no session yet. */
export async function apiFetchPublic<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBase()}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  return readJson(response);
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Sign-in is not configured on this desk.');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sign in again to continue.');
  let response: Response;
  try {
    response = await fetch(`${apiBase()}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  if (response.status === 401) {
    // Root's onAuthStateChange listener sees SIGNED_OUT and routes back to /login.
    await supabase.auth.signOut();
    throw new Error('Sign in again to continue.');
  }
  return readJson(response);
}

export function fetchMe() {
  return apiFetch<MeResponse>('/me');
}
