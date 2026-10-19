import { getSupabase } from './supabase';
import type { Membership } from './session';

export type MeResponse = {
  full_name: string;
  phone: string;
  memberships: Membership[];
};

function apiBase() {
  return import.meta.env.VITE_API_URL || 'http://127.0.0.1:3000';
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Sign-in is not configured on this desk.');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sign in again to continue.');
  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
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

export function fetchMe() {
  return apiFetch<MeResponse>('/me');
}
