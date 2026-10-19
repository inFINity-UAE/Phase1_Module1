import { useState } from 'react';
import { copy } from './copy';
import { cx } from '../ui';

export function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="scroll-mt-20">
      <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{copy.faqTitle}</h2>
      <div className="mt-6 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
        {copy.faq.map((item, i) => {
          const on = open === i;
          return (
            <div key={item.q}>
              <h3>
                <button
                  type="button"
                  aria-expanded={on}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-sm font-medium text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40"
                  onClick={() => setOpen(on ? null : i)}
                >
                  {item.q}
                  <span aria-hidden className="text-slate-400">{on ? '–' : '+'}</span>
                </button>
              </h3>
              <div className={cx(!on && 'hidden')}>
                <p className="px-5 pb-4 text-sm leading-relaxed text-slate-600">{item.a}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
