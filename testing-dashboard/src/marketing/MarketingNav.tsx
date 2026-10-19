import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { copy } from './copy';
import { BrandMark } from './BrandMark';
import { Link, navigate } from '../router';
import { cx } from '../ui';

const focus = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50';

export function MarketingNav({ authed }: { authed: boolean }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" aria-label="inFINity home" className={cx('rounded-lg', focus)} onClick={close}><BrandMark /></Link>
        <nav aria-label="Page" className="ml-4 hidden items-center gap-1 md:flex">
          {copy.nav.map((item) => (
            <Link key={item.href} href={item.href} className={cx('rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900', focus)}>{item.label}</Link>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-2 md:flex">
          {authed ? (
            <button type="button" onClick={() => navigate('/app')} className={cx('h-9 rounded-md bg-brand-700 px-3.5 text-sm font-medium text-white hover:bg-brand-800', focus)}>{copy.openWorkspace}</button>
          ) : (
            <>
              <Link href="/login" className={cx('rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100', focus)}>Log in</Link>
              <Link href="/signup" className={cx('inline-flex h-9 items-center rounded-md bg-brand-700 px-3.5 text-sm font-medium text-white hover:bg-brand-800', focus)}>Get started</Link>
            </>
          )}
        </div>
        <button type="button" className={cx('ml-auto rounded-md p-2 text-slate-700 md:hidden', focus)} aria-expanded={open} aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen((v) => !v)}>
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
      {open ? (
        <nav aria-label="Mobile" className="space-y-1 border-t border-slate-100 px-4 py-3 md:hidden">
          {copy.nav.map((item) => (
            <Link key={item.href} href={item.href} onClick={close} className={cx('block rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-100', focus)}>{item.label}</Link>
          ))}
          {authed ? (
            <button type="button" onClick={() => { close(); navigate('/app'); }} className={cx('mt-2 h-10 w-full rounded-md bg-brand-700 text-sm font-medium text-white', focus)}>{copy.openWorkspace}</button>
          ) : (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Link href="/login" onClick={close} className={cx('inline-flex h-10 items-center justify-center rounded-md border border-slate-300 text-sm font-medium', focus)}>Log in</Link>
              <Link href="/signup" onClick={close} className={cx('inline-flex h-10 items-center justify-center rounded-md bg-brand-700 text-sm font-medium text-white', focus)}>Get started</Link>
            </div>
          )}
        </nav>
      ) : null}
    </header>
  );
}
