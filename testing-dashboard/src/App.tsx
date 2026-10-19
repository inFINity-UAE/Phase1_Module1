import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import {
  BarChart3, BookOpen, Building2, Check, ChevronDown, ChevronsLeft, ChevronsRight, CreditCard, FilePlus2, FileText,
  Landmark, LayoutDashboard, Menu as MenuIcon, NotebookPen, Plus, Receipt, Search, ShieldCheck, ShoppingCart, X,
} from 'lucide-react';
import { ACCOUNTS, customer, vendor } from './data';
import { useStore, type Store } from './store';
import { BillModal, InvoiceModal, JournalModal, PaymentModal, WriteOffModal, type ModalState } from './modals';
import { Menu, Toasts, cx, useClickOutside } from './ui';
import type { WorkspaceSession } from './session';
import { BrandMark } from './marketing/BrandMark';
import { Dashboard } from './views/dashboard';
import { Customers, Invoices, Quotations } from './views/sales';
import { Bills, PurchaseOrders, Vendors } from './views/purchases';
import { BankRec } from './views/bank';
import { ChartOfAccounts, Journals } from './views/accounting';
import { CorporateTax, Vat201 } from './views/compliance';
import { Reports } from './views/reports';

export type View =
  | 'dashboard' | 'invoices' | 'quotations' | 'customers' | 'bills' | 'purchase-orders' | 'vendors'
  | 'bank' | 'coa' | 'journals' | 'vat' | 'ct' | 'reports';
export type ViewProps = {
  store: Store;
  open: (m: ModalState) => void;
  go: (v: View) => void;
  live: { companyId: string } | null;
};

type NavItem = { label: string; icon: ComponentType<{ size?: number; className?: string }>; view?: View; children?: { label: string; view: View }[] };
const NAV: NavItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard, view: 'dashboard' },
  { label: 'Sales / AR', icon: Receipt, children: [{ label: 'Invoices', view: 'invoices' }, { label: 'Quotations', view: 'quotations' }, { label: 'Customers', view: 'customers' }] },
  { label: 'Purchases / AP', icon: ShoppingCart, children: [{ label: 'Bills', view: 'bills' }, { label: 'Purchase Orders', view: 'purchase-orders' }, { label: 'Vendors', view: 'vendors' }] },
  { label: 'Bank & Reconciliation', icon: Landmark, view: 'bank' },
  { label: 'Accounting', icon: BookOpen, children: [{ label: 'Chart of Accounts', view: 'coa' }, { label: 'Journal Entries', view: 'journals' }] },
  { label: 'Compliance & Tax', icon: ShieldCheck, children: [{ label: 'UAE VAT-201', view: 'vat' }, { label: 'Corporate Tax', view: 'ct' }] },
  { label: 'Reports', icon: BarChart3, view: 'reports' },
];

const VIEWS: Record<View, ComponentType<ViewProps>> = {
  dashboard: Dashboard, invoices: Invoices, quotations: Quotations, customers: Customers,
  bills: Bills, 'purchase-orders': PurchaseOrders, vendors: Vendors, bank: BankRec,
  coa: ChartOfAccounts, journals: Journals, vat: Vat201, ct: CorporateTax, reports: Reports,
};

function CompanySelector({ session, onSwitch }: { session: WorkspaceSession; onSwitch: (companyId: string) => void }) {
  const entities = session.mode === 'live'
    ? session.memberships.map((m) => ({ id: m.company_id, name: m.legal_name, detail: m.role }))
    : [{ id: 'demo', name: session.legalName, detail: `TRN ${session.trn ?? '—'}` }];
  const active = entities.find((c) => c.id === (session.mode === 'live' ? session.companyId : 'demo')) ?? entities[0];
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-white/10">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/15 text-sm font-semibold text-white">{active.name[0]}</span>
        <span className="hidden min-w-0 md:block">
          <span className="block max-w-44 truncate text-sm font-semibold text-white">{active.name}</span>
          <span className="block text-[11px] text-brand-200">{active.detail}</span>
        </span>
        <ChevronDown size={15} className="text-brand-200" />
      </button>
      {open ? (
        <div role="listbox" className="absolute left-0 z-40 mt-2 w-80 rounded-lg border border-slate-200 bg-white py-1.5 shadow-xl">
          <p className="px-3 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Entities</p>
          {entities.map((c) => (
            <button key={c.id} role="option" aria-selected={c.id === active.id} type="button" onClick={() => { if (session.mode === 'live') onSwitch(c.id); setOpen(false); }} className="flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-slate-50">
              <Building2 size={18} className="mt-0.5 text-slate-400" />
              <span className="flex-1">
                <span className="block text-sm font-medium text-slate-800">{c.name}</span>
                <span className="block text-xs text-slate-500">{c.detail}</span>
              </span>
              {c.id === active.id ? <Check size={16} className="mt-0.5 text-brand-600" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Omnibox({ store, go }: { store: Store; go: (v: View) => void }) {
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const ref = useClickOutside<HTMLDivElement>(focus, () => setFocus(false));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.current?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    const hit = (...f: (string | null | undefined)[]) => f.some((x) => x?.toLowerCase().includes(s));
    return [
      ...store.invoices.filter((i) => hit(i.number, customer(i.customerId).name)).map((i) => ({ group: 'Invoices', label: i.number ?? 'Draft invoice', sub: customer(i.customerId).name, view: 'invoices' as View })),
      ...store.bills.filter((b) => hit(b.number, b.supplierRef, vendor(b.vendorId).name)).map((b) => ({ group: 'Bills', label: b.number, sub: `${vendor(b.vendorId).name} · ${b.supplierRef}`, view: 'bills' as View })),
      ...store.journals.filter((j) => hit(j.number, j.narration) || j.lines.some((l) => hit(l.account, l.memo))).map((j) => ({ group: 'Ledger', label: j.number, sub: j.narration, view: 'journals' as View })),
      ...Object.entries(ACCOUNTS).filter(([c, n]) => hit(c, n)).map(([c, n]) => ({ group: 'Accounts', label: c, sub: n, view: 'coa' as View })),
    ].slice(0, 9);
  }, [q, store.invoices, store.bills, store.journals]);
  const choose = (v: View) => { go(v); setQ(''); setFocus(false); input.current?.blur(); };
  return (
    <div ref={ref} className="relative w-full max-w-xl">
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-200" />
      <input
        ref={input}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setFocus(true)}
        onKeyDown={(e) => e.key === 'Enter' && results[0] && choose(results[0].view)}
        placeholder="Search invoices, bills, ledger lines…"
        aria-label="Global search"
        className="h-9 w-full rounded-lg border border-white/10 bg-white/10 pl-9 pr-16 text-sm text-white placeholder:text-brand-200 focus:border-white/30 focus:bg-white focus:text-slate-900 focus:placeholder:text-slate-400 focus:outline-none"
      />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-white/20 px-1.5 text-[10px] text-brand-200 sm:block">Ctrl K</kbd>
      {focus && q.trim().length >= 2 ? (
        <div className="absolute left-0 right-0 z-40 mt-2 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
          {results.length ? results.map((r, i) => (
            <button key={i} type="button" onClick={() => choose(r.view)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50">
              <span className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{r.group}</span>
              <span className="num text-sm font-medium text-slate-800">{r.label}</span>
              <span className="truncate text-sm text-slate-500">{r.sub}</span>
            </button>
          )) : <p className="px-3 py-3 text-sm text-slate-500">No matches for “{q}”.</p>}
        </div>
      ) : null}
    </div>
  );
}

function Sidebar({ view, go, collapsed, unreconciled }: { view: View; go: (v: View) => void; collapsed: boolean; unreconciled: number }) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ 'Sales / AR': true, 'Purchases / AP': true });
  return (
    <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
      {NAV.map((item) => {
        const active = item.view === view || item.children?.some((c) => c.view === view);
        const expanded = !collapsed && (openGroups[item.label] || active);
        const onClick = () => (item.view ? go(item.view) : collapsed ? go(item.children![0].view) : setOpenGroups((g) => ({ ...g, [item.label]: !expanded })));
        return (
          <div key={item.label}>
            <button
              type="button"
              title={collapsed ? item.label : undefined}
              aria-expanded={item.children ? expanded : undefined}
              onClick={onClick}
              className={cx('group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors', collapsed && 'justify-center', active && (item.view || collapsed) ? 'bg-brand-50 text-brand-800' : active ? 'text-brand-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900')}
            >
              <item.icon size={19} className={cx('shrink-0', active ? 'text-brand-600' : 'text-slate-400 group-hover:text-slate-600')} />
              {!collapsed ? (
                <>
                  <span className="flex-1 truncate text-left">{item.label}</span>
                  {item.view === 'bank' && unreconciled ? <span className="rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-800">{unreconciled}</span> : null}
                  {item.children ? <ChevronDown size={15} className={cx('text-slate-400 transition-transform', expanded && 'rotate-180')} /> : null}
                </>
              ) : null}
            </button>
            {expanded && item.children ? (
              <div className="mb-1 ml-[22px] mt-0.5 space-y-0.5 border-l border-slate-200 pl-3">
                {item.children.map((c) => (
                  <button key={c.view} type="button" onClick={() => go(c.view)} className={cx('block w-full rounded-md px-2.5 py-1.5 text-left text-sm transition-colors', c.view === view ? 'bg-brand-50 font-medium text-brand-800' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900')}>
                    {c.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

export function App({ session, onLogout, onSwitchCompany }: { session: WorkspaceSession; onLogout: () => void; onSwitchCompany: (companyId: string) => void }) {
  const store = useStore(session.mode === 'demo');
  const live = session.mode === 'live' ? { companyId: session.companyId } : null;
  const [view, setView] = useState<View>('dashboard');
  const [modal, setModal] = useState<ModalState>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const main = useRef<HTMLElement>(null);
  const go = (v: View) => { setView(v); setMobileNav(false); main.current?.scrollTo({ top: 0 }); };
  const close = () => setModal(null);
  const Current = VIEWS[view];

  const sidebar = (isCollapsed: boolean) => (
    <>
      <div className={cx('flex h-14 items-center border-b border-slate-200 px-4', isCollapsed && 'justify-center px-0')}>
        {isCollapsed ? <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-700 text-sm font-bold text-white">∞</span> : <BrandMark />}
      </div>
      <Sidebar view={view} go={go} collapsed={isCollapsed} unreconciled={store.feed.length} />
    </>
  );

  return (
    <div className="flex h-full flex-col">
      <header className="z-30 flex h-14 shrink-0 items-center gap-3 bg-brand-900 px-3 shadow-sm sm:px-4">
        <button type="button" aria-label="Open navigation" onClick={() => setMobileNav(true)} className="rounded-md p-1.5 text-brand-100 hover:bg-white/10 lg:hidden"><MenuIcon size={20} /></button>
        <CompanySelector session={session} onSwitch={onSwitchCompany} />
        <div className="flex flex-1 justify-center px-2"><Omnibox store={store} go={go} /></div>
        <Menu
          label="Quick action"
          triggerClass="inline-flex h-9 items-center gap-1.5 rounded-full bg-emerald-500 px-4 text-sm font-semibold text-white shadow-lg shadow-emerald-900/30 ring-2 ring-emerald-300/40 transition hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-4"
          trigger={<><Plus size={17} strokeWidth={2.5} /><span className="hidden sm:inline">Quick Action</span><ChevronDown size={14} className="hidden sm:block" /></>}
          items={[
            { label: 'Create Tax Invoice', icon: FilePlus2, hint: 'Dr 1100 · Cr revenue · Cr 2200', onClick: () => setModal({ kind: 'invoice' }) },
            { label: 'Log Bill', icon: FileText, hint: 'Dr expense · Dr 1400 · Cr 2000', onClick: () => setModal({ kind: 'bill' }) },
            { label: 'Record Payment', icon: CreditCard, hint: 'Customer receipt or supplier payment', onClick: () => setModal({ kind: 'payment', mode: 'receipt' }) },
            { label: 'Manual Journal Entry', icon: NotebookPen, hint: 'Balanced debits and credits', onClick: () => setModal({ kind: 'journal' }) },
          ]}
        />
        <button
          type="button"
          title={`${session.fullName} · ${session.mode === 'live' ? session.role : 'sample'}. Log out`}
          aria-label="Log out"
          onClick={onLogout}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15 text-xs font-semibold text-white"
        >
          {session.fullName.slice(0, 2).toUpperCase()}
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className={cx('hidden shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200 lg:flex', collapsed ? 'w-[68px]' : 'w-64')}>
          {sidebar(collapsed)}
          <button type="button" onClick={() => setCollapsed((c) => !c)} className="flex items-center gap-2 border-t border-slate-200 px-4 py-3 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-800" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <ChevronsRight size={16} className="mx-auto" /> : <><ChevronsLeft size={16} /> Collapse</>}
          </button>
        </aside>

        {mobileNav ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileNav(false)} />
            <aside className="relative flex h-full w-72 flex-col bg-white shadow-xl">
              <button type="button" aria-label="Close navigation" onClick={() => setMobileNav(false)} className="absolute right-3 top-3.5 rounded p-1 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
              {sidebar(false)}
            </aside>
          </div>
        ) : null}

        <main ref={main} className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <p className={cx('mb-4 rounded-lg px-4 py-2 text-sm', session.mode === 'demo' ? 'bg-amber-50 text-amber-900' : 'bg-slate-100 text-slate-600')}>
              {session.mode === 'demo'
                ? 'Sample data. Horizon Facilities is a demo and is not saved to a database.'
                : 'Demo data — not yet connected. Invoices, bills, bank, tax, and reports are empty. The chart of accounts and customers are loaded from your workspace.'}
            </p>
            <Current store={store} open={setModal} go={go} live={live} />
          </div>
        </main>
      </div>

      {modal?.kind === 'invoice' ? <InvoiceModal store={store} invoice={modal.invoice} onClose={close} /> : null}
      {modal?.kind === 'bill' ? <BillModal store={store} prefill={modal.prefill} onClose={close} /> : null}
      {modal?.kind === 'payment' ? <PaymentModal store={store} mode={modal.mode} id={modal.id} onClose={close} /> : null}
      {modal?.kind === 'journal' ? <JournalModal store={store} onClose={close} /> : null}
      {modal?.kind === 'writeoff' ? <WriteOffModal store={store} id={modal.id} onClose={close} /> : null}
      <Toasts toasts={store.toasts} dismiss={store.dismissToast} />
    </div>
  );
}
