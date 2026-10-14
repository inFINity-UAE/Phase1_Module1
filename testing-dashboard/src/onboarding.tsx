import { useMemo, useState, type ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { ACCOUNTS } from './data';
import { Badge, Button, Card, CardHeader, cx, inputCls } from './ui';

const SESSION_KEY = 'infinity.onboarding.v1';

export type OnboardingSession = {
  email: string;
  fullName: string;
  legalName: string;
  trn: string | null;
  emirate: UaeEmirate | null;
  fiscalYearStartMonth: number;
};

const EMIRATES = [
  ['abu_dhabi', 'Abu Dhabi'],
  ['dubai', 'Dubai'],
  ['sharjah', 'Sharjah'],
  ['ajman', 'Ajman'],
  ['umm_al_quwain', 'Umm Al Quwain'],
  ['ras_al_khaimah', 'Ras Al Khaimah'],
  ['fujairah', 'Fujairah'],
] as const;
type UaeEmirate = (typeof EMIRATES)[number][0];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const CURRENCIES = ['AED', 'USD', 'EUR', 'GBP'] as const;
const CATEGORY = ['asset', 'liability', 'equity', 'income', 'expense'] as const;
type Category = (typeof CATEGORY)[number];

const categoryOf = (code: string): Category => CATEGORY[Number(code[0]) - 1];

const COA = Object.entries(ACCOUNTS)
  .map(([code, name]) => ({ code, name, category: categoryOf(code), system: code === '3100' }))
  .sort((a, b) => a.code.localeCompare(b.code));

const INCOME_ACCOUNTS = COA.filter((a) => a.category === 'income');

const BINDINGS = [
  ['Trade receivables (Modules C and D)', '1100', 'Accounts Receivable - Trade', 'asset'],
  ['Trade payables (Module E)', '2000', 'Accounts Payable - Trade', 'liability'],
  ['Year-end close (create_year_end_closing_entry)', '3100', 'Retained Earnings', 'equity'],
  ['Sales discounts given', '4060', 'Sales Discounts Given', 'income'],
  ['Input VAT', '1400', 'VAT Receivable (Input VAT)', 'asset'],
  ['Output VAT', '2200', 'VAT Payable (Output VAT)', 'liability'],
] as const;

type CustomerDraft = {
  customer_name: string;
  trn: string;
  email: string;
  phone: string;
  billing_address: string;
  credit_limit: string;
};

const emptyCustomer = (): CustomerDraft => ({
  customer_name: '', email: '', phone: '', trn: '', billing_address: '', credit_limit: '',
});

type Draft = {
  fullName: string;
  email: string;
  password: string;
  phone: string;
  legal_name: string;
  trn: string;
  base_currency: (typeof CURRENCIES)[number];
  is_free_zone_entity: boolean;
  fiscal_year_start_month: number;
  journal_approval_threshold: string;
  default_period_length: 'monthly' | 'quarterly';
  allow_period_reopen: boolean;
  write_off_approval_threshold: string;
  weekend_days: number[];
  vat_return_frequency: 'monthly' | 'quarterly';
  default_emirate: '' | UaeEmirate;
  customers: CustomerDraft[];
  item_description: string;
  item_is_service: boolean;
  income_account_id: string;
};

const initialDraft = (): Draft => ({
  fullName: '', email: '', password: '', phone: '',
  legal_name: '', trn: '', base_currency: 'AED', is_free_zone_entity: false, fiscal_year_start_month: 1,
  journal_approval_threshold: '', default_period_length: 'monthly', allow_period_reopen: true,
  write_off_approval_threshold: '5000.00', weekend_days: [6, 7], vat_return_frequency: 'quarterly', default_emirate: '',
  customers: [emptyCustomer()],
  item_description: '', item_is_service: true, income_account_id: '4000',
});

export function loadSession(): OnboardingSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as OnboardingSession) : null;
  } catch {
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function trnError(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  return /^\d{15}$/.test(v) ? null : 'TRN must be 15 digits, or left blank.';
}

function moneyOrNull(value: string): { ok: true; value: number | null } | { ok: false } {
  const v = value.trim();
  if (!v) return { ok: true, value: null };
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return { ok: false };
  return { ok: true, value: Number(v) };
}

function buildPayload(d: Draft) {
  const threshold = moneyOrNull(d.journal_approval_threshold);
  const customers = d.customers
    .filter((c) => c.customer_name.trim() || c.trn.trim() || c.email.trim() || c.phone.trim() || c.billing_address.trim() || c.credit_limit.trim())
    .map((c) => {
      const limit = moneyOrNull(c.credit_limit);
      return {
        customer_name: c.customer_name.trim(),
        trn: c.trn.trim() || null,
        email: c.email.trim() || null,
        phone: c.phone.trim() || null,
        billing_address: c.billing_address.trim() || null,
        credit_limit: limit.ok ? limit.value : null,
        is_active: true,
      };
    });
  return {
    auth_users: {
      email: d.email.trim(),
      password: '[redacted]',
      user_metadata: { full_name: d.fullName.trim(), phone: d.phone.trim() },
    },
    company_members: { user_id: '<auth.users.id>', company_id: '<companies.id>', role: 'owner' as const },
    companies: {
      legal_name: d.legal_name.trim(),
      trn: d.trn.trim() || null,
      base_currency: d.base_currency,
      is_free_zone_entity: d.is_free_zone_entity,
      fiscal_year_start_month: d.fiscal_year_start_month,
    },
    company_settings: {
      company_id: '<companies.id>',
      journal_approval_threshold: threshold.ok ? threshold.value : null,
      approval_threshold_currency: 'AED',
      default_period_length: d.default_period_length,
      allow_period_reopen: d.allow_period_reopen,
      default_bank_account_id: null,
      write_off_approval_threshold: Number(d.write_off_approval_threshold),
      weekend_days: d.weekend_days,
      three_way_match_qty_tolerance_pct: 0,
      three_way_match_price_tolerance_pct: 2,
      fta_api_enabled: false,
      vat_return_frequency: d.vat_return_frequency,
      default_emirate: d.default_emirate || null,
    },
    accounts: 'clone of the finalized chart for this company_id',
    customers,
    invoice_line_default: d.item_description.trim()
      ? { description: d.item_description.trim(), is_service: d.item_is_service, income_account_id: d.income_account_id }
      : null,
    session: "set app.current_company_id to the new companies.id before tenant queries",
  };
}

function problems(d: Draft): string[] {
  const out: string[] = [];
  if (!d.fullName.trim()) out.push('Full name is required.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) out.push('Email is required.');
  if (d.password.length < 6) out.push('Password must be at least 6 characters.');
  if (!d.phone.trim()) out.push('Phone number is required.');
  if (!d.legal_name.trim()) out.push('Legal name is required.');
  const trn = trnError(d.trn);
  if (trn) out.push(`Company ${trn}`);
  if (d.fiscal_year_start_month < 1 || d.fiscal_year_start_month > 12) out.push('Fiscal year start month must be 1 to 12.');
  if (!moneyOrNull(d.journal_approval_threshold).ok) out.push('Journal approval threshold must be blank or a non-negative amount.');
  const writeOff = moneyOrNull(d.write_off_approval_threshold);
  if (!writeOff.ok || writeOff.value == null) out.push('Write-off approval threshold is required.');
  if (d.vat_return_frequency !== 'monthly' && d.vat_return_frequency !== 'quarterly') out.push('VAT return frequency must be monthly or quarterly.');
  const seen = new Set<string>();
  d.customers.forEach((c, i) => {
    const used = c.customer_name.trim() || c.trn.trim() || c.email.trim() || c.phone.trim() || c.billing_address.trim() || c.credit_limit.trim();
    if (!used) return;
    if (!c.customer_name.trim()) out.push(`Customer ${i + 1}: customer_name is required.`);
    const ct = trnError(c.trn);
    if (ct) out.push(`Customer ${i + 1}: ${ct}`);
    const key = c.trn.trim();
    if (key && seen.has(key)) out.push(`Customer ${i + 1}: TRN is already used in this company.`);
    if (key) seen.add(key);
    if (!moneyOrNull(c.credit_limit).ok) out.push(`Customer ${i + 1}: credit limit must be blank or a non-negative amount.`);
  });
  if (d.item_description.trim() && !INCOME_ACCOUNTS.some((a) => a.code === d.income_account_id)) {
    out.push('Catalog income account must be an income account (4xxx).');
  }
  return out;
}

const STEPS = ['Account', 'Company', 'Settings', 'Chart', 'Bindings', 'Masters', 'Review'] as const;

function Err({ children }: { children: string }) {
  return <p className="mt-1 text-xs text-rose-600">{children}</p>;
}

function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex items-center gap-3 text-left">
      <span className={cx('relative h-6 w-11 rounded-full transition-colors', on ? 'bg-brand-700' : 'bg-slate-300')}>
        <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', on ? 'left-5' : 'left-0.5')} />
      </span>
      <span className="text-sm text-slate-700">{label}</span>
    </button>
  );
}

export function Onboarding({ onReady }: { onReady: (s: OnboardingSession) => void }) {
  const [mode, setMode] = useState<'signup' | 'login'>('signup');
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const issues = useMemo(() => problems(draft), [draft]);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  function enterExisting() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginEmail.trim()) || loginPassword.length < 6) {
      setLoginError('Use the email and a password of at least 6 characters for this workspace.');
      return;
    }
    const session: OnboardingSession = {
      email: loginEmail.trim(), fullName: loginEmail.trim(), legalName: 'Horizon Facilities LLC',
      trn: '100234567800003', emirate: 'dubai', fiscalYearStartMonth: 1,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    onReady(session);
  }

  function finish() {
    const found = problems(draft);
    if (found.length) { setShowErrors(true); setStep(6); return; }
    const session: OnboardingSession = {
      email: draft.email.trim(),
      fullName: draft.fullName.trim(),
      legalName: draft.legal_name.trim(),
      trn: draft.trn.trim() || null,
      emirate: draft.default_emirate || null,
      fiscalYearStartMonth: draft.fiscal_year_start_month,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    onReady(session);
  }

  const companyTrn = trnError(draft.trn);

  return (
    <div className="min-h-full bg-[#f6f8fb]">
      <header className="flex h-14 items-center gap-3 bg-brand-900 px-4 sm:px-8">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-sm font-bold text-white">∞</span>
        <span className="text-lg font-semibold tracking-tight text-white">in<span className="text-brand-200">FIN</span>ity</span>
        <span className="ml-2 text-sm text-brand-200">Workspace setup</span>
      </header>
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[200px_1fr] lg:px-8 lg:py-12">
        <ol className="flex gap-2 overflow-x-auto lg:flex-col lg:gap-1">
          {STEPS.map((label, i) => (
            <li key={label}>
              <button
                type="button"
                onClick={() => mode === 'signup' && setStep(i)}
                className={cx('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm', step === i && mode === 'signup' ? 'bg-white font-medium text-brand-800 shadow-sm' : 'text-slate-500 hover:bg-white/70')}
              >
                <span className={cx('flex h-6 w-6 items-center justify-center rounded-full text-xs', step === i && mode === 'signup' ? 'bg-brand-700 text-white' : 'bg-slate-200 text-slate-600')}>{i + 1}</span>
                {label}
              </button>
            </li>
          ))}
        </ol>

        <div className="space-y-6">
          {mode === 'login' ? (
            <Card>
              <CardHeader title="Sign in" subtitle="Returning member. This desk does not call Supabase Auth." />
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                <label className="text-xs font-medium text-slate-600">Email
                  <input className={cx(inputCls, 'mt-1')} value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} autoComplete="username" />
                </label>
                <label className="text-xs font-medium text-slate-600">Password
                  <input type="password" className={cx(inputCls, 'mt-1')} value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} autoComplete="current-password" />
                </label>
                {loginError ? <Err>{loginError}</Err> : null}
              </div>
              <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4">
                <button type="button" className="text-sm text-brand-700" onClick={() => setMode('signup')}>Create a workspace</button>
                <Button variant="primary" onClick={enterExisting}>Enter workspace</Button>
              </div>
            </Card>
          ) : null}

          {mode === 'signup' && step === 0 ? (
            <Card>
              <CardHeader title="Account" subtitle="Stored as auth.users. Phone and full name sit in user metadata. company_members.role is owner." />
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                <label className="text-xs font-medium text-slate-600">Full name
                  <input className={cx(inputCls, 'mt-1')} value={draft.fullName} onChange={(e) => set('fullName', e.target.value)} />
                </label>
                <label className="text-xs font-medium text-slate-600">Email
                  <input className={cx(inputCls, 'mt-1')} value={draft.email} onChange={(e) => set('email', e.target.value)} autoComplete="email" />
                </label>
                <label className="text-xs font-medium text-slate-600">Password
                  <input type="password" className={cx(inputCls, 'mt-1')} value={draft.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
                </label>
                <label className="text-xs font-medium text-slate-600">Phone number
                  <input className={cx(inputCls, 'mt-1')} value={draft.phone} onChange={(e) => set('phone', e.target.value)} />
                </label>
              </div>
              <Footer>
                <button type="button" className="text-sm text-brand-700" onClick={() => setMode('login')}>I already have a workspace</button>
                <Button variant="primary" onClick={() => setStep(1)}>Continue</Button>
              </Footer>
            </Card>
          ) : null}

          {mode === 'signup' && step === 1 ? (
            <Card>
              <CardHeader title="Company" subtitle="companies. legal_name is required. trn is optional." />
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                <label className="text-xs font-medium text-slate-600 sm:col-span-2">Legal name
                  <input className={cx(inputCls, 'mt-1')} value={draft.legal_name} onChange={(e) => set('legal_name', e.target.value)} />
                </label>
                <label className="text-xs font-medium text-slate-600">TRN
                  <input inputMode="numeric" className={cx(inputCls, 'mt-1')} value={draft.trn} onChange={(e) => set('trn', e.target.value)} placeholder="15 digits" />
                  {companyTrn ? <Err>{companyTrn}</Err> : null}
                </label>
                <label className="text-xs font-medium text-slate-600">Base currency
                  <select className={cx(inputCls, 'mt-1')} value={draft.base_currency} onChange={(e) => set('base_currency', e.target.value as Draft['base_currency'])}>
                    {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </label>
                <label className="text-xs font-medium text-slate-600">Fiscal year starts
                  <select className={cx(inputCls, 'mt-1')} value={draft.fiscal_year_start_month} onChange={(e) => set('fiscal_year_start_month', Number(e.target.value))}>
                    {MONTHS.map((m, i) => <option key={m} value={i + 1}>{i + 1} — {m}</option>)}
                  </select>
                </label>
                <div className="flex items-end pb-1">
                  <Toggle on={draft.is_free_zone_entity} onChange={(v) => set('is_free_zone_entity', v)} label="Free zone entity" />
                </div>
              </div>
              <Footer>
                <Button onClick={() => setStep(0)}>Back</Button>
                <Button variant="primary" onClick={() => setStep(2)}>Continue</Button>
              </Footer>
            </Card>
          ) : null}

          {mode === 'signup' && step === 2 ? (
            <Card>
              <CardHeader title="Company settings" subtitle="One company_settings row per company. Blank journal threshold means approval is off." />
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                <label className="text-xs font-medium text-slate-600">Journal approval threshold (AED)
                  <input className={cx(inputCls, 'mt-1')} value={draft.journal_approval_threshold} onChange={(e) => set('journal_approval_threshold', e.target.value)} placeholder="Blank = null" />
                </label>
                <label className="text-xs font-medium text-slate-600">Write-off approval threshold (AED)
                  <input className={cx(inputCls, 'mt-1')} value={draft.write_off_approval_threshold} onChange={(e) => set('write_off_approval_threshold', e.target.value)} />
                </label>
                <label className="text-xs font-medium text-slate-600">Period length
                  <select className={cx(inputCls, 'mt-1')} value={draft.default_period_length} onChange={(e) => set('default_period_length', e.target.value as Draft['default_period_length'])}>
                    <option value="monthly">monthly</option>
                    <option value="quarterly">quarterly</option>
                  </select>
                </label>
                <label className="text-xs font-medium text-slate-600">VAT return frequency
                  <select className={cx(inputCls, 'mt-1')} value={draft.vat_return_frequency} onChange={(e) => set('vat_return_frequency', e.target.value as Draft['vat_return_frequency'])}>
                    <option value="quarterly">quarterly</option>
                    <option value="monthly">monthly</option>
                  </select>
                </label>
                <label className="text-xs font-medium text-slate-600">Default emirate
                  <select className={cx(inputCls, 'mt-1')} value={draft.default_emirate} onChange={(e) => set('default_emirate', e.target.value as Draft['default_emirate'])}>
                    <option value="">Not set</option>
                    {EMIRATES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <div className="flex items-end pb-1">
                  <Toggle on={draft.allow_period_reopen} onChange={(v) => set('allow_period_reopen', v)} label="Allow period reopen" />
                </div>
                <p className="text-xs text-slate-500 sm:col-span-2">Weekend days are Saturday and Sunday (ISO 6 and 7). The default bank account stays empty until account 1020 exists. Match tolerances stay at 0% quantity and 2% price. FTA API stays off.</p>
              </div>
              <Footer>
                <Button onClick={() => setStep(1)}>Back</Button>
                <Button variant="primary" onClick={() => setStep(3)}>Continue</Button>
              </Footer>
            </Card>
          ) : null}

          {mode === 'signup' && step === 3 ? (
            <Card>
              <CardHeader title="Chart of accounts" subtitle="Leading digit must match account_category. 3100 is a system account." />
              <div className="max-h-[480px] overflow-auto">
                <table className="w-full">
                  <thead className="sticky top-0 bg-white">
                    <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      <th className="px-5 py-2">Code</th>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Category</th>
                      <th className="px-5 py-2"> </th>
                    </tr>
                  </thead>
                  <tbody>
                    {COA.map((a) => (
                      <tr key={a.code} className="border-t border-slate-100">
                        <td className="num px-5 py-2 text-sm text-slate-800">{a.code}</td>
                        <td className="px-3 py-2 text-sm text-slate-700">{a.name}</td>
                        <td className="px-3 py-2"><Badge tone={a.category === 'asset' ? 'blue' : a.category === 'liability' ? 'amber' : a.category === 'equity' ? 'violet' : a.category === 'income' ? 'green' : 'slate'}>{a.category}</Badge></td>
                        <td className="px-5 py-2">{a.system ? <span className="inline-flex items-center gap-1 text-xs text-slate-500"><Lock size={12} /> System</span> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Footer>
                <Button onClick={() => setStep(2)}>Back</Button>
                <Button variant="primary" onClick={() => setStep(4)}>Continue</Button>
              </Footer>
            </Card>
          ) : null}

          {mode === 'signup' && step === 4 ? (
            <Card>
              <CardHeader title="Engine bindings" subtitle="These codes are on the finalized chart. They are not chosen during setup." />
              <ul className="divide-y divide-slate-100">
                {BINDINGS.map(([use, code, name, category]) => (
                  <li key={code} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <span className="text-sm text-slate-600">{use}</span>
                    <span className="text-sm font-medium text-slate-900"><span className="num">{code}</span> {name} <Badge tone="slate">{category}</Badge></span>
                  </li>
                ))}
              </ul>
              <Footer>
                <Button onClick={() => setStep(3)}>Back</Button>
                <Button variant="primary" onClick={() => setStep(5)}>Continue</Button>
              </Footer>
            </Card>
          ) : null}

          {mode === 'signup' && step === 5 ? (
            <Card>
              <CardHeader title="Customers and catalog" subtitle="customers rows. A catalog line is an invoice-line default, not its own table." />
              <div className="space-y-6 p-5">
                {draft.customers.map((c, i) => (
                  <div key={i} className="grid gap-4 rounded-lg border border-slate-100 p-4 sm:grid-cols-2">
                    <label className="text-xs font-medium text-slate-600 sm:col-span-2">Customer name
                      <input className={cx(inputCls, 'mt-1')} value={c.customer_name} onChange={(e) => set('customers', draft.customers.map((row, j) => j === i ? { ...row, customer_name: e.target.value } : row))} />
                    </label>
                    <label className="text-xs font-medium text-slate-600">TRN
                      <input className={cx(inputCls, 'mt-1')} value={c.trn} onChange={(e) => set('customers', draft.customers.map((row, j) => j === i ? { ...row, trn: e.target.value } : row))} />
                    </label>
                    <label className="text-xs font-medium text-slate-600">Credit limit
                      <input className={cx(inputCls, 'mt-1')} value={c.credit_limit} onChange={(e) => set('customers', draft.customers.map((row, j) => j === i ? { ...row, credit_limit: e.target.value } : row))} placeholder="Blank = no limit" />
                    </label>
                    <label className="text-xs font-medium text-slate-600">Email
                      <input className={cx(inputCls, 'mt-1')} value={c.email} onChange={(e) => set('customers', draft.customers.map((row, j) => j === i ? { ...row, email: e.target.value } : row))} />
                    </label>
                    <label className="text-xs font-medium text-slate-600">Phone
                      <input className={cx(inputCls, 'mt-1')} value={c.phone} onChange={(e) => set('customers', draft.customers.map((row, j) => j === i ? { ...row, phone: e.target.value } : row))} />
                    </label>
                    <label className="text-xs font-medium text-slate-600 sm:col-span-2">Billing address
                      <input className={cx(inputCls, 'mt-1')} value={c.billing_address} onChange={(e) => set('customers', draft.customers.map((row, j) => j === i ? { ...row, billing_address: e.target.value } : row))} />
                    </label>
                  </div>
                ))}
                <Button onClick={() => set('customers', [...draft.customers, emptyCustomer()])}>Add another customer</Button>
                <div className="grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
                  <label className="text-xs font-medium text-slate-600 sm:col-span-2">Catalog description
                    <input className={cx(inputCls, 'mt-1')} value={draft.item_description} onChange={(e) => set('item_description', e.target.value)} placeholder="Optional service or goods line" />
                  </label>
                  <div className="flex items-end pb-1">
                    <Toggle on={draft.item_is_service} onChange={(v) => set('item_is_service', v)} label="Service (invoice line is_service)" />
                  </div>
                  <label className="text-xs font-medium text-slate-600">Income account
                    <select className={cx(inputCls, 'mt-1')} value={draft.income_account_id} onChange={(e) => set('income_account_id', e.target.value)}>
                      {INCOME_ACCOUNTS.map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
                    </select>
                  </label>
                </div>
              </div>
              <Footer>
                <Button onClick={() => setStep(4)}>Back</Button>
                <Button variant="primary" onClick={() => setStep(6)}>Review</Button>
              </Footer>
            </Card>
          ) : null}

          {mode === 'signup' && step === 6 ? (
            <Card>
              <CardHeader title="Review" subtitle="Insert shapes for companies, company_settings, company_members, and customers. The chart is cloned, not typed in here." />
              <div className="space-y-4 p-5">
                {showErrors && issues.length ? (
                  <ul className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {issues.map((issue) => <li key={issue}>{issue}</li>)}
                  </ul>
                ) : null}
                <pre className="overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-relaxed text-slate-100">{JSON.stringify(buildPayload(draft), null, 2)}</pre>
                <p className="text-xs text-slate-500">There is no company-onboarding route in the API. Completing setup stores this session in the browser and opens the workspace. It does not insert rows.</p>
              </div>
              <Footer>
                <Button onClick={() => setStep(5)}>Back</Button>
                <Button variant="success" onClick={finish}>Open workspace</Button>
              </Footer>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Footer({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4">{children}</div>;
}
