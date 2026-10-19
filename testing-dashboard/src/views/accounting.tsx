import { Fragment, useEffect, useState } from 'react';
import { ChevronRight, NotebookPen, Search } from 'lucide-react';
import { ACCOUNTS, accountType, acct, fmtDate, type AccountType } from '../data';
import { isBalanced, jTotals } from '../store';
import { Badge, Button, Card, Money, PageHeader, Tabs, cx, inputCls, rowCls, tdCls, thCls } from '../ui';
import type { ViewProps } from '../App';
import { apiFetch } from '../api';

const TYPES: AccountType[] = ['Asset', 'Liability', 'Equity', 'Income', 'Expense'];

export function ChartOfAccounts({ store, live }: ViewProps) {
  const [type, setType] = useState<AccountType | 'All'>('All');
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState<{ code: string; name: string; system: boolean }[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const companyId = live?.companyId;
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    apiFetch<{ account_number: string; account_name: string; is_system_account: boolean }[]>(`/accounts?company_id=${companyId}`)
      .then((rows) => {
        if (cancelled) return;
        setRemote(rows.map((r) => ({ code: r.account_number.trim(), name: r.account_name, system: r.is_system_account })));
      })
      .catch((err: unknown) => { if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Could not load accounts.'); });
    return () => { cancelled = true; };
  }, [companyId]);
  const b = store.balances();
  const source = live ? (remote ?? []).map((r) => [r.code, r.name, r.system] as const) : Object.entries(ACCOUNTS).map(([c, n]) => [c, n, c === '3100'] as const);
  const rows = source.filter(([c, n]) => (type === 'All' || accountType(c) === type) && (!q || `${c} ${n}`.toLowerCase().includes(q.toLowerCase())));
  const dr = Object.values(b).reduce((s, v) => s + Math.max(0, v), 0);
  const cr = Object.values(b).reduce((s, v) => s + Math.max(0, -v), 0);
  return (
    <>
      <PageHeader title="Chart of accounts" subtitle="UAE 4-digit COA: 1xxx assets · 2xxx liabilities · 3xxx equity · 4xxx income · 5xxx expenses." actions={<Badge tone={Math.abs(dr - cr) < 0.005 ? 'green' : 'red'}>Trial balance Dr <Money v={dr} /> = Cr <Money v={cr} /></Badge>} />
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3 px-5 pt-3">
          <Tabs value={type} onChange={setType} tabs={[{ id: 'All', label: 'All' }, ...TYPES.map((t) => ({ id: t, label: `${t}s`, count: source.filter(([c]) => accountType(c) === t).length }))]} />
          <div className="relative mb-2 w-full sm:w-64">
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input aria-label="Filter accounts" className={cx(inputCls, 'pl-8!')} placeholder="Code or name" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead className="border-y border-slate-100 bg-slate-50/70"><tr><th className={cx(thCls, 'w-24')}>Code</th><th className={thCls}>Account name</th><th className={thCls}>Type</th><th className={cx(thCls, 'text-right')}>Debit</th><th className={cx(thCls, 'text-right')}>Credit</th></tr></thead>
            <tbody>
              {loadError ? <tr><td className={tdCls} colSpan={5}>{loadError}</td></tr> : null}
              {rows.map(([c, n, system]) => {
                const v = b[c] ?? 0;
                return (
                  <tr key={c} className={rowCls}>
                    <td className={cx(tdCls, 'num font-semibold text-slate-900')}>{c}</td>
                    <td className={tdCls}>{n}{system ? <Badge tone="slate">System</Badge> : null}</td>
                    <td className={tdCls}><span className="text-xs text-slate-500">{accountType(c)}</span></td>
                    <td className={cx(tdCls, 'text-right')}>{v > 0 ? <Money v={v} /> : <span className="text-slate-300">—</span>}</td>
                    <td className={cx(tdCls, 'text-right')}>{v < 0 ? <Money v={-v} /> : <span className="text-slate-300">—</span>}</td>
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

export function Journals({ store, open }: ViewProps) {
  const [openRow, setOpenRow] = useState<string | null>(null);
  const list = [...store.journals].reverse();
  return (
    <>
      <PageHeader title="Journal entries" subtitle="Every invoice, bill, payment and reconciliation posts a balanced journal. Posted entries are immutable — correct them by reversal." actions={<Button variant="primary" onClick={() => open({ kind: 'journal' })}><NotebookPen size={16} /> Manual journal</Button>} />
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[860px]">
          <thead className="bg-slate-50/70"><tr><th className="w-8" /><th className={thCls}>Entry</th><th className={thCls}>Date</th><th className={thCls}>Narration</th><th className={thCls}>Source</th><th className={cx(thCls, 'text-right')}>Amount</th><th className={thCls}>Check</th><th className={thCls}>Status</th></tr></thead>
          <tbody>
            {list.map((j) => {
              const t = jTotals(j.lines);
              const exp = openRow === j.number;
              return (
                <Fragment key={j.number}>
                  <tr className={cx(rowCls, 'cursor-pointer')} onClick={() => setOpenRow(exp ? null : j.number)}>
                    <td className="pl-3"><ChevronRight size={15} className={cx('text-slate-400 transition-transform', exp && 'rotate-90')} /></td>
                    <td className={cx(tdCls, 'num font-medium text-slate-900')}>{j.number}</td>
                    <td className={tdCls}>{fmtDate(j.date)}</td>
                    <td className={tdCls}>{j.narration}</td>
                    <td className={tdCls}><span className="text-xs text-slate-500">{j.source}</span></td>
                    <td className={cx(tdCls, 'text-right font-medium')}><Money v={t.debit} /></td>
                    <td className={tdCls}>{isBalanced(j.lines) ? <Badge tone="green">Dr = Cr</Badge> : <Badge tone="red">Unbalanced</Badge>}</td>
                    <td className={tdCls} onClick={(e) => e.stopPropagation()}>
                      {j.status === 'posted' ? <Badge tone="green">Posted</Badge> : <Button size="sm" variant="primary" onClick={() => store.postDraft(j.number)}>Post</Button>}
                    </td>
                  </tr>
                  {exp ? (
                    <tr className="bg-slate-50/60">
                      <td />
                      <td colSpan={7} className="px-3 pb-4 pt-1">
                        <table className="w-full max-w-3xl rounded-lg border border-slate-200 bg-white">
                          <tbody>
                            {j.lines.map((l, i) => (
                              <tr key={i} className="border-t border-slate-100 first:border-0 text-xs">
                                <td className={cx('px-3 py-1.5 text-slate-700', l.credit > 0 && 'pl-8')}>{acct(l.account)}</td>
                                <td className="px-3 py-1.5 text-slate-500">{l.memo}</td>
                                <td className="px-3 py-1.5 text-right">{l.debit ? <Money v={l.debit} /> : null}</td>
                                <td className="px-3 py-1.5 text-right">{l.credit ? <Money v={l.credit} /> : null}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}
