import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Check, CheckCheck, Plus, Wand2 } from 'lucide-react';
import { ACCOUNTS, BANK_RULES, acct, billBalance, customer, fmtDate, invoiceBalance, r2, vendor, type BankRule, type FeedRow } from '../data';
import { codingJournal, type Coding } from '../store';
import { aed } from '../lib';
import { Badge, Button, Card, CardHeader, Empty, Field, JournalPreview, Money, PageHeader, cx, inputCls } from '../ui';
import type { ViewProps } from '../App';

const CODABLE = Object.keys(ACCOUNTS).filter((c) => c !== '1021' && c !== '1100' && c !== '2000');

export function BankRec({ store }: ViewProps) {
  const [rules, setRules] = useState<BankRule[]>(BANK_RULES);
  const [coding, setCoding] = useState<Record<string, Coding>>({});
  const [preview, setPreview] = useState<string | null>(null);
  const [draft, setDraft] = useState<Omit<BankRule, 'id'>>({ name: '', contains: '', account: '5990', vatInclusive: false });
  const [adding, setAdding] = useState(false);

  const ruleFor = (row: FeedRow) => rules.find((r) => row.description.toUpperCase().includes(r.contains.toUpperCase()));
  const codingFor = (row: FeedRow): Coding | undefined => {
    if (coding[row.id]) return coding[row.id];
    const r = ruleFor(row);
    return r ? { account: r.account, vatInclusive: r.vatInclusive } : undefined;
  };
  const matchFor = (row: FeedRow) => {
    if (row.match?.kind === 'invoice') {
      const inv = store.invoices.find((i) => i.id === row.match!.id);
      if (inv && invoiceBalance(inv) >= row.amount) return { ref: inv.number!, who: customer(inv.customerId).name, open: invoiceBalance(inv), kind: 'Sales invoice' };
    }
    if (row.match?.kind === 'bill') {
      const b = store.bills.find((x) => x.id === row.match!.id);
      if (b && billBalance(b) >= -row.amount) return { ref: b.number, who: vendor(b.vendorId).name, open: billBalance(b), kind: 'Purchase bill' };
    }
    return null;
  };

  const ledger = store.balances()['1021'] ?? 0;
  const unrec = r2(store.feed.reduce((s, f) => s + f.amount, 0));
  const matched = store.feed.filter((f) => matchFor(f));
  const ok = (row: FeedRow) => {
    const m = matchFor(row);
    store.reconcile(m ? row : { ...row, match: undefined }, m ? undefined : codingFor(row));
    store.notify(m ? `Matched to ${m.ref}` : `Coded to ${codingFor(row)!.account} and reconciled`);
  };

  return (
    <>
      <PageHeader
        title="Bank reconciliation"
        subtitle={store.demo ? `${acct('1021')} · Emirates NBD ••• 4471 · feed updated ${fmtDate('2026-10-13')} 07:00` : 'Bank feed is not connected. Nothing here is posted to your books.'}
        actions={matched.length ? <Button variant="success" onClick={() => { matched.forEach((r) => store.reconcile(r)); store.notify(`${matched.length} matched items reconciled`); }}><CheckCheck size={16} /> OK all {matched.length} matches</Button> : null}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Statement balance', v: r2(ledger + unrec), cls: 'text-slate-900' },
          { label: 'Balance in inFINity (1021)', v: ledger, cls: 'text-slate-900' },
          { label: `Difference · ${store.feed.length} items to reconcile`, v: unrec, cls: unrec ? 'text-amber-700' : 'text-emerald-600' },
        ].map((x) => (
          <Card key={x.label} className="px-5 py-4">
            <p className="text-xs font-medium text-slate-500">{x.label}</p>
            <p className={cx('num mt-1 text-xl font-semibold', x.cls)}>AED <Money v={x.v} /></p>
          </Card>
        ))}
      </div>

      <Card>
        <div className="hidden grid-cols-2 gap-6 border-b border-slate-100 px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 lg:grid">
          <span>Bank statement lines</span>
          <span>Match or create in inFINity</span>
        </div>
        <div className="max-h-[640px] divide-y divide-slate-100 overflow-y-auto">
          {store.feed.map((row) => {
            const m = matchFor(row);
            const c = codingFor(row);
            const rule = ruleFor(row);
            const inflow = row.amount > 0;
            return (
              <div key={row.id} className="grid gap-3 px-5 py-4 transition-colors hover:bg-slate-50/60 lg:grid-cols-2 lg:gap-6">
                <div className="flex items-start gap-3">
                  <span className={cx('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', inflow ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500')}>{inflow ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900">{row.payee}</p>
                    <p className="truncate text-xs text-slate-500">{row.description}</p>
                    <p className="mt-0.5 text-xs text-slate-400">{fmtDate(row.date)}</p>
                  </div>
                  <div className="text-right">
                    <p className={cx('num text-sm font-semibold', inflow ? 'text-emerald-600' : 'text-slate-900')}>{inflow ? '+' : '−'}{aed(Math.abs(row.amount))}</p>
                    <p className="text-[11px] text-slate-400">{inflow ? 'Received' : 'Spent'}</p>
                  </div>
                </div>

                {m ? (
                  <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50/80 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-medium text-emerald-900"><Badge tone="green">Match found</Badge>{m.kind} {m.ref}</p>
                      <p className="mt-0.5 truncate text-xs text-emerald-800/80">{m.who} · open balance AED {aed(m.open)}{Math.abs(row.amount) < m.open ? ' · part payment' : ''}</p>
                    </div>
                    <Button variant="success" onClick={() => ok(row)}><Check size={15} /> OK</Button>
                  </div>
                ) : (
                  <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                    <div className="flex items-center gap-2">
                      <select aria-label={`Account for ${row.payee}`} className={cx(inputCls, 'h-8! min-w-0 flex-1')} value={c?.account ?? ''} onChange={(e) => setCoding((s) => ({ ...s, [row.id]: { account: e.target.value, vatInclusive: c?.vatInclusive ?? false } }))}>
                        <option value="">Code to account…</option>
                        {CODABLE.map((a) => <option key={a} value={a}>{acct(a)}</option>)}
                      </select>
                      <Button variant="primary" size="sm" disabled={!c?.account} onClick={() => ok(row)}><Check size={14} /> OK</Button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                      <select aria-label="Apply bank rule" className={cx(inputCls, 'h-7! w-36! px-2! text-xs!')} value="" onChange={(e) => { const r = rules.find((x) => x.id === e.target.value); if (r) setCoding((s) => ({ ...s, [row.id]: { account: r.account, vatInclusive: r.vatInclusive } })); }}>
                        <option value="">Apply rule…</option>
                        {rules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                      <label className="flex items-center gap-1.5 text-slate-600">
                        <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" checked={c?.vatInclusive ?? false} disabled={!c?.account} onChange={(e) => setCoding((s) => ({ ...s, [row.id]: { account: c!.account, vatInclusive: e.target.checked } }))} />
                        Includes 5% VAT
                      </label>
                      {rule && !coding[row.id] ? <span className="flex items-center gap-1 text-violet-700"><Wand2 size={12} /> Rule “{rule.name}” applied</span> : null}
                      {c?.account ? <button type="button" className="ml-auto font-medium text-brand-700 hover:underline" onClick={() => setPreview(preview === row.id ? null : row.id)}>{preview === row.id ? 'Hide' : 'Preview'} posting</button> : null}
                    </div>
                    {preview === row.id && c?.account ? <div className="mt-3"><JournalPreview lines={codingJournal(row, c)} /></div> : null}
                  </div>
                )}
              </div>
            );
          })}
          {!store.feed.length ? <Empty><span className="flex flex-col items-center gap-2"><CheckCheck size={28} className="text-emerald-500" />All caught up — the statement and ledger agree.</span></Empty> : null}
        </div>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Bank rules engine" subtitle="Rules suggest an account when a statement description contains the given text. You still confirm each line." actions={<Button size="sm" onClick={() => setAdding((a) => !a)}><Plus size={14} /> New rule</Button>} />
        {adding ? (
          <div className="grid gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-4 sm:grid-cols-[1fr_1fr_1.5fr_auto_auto] sm:items-end">
            <Field label="Rule name">{(id) => <input id={id} className={inputCls} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />}</Field>
            <Field label="Description contains">{(id) => <input id={id} className={inputCls} value={draft.contains} onChange={(e) => setDraft({ ...draft, contains: e.target.value })} placeholder="e.g. ENOC" />}</Field>
            <Field label="Code to">{(id) => <select id={id} className={inputCls} value={draft.account} onChange={(e) => setDraft({ ...draft, account: e.target.value })}>{CODABLE.map((a) => <option key={a} value={a}>{acct(a)}</option>)}</select>}</Field>
            <label className="flex h-9 items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" className="accent-brand-600" checked={draft.vatInclusive} onChange={(e) => setDraft({ ...draft, vatInclusive: e.target.checked })} /> 5% VAT</label>
            <Button variant="primary" disabled={!draft.name.trim() || draft.contains.trim().length < 3} onClick={() => { setRules([...rules, { ...draft, id: `r${Date.now()}` }]); setAdding(false); setDraft({ name: '', contains: '', account: '5990', vatInclusive: false }); store.notify('Bank rule saved'); }}>Save rule</Button>
          </div>
        ) : null}
        <ul className="divide-y divide-slate-100">
          {rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <Wand2 size={15} className="text-violet-500" />
              <span className="w-48 font-medium text-slate-800">{r.name}</span>
              <span className="text-slate-500">contains <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">{r.contains}</code></span>
              <span className="text-slate-400">→</span>
              <span className="text-slate-700">{acct(r.account)}</span>
              {r.vatInclusive ? <Badge tone="blue">incl. 5% VAT</Badge> : null}
              <span className="ml-auto text-xs text-slate-400">{store.feed.filter((f) => !f.match && f.description.toUpperCase().includes(r.contains.toUpperCase())).length} waiting</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
