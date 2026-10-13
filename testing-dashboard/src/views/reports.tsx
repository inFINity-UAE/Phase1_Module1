import { useState, type ComponentType } from 'react';
import { BookOpenCheck, ChevronLeft, ChevronRight, FileArchive, FileSpreadsheet, Landmark, LineChart, PieChart, Scale, Users } from 'lucide-react';
import {
  ACCOUNTS, CUSTOMERS, EXPENSE_GROUPS, LEDGER_CUTOFF, MOM_MONTHS, PRIOR_PL, SALES_YTD, TODAY,
  accountType, addDays, docTotals, fmtDate, r2,
} from '../data';
import type { Store } from '../store';
import { aed, downloadBlob, toCsv, zipStore } from '../lib';
import { Badge, Button, Card, CardHeader, Field, PageHeader, cx, inputCls, thCls } from '../ui';
import type { ViewProps } from '../App';

type Cell = string | number | null;
type Row = { cells: Cell[]; strong?: boolean; indent?: boolean };
type Report = { title: string; subtitle: string; endpoint: string; cols: string[]; rows: Row[]; check?: { ok: boolean; text: string } };
const COMPANY = 'company_id=…';
const OPEN_FROM = addDays(LEDGER_CUTOFF, 1);
const names = (c: string) => ACCOUNTS[c] ?? c;
const codes = (pred: (c: string) => boolean, b: Record<string, number>) => Object.keys(b).filter((c) => pred(c) && Math.abs(b[c]) > 0.004).sort();

function trialBalance(s: Store, from: string, to: string): Report {
  const open = s.balances(addDays(from, -1));
  const close = s.balances(to);
  const dr: Record<string, number> = {}, cr: Record<string, number> = {};
  for (const j of s.journals) {
    if (j.status !== 'posted' || j.date <= LEDGER_CUTOFF || j.date < from || j.date > to) continue;
    for (const l of j.lines) { dr[l.account] = r2((dr[l.account] ?? 0) + l.debit); cr[l.account] = r2((cr[l.account] ?? 0) + l.credit); }
  }
  const list = codes(() => true, close);
  const tot = (f: (c: string) => number) => r2(list.reduce((a, c) => a + f(c), 0));
  const cd = tot((c) => Math.max(0, close[c])), cc = tot((c) => Math.max(0, -close[c]));
  return {
    title: 'Trial balance', subtitle: `${fmtDate(from)} – ${fmtDate(to)}`,
    endpoint: `/reports/trial-balance-range?${COMPANY}&range_start=${from}&range_end=${to}&format=csv`,
    cols: ['Code', 'Account', 'Opening', 'Period debits', 'Period credits', 'Closing Dr', 'Closing Cr'],
    rows: [
      ...list.map((c) => ({ cells: [c, names(c), open[c] ?? 0, dr[c] ?? 0, cr[c] ?? 0, close[c] > 0 ? close[c] : 0, close[c] < 0 ? -close[c] : 0] })),
      { strong: true, cells: ['', 'Totals', null, tot((c) => dr[c] ?? 0), tot((c) => cr[c] ?? 0), cd, cc] },
    ],
    check: { ok: Math.abs(cd - cc) < 0.005, text: `Closing debits ${aed(cd)} ${Math.abs(cd - cc) < 0.005 ? '=' : '≠'} credits ${aed(cc)}` },
  };
}

function balanceSheet(s: Store, asOf: string): Report {
  const b = s.balances(asOf);
  const sec = (title: string, first: string, sign: 1 | -1) => {
    const list = codes((c) => c[0] === first, b);
    return { title, list, total: r2(list.reduce((a, c) => a + sign * b[c], 0)), sign };
  };
  const assets = sec('Assets', '1', 1), liab = sec('Liabilities', '2', -1), eq = sec('Equity', '3', -1);
  const cye = -r2(codes((c) => c[0] === '4' || c[0] === '5', b).reduce((a, c) => a + b[c], 0));
  const le = r2(liab.total + eq.total + cye);
  const block = (x: typeof assets): Row[] => [{ strong: true, cells: [x.title, '', null] }, ...x.list.map((c) => ({ indent: true, cells: [c, names(c), r2(x.sign * b[c])] }))];
  return {
    title: 'Balance sheet', subtitle: `As of ${fmtDate(asOf)}`,
    endpoint: `/reports/balance-sheet?${COMPANY}&as_of_date=${asOf}&format=csv`,
    cols: ['Code', 'Account', 'AED'],
    rows: [
      ...block(assets), { strong: true, cells: ['', 'Total assets', assets.total] },
      ...block(liab), { strong: true, cells: ['', 'Total liabilities', liab.total] },
      ...block(eq), { indent: true, cells: ['', 'Current year earnings', cye] }, { strong: true, cells: ['', 'Total equity', r2(eq.total + cye)] },
      { strong: true, cells: ['', 'Total liabilities & equity', le] },
    ],
    check: { ok: Math.abs(assets.total - le) < 0.005, text: `Assets ${aed(assets.total)} ${Math.abs(assets.total - le) < 0.005 ? '=' : '≠'} liabilities + equity ${aed(le)}` },
  };
}

function profitAndLoss(s: Store, to: string, compare: boolean): Report {
  const b = s.balances(to);
  const all = [...new Set([...codes((c) => c[0] === '4' || c[0] === '5', b), ...(compare ? Object.keys(PRIOR_PL) : [])])].sort();
  const cur = (c: string) => (accountType(c) === 'Income' ? -(b[c] ?? 0) : b[c] ?? 0);
  const pri = (c: string) => (accountType(c) === 'Income' ? -(PRIOR_PL[c] ?? 0) : PRIOR_PL[c] ?? 0);
  const sum = (pred: (c: string) => boolean, f: (c: string) => number) => r2(all.filter(pred).reduce((a, c) => a + f(c), 0));
  const line = (label: string, a: number, p: number, strong = true): Row => ({ strong, cells: ['', label, a, ...(compare ? [p, r2(a - p), p ? `${(((a - p) / Math.abs(p)) * 100).toFixed(1)}%` : '—'] : [])] });
  const rowsFor = (pred: (c: string) => boolean): Row[] => all.filter(pred).map((c) => ({ indent: true, cells: [c, names(c), cur(c), ...(compare ? [pri(c), r2(cur(c) - pri(c)), pri(c) ? `${(((cur(c) - pri(c)) / Math.abs(pri(c))) * 100).toFixed(1)}%` : '—'] : [])] }));
  const isRev = (c: string) => c[0] === '4' && c !== '4600', isCogs = (c: string) => c.startsWith('50'), isOpex = (c: string) => c[0] === '5' && !isCogs(c) && c !== '5830';
  const rev = [sum(isRev, cur), sum(isRev, pri)], cogs = [sum(isCogs, cur), sum(isCogs, pri)], opex = [sum(isOpex, cur), sum(isOpex, pri)], oth = [sum((c) => c === '4600', cur), sum((c) => c === '4600', pri)];
  const gp = [r2(rev[0] - cogs[0]), r2(rev[1] - cogs[1])], pbt = [r2(gp[0] - opex[0] + oth[0]), r2(gp[1] - opex[1] + oth[1])];
  return {
    title: compare ? 'Profit & loss — comparison' : 'Profit & loss', subtitle: compare ? `1 Jan – ${fmtDate(to)} vs 1 Jan – 30 Sep 2025` : `1 Jan 2026 – ${fmtDate(to)}`,
    endpoint: compare ? `/reports/profit-and-loss-comparison?${COMPANY}&period_a_start=2026-01-01&period_a_end=${to}&period_b_start=2025-01-01&period_b_end=2025-09-30&format=csv` : `/reports/profit-and-loss?${COMPANY}&period_start=2026-01-01&period_end=${to}&format=csv`,
    cols: ['Code', 'Account', 'Current', ...(compare ? ['Prior', 'Variance', 'Δ %'] : [])],
    rows: [
      ...rowsFor(isRev), line('Net revenue', rev[0], rev[1]),
      ...rowsFor(isCogs), line('Gross profit', gp[0], gp[1]),
      ...rowsFor(isOpex), line('Total operating expenses', opex[0], opex[1]),
      ...rowsFor((c) => c === '4600'), line('Net profit before tax', pbt[0], pbt[1]),
    ],
  };
}

/** ponytail: synthetic GL history (pre-cutoff detail isn't in the mock); it nets to the real balance. Upgrade: GET /reports/general-ledger. */
function generalLedger(s: Store, account: string, pageSize: number, page: number): Report & { pages: number } {
  const base = s.balances(LEDGER_CUTOFF)[account] ?? 0;
  const hist = Array.from({ length: 28 }, (_, i) => {
    const amt = r2(Math.abs(base) / 9 * (0.35 + ((i * 37) % 11) / 10));
    const debit = (i % 3 !== 1) === base >= 0;
    return { date: addDays('2026-01-05', Math.floor(i * 9.4)), ref: `JE-${10020 + i * 10}`, memo: debit ? 'Posting — increase' : 'Posting — decrease', debit: debit ? amt : 0, credit: debit ? 0 : amt };
  });
  const histNet = r2(hist.reduce((a, l) => a + l.debit - l.credit, 0));
  const session = s.journals.filter((j) => j.status === 'posted' && j.date > LEDGER_CUTOFF).flatMap((j) => j.lines.filter((l) => l.account === account).map((l) => ({ date: j.date, ref: j.number, memo: j.narration, debit: l.debit, credit: l.credit })));
  const lines = [...hist, ...session].sort((a, b) => a.date.localeCompare(b.date));
  let run = r2(base - histNet);
  const opening = run;
  const all: Row[] = lines.map((l) => { run = r2(run + l.debit - l.credit); return { cells: [fmtDate(l.date), l.ref, l.memo, l.debit, l.credit, run] }; });
  const pages = Math.max(1, Math.ceil(all.length / pageSize));
  const p = Math.min(page, pages - 1);
  return {
    title: `General ledger — ${account} ${names(account)}`, subtitle: `${all.length} lines · opening ${aed(opening)} · closing ${aed(run)}`,
    endpoint: `/reports/general-ledger?${COMPANY}&account_id=${account}&date_from=2026-01-01&date_to=${TODAY}&limit=${pageSize}&offset=${p * pageSize}&format=csv`,
    cols: ['Date', 'Entry', 'Narration', 'Debit', 'Credit', 'Balance'],
    rows: all.slice(p * pageSize, (p + 1) * pageSize), pages,
  };
}

function expenseAnalysis(): Report {
  return {
    title: 'Expense analysis by sub-category', subtitle: 'Month-on-month, Q3 2026',
    endpoint: `/reports/expense-analysis?${COMPANY}&fiscal_year=2026&format=csv`,
    cols: ['Sub-category', 'Accounts', ...MOM_MONTHS, 'MoM Δ %'],
    rows: [
      ...EXPENSE_GROUPS.map((g) => ({ cells: [g.name, g.codes.join(', '), ...g.mom, `${(((g.mom[2] - g.mom[1]) / g.mom[1]) * 100).toFixed(1)}%`] })),
      { strong: true, cells: ['Total', '', ...[0, 1, 2].map((i) => r2(EXPENSE_GROUPS.reduce((a, g) => a + g.mom[i], 0))), ''] },
    ],
  };
}

function salesByCustomer(s: Store): Report {
  const extra: Record<string, number> = {};
  for (const i of s.invoices) if (i.stage === 'issued' && i.issueDate > LEDGER_CUTOFF) extra[i.customerId] = r2((extra[i.customerId] ?? 0) + docTotals(i.lines).net);
  const data = CUSTOMERS.map((c) => { const g = r2(SALES_YTD[c.id].gross + (extra[c.id] ?? 0)); return { c, g, cn: SALES_YTD[c.id].credit, net: r2(g - SALES_YTD[c.id].credit) }; }).sort((a, b) => b.net - a.net);
  const total = r2(data.reduce((a, d) => a + d.net, 0));
  return {
    title: 'Sales by customer', subtitle: 'Ex-VAT, net of credit notes · 1 Jan 2026 to date',
    endpoint: `/reports/sales-by-customer?${COMPANY}&period_start=2026-01-01&period_end=${TODAY}&format=csv`,
    cols: ['Customer', 'TRN', 'Sales ex-VAT', 'Credit notes', 'Net sales', 'Share'],
    rows: [
      ...data.map((d) => ({ cells: [d.c.name, d.c.trn, d.g, -d.cn, d.net, `${((d.net / total) * 100).toFixed(1)}%`] })),
      { strong: true, cells: ['Total', '', r2(data.reduce((a, d) => a + d.g, 0)), -r2(data.reduce((a, d) => a + d.cn, 0)), total, '100%'] },
    ],
  };
}

type Kind = 'tb' | 'bs' | 'pl' | 'gl' | 'exp' | 'sales';
const CARDS: { id: Kind; title: string; text: string; icon: ComponentType<{ size?: number; className?: string }>; tag: string }[] = [
  { id: 'tb', title: 'Trial balance', text: 'Range-based period selection with opening, movement and closing.', icon: Scale, tag: 'Core' },
  { id: 'bs', title: 'Balance sheet', text: 'As-of snapshot of assets, liabilities and equity.', icon: Landmark, tag: 'Core' },
  { id: 'pl', title: 'Profit & loss', text: 'Single period or side-by-side range comparison.', icon: LineChart, tag: 'Core' },
  { id: 'gl', title: 'General ledger', text: 'Line-level detail per account with pagination.', icon: BookOpenCheck, tag: 'Core' },
  { id: 'exp', title: 'Expense analysis', text: 'Sub-category spend, month on month.', icon: PieChart, tag: 'Extended' },
  { id: 'sales', title: 'Sales by customer', text: 'Ex-VAT and net of credit notes.', icon: Users, tag: 'Extended' },
];

const csvOf = (r: Report) => toCsv(r.cols, r.rows.map((x) => x.cells.map((c) => c ?? '')));

export function Reports({ store }: ViewProps) {
  const [kind, setKind] = useState<Kind>('tb');
  const [from, setFrom] = useState(OPEN_FROM);
  const [to, setTo] = useState(TODAY);
  const [asOf, setAsOf] = useState(TODAY);
  const [compare, setCompare] = useState(true);
  const [account, setAccount] = useState('1021');
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(0);

  const gl = kind === 'gl' ? generalLedger(store, account, pageSize, page) : null;
  const report: Report =
    kind === 'tb' ? trialBalance(store, from, to) : kind === 'bs' ? balanceSheet(store, asOf) : kind === 'pl' ? profitAndLoss(store, asOf, compare)
      : kind === 'gl' ? gl! : kind === 'exp' ? expenseAnalysis() : salesByCustomer(store);
  const slug = report.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '');

  const auditPack = () => {
    const full = generalLedger(store, account, 10_000, 0);
    downloadBlob(`audit-pack_${TODAY}.zip`, zipStore([
      { name: 'trial-balance.csv', text: csvOf(trialBalance(store, OPEN_FROM, TODAY)) },
      { name: 'balance-sheet.csv', text: csvOf(balanceSheet(store, TODAY)) },
      { name: 'profit-and-loss.csv', text: csvOf(profitAndLoss(store, TODAY, false)) },
      { name: `general-ledger_${account}.csv`, text: csvOf(full) },
      { name: 'journal-register.csv', text: toCsv(['entry', 'date', 'narration', 'status', 'account', 'debit', 'credit'], store.journals.flatMap((j) => j.lines.map((l) => [j.number, j.date, j.narration, j.status, l.account, l.debit, l.credit]))) },
    ]));
    store.notify('Financial Statement Audit Pack downloaded (5 CSVs)');
  };

  return (
    <>
      <PageHeader title="Reports" subtitle="Core financial statements and extended management reports, computed live from the ledger." />

      <div className="sticky top-0 z-20 -mx-1 mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
        <FileSpreadsheet size={18} className="text-slate-400" />
        <code className="min-w-0 flex-1 truncate rounded bg-slate-50 px-2 py-1 text-xs text-slate-600" title={report.endpoint}>GET {report.endpoint}</code>
        <Button size="sm" onClick={() => { downloadBlob(`${slug}.csv`, new Blob([csvOf(report)], { type: 'text/csv' })); store.notify(`${report.title} exported as CSV`); }}><FileSpreadsheet size={14} /> Download CSV</Button>
        <Button size="sm" variant="primary" onClick={auditPack}><FileArchive size={14} /> Financial Statement Audit Pack</Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {CARDS.map((c) => (
          <button key={c.id} type="button" onClick={() => { setKind(c.id); setPage(0); }} className={cx('flex items-start gap-4 rounded-xl border bg-white p-4 text-left transition-all hover:-translate-y-px hover:shadow-md', kind === c.id ? 'border-brand-400 ring-2 ring-brand-500/15' : 'border-slate-200')}>
            <span className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', kind === c.id ? 'bg-brand-600 text-white' : 'bg-brand-50 text-brand-600')}><c.icon size={20} /></span>
            <span className="flex-1">
              <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">{c.title}<Badge tone={c.tag === 'Core' ? 'blue' : 'violet'}>{c.tag}</Badge></span>
              <span className="mt-1 block text-xs text-slate-500">{c.text}</span>
            </span>
          </button>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader
          title={report.title}
          subtitle={report.subtitle}
          actions={
            <>
              {kind === 'tb' ? <>
                <Field label="From">{(id) => <input id={id} type="date" min={OPEN_FROM} max={to} className={cx(inputCls, 'h-8! w-40!')} value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
                <Field label="To">{(id) => <input id={id} type="date" min={from} className={cx(inputCls, 'h-8! w-40!')} value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
              </> : null}
              {kind === 'bs' || kind === 'pl' ? <Field label={kind === 'bs' ? 'As of' : 'Period end'}>{(id) => <input id={id} type="date" min={LEDGER_CUTOFF} className={cx(inputCls, 'h-8! w-40!')} value={asOf} onChange={(e) => setAsOf(e.target.value)} />}</Field> : null}
              {kind === 'pl' ? (
                <div className="flex self-end rounded-md bg-slate-100 p-0.5 text-xs font-medium">
                  {[false, true].map((v) => <button key={String(v)} type="button" onClick={() => setCompare(v)} className={cx('rounded px-2.5 py-1.5', compare === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')}>{v ? 'Compare vs prior year' : 'Single period'}</button>)}
                </div>
              ) : null}
              {kind === 'gl' ? <>
                <Field label="Account">{(id) => <select id={id} className={cx(inputCls, 'h-8! w-64!')} value={account} onChange={(e) => { setAccount(e.target.value); setPage(0); }}>{Object.keys(ACCOUNTS).map((a) => <option key={a} value={a}>{a} · {ACCOUNTS[a]}</option>)}</select>}</Field>
                <Field label="Rows per page">{(id) => <select id={id} className={cx(inputCls, 'h-8! w-24!')} value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}>{[10, 25, 50].map((n) => <option key={n}>{n}</option>)}</select>}</Field>
              </> : null}
            </>
          }
        />
        {report.check ? <div className={cx('border-b px-5 py-2 text-xs font-medium', report.check.ok ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-rose-100 bg-rose-50 text-rose-700')}>{report.check.ok ? '✓' : '✕'} {report.check.text}</div> : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead className="bg-slate-50/70"><tr>{report.cols.map((c, i) => <th key={c} className={cx(thCls, i >= 2 && typeof report.rows[0]?.cells[i] !== 'string' && 'text-right')}>{c}</th>)}</tr></thead>
            <tbody>
              {report.rows.map((r, i) => (
                <tr key={i} className={cx('border-t border-slate-100', r.strong ? 'bg-slate-50/80 font-semibold text-slate-900' : 'text-slate-700 hover:bg-brand-50/50')}>
                  {r.cells.map((c, j) => (
                    <td key={j} className={cx('px-3 py-2 text-sm', typeof c === 'number' && 'num text-right', r.indent && j === 0 && 'pl-6', j === 0 && !r.strong && 'num text-slate-500')}>
                      {c === null ? '' : typeof c === 'number' ? <span className={c < 0 ? 'text-rose-600' : ''}>{aed(c)}</span> : c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {gl ? (
          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm text-slate-600">
            <span>Page {Math.min(page, gl.pages - 1) + 1} of {gl.pages}</span>
            <div className="flex gap-2">
              <Button size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}><ChevronLeft size={14} /> Previous</Button>
              <Button size="sm" disabled={page >= gl.pages - 1} onClick={() => setPage((p) => p + 1)}>Next <ChevronRight size={14} /></Button>
            </div>
          </div>
        ) : null}
      </Card>
    </>
  );
}
