import { useEffect, useRef, useState } from 'react';
import { Check, FileScan, FileText, Minus, Plus, ShieldAlert, Sparkles, UploadCloud, X } from 'lucide-react';
import { PURCHASE_ORDERS, TODAY, VENDORS, acct, billBalance, daysBetween, docTotals, fmtDate, vendor, type Bill, type DocLine, type MatchState } from '../data';
import { aed } from '../lib';
import { Badge, Button, Card, CardHeader, Money, PageHeader, cx, inputCls, rowCls, tdCls, thCls } from '../ui';
import type { ViewProps } from '../App';

type Phase = 'idle' | 'uploading' | 'scanning' | 'extracting' | 'ready';
const ACCEPT = ['application/pdf', 'image/png', 'image/jpeg'];
const MAX_BYTES = 10 * 1024 * 1024;

const SAMPLE_LINES: DocLine[] = [
  { description: 'OPC cement 50kg', account: '5000', qty: 300, price: 18.5, vat: 'SR' },
  { description: 'Tile adhesive 20kg', account: '5000', qty: 40, price: 46, vat: 'SR' },
];
const SAMPLE = { vendorId: 'v1', supplierRef: 'GC-2026-452', billDate: '2026-10-10', dueDate: '2026-11-09', po: 'PO-2026-0022', lines: SAMPLE_LINES };
const t = docTotals(SAMPLE_LINES);
const FIELDS = [
  { key: 'vendor', label: 'Vendor', value: `${vendor('v1').name} · TRN ${vendor('v1').trn}`, conf: 99 },
  { key: 'ref', label: 'Invoice number', value: SAMPLE.supplierRef, conf: 98 },
  { key: 'date', label: 'Invoice date', value: fmtDate(SAMPLE.billDate), conf: 97 },
  { key: 'due', label: 'Due date', value: fmtDate(SAMPLE.dueDate), conf: 93 },
  { key: 'lines', label: 'Net / VAT 5% / Total', value: `${aed(t.net)} / ${aed(t.vat)} / AED ${aed(t.gross)}`, conf: 96 },
  { key: 'po', label: 'PO reference', value: SAMPLE.po, conf: 88 },
];

function DocumentIntake({ open }: Pick<ViewProps, 'open'>) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [file, setFile] = useState('');
  const [progress, setProgress] = useState(0);
  const [revealed, setRevealed] = useState(0);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState('');
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timers: number[] = [];
    if (phase === 'uploading') {
      const id = window.setInterval(() => setProgress((p) => (p >= 100 ? 100 : p + 10)), 70);
      timers.push(id, window.setTimeout(() => setPhase('scanning'), 800));
      return () => timers.forEach((x) => { clearInterval(x); clearTimeout(x); });
    }
    if (phase === 'scanning') timers.push(window.setTimeout(() => setPhase('extracting'), 1700));
    if (phase === 'extracting') {
      FIELDS.forEach((_, i) => timers.push(window.setTimeout(() => setRevealed(i + 1), 320 * (i + 1))));
      timers.push(window.setTimeout(() => setPhase('ready'), 320 * FIELDS.length + 250));
    }
    return () => timers.forEach(clearTimeout);
  }, [phase]);

  const start = (name: string, f?: File) => {
    if (f && !ACCEPT.includes(f.type)) return setError('Only PDF, PNG or JPG files are accepted.');
    if (f && f.size > MAX_BYTES) return setError('File is larger than 10 MB.');
    setError(''); setFile(name); setProgress(0); setRevealed(0); setPhase('uploading');
  };
  const reset = () => { setPhase('idle'); setFile(''); setRevealed(0); };
  const busy = phase !== 'idle';

  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Sparkles size={16} className="text-violet-500" /> AI Document Intake</span>} subtitle="Drop a supplier tax invoice. OCR reads it into a draft bill for you to verify — nothing posts until you confirm." />
      <div className="p-5">
        {!busy ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) start(f.name, f); }}
            className={cx('flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors', drag ? 'border-violet-400 bg-violet-50' : 'border-slate-300 bg-slate-50/50 hover:border-brand-400')}
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200"><UploadCloud size={26} className="text-brand-500" /></span>
            <p className="mt-4 text-sm font-semibold text-slate-800">Drag & drop vendor bills here</p>
            <p className="mt-1 text-xs text-slate-500">PDF, PNG or JPG · up to 10 MB · one bill per file</p>
            <div className="mt-4 flex gap-2">
              <Button variant="outline" onClick={() => picker.current?.click()}>Browse files</Button>
              <Button variant="ghost" onClick={() => start('GulfCement_GC-2026-452.pdf')}>Try a sample bill</Button>
            </div>
            <input ref={picker} type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) start(f.name, f); e.target.value = ''; }} />
            {error ? <p role="alert" className="mt-3 text-xs font-medium text-rose-600">{error}</p> : null}
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
            <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-white p-4 shadow-inner">
              <div className="mb-3 flex items-center gap-2 text-xs font-medium text-slate-600"><FileText size={14} className="text-rose-500" /><span className="truncate">{file}</span></div>
              <div className="space-y-2" aria-hidden>
                <div className="h-3 w-1/2 rounded bg-slate-300" />
                <div className="h-2 w-2/3 rounded bg-slate-200" />
                <div className="h-2 w-1/3 rounded bg-slate-200" />
                <div className="mt-4 h-2 w-full rounded bg-slate-100" />
                {[...Array(6)].map((_, i) => <div key={i} className="flex gap-2"><div className="h-2 flex-1 rounded bg-slate-100" /><div className="h-2 w-10 rounded bg-slate-200" /></div>)}
                <div className="ml-auto mt-3 h-3 w-1/3 rounded bg-slate-300" />
              </div>
              {phase === 'scanning' ? <div className="absolute inset-x-0 h-[3px] bg-violet-500 shadow-[0_0_14px_4px_rgba(139,92,246,.45)] animate-[scan_0.85s_ease-in-out_infinite_alternate]" /> : null}
              {phase === 'uploading' ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/85 px-6">
                  <p className="text-xs font-medium text-slate-600">Uploading… {progress}%</p>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-brand-500 transition-all" style={{ width: `${progress}%` }} /></div>
                </div>
              ) : null}
            </div>
            <div>
              <div className="mb-3 flex items-center gap-2 text-sm">
                {(['uploading', 'scanning', 'extracting', 'ready'] as Phase[]).map((p, i, arr) => {
                  const done = arr.indexOf(phase) > i || phase === 'ready';
                  const now = phase === p && p !== 'ready';
                  return (
                    <span key={p} className="flex items-center gap-2">
                      <span className={cx('flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold', done ? 'bg-emerald-500 text-white' : now ? 'bg-violet-500 text-white animate-pulse' : 'bg-slate-200 text-slate-500')}>{done ? <Check size={12} /> : i + 1}</span>
                      <span className={cx('text-xs font-medium', done || now ? 'text-slate-800' : 'text-slate-400')}>{['Upload', 'OCR scan', 'Extract fields', 'Verify'][i]}</span>
                      {i < 3 ? <span className="h-px w-5 bg-slate-200" /> : null}
                    </span>
                  );
                })}
              </div>
              <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {FIELDS.map((f, i) => (
                  <div key={f.key} className="grid grid-cols-[150px_1fr_auto] items-center gap-3 px-3 py-2.5 text-sm">
                    <dt className="text-xs font-medium text-slate-500">{f.label}</dt>
                    {i < revealed ? (
                      <>
                        <dd className="num font-medium text-slate-900 animate-[fieldIn_.35s_ease-out]">{f.value}</dd>
                        <Badge tone={f.conf >= 95 ? 'green' : 'amber'}>{f.conf}%</Badge>
                      </>
                    ) : (
                      <>
                        <dd><div className={cx('h-3 rounded bg-slate-100', phase === 'extracting' && i === revealed && 'animate-pulse bg-violet-100')} style={{ width: `${45 + ((i * 17) % 40)}%` }} /></dd>
                        <span />
                      </>
                    )}
                  </div>
                ))}
              </dl>
              {phase === 'ready' ? (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <p className="mr-auto flex items-center gap-1.5 text-xs text-amber-700"><ShieldAlert size={14} /> PO-2026-0022 has no goods receipt yet — bill will hold for 3-way match.</p>
                  <Button variant="ghost" onClick={reset}><X size={15} /> Discard</Button>
                  <Button variant="primary" onClick={() => { open({ kind: 'bill', prefill: { ...SAMPLE, aiFields: ['vendor', 'ref', 'date', 'due', 'lines'] } }); reset(); }}><FileScan size={15} /> Review &amp; create bill</Button>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

const MATCH: Record<MatchState, { label: string; tone: 'green' | 'amber' | 'red' | 'slate' }> = {
  matched: { label: '3-way matched', tone: 'green' },
  variance: { label: 'Price variance', tone: 'red' },
  missing_grn: { label: 'GRN missing', tone: 'amber' },
  no_po: { label: 'Service · 2-way', tone: 'slate' },
};
const held = (b: Bill) => b.match === 'variance' || b.match === 'missing_grn';

function MatchChips({ b }: { b: Bill }) {
  const chip = (label: string, ok: boolean | null) => (
    <span className={cx('inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold', ok === null ? 'bg-slate-100 text-slate-400' : ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600')}>
      {ok === null ? <Minus size={10} /> : ok ? <Check size={10} /> : <X size={10} />}{label}
    </span>
  );
  return (
    <div>
      <div className="flex gap-1">{chip('PO', b.po ? true : null)}{chip('GRN', b.po ? !!b.grn : null)}{chip('BILL', b.match === 'variance' ? false : true)}</div>
      <span className={cx('mt-1 block text-[11px]', MATCH[b.match].tone === 'red' ? 'text-rose-600' : MATCH[b.match].tone === 'amber' ? 'text-amber-700' : 'text-slate-500')} title={b.matchNote}>{b.matchNote ?? MATCH[b.match].label}</span>
    </div>
  );
}

const BUCKETS = ['Not yet due', '1–30', '31–60', '61–90', '90+'];
const bucketOf = (due: string) => {
  const d = daysBetween(due, TODAY);
  return d <= 0 ? 0 : d <= 30 ? 1 : d <= 60 ? 2 : d <= 90 ? 3 : 4;
};

export function Bills({ store, open }: ViewProps) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [method, setMethod] = useState('ACH · UAEFTS local transfer');
  const bills = store.openAP().sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const payable = bills.filter((b) => !held(b));
  const selTotal = bills.filter((b) => sel.has(b.id)).reduce((s, b) => s + billBalance(b), 0);
  const aging = BUCKETS.map((_, i) => bills.filter((b) => bucketOf(b.dueDate) === i).reduce((s, b) => s + billBalance(b), 0));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const approve = () => {
    for (const id of sel) store.pay(id, billBalance(store.bills.find((b) => b.id === id)!), '1021', TODAY);
    store.notify(`${sel.size} payment${sel.size > 1 ? 's' : ''} approved via ${method.split(' ·')[0]} · AED ${aed(selTotal)} from ${acct('1021').split(' · ')[0]}`);
    setSel(new Set());
  };
  return (
    <>
      <PageHeader title="Bills & payables" subtitle="Capture supplier bills with AI, then clear them through 3-way match and the payment desk." actions={<Button variant="primary" onClick={() => open({ kind: 'bill' })}><Plus size={16} /> Log bill</Button>} />
      <DocumentIntake open={open} />

      <Card className="mt-6">
        <CardHeader title="A/P aging & payment desk" subtitle={`${bills.length} open obligations · AED ${aed(-(store.balances()['2000'] ?? 0))} in 2000 Accounts Payable`} />
        <div className="grid grid-cols-2 gap-px border-b border-slate-100 bg-slate-100 sm:grid-cols-5">
          {BUCKETS.map((label, i) => (
            <div key={label} className="bg-white px-5 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{i ? `${label} days late` : label}</p>
              <p className={cx('num mt-1 text-base font-semibold', i >= 2 && aging[i] ? 'text-rose-600' : 'text-slate-900')}><Money v={aging[i]} /></p>
            </div>
          ))}
        </div>

        {sel.size ? (
          <div className="flex flex-wrap items-center gap-3 border-b border-brand-100 bg-brand-50 px-5 py-3">
            <span className="text-sm font-medium text-brand-900">{sel.size} selected · <span className="num">AED {aed(selTotal)}</span></span>
            <select aria-label="Payment method" className={cx(inputCls, 'h-8! w-60!')} value={method} onChange={(e) => setMethod(e.target.value)}>
              <option>ACH · UAEFTS local transfer</option>
              <option>Wire · SWIFT MT103</option>
            </select>
            <span className="text-xs text-brand-700">from {acct('1021')}</span>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>Clear</Button>
              <Button size="sm" variant="success" onClick={approve}><Check size={14} /> Approve &amp; pay</Button>
            </div>
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px]">
            <thead className="bg-slate-50/70">
              <tr>
                <th className="w-10 px-3">
                  <input type="checkbox" aria-label="Select all payable bills" className="h-4 w-4 accent-brand-600" checked={payable.length > 0 && payable.every((b) => sel.has(b.id))} onChange={(e) => setSel(new Set(e.target.checked ? payable.map((b) => b.id) : []))} />
                </th>
                <th className={thCls}>Bill</th><th className={thCls}>Vendor</th><th className={thCls}>Bill date</th><th className={thCls}>Due</th>
                <th className={thCls}>3-way match</th><th className={cx(thCls, 'text-right')}>Gross</th><th className={cx(thCls, 'text-right')}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {bills.map((b) => {
                const v = vendor(b.vendorId);
                const late = daysBetween(b.dueDate, TODAY);
                const hold = held(b);
                return (
                  <tr key={b.id} className={cx(rowCls, sel.has(b.id) && 'bg-brand-50/70')}>
                    <td className="px-3">
                      <input type="checkbox" aria-label={`Select ${b.number}`} disabled={hold} title={hold ? 'On hold — resolve 3-way match exception first' : undefined} className="h-4 w-4 accent-brand-600 disabled:opacity-30" checked={sel.has(b.id)} onChange={() => toggle(b.id)} />
                    </td>
                    <td className={cx(tdCls, 'whitespace-nowrap')}><span className="num font-medium text-slate-900">{b.number}</span><span className="block text-xs text-slate-500">{b.supplierRef}</span></td>
                    <td className={tdCls}><span className="font-medium text-slate-800">{v.name}</span><span className="num block text-xs text-slate-500">TRN {v.trn}</span></td>
                    <td className={tdCls}>{fmtDate(b.billDate)}</td>
                    <td className={tdCls}>{fmtDate(b.dueDate)}<span className={cx('block text-xs', late > 0 ? 'font-medium text-rose-600' : late > -7 ? 'font-medium text-amber-700' : 'text-slate-500')}>{late > 0 ? `${late} day${late > 1 ? 's' : ''} late` : late === 0 ? 'Due today' : `in ${-late} day${late < -1 ? 's' : ''}`}</span></td>
                    <td className={tdCls}><MatchChips b={b} /></td>
                    <td className={cx(tdCls, 'text-right')}><Money v={docTotals(b.lines).gross} /></td>
                    <td className={cx(tdCls, 'text-right font-semibold text-slate-900')}><Money v={billBalance(b)} />{b.paid ? <span className="block text-[11px] font-normal text-amber-700">Partially paid</span> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

export function PurchaseOrders() {
  return (
    <>
      <PageHeader title="Purchase orders" subtitle="Goods receipts (GRN) and bills are matched against each PO before payment is released." />
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[760px]">
          <thead className="bg-slate-50/70"><tr><th className={thCls}>PO</th><th className={thCls}>Vendor</th><th className={thCls}>Date</th><th className={cx(thCls, 'text-right')}>Ex-VAT</th><th className={thCls}>Goods receipt</th><th className={thCls}>Billing</th></tr></thead>
          <tbody>
            {PURCHASE_ORDERS.map((p) => (
              <tr key={p.number} className={rowCls}>
                <td className={cx(tdCls, 'num font-medium text-slate-900')}>{p.number}</td>
                <td className={tdCls}>{vendor(p.vendorId).name}</td>
                <td className={tdCls}>{fmtDate(p.date)}</td>
                <td className={cx(tdCls, 'text-right')}><Money v={p.net} /></td>
                <td className={tdCls}><Badge tone={p.grn === 'Received' ? 'green' : 'amber'}>{p.grn}</Badge></td>
                <td className={tdCls}><Badge tone={p.billed.includes('variance') ? 'red' : p.billed === 'Billed' ? 'blue' : 'slate'}>{p.billed}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

export function Vendors({ store }: ViewProps) {
  return (
    <>
      <PageHeader title="Vendors" subtitle="Suppliers with TRN on file for input VAT recovery." />
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[760px]">
          <thead className="bg-slate-50/70"><tr><th className={thCls}>Vendor</th><th className={thCls}>TRN</th><th className={thCls}>Category</th><th className={thCls}>Terms</th><th className={cx(thCls, 'text-right')}>Open bills</th><th className={cx(thCls, 'text-right')}>Balance</th></tr></thead>
          <tbody>
            {VENDORS.map((v) => {
              const mine = store.openAP().filter((b) => b.vendorId === v.id);
              return (
                <tr key={v.id} className={rowCls}>
                  <td className={cx(tdCls, 'font-medium text-slate-900')}>{v.name}</td>
                  <td className={cx(tdCls, 'num text-xs')}>{v.trn}</td>
                  <td className={tdCls}>{v.category}</td>
                  <td className={tdCls}>Net {v.terms}</td>
                  <td className={cx(tdCls, 'text-right')}>{mine.length}</td>
                  <td className={cx(tdCls, 'text-right font-medium')}><Money v={mine.reduce((s, b) => s + billBalance(b), 0)} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}
