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

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://de-puls.de';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'De-Puls – Interaktive Deutschlandkarte sozialer Indikatoren',
    template: '%s | De-Puls',
  },
  description:
    'Interaktive Karte sozialer Indikatoren in Deutschland: Ausländeranteil, Kriminalstatistik, Kinderarmut, Arbeitslosigkeit und mehr – visualisiert nach 400 Kreisen und kreisfreien Städten.',
  keywords: [
    'Deutschland', 'Sozialatlas', 'Ausländeranteil', 'Migration', 'Kriminalstatistik',
    'Karte', 'Statistik', 'Kreise', 'Deutschlandatlas', 'Choropleth',
    'Kinderarmut', 'Arbeitslosigkeit', 'Polizeimeldungen', 'Blaulicht',
    'interaktive Karte', 'Germany social map', 'crime statistics Germany',
  ],
  authors: [{ name: 'De-Puls' }],
  creator: 'De-Puls',
  publisher: 'De-Puls',
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'de_DE',
    alternateLocale: 'en_US',
    url: SITE_URL,
    siteName: 'De-Puls',
    title: 'De-Puls – Interaktive Deutschlandkarte sozialer Indikatoren',
    description:
      'Ausländeranteil, Kriminalstatistik, Kinderarmut und mehr – interaktiv visualisiert für alle 400 deutschen Kreise.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'De-Puls – Deutschlandkarte sozialer Indikatoren',
    description:
      'Ausländeranteil, Kriminalstatistik, Kinderarmut und mehr – interaktiv visualisiert für alle 400 deutschen Kreise.',
  },
  alternates: {
    canonical: SITE_URL,
    languages: {
      'de-DE': SITE_URL,
      'en-US': `${SITE_URL}?lang=en`,
    },
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'De-Puls',
  },
  manifest: '/manifest.json',
  category: 'technology',
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
