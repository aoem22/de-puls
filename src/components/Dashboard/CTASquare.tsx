import Link from 'next/link';

interface CTASquareProps {
  href: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
}

export function CTASquare({ href, title, subtitle, icon }: CTASquareProps) {
  return (
    <Link
      href={href}
      className="group relative flex min-h-[190px] flex-col items-center justify-center overflow-hidden rounded-2xl border p-6 text-center transition-all hover:-translate-y-0.5 sm:p-8"
      style={{ background: 'var(--card)', borderColor: 'var(--border-subtle)' }}
    >
      <span
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: 'radial-gradient(circle at 20% 20%, rgba(8, 145, 178, 0.2) 0%, transparent 55%)' }}
      />
      <div className="relative mb-3 opacity-70 transition-opacity group-hover:opacity-100">
        {icon}
      </div>
      <h3 className="relative mb-0.5 text-base font-bold" style={{ color: 'var(--text-primary)' }}>
        {title}
      </h3>
      <p className="relative text-xs" style={{ color: 'var(--text-muted)' }}>
        {subtitle}
      </p>
    </Link>
  );
}
