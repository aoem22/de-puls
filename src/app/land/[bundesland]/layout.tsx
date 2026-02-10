import { SeoFooter } from '@/components/seo/SeoFooter';

export default function BundeslandLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <header className="border-b border-[var(--card-border)]">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-cyan-600 flex items-center justify-center text-sm font-bold text-[var(--background)]">
              D
            </div>
            <span className="text-lg font-bold tracking-tight group-hover:text-cyan-400 transition-colors">
              De-Puls
            </span>
          </a>
          <a
            href="/"
            className="text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          >
            Zur Karte
          </a>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-8">
        {children}
      </main>
      <SeoFooter />
    </div>
  );
}
