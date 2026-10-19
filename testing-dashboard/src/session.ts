export type Membership = {
  company_id: string;
  legal_name: string;
  role: string;
};

type Emirate = 'abu_dhabi' | 'dubai' | 'sharjah' | 'ajman' | 'umm_al_quwain' | 'ras_al_khaimah' | 'fujairah';

export type DemoSession = {
  mode: 'demo';
  email: string;
  fullName: string;
  legalName: string;
  trn: string | null;
  emirate: Emirate | null;
  fiscalYearStartMonth: number;
};

export type LiveSession = {
  mode: 'live';
  fullName: string;
  phone: string;
  companyId: string;
  legalName: string;
  role: string;
  memberships: Membership[];
};

export type WorkspaceSession = DemoSession | LiveSession;

const DEMO_KEY = 'infinity.demo.v1';
const DRAFT_KEY = 'infinity.signup.draft.v1';
const COMPANY_KEY = 'infinity.company.v1';
const LEGACY_KEY = 'infinity.onboarding.v1';

/** Same company the old sign-in opened: Horizon Facilities LLC. */
export const SAMPLE_SESSION: DemoSession = {
  mode: 'demo',
  email: 'owner@horizonfacilities.example',
  fullName: 'Sample owner',
  legalName: 'Horizon Facilities LLC',
  trn: '100234567800003',
  emirate: 'dubai',
  fiscalYearStartMonth: 1,
};

export function loadDemo(): DemoSession | null {
  localStorage.removeItem(LEGACY_KEY);
  try {
    const raw = localStorage.getItem(DEMO_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DemoSession;
    return parsed?.mode === 'demo' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveDemo(session: DemoSession) {
  localStorage.setItem(DEMO_KEY, JSON.stringify(session));
}

export function clearDemo() {
  localStorage.removeItem(DEMO_KEY);
}

export function loadDraft<T>(): T | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function saveDraft(draft: unknown) {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

export function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
}

export function loadPreferredCompany(): string | null {
  return localStorage.getItem(COMPANY_KEY);
}

export function savePreferredCompany(companyId: string) {
  localStorage.setItem(COMPANY_KEY, companyId);
}

if (import.meta.env.DEV && SAMPLE_SESSION.legalName !== 'Horizon Facilities LLC') {
  throw new Error('Sample sign-in must open Horizon Facilities LLC');
}
