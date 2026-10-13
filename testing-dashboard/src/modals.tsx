import { useState } from 'react';
import { Plus, Sparkles, Trash2 } from 'lucide-react';
import {
  ACCOUNTS, BANK_ACCOUNTS, CATALOG, CUSTOMERS, EXPENSE_ACCOUNTS, INCOME_ACCOUNTS, LEDGER_CUTOFF, PURCHASE_ORDERS, TODAY, VAT_CODES, VENDORS,
  acct, addDays, billBalance, customer, docTotals, fmtDate, invoiceBalance, lineNet, lineVat, r2, vendor,
  type Bill, type DocLine, type Invoice, type VatCode,
} from './data';
import { billJournal, invoiceJournal, isBalanced, jTotals, type JLine, type Store } from './store';
import { aed } from './lib';
import { Badge, Button, Field, JournalPreview, Modal, Money, cx, inputCls } from './ui';

export type ModalState =
  | { kind: 'invoice'; invoice?: Invoice }
  | { kind: 'bill'; prefill?: Partial<Bill> & { aiFields?: string[] } }
  | { kind: 'payment'; mode: 'receipt' | 'payment'; id?: string }
  | { kind: 'journal' }
  | { kind: 'writeoff'; id: string }
  | null;

const num = (v: string) => (v === '' ? 0 : Number(v));
const MIN_DATE = addDays(LEDGER_CUTOFF, 1);

function LinesEditor({ lines, setLines, accounts, catalog, defaultAccount }: { lines: DocLine[]; setLines: (l: DocLine[]) => void; accounts: string[]; catalog?: boolean; defaultAccount: string }) {
  const set = (i: number, patch: Partial<DocLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[880px]">
        <thead className="bg-slate-50">
          <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {catalog ? <th className="px-2 py-2 w-36">Item</th> : null}
            <th className="px-2 py-2 min-w-48">Description</th>
            <th className="px-2 py-2 w-52">Account</th>
            <th className="px-2 py-2 w-20 text-right">Qty</th>
            <th className="px-2 py-2 w-28 text-right">Unit price</th>
            <th className="px-2 py-2 w-36">VAT</th>
            <th className="px-2 py-2 w-28 text-right">Amount</th>
            <th className="w-9" />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className="border-t border-slate-100 align-top">
              {catalog ? (
                <td className="px-2 py-2">
                  <select
                    aria-label="Catalog item"
                    className={inputCls}
                    value=""
                    onChange={(e) => {
                      const c = CATALOG.find((x) => x.sku === e.target.value);
                      if (c) set(i, { description: c.name, account: c.account, price: c.price, vat: c.vat });
                    }}
                  >
                    <option value="">Pick item…</option>
                    {CATALOG.map((c) => <option key={c.sku} value={c.sku}>{c.sku}</option>)}
                  </select>
                </td>
              ) : null}
              <td className="px-2 py-2"><input aria-label="Description" className={inputCls} value={l.description} onChange={(e) => set(i, { description: e.target.value })} placeholder="Description" /></td>
              <td className="px-2 py-2">
                <select aria-label="Account" className={inputCls} value={l.account} onChange={(e) => set(i, { account: e.target.value })}>
                  {accounts.map((a) => <option key={a} value={a}>{acct(a)}</option>)}
                </select>
              </td>
              <td className="px-2 py-2"><input aria-label="Quantity" type="number" min={0} step="any" className={cx(inputCls, 'text-right num')} value={l.qty} onChange={(e) => set(i, { qty: num(e.target.value) })} /></td>
              <td className="px-2 py-2"><input aria-label="Unit price" type="number" min={0} step="0.01" className={cx(inputCls, 'text-right num')} value={l.price} onChange={(e) => set(i, { price: num(e.target.value) })} /></td>
              <td className="px-2 py-2">
                <select aria-label="VAT rate" className={inputCls} value={l.vat} onChange={(e) => set(i, { vat: e.target.value as VatCode })}>
                  {(Object.keys(VAT_CODES) as VatCode[]).map((k) => <option key={k} value={k}>{VAT_CODES[k].label}</option>)}
                </select>
                <span className="mt-1 block text-[11px] text-slate-500">VAT <Money v={lineVat(l)} /></span>
              </td>
              <td className="px-2 py-2 pt-4 text-right text-sm font-medium text-slate-900"><Money v={lineNet(l)} /></td>
              <td className="px-1 py-2">
                <button type="button" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))} className="mt-1 rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30">
                  <Trash2 size={15} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-slate-100 px-2 py-2">
        <Button variant="ghost" size="sm" onClick={() => setLines([...lines, { description: '', account: defaultAccount, qty: 1, price: 0, vat: 'SR' }])}>
          <Plus size={14} /> Add line
        </Button>
      </div>
    </div>
  );
}

function Totals({ lines }: { lines: DocLine[] }) {
  const t = docTotals(lines);
  return (
    <dl className="ml-auto w-full max-w-xs space-y-1.5 text-sm">
      <div className="flex justify-between text-slate-600"><dt>Subtotal (ex-VAT)</dt><dd><Money v={t.net} /></dd></div>
      <div className="flex justify-between text-slate-600"><dt>VAT</dt><dd><Money v={t.vat} /></dd></div>
      <div className="flex justify-between border-t border-slate-200 pt-1.5 text-base font-semibold text-slate-900"><dt>Total AED</dt><dd><Money v={t.gross} /></dd></div>
    </dl>
  );
}

const linesValid = (lines: DocLine[]) => lines.every((l) => l.qty > 0 && l.price >= 0 && l.description.trim()) && docTotals(lines).net > 0;

export function InvoiceModal({ store, invoice, onClose }: { store: Store; invoice?: Invoice; onClose: () => void }) {
  const [customerId, setCustomerId] = useState(invoice?.customerId ?? CUSTOMERS[0].id);
  const [issueDate, setIssueDate] = useState(invoice?.issueDate ?? TODAY);
  const [terms, setTerms] = useState(30);
  const [defaultAccount, setDefaultAccount] = useState('4040');
  const [lines, setLines] = useState<DocLine[]>(invoice?.lines ?? [{ description: CATALOG[0].name, account: CATALOG[0].account, qty: 1, price: CATALOG[0].price, vat: 'SR' }]);
  const c = customer(customerId);
  const valid = linesValid(lines) && issueDate >= MIN_DATE;
  const save = (mode: 'draft' | 'submit' | 'approve') => {
    store.saveInvoice(
      { id: invoice?.id ?? `n${Date.now()}`, number: null, customerId, issueDate, dueDate: addDays(issueDate, terms), stage: 'draft', lines, paid: 0, reminders: 0 },
      mode,
    );
    onClose();
  };
  return (
    <Modal
      size="xl"
      title={invoice && store.invoices.some((i) => i.id === invoice.id) ? 'Edit tax invoice' : 'New tax invoice'}
      subtitle="Invoice number is assigned sequentially when the invoice is approved and issued."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="outline" disabled={!linesValid(lines)} onClick={() => save('draft')}>Save draft</Button>
          <Button variant="outline" disabled={!valid} onClick={() => save('submit')}>Submit for approval</Button>
          <Button variant="primary" disabled={!valid} onClick={() => save('approve')}>Approve &amp; post ledger</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Customer" className="sm:col-span-2">
          {(id) => (
            <select id={id} className={inputCls} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              {CUSTOMERS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          )}
        </Field>
        <Field label="Issue date" hint={issueDate < MIN_DATE ? 'September is closed — choose a date in an open period.' : undefined}>
          {(id) => <input id={id} type="date" min={MIN_DATE} className={inputCls} value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />}
        </Field>
        <Field label="Payment terms" hint={`Due ${fmtDate(addDays(issueDate, terms))}`}>
          {(id) => (
            <select id={id} className={inputCls} value={terms} onChange={(e) => setTerms(Number(e.target.value))}>
              {[0, 15, 30, 45, 60].map((d) => <option key={d} value={d}>{d ? `Net ${d}` : 'Due on receipt'}</option>)}
            </select>
          )}
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <span>TRN <span className="num font-medium text-slate-800">{c.trn}</span></span>
        <span>Place of supply <span className="font-medium text-slate-800">{c.emirate}</span></span>
        <span>{c.email}</span>
        <label className="ml-auto flex items-center gap-2">
          Default income account
          <select className={cx(inputCls, 'h-8! w-64!')} value={defaultAccount} onChange={(e) => setDefaultAccount(e.target.value)}>
            {INCOME_ACCOUNTS.map((a) => <option key={a} value={a}>{acct(a)}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-4">
        <LinesEditor lines={lines} setLines={setLines} accounts={INCOME_ACCOUNTS} catalog defaultAccount={defaultAccount} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
        <JournalPreview lines={invoiceJournal(lines, 'Invoice')} />
        <Totals lines={lines} />
      </div>
    </Modal>
  );
}

export function BillModal({ store, prefill, onClose }: { store: Store; prefill?: Partial<Bill> & { aiFields?: string[] }; onClose: () => void }) {
  const [vendorId, setVendorId] = useState(prefill?.vendorId ?? VENDORS[0].id);
  const [supplierRef, setSupplierRef] = useState(prefill?.supplierRef ?? '');
  const [billDate, setBillDate] = useState(prefill?.billDate ?? TODAY);
  const [dueDate, setDueDate] = useState(prefill?.dueDate ?? addDays(TODAY, vendor(prefill?.vendorId ?? VENDORS[0].id).terms));
  const [po, setPo] = useState(prefill?.po ?? '');
  const [lines, setLines] = useState<DocLine[]>(prefill?.lines ?? [{ description: '', account: '5000', qty: 1, price: 0, vat: 'SR' }]);
  const ai = new Set(prefill?.aiFields ?? []);
  const aiTag = (k: string) => (ai.has(k) ? <Badge tone="violet"><Sparkles size={11} /> AI</Badge> : null);
  const poRow = PURCHASE_ORDERS.find((p) => p.number === po.trim());
  const valid = linesValid(lines) && supplierRef.trim() && billDate >= MIN_DATE && dueDate >= billDate;
  const submit = () => {
    store.saveBill({
      id: `b${Date.now()}`, number: '', vendorId, supplierRef, billDate, dueDate, lines, paid: 0,
      po: poRow?.number ?? null, grn: null,
      match: !poRow ? 'no_po' : poRow.grn === 'Received' ? 'matched' : 'missing_grn',
      matchNote: poRow && poRow.grn !== 'Received' ? 'Goods receipt not yet recorded' : undefined,
    });
    onClose();
  };
  return (
    <Modal
      size="xl"
      title={prefill?.aiFields ? 'Verify AI-extracted bill' : 'Log supplier bill'}
      subtitle={prefill?.aiFields ? 'Fields tagged AI were read from the uploaded document. Check each before posting.' : 'Posts Dr expense / Dr 1400 Input VAT / Cr 2000 Accounts Payable.'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid} onClick={submit}>Post bill to ledger</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Vendor" className="sm:col-span-2">
          {(id) => (
            <div className="flex items-center gap-2">
              <select id={id} className={inputCls} value={vendorId} onChange={(e) => { setVendorId(e.target.value); setDueDate(addDays(billDate, vendor(e.target.value).terms)); }}>
                {VENDORS.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              {aiTag('vendor')}
            </div>
          )}
        </Field>
        <Field label="Supplier invoice #">
          {(id) => <div className="flex items-center gap-2"><input id={id} className={inputCls} value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} placeholder="e.g. GC-2026-452" />{aiTag('ref')}</div>}
        </Field>
        <Field label="Bill date">
          {(id) => <div className="flex items-center gap-2"><input id={id} type="date" min={MIN_DATE} className={inputCls} value={billDate} onChange={(e) => setBillDate(e.target.value)} />{aiTag('date')}</div>}
        </Field>
        <Field label="Due date">
          {(id) => <div className="flex items-center gap-2"><input id={id} type="date" min={billDate} className={inputCls} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />{aiTag('due')}</div>}
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <span>Vendor TRN <span className="num font-medium text-slate-800">{vendor(vendorId).trn}</span></span>
        <label className="ml-auto flex items-center gap-2">
          Purchase order
          <input className={cx(inputCls, 'h-8! w-40!')} value={po} onChange={(e) => setPo(e.target.value)} placeholder="PO-2026-…" list="po-list" />
          <datalist id="po-list">{PURCHASE_ORDERS.map((p) => <option key={p.number} value={p.number} />)}</datalist>
        </label>
        {po ? poRow ? <Badge tone={poRow.grn === 'Received' ? 'green' : 'amber'}>{poRow.grn === 'Received' ? 'PO + GRN found' : 'GRN pending'}</Badge> : <Badge tone="red">PO not found</Badge> : <Badge>No PO (service bill)</Badge>}
      </div>
      <div className="mt-4">
        <LinesEditor lines={lines} setLines={setLines} accounts={EXPENSE_ACCOUNTS} defaultAccount="5000" />
        {ai.has('lines') ? <p className="mt-1.5 flex items-center gap-1 text-xs text-violet-700"><Sparkles size={12} /> Line amounts and VAT extracted by OCR.</p> : null}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
        <JournalPreview lines={billJournal(lines, supplierRef || 'Bill')} />
        <Totals lines={lines} />
      </div>
    </Modal>
  );
}

export function PaymentModal({ store, mode: initialMode, id, onClose }: { store: Store; mode: 'receipt' | 'payment'; id?: string; onClose: () => void }) {
  const [mode, setMode] = useState(initialMode);
  const docs = mode === 'receipt'
    ? store.openAR().map((i) => ({ id: i.id, label: `${i.number} · ${customer(i.customerId).name}`, balance: invoiceBalance(i) }))
    : store.openAP().map((b) => ({ id: b.id, label: `${b.number} · ${vendor(b.vendorId).name}`, balance: billBalance(b) }));
  const [docId, setDocId] = useState(id ?? docs[0]?.id ?? '');
  const doc = docs.find((d) => d.id === docId);
  const [amount, setAmount] = useState(doc?.balance ?? 0);
  const [bank, setBank] = useState('1021');
  const [date, setDate] = useState(TODAY);
  const pick = (d: string) => { setDocId(d); setAmount(docs.find((x) => x.id === d)?.balance ?? 0); };
  const lines: JLine[] = mode === 'receipt'
    ? [{ account: bank, debit: amount, credit: 0 }, { account: '1100', debit: 0, credit: amount }]
    : [{ account: '2000', debit: amount, credit: 0 }, { account: bank, debit: 0, credit: amount }];
  const valid = !!doc && amount > 0 && amount <= doc.balance && date >= MIN_DATE;
  const submit = () => {
    if (mode === 'receipt') store.receive(docId, r2(amount), bank, date);
    else store.pay(docId, r2(amount), bank, date);
    store.notify(`${mode === 'receipt' ? 'Receipt' : 'Payment'} of AED ${aed(amount)} recorded`);
    onClose();
  };
  return (
    <Modal size="md" title="Record payment" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="success" disabled={!valid} onClick={submit}>Record payment</Button></>}>
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 text-sm font-medium">
        {(['receipt', 'payment'] as const).map((m) => (
          <button key={m} type="button" onClick={() => { setMode(m); setDocId(''); setAmount(0); }} className={cx('rounded-md py-1.5', mode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')}>
            {m === 'receipt' ? 'Customer receipt' : 'Supplier payment'}
          </button>
        ))}
      </div>
      <div className="space-y-4">
        <Field label={mode === 'receipt' ? 'Open invoice' : 'Open bill'}>
          {(fid) => (
            <select id={fid} className={inputCls} value={docId} onChange={(e) => pick(e.target.value)}>
              <option value="">Select…</option>
              {docs.map((d) => <option key={d.id} value={d.id}>{d.label} — AED {aed(d.balance)}</option>)}
            </select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Amount (AED)" hint={doc ? `Outstanding ${aed(doc.balance)}` : undefined}>
            {(fid) => <input id={fid} type="number" min={0} max={doc?.balance} step="0.01" className={cx(inputCls, 'num text-right')} value={amount} onChange={(e) => setAmount(num(e.target.value))} />}
          </Field>
          <Field label="Payment date">
            {(fid) => <input id={fid} type="date" min={MIN_DATE} className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />}
          </Field>
        </div>
        <Field label={mode === 'receipt' ? 'Deposit to' : 'Pay from'}>
          {(fid) => (
            <select id={fid} className={inputCls} value={bank} onChange={(e) => setBank(e.target.value)}>
              {BANK_ACCOUNTS.map((a) => <option key={a} value={a}>{acct(a)}</option>)}
            </select>
          )}
        </Field>
        <JournalPreview lines={lines} />
      </div>
    </Modal>
  );
}

const ALL_ACCOUNTS = Object.keys(ACCOUNTS);
const blank = (): JLine => ({ account: '', debit: 0, credit: 0, memo: '' });

export function JournalModal({ store, onClose }: { store: Store; onClose: () => void }) {
  const [date, setDate] = useState(TODAY);
  const [narration, setNarration] = useState('');
  const [lines, setLines] = useState<JLine[]>([blank(), blank()]);
  const set = (i: number, patch: Partial<JLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const t = jTotals(lines);
  const diff = r2(t.debit - t.credit);
  const filled = lines.filter((l) => l.account || l.debit || l.credit);
  const canPost = isBalanced(filled) && filled.length >= 2 && narration.trim() && date >= MIN_DATE;
  const save = (status: 'draft' | 'posted') => {
    const n = store.post({ date, narration, source: 'Manual', status, lines: filled });
    store.notify(status === 'posted' ? `${n} posted to ledger` : `${n} saved as draft`, status === 'posted' ? 'success' : 'info');
    onClose();
  };
  return (
    <Modal
      size="xl"
      title="Manual journal entry"
      subtitle="Each line is a debit or a credit. Posting is blocked until total debits equal total credits."
      onClose={onClose}
      footer={
        <>
          <span className={cx('mr-auto text-sm font-medium', diff ? 'text-rose-600' : 'text-emerald-600')}>
            {diff ? `Out of balance by AED ${aed(Math.abs(diff))}` : t.debit ? 'Balanced' : 'Enter lines'}
          </span>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="outline" disabled={!narration.trim() || !filled.length} onClick={() => save('draft')}>Save draft</Button>
          <Button variant="primary" disabled={!canPost} onClick={() => save('posted')}>Post ledger</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
        <Field label="Entry date">{(id) => <input id={id} type="date" min={MIN_DATE} className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        <Field label="Narration">{(id) => <input id={id} className={inputCls} value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="e.g. Accrue October office rent" />}</Field>
      </div>
      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[720px]">
          <thead className="bg-slate-50">
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-2 py-2">Account</th>
              <th className="px-2 py-2">Line memo</th>
              <th className="px-2 py-2 w-36 text-right">Debit</th>
              <th className="px-2 py-2 w-36 text-right">Credit</th>
              <th className="w-9" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-2 py-2">
                  <select aria-label="Account" className={inputCls} value={l.account} onChange={(e) => set(i, { account: e.target.value })}>
                    <option value="">Select account…</option>
                    {ALL_ACCOUNTS.map((a) => <option key={a} value={a}>{acct(a)}</option>)}
                  </select>
                </td>
                <td className="px-2 py-2"><input aria-label="Memo" className={inputCls} value={l.memo} onChange={(e) => set(i, { memo: e.target.value })} /></td>
                <td className="px-2 py-2"><input aria-label="Debit" type="number" min={0} step="0.01" className={cx(inputCls, 'num text-right')} value={l.debit || ''} onChange={(e) => set(i, { debit: num(e.target.value), credit: 0 })} /></td>
                <td className="px-2 py-2"><input aria-label="Credit" type="number" min={0} step="0.01" className={cx(inputCls, 'num text-right')} value={l.credit || ''} onChange={(e) => set(i, { credit: num(e.target.value), debit: 0 })} /></td>
                <td className="px-1">
                  <button type="button" aria-label="Remove line" disabled={lines.length <= 2} onClick={() => setLines(lines.filter((_, j) => j !== i))} className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"><Trash2 size={15} /></button>
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-200 bg-slate-50/60 text-sm font-semibold text-slate-900">
              <td className="px-2 py-2.5" colSpan={2}>
                <Button variant="ghost" size="sm" onClick={() => setLines([...lines, blank()])}><Plus size={14} /> Add line</Button>
              </td>
              <td className="px-4 py-2.5 text-right"><Money v={t.debit} /></td>
              <td className="px-4 py-2.5 text-right"><Money v={t.credit} /></td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

/** Approval threshold: write_off_approval_threshold default 5000 (.cursor rules / feature-spec-1_1_D). */
const WRITE_OFF_THRESHOLD = 5000;

export function WriteOffModal({ store, id, onClose }: { store: Store; id: string; onClose: () => void }) {
  const inv = store.invoices.find((i) => i.id === id)!;
  const bal = invoiceBalance(inv);
  const lines: JLine[] = [{ account: '1110', debit: bal, credit: 0 }, { account: '1100', debit: 0, credit: bal }];
  return (
    <Modal size="md" title={`Write off ${inv.number}`} subtitle={customer(inv.customerId).name} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" onClick={() => { store.writeOff(id); onClose(); }}>Post write-off</Button></>}>
      <p className="text-sm text-slate-600">
        Outstanding balance of <strong className="num text-slate-900">AED {aed(bal)}</strong> is charged against the ECL allowance (1110), not directly to expense.
      </p>
      {bal > WRITE_OFF_THRESHOLD ? (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-600/20">
          Above the AED {aed(WRITE_OFF_THRESHOLD)} write-off approval threshold. You are signed in as Owner, so this posting is recorded as Owner-approved.
        </p>
      ) : null}
      <div className="mt-4"><JournalPreview lines={lines} /></div>
    </Modal>
  );
}
