import { useEffect, useState } from 'react';
import { App } from './App';
import { Onboarding } from './onboarding';
import { LandingPage, openSample } from './marketing/LandingPage';
import { LoginPage } from './marketing/LoginPage';
import { PlaceholderPage } from './marketing/PlaceholderPage';
import { copy } from './marketing/copy';
import { navigate, usePath } from './router';
import { fetchMe } from './api';
import { getSupabase } from './supabase';
import {
  clearDemo,
  clearDraft,
  loadDemo,
  loadPreferredCompany,
  savePreferredCompany,
  type DemoSession,
  type LiveSession,
  type Membership,
  type WorkspaceSession,
} from './session';

function titleFor(path: string) {
  if (path === '/login') return 'Log in — inFINity';
  if (path === '/signup') return 'Create your workspace — inFINity';
  if (path.startsWith('/app')) return 'Workspace — inFINity';
  if (path === '/privacy') return 'Privacy — inFINity';
  if (path === '/terms') return 'Terms — inFINity';
  return copy.meta.title;
}

function liveFrom(memberships: Membership[], fullName: string, phone: string): LiveSession {
  const preferred = loadPreferredCompany();
  const current = memberships.find((m) => m.company_id === preferred) ?? memberships[0];
  return {
    mode: 'live',
    fullName: fullName || 'Owner',
    phone,
    companyId: current.company_id,
    legalName: current.legal_name,
    role: current.role,
    memberships,
  };
}

export function Root() {
  const path = usePath();
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<WorkspaceSession | null>(null);
  const [needsCompany, setNeedsCompany] = useState(false);

  useEffect(() => {
    document.title = titleFor(path);
  }, [path]);

  useEffect(() => {
    let cancelled = false;
    const demo = loadDemo();
    if (demo) {
      setSession(demo);
      setNeedsCompany(false);
      setReady(true);
      return;
    }
    const supabase = getSupabase();
    if (!supabase) {
      setReady(true);
      return;
    }
    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      if (!data.session) {
        setSession(null);
        setNeedsCompany(false);
        setReady(true);
        return;
      }
      try {
        const me = await fetchMe();
        if (cancelled) return;
        if (me.memberships.length === 0) {
          setSession(null);
          setNeedsCompany(true);
        } else {
          setNeedsCompany(false);
          setSession(liveFrom(me.memberships, me.full_name, me.phone));
        }
      } catch {
        if (!cancelled) {
          setSession(null);
          setNeedsCompany(false);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const signedIn = !!session || needsCompany;
    if (path.startsWith('/app') && !session) navigate(needsCompany ? '/signup' : '/login', true);
    if (path === '/login' && session) navigate('/app', true);
    if (path === '/login' && needsCompany) navigate('/signup', true);
    if (!signedIn && path.startsWith('/app')) navigate('/login', true);
  }, [path, session, needsCompany, ready]);

  const enterDemo = (next: DemoSession) => {
    setNeedsCompany(false);
    setSession(next);
    navigate('/app');
  };
  const enterLive = (next: LiveSession) => {
    savePreferredCompany(next.companyId);
    clearDraft();
    setNeedsCompany(false);
    setSession(next);
    navigate('/app');
  };
  const sample = () => openSample(enterDemo);
  const leave = async () => {
    clearDemo();
    if (session?.mode === 'live') {
      await getSupabase()?.auth.signOut();
    }
    setSession(null);
    setNeedsCompany(false);
    navigate('/');
  };

  if (!ready) {
    return <div className="flex h-full items-center justify-center bg-[#f6f8fb] text-sm text-slate-500" aria-busy="true">Loading</div>;
  }

  if (path.startsWith('/app')) {
    if (!session) return null;
    return (
      <App
        session={session}
        onLogout={leave}
        onSwitchCompany={(companyId) => {
          if (session.mode !== 'live') return;
          const next = session.memberships.find((m) => m.company_id === companyId);
          if (!next) return;
          savePreferredCompany(companyId);
          setSession({ ...session, companyId, legalName: next.legal_name, role: next.role });
        }}
      />
    );
  }
  if (path === '/login') {
    if (session || needsCompany) return null;
    return (
      <LoginPage
        onSample={sample}
        onSignedIn={(me) => {
          if (me.memberships.length === 0) {
            setNeedsCompany(true);
            navigate('/signup');
            return;
          }
          enterLive(liveFrom(me.memberships, me.full_name, me.phone));
        }}
      />
    );
  }
  if (path === '/signup') {
    if (session?.mode === 'live' || session?.mode === 'demo') {
      return (
        <div className="flex min-h-full items-center justify-center bg-[#f6f8fb] px-4">
          <button type="button" onClick={() => navigate('/app')} className="h-11 rounded-md bg-brand-700 px-5 text-sm font-medium text-white">{copy.openWorkspace}</button>
        </div>
      );
    }
    return <Onboarding onReady={enterLive} />;
  }
  if (path === '/privacy') return <PlaceholderPage title={copy.legal.privacyTitle} authed={!!session} />;
  if (path === '/terms') return <PlaceholderPage title={copy.legal.termsTitle} authed={!!session} />;
  return <LandingPage authed={!!session} onSample={sample} />;
}
