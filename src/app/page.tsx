import { MapWrapper } from '@/components/Map';

export default function Home() {
  return (
    <main className="h-screen w-screen bg-[#0a0a0a] overflow-hidden relative">
      {/* Full-screen map */}
      <MapWrapper />

      {/* Centered logo at top */}
      <div className="absolute top-6 left-0 right-0 z-[1000] pointer-events-none">
        <h1
          className="text-center text-white text-5xl md:text-7xl drop-shadow-[0_4px_24px_rgba(0,0,0,0.8)]"
          style={{ fontFamily: 'var(--font-jolly-lodger), cursive' }}
        >
          Kanak Karte
        </h1>
      </div>
    </main>
  );
}
