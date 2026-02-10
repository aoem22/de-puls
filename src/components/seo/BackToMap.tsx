interface BackToMapProps {
  ags: string;
  label?: string;
}

export function BackToMap({ ags, label = 'Auf der Karte anzeigen' }: BackToMapProps) {
  return (
    <a
      href={`/?focus=${ags}`}
      className="inline-flex items-center gap-2 text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
        <path d="M8 1L3 6.5V14.5H6.5V10H9.5V14.5H13V6.5L8 1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      {label}
    </a>
  );
}
