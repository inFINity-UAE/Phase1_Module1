import { useRef, useState } from 'react';
import {
  BASE_BALANCES, LEDGER_CUTOFF, SEED_BILLS, SEED_FEED, SEED_INVOICES, TODAY,
  billBalance, docTotals, invoiceBalance, r2,
  type Bill, type DocLine, type FeedRow, type Invoice,
} from './data';

export type JLine = { account: string; debit: number; credit: number; memo?: string };
export type Journal = {
  number: string;
  date: string;
  narration: string;
  source: 'Manual' | 'Sales invoice' | 'Bill' | 'Receipt' | 'Supplier payment' | 'Bank reconciliation' | 'Write-off';
  status: 'draft' | 'posted';
  lines: JLine[];
};
export type Toast = { id: number; text: string; tone: 'success' | 'info' | 'warning' };
export type Coding = { account: string; vatInclusive: boolean };

export const jTotals = (lines: JLine[]) => ({
  debit: r2(lines.reduce((s, l) => s + (l.debit || 0), 0)),
  credit: r2(lines.reduce((s, l) => s + (l.credit || 0), 0)),
});
export const isBalanced = (lines: JLine[]) => {
  const t = jTotals(lines);
  return t.debit > 0 && t.debit === t.credit && lines.every((l) => l.account && !(l.debit && l.credit));
};

/** Group document lines by account so the journal shows one line per GL code. */
const byAccount = (lines: DocLine[], side: 'debit' | 'credit', memo: string): JLine[] => {
  const sums = new Map<string, number>();
  for (const l of lines) sums.set(l.account, r2((sums.get(l.account) ?? 0) + l.qty * l.price));
  return [...sums].map(([account, v]) => ({ account, debit: side === 'debit' ? v : 0, credit: side === 'credit' ? v : 0, memo }));
};

/** Dr 1100 gross / Cr income net / Cr 2200 output VAT. */
export const invoiceJournal = (lines: DocLine[], ref: string): JLine[] => {
  const t = docTotals(lines);
  return [
    { account: '1100', debit: t.gross, credit: 0, memo: ref },
    ...byAccount(lines, 'credit', ref),
    ...(t.vat ? [{ account: '2200', debit: 0, credit: t.vat, memo: 'Output VAT' }] : []),
  ];
};

/** Dr expense net / Dr 1400 input VAT / Cr 2000 gross. */
export const billJournal = (lines: DocLine[], ref: string): JLine[] => {
  const t = docTotals(lines);
  return [
    ...byAccount(lines, 'debit', ref),
    ...(t.vat ? [{ account: '1400', debit: t.vat, credit: 0, memo: 'Input VAT' }] : []),
    { account: '2000', debit: 0, credit: t.gross, memo: ref },
  ];
};

export const codingJournal = (row: FeedRow, c: Coding): JLine[] => {
  const abs = Math.abs(row.amount);
  const net = c.vatInclusive ? r2(abs / 1.05) : abs;
  const vat = r2(abs - net);
  const vatAcct = row.amount < 0 ? '1400' : '2200';
  const contra: JLine[] = [
    { account: c.account, debit: row.amount < 0 ? net : 0, credit: row.amount < 0 ? 0 : net, memo: row.payee },
    ...(vat ? [{ account: vatAcct, debit: row.amount < 0 ? vat : 0, credit: row.amount < 0 ? 0 : vat, memo: 'VAT' }] : []),
  ];
  const bank: JLine = { account: '1021', debit: row.amount > 0 ? abs : 0, credit: row.amount < 0 ? abs : 0, memo: row.description };
  return row.amount > 0 ? [bank, ...contra] : [...contra, bank];
};

const SEED_JOURNALS: Journal[] = [
  { number: 'JE-10298', date: '2026-09-29', narration: 'Receipt Desert Mall FM — INV-2026-0101', source: 'Receipt', status: 'posted', lines: [{ account: '1021', debit: 40110, credit: 0 }, { account: '1100', debit: 0, credit: 40110 }] },
  { number: 'JE-10301', date: '2026-09-30', narration: 'September depreciation run', source: 'Manual', status: 'posted', lines: [{ account: '5600', debit: 6350, credit: 0 }, { account: '1640', debit: 0, credit: 2400 }, { account: '1650', debit: 0, credit: 3950 }] },
  { number: 'JE-10302', date: '2026-09-30', narration: 'Gratuity accrual — September', source: 'Manual', status: 'posted', lines: [{ account: '5120', debit: 3210, credit: 0 }, { account: '2410', debit: 0, credit: 3210 }] },
  { number: 'JE-10303', date: '2026-10-10', narration: 'Accrue Q3 audit fee', source: 'Manual', status: 'draft', lines: [{ account: '5500', debit: 9500, credit: 0 }, { account: '2010', debit: 0, credit: 9500 }] },
];

const nextSeq = (values: (string | null)[], prefix: string, pad: number) => {
  const max = Math.max(0, ...values.filter(Boolean).map((v) => Number(v!.slice(prefix.length))));
  return `${prefix}${String(max + 1).padStart(pad, '0')}`;
};

export function useStore() {
  const [invoices, setInvoices] = useState<Invoice[]>(SEED_INVOICES);
  const [bills, setBills] = useState<Bill[]>(SEED_BILLS);
  const [feed, setFeed] = useState<FeedRow[]>(SEED_FEED);
  const [journals, setJournals] = useState<Journal[]>(SEED_JOURNALS);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = (text: string, tone: Toast['tone'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  };

  const seq = useRef(10303);
  const post = (j: Omit<Journal, 'number'>): string => {
    if (j.status === 'posted' && !isBalanced(j.lines)) throw new Error('Unbalanced journal rejected');
    const number = `JE-${++seq.current}`;
    setJournals((all) => [...all, { ...j, number }]);
    return number;
  };

  const postDraft = (number: string) => {
    const j = journals.find((x) => x.number === number)!;
    if (!isBalanced(j.lines)) return notify('Debits must equal credits before posting', 'warning');
    setJournals((all) => all.map((x) => (x.number === number ? { ...x, status: 'posted' } : x)));
    notify(`${number} posted`);
  };

  /** Seeded journals dated ≤ cutoff are already inside BASE_BALANCES. */
  const sessionPosted = journals.filter((j) => j.status === 'posted' && j.date > LEDGER_CUTOFF);
  const balances = (asOf = '9999-12-31', from?: string) => {
    const b: Record<string, number> = from ? {} : { ...BASE_BALANCES };
    for (const j of sessionPosted) {
      if (j.date > asOf || (from && j.date < from)) continue;
      for (const l of j.lines) b[l.account] = r2((b[l.account] ?? 0) + l.debit - l.credit);
    }
    return b;
  };

  const saveInvoice = (inv: Invoice, mode: 'draft' | 'submit' | 'approve') => {
    const exists = invoices.some((i) => i.id === inv.id);
    const next: Invoice = { ...inv, stage: mode === 'draft' ? 'draft' : mode === 'submit' ? 'awaiting_approval' : 'issued' };
    if (mode === 'approve') {
      next.number = nextSeq(invoices.map((i) => i.number), 'INV-2026-', 4);
      post({ date: next.issueDate, narration: `Sales invoice ${next.number}`, source: 'Sales invoice', status: 'posted', lines: invoiceJournal(next.lines, next.number) });
    }
    setInvoices((all) => (exists ? all.map((i) => (i.id === inv.id ? next : i)) : [next, ...all]));
    notify(mode === 'approve' ? `${next.number} issued and posted to ledger` : mode === 'submit' ? 'Invoice submitted for approval' : 'Draft saved', mode === 'draft' ? 'info' : 'success');
  };

  const advanceInvoice = (id: string) => {
    const inv = invoices.find((i) => i.id === id)!;
    saveInvoice(inv, inv.stage === 'draft' ? 'submit' : 'approve');
  };

  const receive = (invoiceId: string, amount: number, bank: string, date: string, viaFeed = false) => {
    const inv = invoices.find((i) => i.id === invoiceId)!;
    post({ date, narration: `Receipt ${inv.number}`, source: viaFeed ? 'Bank reconciliation' : 'Receipt', status: 'posted', lines: [{ account: bank, debit: amount, credit: 0 }, { account: '1100', debit: 0, credit: amount, memo: inv.number ?? '' }] });
    setInvoices((all) => all.map((i) => (i.id === invoiceId ? { ...i, paid: r2(i.paid + amount) } : i)));
  };

  const pay = (billId: string, amount: number, bank: string, date: string, viaFeed = false) => {
    const bill = bills.find((b) => b.id === billId)!;
    post({ date, narration: `Payment ${bill.number}`, source: viaFeed ? 'Bank reconciliation' : 'Supplier payment', status: 'posted', lines: [{ account: '2000', debit: amount, credit: 0, memo: bill.number }, { account: bank, debit: 0, credit: amount }] });
    setBills((all) => all.map((b) => (b.id === billId ? { ...b, paid: r2(b.paid + amount) } : b)));
  };

  /** [feature-spec-1_1_D §4.4 / D-8] allowance method: Dr 1110, Cr 1100. */
  const writeOff = (id: string) => {
    const inv = invoices.find((i) => i.id === id)!;
    const amt = invoiceBalance(inv);
    post({ date: TODAY, narration: `Write-off ${inv.number}`, source: 'Write-off', status: 'posted', lines: [{ account: '1110', debit: amt, credit: 0 }, { account: '1100', debit: 0, credit: amt, memo: inv.number ?? '' }] });
    setInvoices((all) => all.map((i) => (i.id === id ? { ...i, writtenOff: true } : i)));
    notify(`${inv.number} written off against ECL allowance`, 'warning');
  };

  const remind = (id: string, auto?: boolean) => {
    setInvoices((all) => all.map((i) => (i.id === id ? (auto === undefined ? { ...i, reminders: i.reminders + 1 } : { ...i, autoDunning: auto }) : i)));
    const inv = invoices.find((i) => i.id === id)!;
    notify(auto === undefined ? `Reminder emailed for ${inv.number}` : auto ? `Auto-dunning on for ${inv.number} (7 / 14 / 30 days)` : 'Auto-dunning paused', 'info');
  };

  const saveBill = (bill: Bill) => {
    const number = nextSeq(bills.map((b) => b.number), 'BILL-2026-', 4);
    post({ date: bill.billDate, narration: `Bill ${number} · ${bill.supplierRef}`, source: 'Bill', status: 'posted', lines: billJournal(bill.lines, number) });
    setBills((all) => [{ ...bill, number }, ...all]);
    notify(`${number} posted to Accounts Payable`);
  };

  const reconcile = (row: FeedRow, coding?: Coding) => {
    if (row.match?.kind === 'invoice') receive(row.match.id, row.amount, '1021', row.date, true);
    else if (row.match?.kind === 'bill') pay(row.match.id, -row.amount, '1021', row.date, true);
    else if (coding) post({ date: row.date, narration: `${row.payee} — ${row.description}`, source: 'Bank reconciliation', status: 'posted', lines: codingJournal(row, coding) });
    setFeed((f) => f.filter((x) => x.id !== row.id));
  };

  return {
    invoices, bills, feed, journals, toasts,
    notify, post, postDraft, balances, saveInvoice, advanceInvoice, receive, pay, writeOff, remind, saveBill, reconcile,
    openAR: () => invoices.filter((i) => i.stage === 'issued' && invoiceBalance(i) > 0),
    openAP: () => bills.filter((b) => billBalance(b) > 0),
    dismissToast: (id: number) => setToasts((t) => t.filter((x) => x.id !== id)),
  };
}
export type Store = ReturnType<typeof useStore>;
