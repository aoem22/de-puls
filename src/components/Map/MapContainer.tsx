'use client';

import dynamic from 'next/dynamic';

// Dynamically import the map component with SSR disabled
// MapLibre GL requires DOM access and won't work during server-side rendering
const ChoroplethMap = dynamic(
  () => import('./ChoroplethMap').then((mod) => mod.ChoroplethMap),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center bg-gray-100">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-gray-600">Karte wird geladen...</span>
        </div>
      </div>
    ),
  }
);

export function MapWrapper() {
  return <ChoroplethMap />;
}
