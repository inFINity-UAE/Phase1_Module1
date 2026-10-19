import { copy } from './copy';
import { BrandMark } from './BrandMark';
import { Link } from '../router';

const link = 'rounded-sm text-sm text-slate-600 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50';

export function Footer() {
  const links = [
    ...copy.nav,
    { href: '/login', label: 'Log in' },
    { href: '/signup', label: 'Sign up' },
    { href: '/privacy', label: copy.footer.privacy },
    { href: '/terms', label: copy.footer.terms },
  ];
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6">
        <BrandMark />
        <p className="max-w-md text-sm text-slate-600">{copy.tagline}</p>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
          {links.map((item) => <Link key={item.href + item.label} href={item.href} className={link}>{item.label}</Link>)}
        </nav>
        <p className="text-xs text-slate-500">{copy.footer.confidential} · {new Date().getFullYear()}</p>
      </div>
    </footer>
  );
}
