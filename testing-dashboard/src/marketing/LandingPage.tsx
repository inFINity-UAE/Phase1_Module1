import { useEffect } from 'react';
import { copy } from './copy';
import { MarketingNav } from './MarketingNav';
import { Footer } from './Footer';
import { FeatureGrid } from './FeatureGrid';
import { FAQ } from './FAQ';
import { Link, navigate } from '../router';
import { SAMPLE_SESSION, saveDemo, type DemoSession } from '../session';

const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50';

function Ctas({ onSample }: { onSample: () => void }) {
  return (
    <div className="mt-8 flex flex-col gap-3 sm:flex-row">
      <Link href="/signup" className={`inline-flex h-11 items-center justify-center rounded-md bg-brand-700 px-5 text-sm font-medium text-white hover:bg-brand-800 ${focus}`}>
        {copy.hero.primary}
      </Link>
      <button type="button" onClick={onSample} className={`inline-flex h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-5 text-sm font-medium text-slate-800 hover:bg-slate-50 ${focus}`}>
        {copy.hero.secondary}
      </button>
    </div>
  );
}

function Preview() {
  const bars = [42, 55, 48, 70, 64, 82];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.06)] sm:p-6" aria-hidden>
      <p className="text-xs font-medium text-slate-500">{copy.preview.label}</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {[
          ['Cash', copy.preview.cash],
          ['Receivables', copy.preview.receivables],
          ['Payables', copy.preview.payables],
          ['Profit', copy.preview.profit],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg bg-slate-50 px-3 py-3">
            <p className="text-[11px] text-slate-500">{label}</p>
            <p className="num mt-1 text-sm font-semibold text-slate-900 sm:text-base">AED {value}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 flex h-16 items-end gap-1.5">
        {bars.map((h, i) => (
          <span key={i} className="flex-1 rounded-sm bg-brand-600/80" style={{ height: `${h}%` }} />
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-3 text-sm">
        <span>
          <span className="num font-medium text-slate-900">{copy.preview.invoice}</span>
          <span className="mt-0.5 block text-xs text-slate-500">{copy.preview.customer}</span>
        </span>
        <span className="text-right text-xs text-slate-600">
          <span className="num block">Net AED {copy.preview.net}</span>
          <span className="num block">VAT 5% AED {copy.preview.vat}</span>
        </span>
      </div>
    </div>
  );
}

export function LandingPage({ authed, onSample }: { authed: boolean; onSample: () => void }) {
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);
  return (
    <div className="min-h-full bg-[#f6f8fb]">
      <MarketingNav authed={authed} />
      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-2 lg:py-20">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl sm:leading-tight">{copy.hero.title}</h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-600">{copy.hero.sub}</p>
            {authed ? (
              <button type="button" onClick={() => navigate('/app')} className={`mt-8 inline-flex h-11 items-center rounded-md bg-brand-700 px-5 text-sm font-medium text-white hover:bg-brand-800 ${focus}`}>{copy.openWorkspace}</button>
            ) : <Ctas onSample={onSample} />}
            <p className="mt-4 text-sm text-slate-500">{copy.hero.note}</p>
          </div>
          <Preview />
        </section>
        <div className="mx-auto max-w-6xl space-y-16 px-4 py-8 sm:px-6 sm:py-12">
          <FeatureGrid />
          <section id="how" className="scroll-mt-20">
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{copy.howTitle}</h2>
            <p className="mt-2 text-sm text-slate-600">{copy.howNote}</p>
            <ol className="mt-8 grid gap-4 md:grid-cols-3">
              {copy.how.map((step) => (
                <li key={step.n} className="rounded-xl border border-slate-200 bg-white p-5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-800">{step.n}</span>
                  <h3 className="mt-3 text-sm font-semibold text-slate-900">{step.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{step.text}</p>
                </li>
              ))}
            </ol>
          </section>
          <section id="compliance" className="scroll-mt-20 rounded-2xl bg-brand-900 px-5 py-8 text-white sm:px-8">
            <h2 className="text-2xl font-semibold tracking-tight">{copy.complianceTitle}</h2>
            <ul className="mt-6 space-y-3 text-sm leading-relaxed text-brand-100">
              {copy.compliance.map((line) => <li key={line}>{line}</li>)}
            </ul>
            <p className="mt-6 text-sm font-medium text-white">{copy.complianceNote}</p>
          </section>
          <section aria-label={copy.soonTitle}>
            <h2 className="text-lg font-semibold text-slate-700">{copy.soonTitle}</h2>
            <p className="mt-1 text-sm text-slate-500">{copy.soonNote}</p>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {copy.soon.map((item) => (
                <li key={item} className="rounded-lg border border-slate-200 bg-slate-100/80 px-4 py-3 text-sm text-slate-500">
                  {item}
                  <span className="mt-1 block text-[11px] font-medium uppercase tracking-wide text-slate-400">Coming soon</span>
                </li>
              ))}
            </ul>
          </section>
          <FAQ />
          <section className="rounded-2xl border border-slate-200 bg-white px-5 py-10 text-center sm:px-8">
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{copy.cta.title}</h2>
            {authed ? (
              <button type="button" onClick={() => navigate('/app')} className={`mt-6 inline-flex h-11 items-center rounded-md bg-brand-700 px-5 text-sm font-medium text-white ${focus}`}>{copy.openWorkspace}</button>
            ) : (
              <div className="mt-2 flex justify-center"><Ctas onSample={onSample} /></div>
            )}
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}

export function openSample(onReady: (s: DemoSession) => void) {
  saveDemo(SAMPLE_SESSION);
  onReady(SAMPLE_SESSION);
}
