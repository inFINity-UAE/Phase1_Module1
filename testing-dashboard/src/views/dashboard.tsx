import { useState, type ReactNode } from 'react';
import { ArrowRight, ArrowUpRight, CheckCircle2, Circle, Flame, Landmark, Receipt, ShoppingCart, TrendingUp, TriangleAlert, Wallet } from 'lucide-react';
import { CASH_OUTFLOWS, CASH_TREND, TODAY, addDays, billBalance, cashTotal, customer, daysBetween, fmtDate, invoiceBalance, plSummary, r2 } from '../data';
import { jTotals } from '../store';
import { aed } from '../lib';
import { Badge, Button, Card, CardHeader, Money, PageHeader, Sparkline, cx } from '../ui';
import type { ViewProps } from '../App';

const compact = (n: number) => new Intl.NumberFormat('en-AE', { notation: 'compact', maximumFractionDigits: 2 }).format(n);

function Metric({ icon: Icon, label, value, children, tone = 'text-brand-600' }: { icon: typeof Wallet; label: string; value: string; children: ReactNode; tone?: string }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
        <span className={cx('flex h-7 w-7 items-center justify-center rounded-md bg-slate-50', tone)}><Icon size={16} /></span>
        {label}
      </div>
      <p className="num mt-3 text-[28px] font-semibold leading-none tracking-tight text-slate-900"><span className="mr-1 text-base font-medium text-slate-400">AED</span>{value}</p>
      <div className="mt-3">{children}</div>
    </Card>
  );
}

export function Dashboard({ store, go, open }: ViewProps) {
  const b = store.balances();
  const cash = cashTotal(b);
  const sample = store.demo;
  const trend = [...(sample ? CASH_TREND.map((x) => x.v) : []), cash];
  const grossBurn = sample ? r2(CASH_OUTFLOWS.reduce((s, x) => s + x.out, 0) / CASH_OUTFLOWS.length) : 0;
  const netFlow = sample ? r2((CASH_TREND.at(-1)!.v - CASH_TREND.at(-4)!.v) / 3) : 0;
  const runway = grossBurn > 0 ? cash / grossBurn : 0;
  const pl = plSummary(b);
  const ebitdaMargin = pl.revenue ? (pl.ebitda / pl.revenue) * 100 : 0;
  const netMargin = pl.revenue ? (pl.net / pl.revenue) * 100 : 0;

  const overdue30 = store.openAR().filter((i) => daysBetween(i.dueDate, TODAY) > 30);
  const weekEnd = addDays(TODAY, 6);
  const billsDue = store.openAP().filter((x) => x.dueDate >= TODAY && x.dueDate <= weekEnd);
  const actions = [
    { n: store.feed.length, text: 'un-reconciled bank feed items', sub: sample ? 'Operations ••• 4471' : 'Bank feed not connected', icon: Landmark, cta: 'Reconcile', view: 'bank' as const },
    { n: overdue30.length, text: 'invoices past 30 days overdue', sub: `AED ${aed(overdue30.reduce((s, i) => s + invoiceBalance(i), 0))} at risk`, icon: Receipt, cta: 'Chase', view: 'invoices' as const },
    { n: billsDue.length, text: 'vendor bills due this week', sub: `AED ${aed(billsDue.reduce((s, x) => s + billBalance(x), 0))} by ${fmtDate(weekEnd)}`, icon: ShoppingCart, cta: 'Pay', view: 'bills' as const },
  ];

  const ar = store.openAR();
  const buckets = [
    { label: 'Current', test: (d: number) => d <= 0 },
    { label: '1–30', test: (d: number) => d > 0 && d <= 30 },
    { label: '31–60', test: (d: number) => d > 30 && d <= 60 },
    { label: '61–90', test: (d: number) => d > 60 && d <= 90 },
    { label: '90+', test: (d: number) => d > 90 },
  ].map((k) => ({ ...k, v: ar.filter((i) => k.test(daysBetween(i.dueDate, TODAY))).reduce((s, i) => s + invoiceBalance(i), 0) }));
  const arMax = Math.max(...buckets.map((x) => x.v), 1);

  const [checks, setChecks] = useState<Record<string, boolean>>({ accruals: true });
  const close = [
    { id: 'bank', label: 'Reconcile all bank feeds', done: store.feed.length === 0, auto: true },
    { id: 'ar', label: 'Review AR aging & send dunning reminders' },
    { id: 'accruals', label: 'Post depreciation & gratuity accruals' },
    { id: 'drafts', label: 'Post or discard draft journals', done: !store.journals.some((j) => j.status === 'draft'), auto: true },
    { id: 'vat', label: 'Review Q3 2026 VAT-201 draft' },
    { id: 'ct', label: 'Check CT threshold & related-party log' },
  ].map((c) => ({ ...c, done: c.auto ? c.done! : !!checks[c.id] }));
  const doneCount = close.filter((c) => c.done).length;

  return (
    <>
      <PageHeader
        title={sample ? 'Good afternoon, Salah' : 'Workspace'}
        subtitle={sample ? `Here is where Horizon Facilities LLC stands today, ${fmtDate(TODAY)}.` : `No invoices, bills, or bank activity in this workspace yet. ${fmtDate(TODAY)}.`}
        actions={<><Button onClick={() => go('reports')}>Open reports</Button><Button variant="primary" onClick={() => open({ kind: 'invoice' })}>New invoice</Button></>}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Metric icon={Wallet} label="Total liquidity" value={compact(cash)}>
          <div className="flex items-end justify-between gap-3">
            <p className="text-xs text-slate-500">{sample ? <>5 cash & bank accounts<br /><span className="font-medium text-emerald-600">+{aed(r2(cash - CASH_TREND[0].v))}</span> since April</> : 'Cash accounts have no posted activity yet.'}</p>
            <Sparkline values={trend} className="h-10 w-28 text-emerald-500" />
          </div>
        </Metric>
        <Metric icon={Flame} label="Burn rate & runway" value={compact(grossBurn)} tone="text-amber-600">
          <p className="text-xs text-slate-500">Avg. monthly gross outflow (Jul–Sep)</p>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-slate-500">Net cash flow <span className="font-medium text-emerald-600">+{compact(netFlow)}/mo</span></span>
            <Badge tone="blue">{runway.toFixed(1)} mo runway</Badge>
          </div>
        </Metric>
        <Metric icon={TrendingUp} label="EBITDA (YTD)" value={compact(pl.ebitda)} tone="text-emerald-600">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md bg-slate-50 px-2 py-1.5"><p className="text-slate-500">EBITDA margin</p><p className="num font-semibold text-slate-800">{ebitdaMargin.toFixed(1)}%</p></div>
            <div className="rounded-md bg-slate-50 px-2 py-1.5"><p className="text-slate-500">Net profit margin</p><p className="num font-semibold text-slate-800">{netMargin.toFixed(1)}%</p></div>
          </div>
        </Metric>
        <Metric icon={ArrowUpRight} label="Receivables vs payables" value={compact(b['1100'] ?? 0)} tone="text-violet-600">
          <p className="text-xs text-slate-500">Owed to you · <span className="font-medium text-slate-700">AED {compact(-(b['2000'] ?? 0))}</span> you owe</p>
          <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="bg-violet-500" style={{ width: `${(() => { const owed = (b['1100'] ?? 0) - (b['2000'] ?? 0); return owed ? ((b['1100'] ?? 0) / owed) * 100 : 0; })()}%` }} />
            <div className="flex-1 bg-amber-400" />
          </div>
        </Metric>
      </div>

      <section aria-label="Urgent action center" className="mt-6 overflow-hidden rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50/40">
        <div className="flex items-center gap-2 border-b border-amber-200/70 px-5 py-3">
          <TriangleAlert size={18} className="text-amber-600" />
          <h2 className="text-sm font-semibold text-amber-900">Urgent action center</h2>
          <span className="text-xs text-amber-700">{actions.reduce((s, a) => s + a.n, 0)} items need you today</span>
        </div>
        <div className="grid divide-y divide-amber-200/70 md:grid-cols-3 md:divide-x md:divide-y-0">
          {actions.map((a) => (
            <button key={a.view} type="button" onClick={() => go(a.view)} className="group flex items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-white/60">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-amber-600 shadow-sm ring-1 ring-amber-200"><a.icon size={20} /></span>
              <span className="flex-1">
                <span className="block text-sm text-slate-800"><span className="num text-xl font-bold text-amber-700">{a.n}</span> {a.text}</span>
                <span className="block text-xs text-slate-500">{a.sub}</span>
              </span>
              <span className="flex items-center gap-1 text-sm font-semibold text-brand-700 group-hover:underline">{a.cta}<ArrowRight size={15} /></span>
            </button>
          ))}
        </div>
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Receivables aging" subtitle={`AED ${aed(b['1100'] ?? 0)} outstanding across ${ar.length} invoices`} actions={<Button size="sm" variant="ghost" onClick={() => go('invoices')}>View invoices <ArrowRight size={14} /></Button>} />
          <div className="grid grid-cols-5 items-end gap-3 px-5 pb-5 pt-6">
            {buckets.map((k) => (
              <div key={k.label} className="flex flex-col items-center gap-2">
                <span className="num text-xs font-medium text-slate-700">{compact(k.v)}</span>
                <div className="flex h-36 w-full items-end rounded-md bg-slate-50">
                  <div className={cx('w-full rounded-md transition-all', k.label === 'Current' ? 'bg-brand-500' : k.label === '1–30' ? 'bg-amber-400' : 'bg-rose-500')} style={{ height: `${Math.max(3, (k.v / arMax) * 100)}%` }} />
                </div>
                <span className="text-xs text-slate-500">{k.label === 'Current' ? 'Current' : `${k.label} days`}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-slate-100">
            <p className="px-5 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">Recent ledger activity</p>
            <ul className="divide-y divide-slate-100 px-5 pb-2">
              {store.journals.slice(-5).reverse().map((j) => (
                <li key={j.number} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className="num w-20 shrink-0 font-medium text-slate-800">{j.number}</span>
                  <span className="flex-1 truncate text-slate-600">{j.narration}</span>
                  <Badge tone={j.status === 'posted' ? 'green' : 'slate'}>{j.status === 'posted' ? 'Posted' : 'Draft'}</Badge>
                  <Money v={jTotals(j.lines).debit} className="w-28 text-right text-slate-800" />
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <Card>
          <CardHeader title="October close checklist" subtitle={`${doneCount} of ${close.length} complete`} />
          <div className="px-5 pt-4">
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(doneCount / close.length) * 100}%` }} /></div>
          </div>
          <ul className="space-y-1 p-3">
            {close.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={c.auto}
                  onClick={() => setChecks((s) => ({ ...s, [c.id]: !s[c.id] }))}
                  className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left text-sm hover:bg-slate-50 disabled:cursor-default"
                  aria-pressed={c.done}
                >
                  {c.done ? <CheckCircle2 size={18} className="mt-px shrink-0 text-emerald-500" /> : <Circle size={18} className="mt-px shrink-0 text-slate-300" />}
                  <span className={cx('flex-1', c.done ? 'text-slate-400 line-through' : 'text-slate-700')}>{c.label}</span>
                  {c.auto ? <span className="text-[11px] text-slate-400">auto</span> : null}
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-slate-100 px-5 py-4 text-xs text-slate-500">
            Largest overdue: <span className="font-medium text-slate-700">{overdue30[0] ? `${overdue30[0].number} · ${customer(overdue30[0].customerId).name}` : 'none'}</span>
          </div>
        </Card>
      </div>
    </>
  );
}
