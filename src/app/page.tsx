import { MapWrapper } from '@/components/Map';

function JsonLd() {
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebApplication',
        name: 'De-Puls',
        url: process.env.NEXT_PUBLIC_SITE_URL || 'https://de-puls.de',
        description:
          'Interaktive Karte sozialer Indikatoren in Deutschland: Ausländeranteil, Kriminalstatistik, Kinderarmut, Arbeitslosigkeit und mehr – visualisiert nach 400 Kreisen.',
        applicationCategory: 'ReferenceApplication',
        operatingSystem: 'Web',
        browserRequirements: 'Requires JavaScript',
        inLanguage: ['de', 'en'],
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'EUR',
        },
        featureList: [
          'Choropleth-Karte mit sozialen Indikatoren für alle 400 deutschen Kreise',
          'Ausländeranteil nach Herkunftskontinent',
          'Kriminalstatistik der deutschen Großstädte',
          'Polizei-Pressemeldungen mit Timeline-Wiedergabe',
          'Deutschlandatlas-Indikatoren: Kinderarmut, Arbeitslosigkeit, Einkommen',
        ],
      },
      {
        '@type': 'Dataset',
        name: 'Soziale Indikatoren Deutschlands nach Kreisen',
        description:
          'Datensatz sozialer Indikatoren für alle 400 Kreise und kreisfreien Städte Deutschlands, einschließlich Ausländeranteil, Kriminalstatistik und Deutschlandatlas-Kennzahlen.',
        spatialCoverage: {
          '@type': 'Place',
          name: 'Deutschland',
          geo: {
            '@type': 'GeoShape',
            box: '47.27 5.87 55.06 15.04',
          },
        },
        variableMeasured: [
          'Ausländeranteil',
          'Kriminalitätsrate',
          'Kinderarmut',
          'Arbeitslosenquote',
        ],
        license: 'https://creativecommons.org/licenses/by/4.0/',
        inLanguage: ['de', 'en'],
      },
      {
        '@type': 'Organization',
        name: 'De-Puls',
        url: process.env.NEXT_PUBLIC_SITE_URL || 'https://de-puls.de',
        logo: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://de-puls.de'}/icon-512.png`,
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
    />
  );
}

function SeoContent() {
  return (
    <div className="sr-only">
      <h1>De-Puls – Interaktive Deutschlandkarte sozialer Indikatoren</h1>
      <p>
        De-Puls visualisiert soziale Indikatoren für alle 400 Kreise und
        kreisfreien Städte Deutschlands auf einer interaktiven Choropleth-Karte.
      </p>

      <h2>Verfügbare Daten-Ebenen</h2>
      <ul>
        <li>
          <strong>Ausländeranteil</strong> – Anteil der ausländischen
          Bevölkerung nach Kreisen, aufgeschlüsselt nach Herkunftskontinent
          (Europa, Asien, Afrika, Amerika, Ozeanien).
        </li>
        <li>
          <strong>Kriminalstatistik</strong> – Polizeiliche Kriminalstatistik
          (PKS) der deutschen Großstädte mit Ranking und Vergleich.
        </li>
        <li>
          <strong>Blaulicht / Polizeimeldungen</strong> – Aktuelle
          Polizei-Pressemeldungen von Presseportal, dargestellt mit
          Timeline-Wiedergabe und Pulse-Markern auf der Karte.
        </li>
        <li>
          <strong>Deutschlandatlas</strong> – Regierungsdaten zu Kinderarmut,
          Arbeitslosigkeit, Einkommen und weiteren sozioökonomischen
          Kennzahlen.
        </li>
      </ul>

      <h2>Funktionen</h2>
      <ul>
        <li>Interaktive Choropleth-Karte mit Hover-Details pro Kreis</li>
        <li>Ebenen-Steuerung zum Umschalten zwischen Indikatoren</li>
        <li>Timeline-Wiedergabe für zeitliche Polizeimeldungen</li>
        <li>Kriminalitäts-Ranking deutscher Großstädte</li>
        <li>Zweisprachig: Deutsch und Englisch</li>
        <li>Progressive Web App (PWA) für mobile Nutzung</li>
      </ul>

      <h2>About De-Puls (English)</h2>
      <p>
        De-Puls is an interactive choropleth map of social indicators across
        Germany&apos;s 400 districts. Explore foreign population shares, crime
        statistics, child poverty rates, unemployment data, and real-time
        police press releases – all visualized on an interactive map.
      </p>
    </div>
  );
}

export default function Home() {
  return (
    <>
      <JsonLd />
      <main className="fixed inset-0 overflow-hidden">
        <SeoContent />
        <MapWrapper />
      </main>
      <noscript>
        <div style={{ padding: '2rem', color: '#fafafa', background: '#0a0a0a' }}>
          <h1>De-Puls – Interaktive Deutschlandkarte</h1>
          <p>
            De-Puls benötigt JavaScript, um die interaktive Karte
            darzustellen. Bitte aktivieren Sie JavaScript in Ihrem Browser.
          </p>
          <p>
            De-Puls requires JavaScript to display the interactive map.
            Please enable JavaScript in your browser.
          </p>
        </div>
      </noscript>
    </>
  );
}
