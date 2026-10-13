import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ComponentType, type ReactNode } from 'react';
import { CheckCircle2, ChevronDown, Info, Scale, TriangleAlert, X } from 'lucide-react';
import { aed } from './lib';
import { acct } from './data';
import { jTotals, type JLine, type Toast } from './store';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export const inputCls =
  'h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-50 disabled:text-slate-500';
export const thCls = 'px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500';
export const tdCls = 'px-3 py-2.5 text-sm text-slate-700';
export const rowCls = 'border-t border-slate-100 transition-colors hover:bg-brand-50/60';

type BtnVariant = 'primary' | 'success' | 'outline' | 'ghost' | 'danger';
const BTN: Record<BtnVariant, string> = {
  primary: 'bg-brand-700 text-white shadow-sm hover:bg-brand-800 disabled:bg-slate-300',
  success: 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 disabled:bg-slate-300',
  outline: 'border border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50 disabled:text-slate-400',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-300',
  danger: 'bg-rose-600 text-white shadow-sm hover:bg-rose-700 disabled:bg-slate-300',
};

export function Button({ variant = 'outline', size = 'md', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      {...p}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-not-allowed',
        size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
        BTN[variant],
        className,
      )}
    />
  );
}

export type Tone = 'green' | 'amber' | 'red' | 'slate' | 'blue' | 'violet';
const TONE: Record<Tone, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/25',
  red: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  slate: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  blue: 'bg-brand-50 text-brand-700 ring-brand-600/20',
  violet: 'bg-violet-50 text-violet-700 ring-violet-600/20',
};
export const Badge = ({ tone = 'slate', children }: { tone?: Tone; children: ReactNode }) => (
  <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', TONE[tone])}>{children}</span>
);

export const Card = ({ className, children }: { className?: string; children: ReactNode }) => (
  <section className={cx('rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]', className)}>{children}</section>
);

export const CardHeader = ({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) => (
  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
    <div>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
    </div>
    {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
  </div>
);

export const PageHeader = ({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) => (
  <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
    </div>
    {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
  </div>
);

export const Money = ({ v, className, sign }: { v: number; className?: string; sign?: boolean }) => (
  <span className={cx('num whitespace-nowrap', sign && v < 0 && 'text-rose-600', className)}>{aed(v)}</span>
);

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
      {children(id)}
      {hint ? <p className="mt-1 text-[11px] text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function useClickOutside<T extends HTMLElement>(open: boolean, close: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

export type MenuItem = { label: string; icon?: ComponentType<{ size?: number; className?: string }>; onClick: () => void; danger?: boolean; disabled?: boolean; hint?: string };

export function Menu({ trigger, items, align = 'right', triggerClass, label }: { trigger: ReactNode; items: MenuItem[]; align?: 'left' | 'right'; triggerClass?: string; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)} className={triggerClass}>
        {trigger}
      </button>
      {open ? (
        <div role="menu" className={cx('absolute z-40 mt-1.5 min-w-56 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg', align === 'right' ? 'right-0' : 'left-0')}>
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              type="button"
              disabled={it.disabled}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
              className={cx('flex w-full items-start gap-2.5 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40', it.danger ? 'text-rose-600' : 'text-slate-700')}
            >
              {it.icon ? <it.icon size={16} className="mt-0.5 shrink-0 text-slate-400" /> : null}
              <span>
                {it.label}
                {it.hint ? <span className="block text-xs text-slate-400">{it.hint}</span> : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export const MenuTrigger = ({ children }: { children: ReactNode }) => (
  <span className="inline-flex items-center gap-1">
    {children}
    <ChevronDown size={14} />
  </span>
);

export function Modal({ title, subtitle, onClose, children, footer, size = 'lg' }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'md' | 'lg' | 'xl' }) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', onKey);
    panel.current?.querySelector<HTMLElement>('input, select, textarea')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-[2px] sm:p-8" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title} className={cx('w-full rounded-xl bg-white shadow-2xl', size === 'md' ? 'max-w-lg' : size === 'lg' ? 'max-w-3xl' : 'max-w-5xl')}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer ? <div className="flex flex-wrap items-center justify-end gap-2 rounded-b-xl border-t border-slate-100 bg-slate-50/70 px-6 py-3.5">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number; tone?: Tone }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx('-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors', value === t.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800')}
        >
          {t.label}
          {t.count !== undefined ? (
            <span className={cx('rounded-full px-1.5 text-[11px] font-semibold', value === t.id ? 'bg-brand-100 text-brand-700' : t.tone === 'red' && t.count ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500')}>{t.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export function JournalPreview({ lines, title = 'Ledger posting preview' }: { lines: JLine[]; title?: string }) {
  const t = jTotals(lines);
  const ok = t.debit > 0 && t.debit === t.credit;
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <Scale size={14} /> {title}
        </span>
        {ok ? <Badge tone="green"><CheckCircle2 size={12} /> Debits = Credits</Badge> : <Badge tone="red"><TriangleAlert size={12} /> Out of balance {aed(Math.abs(t.debit - t.credit))}</Badge>}
      </div>
      <table className="w-full">
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className="border-t border-slate-100 first:border-0">
              <td className={cx('px-3 py-1.5 text-xs text-slate-700', l.credit > 0 && 'pl-8')}>{acct(l.account)}</td>
              <td className="px-3 py-1.5 text-right text-xs"><Money v={l.debit} className={l.debit ? 'text-slate-900' : 'text-slate-300'} /></td>
              <td className="px-3 py-1.5 text-right text-xs"><Money v={l.credit} className={l.credit ? 'text-slate-900' : 'text-slate-300'} /></td>
            </tr>
          ))}
          <tr className="border-t border-slate-300 font-semibold">
            <td className="px-3 py-1.5 text-xs text-slate-500">Totals (AED)</td>
            <td className="px-3 py-1.5 text-right text-xs"><Money v={t.debit} /></td>
            <td className="px-3 py-1.5 text-right text-xs"><Money v={t.credit} /></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const w = 120, h = 36, min = Math.min(...values), max = Math.max(...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 4 - ((v - min) / (max - min || 1)) * (h - 8)]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} aria-hidden>
      <defs>
        <linearGradient id="spark" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.25" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${w},${h} L0,${h} Z`} fill="url(#spark)" />
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts.at(-1)![0]} cy={pts.at(-1)![1]} r="2.5" fill="currentColor" />
    </svg>
  );
}

export function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  const icon = { success: CheckCircle2, info: Info, warning: TriangleAlert };
  const color = { success: 'text-emerald-500', info: 'text-brand-500', warning: 'text-amber-500' };
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => {
        const I = icon[t.tone];
        return (
          <div key={t.id} className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-700 shadow-lg animate-[toast_.2s_ease-out]">
            <I size={18} className={cx('mt-px shrink-0', color[t.tone])} />
            <span className="flex-1">{t.text}</span>
            <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
          </div>
        );
      })}
    </div>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => (
  <div className="px-6 py-12 text-center text-sm text-slate-500">{children}</div>
);
