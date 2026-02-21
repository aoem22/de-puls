import { ImageResponse } from 'next/og';
import { KREIS_BY_SLUG } from '@/lib/slugs/registry';
import { BUNDESLAND_BY_CODE } from '@/lib/slugs/bundesland-registry';

export const alt = 'Kriminalitaet in Deutschland — Adlerlicht';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const kreis = KREIS_BY_SLUG[slug];
  const bl = kreis ? BUNDESLAND_BY_CODE[kreis.bundeslandCode] : null;

  const cityName = kreis?.name ?? slug;
  const stateName = bl?.name ?? '';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          background: '#0a0a0a',
          position: 'relative',
          overflow: 'hidden',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {/* Background grid */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />

        {/* Gradient glow */}
        <div
          style={{
            position: 'absolute',
            top: -100,
            right: -60,
            width: 500,
            height: 500,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(239,68,68,0.15) 0%, transparent 70%)',
            display: 'flex',
          }}
        />

        {/* Content */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '60px 70px',
            position: 'relative',
            zIndex: 1,
          }}
        >
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 32 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: 'linear-gradient(135deg, #22d3ee, #0891b2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: 12,
              }}
            >
              <div style={{ color: '#0a0a0a', fontSize: 20, fontWeight: 800, display: 'flex' }}>A</div>
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#fafafa', display: 'flex' }}>Adlerlicht</div>
          </div>

          {/* Title */}
          <div
            style={{
              fontSize: 52,
              fontWeight: 800,
              color: '#fafafa',
              lineHeight: 1.15,
              letterSpacing: '-0.03em',
              marginBottom: 16,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <span style={{ display: 'flex' }}>Kriminalitaet in</span>
            <span
              style={{
                display: 'flex',
                background: 'linear-gradient(90deg, #ef4444, #f59e0b)',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              {cityName}
            </span>
          </div>

          {/* Subtitle */}
          <div style={{ fontSize: 20, color: '#a1a1aa', display: 'flex' }}>
            {stateName} — Statistik, Polizeimeldungen &amp; Indikatoren
          </div>
        </div>

        {/* Bottom bar */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 4,
            display: 'flex',
          }}
        >
          <div style={{ flex: 1, background: '#ef4444', display: 'flex' }} />
          <div style={{ flex: 1, background: '#f59e0b', display: 'flex' }} />
          <div style={{ flex: 1, background: '#22d3ee', display: 'flex' }} />
          <div style={{ flex: 1, background: '#22c55e', display: 'flex' }} />
        </div>
      </div>
    ),
    { ...size },
  );
}
