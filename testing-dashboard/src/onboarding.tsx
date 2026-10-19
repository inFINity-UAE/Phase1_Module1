import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { ACCOUNTS } from './data';
import { Badge, Button, Card, CardHeader, cx, inputCls } from './ui';
import { Link } from './router';
import { BrandMark } from './marketing/BrandMark';
import { apiFetch, fetchMe } from './api';
import { getSupabase } from './supabase';
import { loadDraft, saveDraft, type LiveSession } from './session';

const UAE_PHONE = /^\+971\d{8,9}$/;
const E164 = /^\+[1-9]\d{7,14}$/;

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
  ['Money customers owe you', '1100', 'Accounts Receivable - Trade', 'asset'],
  ['Money you owe suppliers', '2000', 'Accounts Payable - Trade', 'liability'],
  ['Profit kept in the business', '3100', 'Retained Earnings', 'equity'],
  ['Discounts you give on sales', '4060', 'Sales Discounts Given', 'income'],
  ['VAT you can recover', '1400', 'VAT Receivable (Input VAT)', 'asset'],
  ['VAT you collect', '2200', 'VAT Payable (Output VAT)', 'liability'],
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
  if (!UAE_PHONE.test(d.phone.trim())) out.push('Phone must start with +971, for example +971501234567.');
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
    if (!c.customer_name.trim()) out.push(`Customer ${i + 1} needs a name.`);
    const ct = trnError(c.trn);
    if (ct) out.push(`Customer ${i + 1}: ${ct}`);
    const key = c.trn.trim();
    if (key && seen.has(key)) out.push(`Customer ${i + 1}: TRN is already used in this company.`);
    if (key) seen.add(key);
    if (c.phone.trim() && !E164.test(c.phone.trim())) out.push(`Customer ${i + 1} phone must start with + and the country code.`);
    if (!moneyOrNull(c.credit_limit).ok) out.push(`Customer ${i + 1}: credit limit must be blank or a non-negative amount.`);
  });
  if (d.item_description.trim() && !INCOME_ACCOUNTS.some((a) => a.code === d.income_account_id)) {
    out.push('Choose an income account for the catalog line.');
  }
  return out;
}

const STEPS: { label: string; purpose: string }[] = [
  { label: 'Account', purpose: 'Your login' },
  { label: 'Company', purpose: 'The business' },
  { label: 'Settings', purpose: 'Tax and periods' },
  { label: 'Chart', purpose: 'Accounts we load' },
  { label: 'Accounts', purpose: 'Where amounts go' },
  { label: 'Customers', purpose: 'People you invoice' },
  { label: 'Review', purpose: 'Check and open' },
];

const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40';

function Err({ children }: { children: string }) {
  return <p className="mt-1 text-xs text-rose-600">{children}</p>;
}

function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className={cx('flex items-center gap-3 rounded-md text-left', focus)}>
      <span className={cx('relative h-6 w-11 rounded-full transition-colors', on ? 'bg-brand-700' : 'bg-slate-300')}>
        <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', on ? 'left-5' : 'left-0.5')} />
      </span>
      <span className="text-sm text-slate-700">{label}</span>
    </button>
  );
}

export function Onboarding({ onReady }: { onReady: (s: LiveSession) => void }) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(() => {
    const saved = loadDraft<Partial<Draft>>();
    return { ...initialDraft(), ...(saved ?? {}), password: '' };
  });
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [awaitingEmail, setAwaitingEmail] = useState(false);
  const issues = useMemo(() => problems(draft), [draft]);
  const summary = useMemo(() => buildPayload(draft), [draft]);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  useEffect(() => {
    const { password: _password, ...rest } = draft;
    saveDraft(rest);
  }, [draft]);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setStep((current) => (current === 0 ? 1 : current));
    });
  }, []);

  async function continueAccount() {
    const found: string[] = [];
    if (!draft.fullName.trim()) found.push('Full name is required.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) found.push('Email is required.');
    if (draft.password.length < 6) found.push('Password must be at least 6 characters.');
    if (!UAE_PHONE.test(draft.phone.trim())) found.push('Phone must start with +971, for example +971501234567.');
    if (found.length) { setFormError(found[0]); return; }
    const supabase = getSupabase();
    if (!supabase) { setFormError('Sign-up is not configured on this desk.'); return; }
    setBusy(true);
    setFormError('');
    const { data, error } = await supabase.auth.signUp({
      email: draft.email.trim(),
      password: draft.password,
      options: { data: { full_name: draft.fullName.trim(), phone: draft.phone.trim() } },
    });
    setBusy(false);
    setDraft((d) => ({ ...d, password: '' }));
    if (error) {
      setFormError(/already|registered/i.test(error.message)
        ? 'That email is already registered. Log in instead.'
        : 'Could not create the login. Check the email and password.');
      return;
    }
    if (!data.session) { setAwaitingEmail(true); return; }
    setStep(1);
  }

  async function finish() {
    const found = problems(draft);
    if (found.length) { setShowErrors(true); setFormError(found[0]); setStep(6); return; }
    const journal = moneyOrNull(draft.journal_approval_threshold);
    const writeOff = moneyOrNull(draft.write_off_approval_threshold);
    setBusy(true);
    setFormError('');
    try {
      const created = await apiFetch<{ company_id: string; role: string }>('/onboarding/workspace', {
        method: 'POST',
        body: JSON.stringify({
          legal_name: draft.legal_name.trim(),
          trn: draft.trn.trim() || null,
          base_currency: draft.base_currency,
          is_free_zone_entity: draft.is_free_zone_entity,
          fiscal_year_start_month: draft.fiscal_year_start_month,
          journal_approval_threshold: journal.ok ? journal.value : null,
          default_period_length: draft.default_period_length,
          allow_period_reopen: draft.allow_period_reopen,
          write_off_approval_threshold: writeOff.ok ? writeOff.value : null,
          weekend_days: draft.weekend_days,
          vat_return_frequency: draft.vat_return_frequency,
          default_emirate: draft.default_emirate || null,
          customers: draft.customers.filter((c) => c.customer_name.trim()).map((c) => {
            const limit = moneyOrNull(c.credit_limit);
            return {
              customer_name: c.customer_name.trim(),
              trn: c.trn.trim() || null,
              email: c.email.trim() || null,
              phone: c.phone.trim() || null,
              billing_address: c.billing_address.trim() || null,
              credit_limit: limit.ok ? limit.value : null,
            };
          }),
        }),
      });
      const me = await fetchMe();
      const membership = me.memberships.find((m) => m.company_id === created.company_id) ?? me.memberships[0];
      onReady({
        mode: 'live',
        fullName: me.full_name || draft.fullName.trim(),
        phone: me.phone || draft.phone.trim(),
        companyId: created.company_id,
        legalName: membership?.legal_name || draft.legal_name.trim(),
        role: created.role,
        memberships: me.memberships.length ? me.memberships : [{ company_id: created.company_id, legal_name: draft.legal_name.trim(), role: created.role }],
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not create the workspace.');
    } finally {
      setBusy(false);
    }
  }

  const companyTrn = trnError(draft.trn);

  return (
    <div className="min-h-full bg-[#f6f8fb]">
      <header className="flex h-14 items-center gap-3 bg-brand-900 px-4 sm:px-8">
        <Link href="/" aria-label="inFINity home" className={cx('rounded-lg', focus)}><BrandMark tone="dark" /></Link>
        <span className="hidden text-sm text-brand-200 sm:inline">Workspace setup</span>
        <Link href="/" className={cx('ml-auto rounded-md text-sm text-brand-100', focus)}>Back to home</Link>
      </header>
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[220px_1fr] lg:px-8 lg:py-12">
        <ol aria-label="Setup steps" className="flex min-w-0 gap-2 overflow-x-auto lg:flex-col lg:gap-1">
          {STEPS.map((item, i) => (
            <li key={item.label} className="shrink-0 lg:shrink">
              <button
                type="button"
                aria-current={step === i ? 'step' : undefined}
                onClick={() => setStep(i)}
                className={cx('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm', focus, step === i ? 'bg-white font-medium text-brand-800 shadow-sm' : 'text-slate-500 hover:bg-white/70')}
              >
                <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs', step === i ? 'bg-brand-700 text-white' : 'bg-slate-200 text-slate-600')}>{i + 1}</span>
                <span>
                  <span className="block">{item.label}</span>
                  <span className="hidden text-xs font-normal text-slate-500 lg:block">{item.purpose}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>

        <div className="min-w-0 space-y-6">
          <p className="text-sm text-slate-500">Step {step + 1} of 7</p>
          {awaitingEmail ? (
            <Card>
              <CardHeader title="Check your email" subtitle="Confirm the address, then log in. Setup continues at the company step." />
              <div className="px-5 pb-5">
                <Link href="/login" className={cx('text-sm text-brand-700', focus)}>Go to log in</Link>
              </div>
            </Card>
          ) : null}
          {formError ? <p role="alert" className="text-sm text-rose-700">{formError}</p> : null}
          {step === 0 && !awaitingEmail ? (
            <Card>
              <CardHeader title="Account" subtitle="Create your login. You'll be the owner of this workspace." />
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                <label htmlFor="acct-name" className="text-xs font-medium text-slate-600">Full name
                  <input id="acct-name" className={cx(inputCls, 'mt-1')} value={draft.fullName} onChange={(e) => set('fullName', e.target.value)} autoComplete="name" placeholder="Your name" />
                </label>
                <label htmlFor="acct-email" className="text-xs font-medium text-slate-600">Email
                  <input id="acct-email" type="email" className={cx(inputCls, 'mt-1')} value={draft.email} onChange={(e) => set('email', e.target.value)} autoComplete="email" placeholder="you@company.ae" />
                </label>
                <label htmlFor="acct-password" className="text-xs font-medium text-slate-600">Password
                  <input id="acct-password" type="password" className={cx(inputCls, 'mt-1')} value={draft.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" aria-describedby="acct-password-hint" />
                  <span id="acct-password-hint" className="mt-1 block font-normal text-slate-500">At least 6 characters.</span>
                </label>
                <label htmlFor="acct-phone" className="text-xs font-medium text-slate-600">Phone number
                  <input id="acct-phone" type="tel" className={cx(inputCls, 'mt-1')} value={draft.phone} onChange={(e) => set('phone', e.target.value)} autoComplete="tel" placeholder="+971 50 000 0000" aria-describedby="acct-phone-hint" />
                  <span id="acct-phone-hint" className="mt-1 block font-normal text-slate-500">Use the UAE country code, +971.</span>
                </label>
              </div>
              <Footer>
                <Link href="/login" className={cx('text-sm text-brand-700', focus)}>Already have a workspace? Log in</Link>
                <Button variant="primary" disabled={busy} onClick={continueAccount}>{busy ? 'Creating login…' : 'Continue'}</Button>
              </Footer>
            </Card>
          ) : null}

          {step === 1 ? (
            <Card>
              <CardHeader title="Company" subtitle="The legal name on your invoices. A tax number is optional." />
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                <label htmlFor="co-name" className="text-xs font-medium text-slate-600 sm:col-span-2">Legal name
                  <input id="co-name" className={cx(inputCls, 'mt-1')} value={draft.legal_name} onChange={(e) => set('legal_name', e.target.value)} placeholder="Registered company name" />
                </label>
                <label htmlFor="co-trn" className="text-xs font-medium text-slate-600">TRN
                  <input id="co-trn" inputMode="numeric" className={cx(inputCls, 'mt-1')} value={draft.trn} onChange={(e) => set('trn', e.target.value)} placeholder="15 digits, or leave blank" aria-describedby={companyTrn ? 'co-trn-err' : undefined} />
                  {companyTrn ? <span id="co-trn-err"><Err>{companyTrn}</Err></span> : null}
                </label>
                <label htmlFor="co-ccy" className="text-xs font-medium text-slate-600">Base currency
                  <select id="co-ccy" className={cx(inputCls, 'mt-1')} value={draft.base_currency} onChange={(e) => set('base_currency', e.target.value as Draft['base_currency'])}>
                    {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </label>
                <label htmlFor="co-fy" className="text-xs font-medium text-slate-600">Fiscal year starts
                  <select id="co-fy" className={cx(inputCls, 'mt-1')} value={draft.fiscal_year_start_month} onChange={(e) => set('fiscal_year_start_month', Number(e.target.value))}>
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

          {step === 2 ? (
            <Card>
              <CardHeader title="Tax and periods" subtitle="How often you prepare VAT, and when a large journal needs a second look." />
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                <label htmlFor="set-journal" className="text-xs font-medium text-slate-600">Journal approval threshold (AED)
                  <input id="set-journal" className={cx(inputCls, 'mt-1')} value={draft.journal_approval_threshold} onChange={(e) => set('journal_approval_threshold', e.target.value)} placeholder="Leave blank if no approval is needed" />
                </label>
                <label htmlFor="set-writeoff" className="text-xs font-medium text-slate-600">Write-off approval threshold (AED)
                  <input id="set-writeoff" className={cx(inputCls, 'mt-1')} value={draft.write_off_approval_threshold} onChange={(e) => set('write_off_approval_threshold', e.target.value)} />
                </label>
                <label htmlFor="set-period" className="text-xs font-medium text-slate-600">Period length
                  <select id="set-period" className={cx(inputCls, 'mt-1')} value={draft.default_period_length} onChange={(e) => set('default_period_length', e.target.value as Draft['default_period_length'])}>
                    <option value="monthly">monthly</option>
                    <option value="quarterly">quarterly</option>
                  </select>
                </label>
                <label htmlFor="set-vat" className="text-xs font-medium text-slate-600">VAT return frequency
                  <select id="set-vat" className={cx(inputCls, 'mt-1')} value={draft.vat_return_frequency} onChange={(e) => set('vat_return_frequency', e.target.value as Draft['vat_return_frequency'])}>
                    <option value="quarterly">quarterly</option>
                    <option value="monthly">monthly</option>
                  </select>
                </label>
                <label htmlFor="set-emirate" className="text-xs font-medium text-slate-600">Default emirate
                  <select id="set-emirate" className={cx(inputCls, 'mt-1')} value={draft.default_emirate} onChange={(e) => set('default_emirate', e.target.value as Draft['default_emirate'])}>
                    <option value="">Not set</option>
                    {EMIRATES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <div className="flex items-end pb-1">
                  <Toggle on={draft.allow_period_reopen} onChange={(v) => set('allow_period_reopen', v)} label="Allow period reopen" />
                </div>
                <p className="text-xs text-slate-500 sm:col-span-2">The working week treats Saturday and Sunday as the weekend. Bank matching allows a 2% price difference. This demo does not file with the FTA.</p>
              </div>
              <Footer>
                <Button onClick={() => setStep(1)}>Back</Button>
                <Button variant="primary" onClick={() => setStep(3)}>Continue</Button>
              </Footer>
            </Card>
          ) : null}

          {step === 3 ? (
            <Card>
              <CardHeader title="Chart of accounts" subtitle="These accounts are loaded for you. The first digit shows the type. Retained earnings stays locked." />
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

          {step === 4 ? (
            <Card>
              <CardHeader title="Standard accounts" subtitle="These accounts are already on the chart. You do not pick them during setup." />
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

          {step === 5 ? (
            <Card>
              <CardHeader title="Customers" subtitle="Add the people you invoice. A catalog line is optional and becomes the starting description on a new invoice." />
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
                      <input className={cx(inputCls, 'mt-1')} value={c.credit_limit} onChange={(e) => set('customers', draft.customers.map((row, j) => j === i ? { ...row, credit_limit: e.target.value } : row))} placeholder="Leave blank for no limit" />
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
                    <Toggle on={draft.item_is_service} onChange={(v) => set('item_is_service', v)} label="This line is a service" />
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

          {step === 6 ? (
            <Card>
              <CardHeader title="Review" subtitle="Check the details, then open your workspace. The chart of accounts is already loaded." />
              <div className="space-y-4 p-5 text-sm text-slate-700">
                {showErrors && issues.length ? (
                  <ul className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {issues.map((issue) => <li key={issue}>{issue}</li>)}
                  </ul>
                ) : null}
                <dl className="grid gap-3 sm:grid-cols-2">
                  <div><dt className="text-xs text-slate-500">Name</dt><dd>{summary.auth_users.user_metadata.full_name || '—'}</dd></div>
                  <div><dt className="text-xs text-slate-500">Email</dt><dd>{summary.auth_users.email || '—'}</dd></div>
                  <div><dt className="text-xs text-slate-500">Company</dt><dd>{summary.companies.legal_name || '—'}</dd></div>
                  <div><dt className="text-xs text-slate-500">TRN</dt><dd>{summary.companies.trn || 'Not set'}</dd></div>
                  <div><dt className="text-xs text-slate-500">Currency</dt><dd>{summary.companies.base_currency}</dd></div>
                  <div><dt className="text-xs text-slate-500">VAT period</dt><dd className="capitalize">{summary.company_settings.vat_return_frequency}</dd></div>
                  <div><dt className="text-xs text-slate-500">Customers</dt><dd>{summary.customers.length}</dd></div>
                  <div><dt className="text-xs text-slate-500">Catalog line</dt><dd>Not saved. There is no catalog in the books yet.</dd></div>
                </dl>
                <p className="text-xs text-slate-500">This demo keeps your login in this browser. Invoices, bills, and journals are not saved. A refresh clears that work.</p>
              </div>
              <Footer>
                <Button onClick={() => setStep(5)}>Back</Button>
                <Button variant="success" disabled={busy} onClick={finish}>{busy ? 'Creating workspace…' : 'Create workspace'}</Button>
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
