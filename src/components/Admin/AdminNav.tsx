'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useActiveProcesses } from './AdminProcessContext';

const NAV_ITEMS = [
  { href: '/admin', label: 'Dashboard', icon: '◈' },
  { href: '/admin/compare', label: 'Compare', icon: '⇄' },
  { href: '/admin/prompts', label: 'Prompts', icon: '✎' },
  { href: '/admin/scrape', label: 'Scrape', icon: '⚡' },
  { href: '/admin/enrich', label: 'Enrich', icon: '⚗' },
  { href: '/admin/geocode', label: 'Geocode', icon: '◎' },
];

export function AdminNav() {
  const pathname = usePathname();
  const { scrapeRunning, enrichRunning, geocodeRunning } = useActiveProcesses();

  return (
    <nav className="flex flex-col gap-1">
      {NAV_ITEMS.map(item => {
        const active = pathname === item.href ||
          (item.href !== '/admin' && pathname.startsWith(item.href));
        const isProcessing =
          (item.href === '/admin/scrape' && scrapeRunning) ||
          (item.href === '/admin/enrich' && enrichRunning) ||
          (item.href === '/admin/geocode' && geocodeRunning);

        return (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all"
            style={{
              background: active ? 'var(--accent)' : 'transparent',
              color: active ? '#fff' : 'var(--text-secondary)',
              boxShadow: active ? '0 2px 8px rgba(0,0,0,0.15)' : undefined,
            }}
          >
            <span className="text-base opacity-70">{item.icon}</span>
            {item.label}
            {isProcessing && (
              <span
                className="ml-auto h-2 w-2 shrink-0 animate-pulse rounded-full"
                style={{ background: active ? '#fff' : '#22c55e' }}
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
