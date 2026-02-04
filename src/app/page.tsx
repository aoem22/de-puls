import { MapWrapper } from '@/components/Map';

export default function Home() {
  return (
    <main className="h-screen w-screen bg-[#0a0a0a] overflow-hidden relative">
      {/* Full-screen map */}
      <MapWrapper />

    </main>
  );
}
