import { copy } from './copy';
import { MarketingNav } from './MarketingNav';
import { Footer } from './Footer';
import { Link } from '../router';

export function PlaceholderPage({ title, authed }: { title: string; authed: boolean }) {
  return (
    <div className="flex min-h-full flex-col bg-[#f6f8fb]">
      <MarketingNav authed={authed} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-16 sm:px-6">
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        <p className="mt-3 text-sm text-slate-600">{copy.legal.body}</p>
        <Link href="/" className="mt-6 inline-block text-sm text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50">Back to home</Link>
      </main>
      <Footer />
    </div>
  );
}
