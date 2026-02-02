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
  title: 'Kanak Karte',
  description:
    'Interaktive Karte der sozialen Indikatoren in Darmstadt - Armutsindex, Kinderarmut, Erwachsenenarmut und Altersarmut nach Stadtbezirken',
  keywords: ['Darmstadt', 'Sozialatlas', 'Armut', 'Karte', 'Statistik', 'Kanak'],
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
