import type { Metadata } from 'next';
import { Space_Grotesk, Jolly_Lodger } from 'next/font/google';
import './globals.css';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-space-grotesk',
});

const jollyLodger = Jolly_Lodger({
  weight: '400',
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jolly-lodger',
});

export const metadata: Metadata = {
  title: 'De-Puls',
  description:
    'Interaktive Karte sozialer Indikatoren in Deutschland - Ausländeranteil, Kinderarmut, Arbeitslosigkeit und mehr nach Kreisen',
  keywords: ['Deutschland', 'Sozialatlas', 'Ausländer', 'Migration', 'Karte', 'Statistik', 'Kreise'],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" className="dark">
      <body className={`${spaceGrotesk.variable} ${jollyLodger.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
