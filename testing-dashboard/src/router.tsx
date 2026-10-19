import { useEffect, useState, type AnchorHTMLAttributes, type ReactNode } from 'react';

export function navigate(to: string, replace = false) {
  const here = window.location.pathname + window.location.hash;
  if (here === to) {
    window.dispatchEvent(new PopStateEvent('popstate'));
    return;
  }
  window.history[replace ? 'replaceState' : 'pushState']({}, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function usePath() {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const sync = () => setPath(window.location.pathname);
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  return path;
}

export function Link({ href, children, className, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className={className}
      {...rest}
      onClick={(e) => {
        rest.onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        navigate(href);
        const id = href.split('#')[1];
        if (id) {
          const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' }));
        }
      }}
    >
      {children}
    </a>
  );
}
