'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AdminNav } from './AdminNav';
import { AdminProcessProvider } from './AdminProcessContext';

export function AdminShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <AdminProcessProvider>
      <div className="flex min-h-screen" style={{ background: 'var(--background)' }}>
        {/* Sidebar */}
        <aside
          className="sticky top-0 flex h-screen flex-col border-r transition-all duration-200"
          style={{
            width: sidebarOpen ? 220 : 56,
            borderColor: 'var(--border-subtle)',
            background: 'var(--card)',
          }}
        >
          <div className="flex items-center justify-between px-3 py-4">
            {sidebarOpen && (
              <Link
                href="/admin"
                className="text-sm font-bold tracking-wide"
                style={{ color: 'var(--accent)' }}
              >
                Pipeline Admin
              </Link>
            )}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="rounded-lg p-1.5 text-xs transition-colors"
              style={{ color: 'var(--text-muted)' }}
              title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            >
              {sidebarOpen ? '◂' : '▸'}
            </button>
          </div>

          {sidebarOpen && (
            <div className="flex-1 overflow-y-auto px-2">
              <AdminNav />
            </div>
          )}

          {sidebarOpen && (
            <div className="border-t px-3 py-3" style={{ borderColor: 'var(--border-subtle)' }}>
              <Link
                href="/"
                className="text-xs"
                style={{ color: 'var(--text-faint)' }}
              >
                ← Back to site
              </Link>
            </div>
          )}
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-6 py-6">
            {children}
          </div>
        </main>
      </div>
    </AdminProcessProvider>
  );
}
