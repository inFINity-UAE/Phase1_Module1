import { useState, type FormEvent } from 'react';
import { copy } from './copy';
import { BrandMark } from './BrandMark';
import { Link } from '../router';
import { fetchMe, type MeResponse } from '../api';
import { getSupabase } from '../supabase';
import { savePreferredCompany } from '../session';
import { cx, inputCls } from '../ui';

const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50';

export function LoginPage({ onSignedIn, onSample }: { onSignedIn: (me: MeResponse) => void; onSample: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<MeResponse | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || password.length < 6) {
      setError(copy.login.error);
      return;
    }
    const supabase = getSupabase();
    if (!supabase) {
      setError('Sign-in is not configured on this desk.');
      return;
    }
    setBusy(true);
    setError('');
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signInError) {
      setBusy(false);
      setError('Email or password is wrong.');
      return;
    }
    try {
      const me = await fetchMe();
      if (me.memberships.length > 1) {
        setChoices(me);
        setBusy(false);
        return;
      }
      onSignedIn(me);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'Could not open the workspace.');
    }
  }

  return (
    <div className="flex min-h-full flex-col bg-[#f6f8fb]">
      <div className="px-4 pt-6 sm:px-8">
        <Link href="/" className={cx('text-sm text-brand-700', focus)}>{copy.login.back}</Link>
      </div>
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-6 flex justify-center"><BrandMark /></div>
          {choices ? (
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <h1 className="text-xl font-semibold text-slate-900">Choose a workspace</h1>
              <ul className="mt-4 space-y-2">
                {choices.memberships.map((m) => (
                  <li key={m.company_id}>
                    <button type="button" onClick={() => { savePreferredCompany(m.company_id); onSignedIn(choices); }} className={cx('h-11 w-full rounded-md border border-slate-300 text-sm font-medium text-slate-800 hover:bg-slate-50', focus)}>
                      {m.legal_name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]" noValidate>
              <h1 className="text-xl font-semibold text-slate-900">{copy.login.title}</h1>
              <label htmlFor="login-email" className="mb-1 mt-5 block text-xs font-medium text-slate-600">{copy.login.email}</label>
              <input id="login-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} aria-invalid={!!error} />
              <label htmlFor="login-password" className="mb-1 mt-4 block text-xs font-medium text-slate-600">{copy.login.password}</label>
              <div className="relative">
                <input id="login-password" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={cx(inputCls, 'pr-16')} aria-invalid={!!error} aria-describedby={error ? 'login-error' : undefined} />
                <button type="button" onClick={() => setShow((v) => !v)} className={cx('absolute right-2 top-1/2 -translate-y-1/2 rounded px-1.5 py-1 text-xs text-slate-500', focus)}>{show ? copy.login.hide : copy.login.show}</button>
              </div>
              <div className="mt-2 text-right">
                <button type="button" disabled title={copy.login.forgotTip} className="cursor-not-allowed text-sm text-slate-400">{copy.login.forgot}</button>
              </div>
              {error ? <p id="login-error" role="alert" className="mt-3 text-sm text-rose-700">{error}</p> : null}
              <button type="submit" disabled={busy} className={cx('mt-5 h-11 w-full rounded-md bg-brand-700 text-sm font-medium text-white hover:bg-brand-800 disabled:bg-slate-300', focus)}>{busy ? 'Signing in…' : copy.login.submit}</button>
              <button type="button" onClick={onSample} className={cx('mt-3 h-11 w-full rounded-md border border-slate-300 text-sm font-medium text-slate-800 hover:bg-slate-50', focus)}>{copy.login.sample}</button>
              <p className="mt-5 text-center text-sm text-slate-600">
                <Link href="/signup" className={cx('text-brand-700', focus)}>{copy.login.signup}</Link>
              </p>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
