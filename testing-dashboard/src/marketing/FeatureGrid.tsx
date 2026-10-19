import { BarChart3, BookOpen, Landmark, Receipt, ShieldCheck, ShoppingCart } from 'lucide-react';
import { copy } from './copy';

const icons = [BookOpen, Receipt, ShoppingCart, Landmark, ShieldCheck, BarChart3];

export function FeatureGrid() {
  return (
    <section id="features" className="scroll-mt-20">
      <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{copy.featuresTitle}</h2>
      <p className="mt-2 max-w-2xl text-sm text-slate-600">{copy.featuresIntro}</p>
      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {copy.features.map((item, i) => {
          const Icon = icons[i] ?? BookOpen;
          return (
            <li key={item.title} className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <Icon size={18} className="text-brand-700" aria-hidden />
              <h3 className="mt-3 text-sm font-semibold text-slate-900">{item.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{item.text}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
