import type { Metadata, Viewport } from 'next';
import { Space_Grotesk } from 'next/font/google';
import { LanguageProvider } from '@/lib/i18n';
import './globals.css';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-space-grotesk',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#0a0a0a',
};

export const metadata: Metadata = {
  title: 'De-Puls',
  description:
    'Interaktive Karte sozialer Indikatoren in Deutschland - Ausländeranteil, Kinderarmut, Arbeitslosigkeit und mehr nach Kreisen',
  keywords: ['Deutschland', 'Sozialatlas', 'Ausländer', 'Migration', 'Karte', 'Statistik', 'Kreise'],
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'De-Puls',
  },
  manifest: '/manifest.json',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" className="dark">
      <body className={`${spaceGrotesk.variable} font-sans antialiased`}>
        <LanguageProvider>
          {children}
        </LanguageProvider>
      </body>
    </html>
  );
}
