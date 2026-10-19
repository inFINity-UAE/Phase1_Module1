import { cx } from '../ui';

export function BrandMark({ tone = 'light', className }: { tone?: 'light' | 'dark'; className?: string }) {
  const onDark = tone === 'dark';
  return (
    <span className={cx('inline-flex items-center', className)}>
      <span className={cx('flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold', onDark ? 'bg-white/15 text-white' : 'bg-brand-700 text-white')}>∞</span>
      <span className={cx('ml-2.5 text-lg font-semibold tracking-tight', onDark ? 'text-white' : 'text-slate-900')}>
        in<span className={onDark ? 'text-brand-200' : 'text-brand-600'}>FIN</span>ity
      </span>
    </span>
  );
}
