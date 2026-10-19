import { BadgeAlert, Download, FileLock2, Info, Scale, Users } from 'lucide-react';
import { COMPANIES, CT, RELATED_PARTIES, TODAY, VAT_BOX1, VAT_OTHER, acct, daysBetween, fmtDate, plSummary, r2 } from '../data';
import { downloadBlob, toCsv, aed } from '../lib';
import { Badge, Button, Card, CardHeader, Money, PageHeader, cx, tdCls, thCls } from '../ui';
import type { ViewProps } from '../App';

const pct = (a: number, rate = 5) => r2((a * rate) / 100);

export function Vat201({ store }: ViewProps) {
  const seeded = store.demo;
  const box1 = VAT_BOX1.map((r, i) => ({ code: `1${'abcdefg'[i]}`, label: `Standard rated supplies in ${r.emirate}`, amount: seeded ? r.amount : 0, vat: pct(seeded ? r.amount : 0), adj: seeded ? r.adj : 0 }));
  const o = seeded ? VAT_OTHER : {
    box3: { ...VAT_OTHER.box3, amount: 0 }, box4: { ...VAT_OTHER.box4, amount: 0 }, box5: { ...VAT_OTHER.box5, amount: 0 },
    box6: { ...VAT_OTHER.box6, amount: 0 }, box7: { ...VAT_OTHER.box7, amount: 0 }, box9: { ...VAT_OTHER.box9, amount: 0, adj: 0 }, box10: { ...VAT_OTHER.box10, amount: 0 },
  };
  const outputs = [
    ...box1,
    { code: '2', label: null, amount: 0, vat: 0, adj: 0 },
    { code: '3', label: o.box3.label, amount: o.box3.amount, vat: pct(o.box3.amount), adj: 0 },
    { code: '4', label: o.box4.label, amount: o.box4.amount, vat: 0, adj: 0 },
    { code: '5', label: o.box5.label, amount: o.box5.amount, vat: 0, adj: 0 },
    { code: '6', label: o.box6.label, amount: o.box6.amount, vat: pct(o.box6.amount), adj: 0 },
    { code: '7', label: o.box7.label, amount: o.box7.amount, vat: 0, adj: 0 },
  ];
  const inputs = [
    { code: '9', label: o.box9.label, amount: o.box9.amount, vat: pct(o.box9.amount), adj: o.box9.adj },
    { code: '10', label: o.box10.label, amount: o.box10.amount, vat: pct(o.box10.amount), adj: 0 },
  ];
  const sum = (rows: typeof outputs, k: 'amount' | 'vat' | 'adj') => r2(rows.reduce((s, r) => s + r[k], 0));
  const box12 = r2(sum(outputs, 'vat') + sum(outputs, 'adj'));
  const box13 = r2(sum(inputs, 'vat') + sum(inputs, 'adj'));
  const box14 = r2(box12 - box13);
  const maxEmirate = Math.max(...box1.map((r) => r.amount), 1);

  const exportCsv = () => {
    const rows = [...outputs, { code: '8', label: 'Total output tax', amount: sum(outputs, 'amount'), vat: sum(outputs, 'vat'), adj: sum(outputs, 'adj') }, ...inputs, { code: '11', label: 'Total input tax', amount: sum(inputs, 'amount'), vat: sum(inputs, 'vat'), adj: sum(inputs, 'adj') }];
    downloadBlob('vat201_Q3-2026_working_papers.csv', new Blob([toCsv(['box', 'description', 'amount_aed', 'vat_aed', 'adjustment_aed'], [...rows.map((r) => [r.code, r.label ?? 'UNSEEDED (F-42)', r.amount, r.vat, r.adj]), ['12', 'Total payable tax', '', box12, ''], ['13', 'Total recoverable tax', '', box13, ''], ['14', 'Net VAT payable / refundable', '', box14, '']])], { type: 'text/csv' }));
    store.notify('VAT-201 working papers downloaded');
  };

  const Section = ({ title, rows, totalCode, totalLabel }: { title: string; rows: typeof outputs; totalCode: string; totalLabel: string }) => (
    <Card className="overflow-x-auto">
      <CardHeader title={title} />
      <table className="w-full min-w-[760px]">
        <thead className="bg-slate-50/70"><tr><th className={cx(thCls, 'w-16')}>Box</th><th className={thCls}>Description</th><th className={cx(thCls, 'text-right')}>Amount (AED)</th><th className={cx(thCls, 'text-right')}>VAT amount (AED)</th><th className={cx(thCls, 'text-right')}>Adjustment (AED)</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code} className={cx('border-t border-slate-100', r.label === null && 'bg-amber-50/50')}>
              <td className={cx(tdCls, 'num font-semibold text-slate-900')}>{r.code}</td>
              <td className={tdCls}>{r.label ?? <span className="flex items-center gap-2 text-amber-800"><BadgeAlert size={15} /> Label not yet seeded — awaiting EmaraTax screenshot (feature-spec-1_1_F F-42)</span>}</td>
              <td className={cx(tdCls, 'text-right')}>{r.label === null ? '—' : <Money v={r.amount} />}</td>
              <td className={cx(tdCls, 'text-right')}>{r.label === null ? '—' : <Money v={r.vat} />}</td>
              <td className={cx(tdCls, 'text-right')}>{r.label === null ? '—' : <Money v={r.adj} sign />}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-900">
            <td className={cx(tdCls, 'num font-bold text-slate-900')}>{totalCode}</td>
            <td className={cx(tdCls, 'font-semibold text-slate-900')}>{totalLabel}</td>
            <td className={cx(tdCls, 'text-right')}><Money v={sum(rows, 'amount')} /></td>
            <td className={cx(tdCls, 'text-right')}><Money v={sum(rows, 'vat')} /></td>
            <td className={cx(tdCls, 'text-right')}><Money v={sum(rows, 'adj')} sign /></td>
          </tr>
        </tbody>
      </table>
    </Card>
  );

  return (
    <>
      <PageHeader
        title="UAE VAT-201 return"
        subtitle={seeded ? `Tax period Q3 2026 · ${fmtDate('2026-07-01')} – ${fmtDate('2026-09-30')} · TRN ${COMPANIES[0].trn}` : 'VAT return is not connected to this workspace yet. Every box is zero.'}
        actions={<><Badge tone="amber">Draft — not filed</Badge><Button onClick={exportCsv}><Download size={16} /> Working papers CSV</Button><Button variant="primary" disabled title="Blocked until Box 2 and the Capital Assets Scheme box are seeded (F-42)"><FileLock2 size={16} /> Export for EmaraTax</Button></>}
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Section title="VAT on sales and all other outputs" rows={outputs} totalCode="8" totalLabel="Total output tax" />
          <Section title="VAT on expenses and all other inputs" rows={inputs} totalCode="11" totalLabel="Total input tax" />
        </div>
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <div className={cx('px-5 py-5 text-white', box14 >= 0 ? 'bg-brand-800' : 'bg-emerald-700')}>
              <p className="text-xs font-medium uppercase tracking-wide text-white/70">Box 14 · Net VAT {box14 >= 0 ? 'payable' : 'reclaimable'}</p>
              <p className="num mt-1 text-3xl font-semibold">AED {aed(Math.abs(box14))}</p>
            </div>
            <dl className="divide-y divide-slate-100 text-sm">
              <div className="flex justify-between px-5 py-3"><dt className="text-slate-600">Box 12 · Total payable tax</dt><dd><Money v={box12} className="font-medium" /></dd></div>
              <div className="flex justify-between px-5 py-3"><dt className="text-slate-600">Box 13 · Total recoverable tax</dt><dd><Money v={box13} className="font-medium" /></dd></div>
              <div className="flex justify-between px-5 py-3 font-semibold text-slate-900"><dt>Box 14 · Payable − recoverable</dt><dd><Money v={box14} /></dd></div>
            </dl>
            <p className="flex gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3 text-xs text-slate-500"><Info size={14} className="mt-px shrink-0" />Settlement posts Dr {acct('2200').split(' · ')[0]} / Cr {acct('1400').split(' · ')[0]} with the net to the bank.</p>
          </Card>
          <Card>
            <CardHeader title="Box 1 by Emirate" subtitle="Standard-rated supplies (place of supply)" />
            <ul className="space-y-3 px-5 py-4">
              {box1.map((r) => (
                <li key={r.code} className="text-xs">
                  <div className="mb-1 flex justify-between"><span className="text-slate-600">{r.label.replace('Standard rated supplies in ', '')}</span><Money v={r.amount} className="font-medium text-slate-800" /></div>
                  <div className="h-1.5 rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-500" style={{ width: `${(r.amount / maxEmirate) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

export function CorporateTax({ store }: ViewProps) {
  const pl = plSummary(store.balances());
  const usage = (pl.pbt / CT.zeroBand) * 100;
  const alert = usage >= CT.alertPct;
  const monthsElapsed = 8 + daysBetween('2026-09-01', TODAY) / 30.4;
  const projected = r2((pl.pbt / monthsElapsed) * 12);
  const projectedCt = r2((Math.max(0, projected - CT.zeroBand) * CT.rate) / 100);
  const sbrUse = (pl.grossSales / CT.sbrRevenueCap) * 100;
  const parties = store.demo ? RELATED_PARTIES : [];
  const rpTotal = parties.reduce((s, r) => s + r.amount, 0);
  return (
    <>
      <PageHeader title="Corporate tax tracker" subtitle="UAE CT: 0% on taxable income up to AED 375,000, 9% above. FY 2026 · Jan–Dec." />
      {alert ? (
        <div role="status" className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          <BadgeAlert size={20} className="mt-px shrink-0 text-amber-600" />
          <p><strong>Threshold alert.</strong> Taxable profit is at {usage.toFixed(1)}% of the AED {aed(CT.zeroBand)} 0% band (alert at {CT.alertPct}% = AED {aed((CT.zeroBand * CT.alertPct) / 100)}). Run-rate projects AED {aed(projected)} for the full year.</p>
        </div>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Taxable income vs statutory threshold" subtitle="Year-to-date accounting profit before CT adjustments" />
          <div className="px-5 py-6">
            <div className="flex items-end justify-between">
              <p className="num text-3xl font-semibold text-slate-900">AED {aed(pl.pbt)}</p>
              <p className="text-sm text-slate-500">of AED {aed(CT.zeroBand)}</p>
            </div>
            <div className="relative mt-4 h-4 rounded-full bg-slate-100">
              <div className={cx('h-full rounded-full transition-all', usage >= 100 ? 'bg-rose-500' : alert ? 'bg-amber-400' : 'bg-emerald-500')} style={{ width: `${Math.min(100, usage)}%` }} />
              <div className="absolute -top-1.5 h-7 w-0.5 bg-amber-600" style={{ left: `${CT.alertPct}%` }} title="90% alert" />
            </div>
            <div className="mt-2 flex justify-between text-xs text-slate-500"><span>AED 0</span><span className="text-amber-700" style={{ marginLeft: `${CT.alertPct - 12}%` }}>90% alert</span><span>375,000</span></div>
          </div>
          <table className="w-full border-t border-slate-100">
            <tbody className="text-sm">
              {[
                ['Taxable income (YTD)', pl.pbt],
                [`First AED ${aed(CT.zeroBand)} @ 0%`, 0],
                [`Excess AED ${aed(Math.max(0, pl.pbt - CT.zeroBand))} @ ${CT.rate}%`, pl.ct],
              ].map(([l, v]) => <tr key={l as string} className="border-t border-slate-100"><td className={tdCls}>{l}</td><td className={cx(tdCls, 'text-right')}><Money v={v as number} /></td></tr>)}
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-900"><td className={tdCls}>Estimated CT provision (YTD)</td><td className={cx(tdCls, 'text-right font-semibold')}><Money v={pl.ct} /></td></tr>
              <tr className="border-t border-slate-100 text-slate-500"><td className={tdCls}>Full-year run-rate estimate · {acct('2300')}</td><td className={cx(tdCls, 'text-right')}><Money v={projectedCt} /></td></tr>
            </tbody>
          </table>
          <div className="flex justify-end border-t border-slate-100 px-5 py-3">
            <Button variant="primary" disabled={pl.ct <= 0} title={pl.ct <= 0 ? 'Nothing to provide — income is within the 0% band' : undefined} onClick={() => { store.post({ date: TODAY, narration: 'CT provision YTD', source: 'Manual', status: 'posted', lines: [{ account: '5830', debit: pl.ct, credit: 0 }, { account: '2300', debit: 0, credit: pl.ct }] }); store.notify('CT provision posted'); }}>
              <Scale size={16} /> Post CT provision
            </Button>
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Small Business Relief monitor" subtitle={`Revenue cap AED ${aed(CT.sbrRevenueCap)} · tax periods ending by 31 Dec 2026`} />
            <div className="px-5 py-4">
              <div className="flex items-center justify-between text-sm"><span className="text-slate-600">Revenue YTD</span><Money v={pl.grossSales} className="font-semibold" /></div>
              <div className="mt-2 h-2 rounded-full bg-slate-100"><div className={cx('h-full rounded-full', sbrUse > 100 ? 'bg-rose-500' : 'bg-brand-500')} style={{ width: `${Math.min(100, sbrUse)}%` }} /></div>
              <p className="mt-2 text-xs text-slate-500">{sbrUse.toFixed(1)}% of cap used</p>
              <p className="mt-3"><Badge tone={sbrUse <= 100 ? 'green' : 'red'}>{sbrUse <= 100 ? 'Eligible this period — election required' : 'Not eligible'}</Badge></p>
              <p className="mt-2 text-[11px] text-slate-400">Eligibility also requires revenue under the cap in all prior periods (feature-spec-1_1_G G-4).</p>
            </div>
          </Card>
          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><Users size={16} className="text-slate-400" /> Related-party transactions</span>} subtitle="Append-only log for transfer pricing documentation" />
            <ul className="divide-y divide-slate-100">
              {parties.map((r) => (
                <li key={r.party + r.date} className="px-5 py-3 text-sm">
                  <div className="flex justify-between gap-3"><span className="font-medium text-slate-800">{r.party}</span><Money v={r.amount} className="font-medium" /></div>
                  <p className="text-xs text-slate-500">{r.relationship} · {r.nature} · {fmtDate(r.date)}</p>
                </li>
              ))}
            </ul>
            <div className="flex justify-between border-t border-slate-100 bg-slate-50 px-5 py-3 text-sm font-semibold"><span>Total YTD</span><Money v={rpTotal} /></div>
          </Card>
        </div>
      </div>
    </>
  );
}
