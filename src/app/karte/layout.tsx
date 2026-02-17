import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Inzidenzkarte',
  description:
    'Interaktive Karte aller Polizeimeldungen, Kriminalstatistiken und sozialen Indikatoren in Deutschland.',
};

export default function KarteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
