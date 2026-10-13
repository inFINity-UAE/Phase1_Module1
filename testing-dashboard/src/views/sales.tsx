import { useState } from 'react';
import { BellRing, CheckCheck, CreditCard, FileX2, MoreHorizontal, Pencil, Plus, Repeat, Search, Send } from 'lucide-react';
import { CUSTOMERS, QUOTATIONS, SALES_YTD, TODAY, addDays, customer, daysBetween, docTotals, fmtDate, invoiceBalance, type Invoice } from '../data';
import { Badge, Button, Card, Empty, Menu, Money, PageHeader, Tabs, cx, inputCls, rowCls, tdCls, thCls, type Tone } from '../ui';
import type { ViewProps } from '../App';

type Status = 'draft' | 'awaiting_approval' | 'awaiting_payment' | 'partially_paid' | 'overdue' | 'paid' | 'written_off';
export const invoiceStatus = (i: Invoice): Status => {
  if (i.writtenOff) return 'written_off';
  if (i.stage !== 'issued') return i.stage;
  const bal = invoiceBalance(i);
  if (bal <= 0) return 'paid';
  if (i.dueDate < TODAY) return 'overdue';
  return i.paid > 0 ? 'partially_paid' : 'awaiting_payment';
};
const PILL: Record<Status, [string, Tone]> = {
  draft: ['Draft', 'slate'], awaiting_approval: ['Awaiting approval', 'blue'], awaiting_payment: ['Awaiting payment', 'blue'],
  partially_paid: ['Partially paid', 'amber'], overdue: ['Overdue', 'red'], paid: ['Paid', 'green'], written_off: ['Written off', 'violet'],
};

type Tab = 'draft' | 'approval' | 'payment' | 'overdue' | 'paid' | 'all';
const inTab = (t: Tab, s: Status) =>
  t === 'all' || (t === 'draft' && s === 'draft') || (t === 'approval' && s === 'awaiting_approval') ||
  (t === 'payment' && (s === 'awaiting_payment' || s === 'partially_paid')) || (t === 'overdue' && s === 'overdue') || (t === 'paid' && s === 'paid');

export function Invoices({ store, open }: ViewProps) {
  const [tab, setTab] = useState<Tab>('overdue');
  const [q, setQ] = useState('');
  const rows = store.invoices.map((i) => ({ i, s: invoiceStatus(i), c: customer(i.customerId), t: docTotals(i.lines) }));
  const count = (t: Tab) => rows.filter((r) => inTab(t, r.s)).length;
  const sum = (t: Tab) => rows.filter((r) => inTab(t, r.s)).reduce((s, r) => s + (r.s === 'draft' || r.s === 'awaiting_approval' ? r.t.gross : invoiceBalance(r.i)), 0);
  const shown = rows.filter((r) => inTab(tab, r.s) && (!q || `${r.i.number} ${r.c.name} ${r.c.trn}`.toLowerCase().includes(q.toLowerCase())));
  const stages: { id: Tab; label: string; tone: string }[] = [
    { id: 'draft', label: 'Draft', tone: 'bg-slate-400' },
    { id: 'approval', label: 'Awaiting approval', tone: 'bg-brand-400' },
    { id: 'payment', label: 'Awaiting payment', tone: 'bg-brand-600' },
    { id: 'overdue', label: 'Overdue', tone: 'bg-rose-500' },
  ];
  return (
    <>
      <PageHeader title="Invoices" subtitle="Tax invoices issued to customers. Approving an invoice assigns its number and posts it to the ledger." actions={<><Button onClick={() => open({ kind: 'payment', mode: 'receipt' })}><CreditCard size={16} /> Record receipt</Button><Button variant="primary" onClick={() => open({ kind: 'invoice' })}><Plus size={16} /> New invoice</Button></>} />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stages.map((s) => (
          <button key={s.id} type="button" onClick={() => setTab(s.id)} className={cx('rounded-xl border bg-white p-4 text-left transition-shadow hover:shadow-md', tab === s.id ? 'border-brand-400 ring-2 ring-brand-500/15' : 'border-slate-200')}>
            <span className="flex items-center gap-2 text-xs font-medium text-slate-500"><span className={cx('h-2 w-2 rounded-full', s.tone)} />{s.label} · {count(s.id)}</span>
            <span className="num mt-1.5 block text-xl font-semibold text-slate-900"><Money v={sum(s.id)} /></span>
          </button>
        ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3 px-5 pt-3">
          <Tabs value={tab} onChange={setTab} tabs={[
            { id: 'draft', label: 'Draft', count: count('draft') },
            { id: 'approval', label: 'Awaiting Approval', count: count('approval') },
            { id: 'payment', label: 'Awaiting Payment', count: count('payment') },
            { id: 'overdue', label: 'Overdue', count: count('overdue'), tone: 'red' },
            { id: 'paid', label: 'Paid', count: count('paid') },
            { id: 'all', label: 'All' },
          ]} />
          <div className="relative mb-2 w-full sm:w-64">
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input aria-label="Filter invoices" className={cx(inputCls, 'pl-8!')} placeholder="Filter by number, customer, TRN" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px]">
            <thead className="border-y border-slate-100 bg-slate-50/70">
              <tr>
                <th className={thCls}>Invoice</th><th className={thCls}>Customer</th><th className={thCls}>TRN</th><th className={thCls}>Issued / Due</th>
                <th className={cx(thCls, 'text-right')}>Ex-VAT</th><th className={cx(thCls, 'text-right')}>Gross</th><th className={cx(thCls, 'text-right')}>Balance</th>
                <th className={thCls}>Status</th><th className={cx(thCls, 'text-right')}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ i, s, c, t }) => {
                const late = s === 'overdue' ? daysBetween(i.dueDate, TODAY) : 0;
                const [label, tone] = PILL[s];
                return (
                  <tr key={i.id} className={rowCls}>
                    <td className={cx(tdCls, 'num font-medium text-slate-900')}>{i.number ?? <span className="font-normal italic text-slate-400">Assigned on issue</span>}</td>
                    <td className={tdCls}><span className="font-medium text-slate-800">{c.name}</span><span className="block text-xs text-slate-500">{c.emirate}</span></td>
                    <td className={cx(tdCls, 'num text-xs text-slate-500')}>{c.trn}</td>
                    <td className={tdCls}>{fmtDate(i.issueDate)}<span className={cx('block text-xs', late ? 'font-medium text-rose-600' : 'text-slate-500')}>{late ? `${late} days overdue` : `Due ${fmtDate(i.dueDate)}`}</span></td>
                    <td className={cx(tdCls, 'text-right')}><Money v={t.net} /></td>
                    <td className={cx(tdCls, 'text-right font-medium text-slate-900')}><Money v={t.gross} /></td>
                    <td className={cx(tdCls, 'text-right')}><Money v={i.stage === 'issued' ? invoiceBalance(i) : t.gross} className={s === 'overdue' ? 'font-semibold text-rose-600' : ''} /></td>
                    <td className={tdCls}>
                      <Badge tone={tone}>{label}</Badge>
                      {s === 'overdue' && i.paid > 0 ? <span className="mt-1 block text-[11px] text-amber-700">Partially paid</span> : null}
                      {i.autoDunning ? <span className="mt-1 flex items-center gap-1 text-[11px] text-brand-600"><Repeat size={11} /> Auto-dunning</span> : i.reminders ? <span className="mt-1 block text-[11px] text-slate-400">{i.reminders} reminder{i.reminders > 1 ? 's' : ''} sent</span> : null}
                    </td>
                    <td className={cx(tdCls, 'text-right')}>
                      <div className="flex items-center justify-end gap-1.5">
                        {s === 'draft' ? <><Button size="sm" variant="ghost" onClick={() => open({ kind: 'invoice', invoice: i })}><Pencil size={14} /> Edit</Button><Button size="sm" onClick={() => store.advanceInvoice(i.id)}><Send size={14} /> Submit</Button></> : null}
                        {s === 'awaiting_approval' ? <><Button size="sm" variant="ghost" onClick={() => open({ kind: 'invoice', invoice: i })}>Edit</Button><Button size="sm" variant="primary" onClick={() => store.advanceInvoice(i.id)}><CheckCheck size={14} /> Approve</Button></> : null}
                        {['overdue', 'awaiting_payment', 'partially_paid'].includes(s) ? (
                          <Menu label={`Actions for ${i.number}`} triggerClass="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-800" trigger={<MoreHorizontal size={16} />} items={[
                            { label: 'Send reminder now', icon: BellRing, hint: `To ${c.email}`, onClick: () => store.remind(i.id) },
                            { label: i.autoDunning ? 'Pause automated dunning' : 'Enable automated dunning', icon: Repeat, hint: '7 / 14 / 30 days after due date', onClick: () => store.remind(i.id, !i.autoDunning) },
                            { label: 'Record payment', icon: CreditCard, onClick: () => open({ kind: 'payment', mode: 'receipt', id: i.id }) },
                            { label: 'Flag for write-off', icon: FileX2, danger: true, hint: 'Posts Dr 1110 / Cr 1100', disabled: s !== 'overdue', onClick: () => open({ kind: 'writeoff', id: i.id }) },
                          ]} />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!shown.length ? <Empty>No invoices in this stage.</Empty> : null}
        </div>
      </Card>
    </>
  );
}

const Q_TONE: Record<string, Tone> = { Sent: 'blue', Accepted: 'green', Expired: 'slate', Converted: 'violet' };

export function Quotations({ open }: ViewProps) {
  return (
    <>
      <PageHeader title="Quotations" subtitle="Accepted quotations convert to a draft tax invoice with the same lines." />
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[800px]">
          <thead className="bg-slate-50/70"><tr><th className={thCls}>Quote</th><th className={thCls}>Customer</th><th className={thCls}>Date</th><th className={thCls}>Expiry</th><th className={cx(thCls, 'text-right')}>Ex-VAT</th><th className={thCls}>Status</th><th /></tr></thead>
          <tbody>
            {QUOTATIONS.map((qt) => (
              <tr key={qt.number} className={rowCls}>
                <td className={cx(tdCls, 'num font-medium text-slate-900')}>{qt.number}</td>
                <td className={tdCls}>{customer(qt.customerId).name}</td>
                <td className={tdCls}>{fmtDate(qt.date)}</td>
                <td className={tdCls}>{fmtDate(qt.expiry)}</td>
                <td className={cx(tdCls, 'text-right')}><Money v={qt.net} /></td>
                <td className={tdCls}><Badge tone={Q_TONE[qt.status]}>{qt.status}</Badge></td>
                <td className={cx(tdCls, 'text-right')}>
                  {qt.status === 'Accepted' || qt.status === 'Sent' ? (
                    <Button size="sm" variant={qt.status === 'Accepted' ? 'primary' : 'outline'} onClick={() => open({ kind: 'invoice', invoice: { id: `q-${qt.number}`, number: null, customerId: qt.customerId, issueDate: TODAY, dueDate: addDays(TODAY, 30), stage: 'draft', paid: 0, reminders: 0, lines: [{ description: `Per ${qt.number}`, account: '4040', qty: 1, price: qt.net, vat: 'SR' }] } })}>
                      Convert to invoice
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

export function Customers({ store, open }: ViewProps) {
  return (
    <>
      <PageHeader title="Customers" subtitle="VAT-registered customers with place of supply by Emirate." actions={<Button variant="primary" onClick={() => open({ kind: 'invoice' })}><Plus size={16} /> New invoice</Button>} />
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead className="bg-slate-50/70"><tr><th className={thCls}>Customer</th><th className={thCls}>TRN</th><th className={thCls}>Emirate</th><th className={thCls}>Terms</th><th className={cx(thCls, 'text-right')}>YTD sales (ex-VAT)</th><th className={cx(thCls, 'text-right')}>Outstanding</th><th className={cx(thCls, 'text-right')}>Overdue</th></tr></thead>
          <tbody>
            {CUSTOMERS.map((c) => {
              const mine = store.openAR().filter((i) => i.customerId === c.id);
              const overdue = mine.filter((i) => i.dueDate < TODAY).reduce((s, i) => s + invoiceBalance(i), 0);
              return (
                <tr key={c.id} className={rowCls}>
                  <td className={tdCls}><span className="font-medium text-slate-900">{c.name}</span><span className="block text-xs text-slate-500">{c.email}</span></td>
                  <td className={cx(tdCls, 'num text-xs')}>{c.trn}</td>
                  <td className={tdCls}>{c.emirate}</td>
                  <td className={tdCls}>Net {c.terms}</td>
                  <td className={cx(tdCls, 'text-right')}><Money v={SALES_YTD[c.id].gross - SALES_YTD[c.id].credit} /></td>
                  <td className={cx(tdCls, 'text-right font-medium')}><Money v={mine.reduce((s, i) => s + invoiceBalance(i), 0)} /></td>
                  <td className={cx(tdCls, 'text-right')}>{overdue ? <Money v={overdue} className="font-semibold text-rose-600" /> : <span className="text-slate-300">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}
