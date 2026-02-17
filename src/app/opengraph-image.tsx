import { ImageResponse } from 'next/og';

export const runtime = 'nodejs';

export const alt = 'De-Puls – Interaktive Choropleth-Karte von Deutschland';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
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
        {/* Background grid pattern */}
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

        {/* Gradient glow — top-right cyan */}
        <div
          style={{
            position: 'absolute',
            top: -120,
            right: -80,
            width: 500,
            height: 500,
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(34,211,238,0.18) 0%, rgba(34,211,238,0.04) 50%, transparent 70%)',
            display: 'flex',
          }}
        />

        {/* Gradient glow — bottom-left amber */}
        <div
          style={{
            position: 'absolute',
            bottom: -100,
            left: -60,
            width: 400,
            height: 400,
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(245,158,11,0.14) 0%, rgba(245,158,11,0.03) 50%, transparent 70%)',
            display: 'flex',
          }}
        />

        {/* Decorative map dots — simulating district centroids */}
        {[
          { x: 780, y: 120, c: '#22d3ee', s: 6 },
          { x: 830, y: 180, c: '#22d3ee', s: 4 },
          { x: 860, y: 150, c: '#06b6d4', s: 5 },
          { x: 810, y: 250, c: '#22d3ee', s: 7 },
          { x: 870, y: 220, c: '#0891b2', s: 4 },
          { x: 900, y: 280, c: '#22d3ee', s: 5 },
          { x: 840, y: 310, c: '#06b6d4', s: 6 },
          { x: 920, y: 190, c: '#22d3ee', s: 3 },
          { x: 760, y: 200, c: '#0891b2', s: 5 },
          { x: 790, y: 280, c: '#22d3ee', s: 4 },
          { x: 850, y: 350, c: '#06b6d4', s: 5 },
          { x: 880, y: 380, c: '#22d3ee', s: 6 },
          { x: 920, y: 340, c: '#0891b2', s: 4 },
          { x: 950, y: 300, c: '#22d3ee', s: 3 },
          { x: 830, y: 420, c: '#06b6d4', s: 5 },
          { x: 870, y: 450, c: '#22d3ee', s: 7 },
          { x: 910, y: 420, c: '#0891b2', s: 4 },
          { x: 800, y: 380, c: '#22d3ee', s: 3 },
          { x: 940, y: 370, c: '#06b6d4', s: 5 },
          { x: 860, y: 480, c: '#22d3ee', s: 4 },
          { x: 900, y: 500, c: '#0891b2', s: 6 },
          // pulse marker cluster — red
          { x: 1020, y: 200, c: '#ef4444', s: 8 },
          { x: 1050, y: 240, c: '#f87171', s: 5 },
          { x: 1000, y: 260, c: '#ef4444', s: 6 },
          // amber accents
          { x: 1060, y: 350, c: '#f59e0b', s: 5 },
          { x: 1090, y: 310, c: '#fbbf24', s: 4 },
          { x: 1030, y: 380, c: '#f59e0b', s: 6 },
        ].map((dot, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: dot.x,
              top: dot.y,
              width: dot.s,
              height: dot.s,
              borderRadius: '50%',
              background: dot.c,
              opacity: 0.6,
              display: 'flex',
            }}
          />
        ))}

        {/* Connecting lines between some dots */}
        {[
          { x1: 780, y1: 122, x2: 830, y2: 182, c: 'rgba(34,211,238,0.12)' },
          { x1: 830, y1: 182, x2: 810, y2: 252, c: 'rgba(34,211,238,0.1)' },
          { x1: 810, y1: 252, x2: 840, y2: 312, c: 'rgba(34,211,238,0.08)' },
          { x1: 840, y1: 312, x2: 880, y2: 382, c: 'rgba(34,211,238,0.1)' },
          { x1: 880, y1: 382, x2: 870, y2: 452, c: 'rgba(34,211,238,0.08)' },
        ].map((line, i) => {
          const dx = line.x2 - line.x1;
          const dy = line.y2 - line.y1;
          const length = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx) * (180 / Math.PI);
          return (
            <div
              key={`line-${i}`}
              style={{
                position: 'absolute',
                left: line.x1,
                top: line.y1,
                width: length,
                height: 1,
                background: line.c,
                transform: `rotate(${angle}deg)`,
                transformOrigin: '0 0',
                display: 'flex',
              }}
            />
          );
        })}

        {/* Main content — left side */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '60px 70px',
            maxWidth: 720,
            position: 'relative',
            zIndex: 1,
          }}
        >
          {/* Logo / brand */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              marginBottom: 28,
            }}
          >
            {/* Stylized pulse icon */}
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: 'linear-gradient(135deg, #22d3ee 0%, #0891b2 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: 14,
                boxShadow: '0 0 24px rgba(34,211,238,0.3)',
              }}
            >
              <div
                style={{
                  color: '#0a0a0a',
                  fontSize: 22,
                  fontWeight: 800,
                  display: 'flex',
                }}
              >
                D
              </div>
            </div>
            <div
              style={{
                fontSize: 28,
                fontWeight: 700,
                color: '#fafafa',
                letterSpacing: '-0.02em',
                display: 'flex',
              }}
            >
              De-Puls
            </div>
          </div>

          {/* Title */}
          <div
            style={{
              fontSize: 46,
              fontWeight: 800,
              color: '#fafafa',
              lineHeight: 1.15,
              letterSpacing: '-0.03em',
              marginBottom: 20,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <span style={{ display: 'flex' }}>Interaktive Karte</span>
            <span style={{ display: 'flex' }}>
              sozialer Indikatoren
            </span>
            <span
              style={{
                display: 'flex',
                background: 'linear-gradient(90deg, #22d3ee, #06b6d4)',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              in Deutschland
            </span>
          </div>

          {/* Subtitle */}
          <div
            style={{
              fontSize: 18,
              color: '#a1a1aa',
              lineHeight: 1.5,
              marginBottom: 32,
              display: 'flex',
            }}
          >
            400 Kreise &middot; Ausländeranteil &middot; Kriminalstatistik &middot; Polizeimeldungen
          </div>

          {/* Feature pills */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 10,
            }}
          >
            {[
              { label: 'Choropleth-Karte', color: '#22d3ee' },
              { label: 'Kriminalstatistik', color: '#ef4444' },
              { label: 'Blaulicht-Timeline', color: '#3b82f6' },
              { label: 'Deutschlandatlas', color: '#f59e0b' },
            ].map((pill) => (
              <div
                key={pill.label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '6px 16px',
                  borderRadius: 20,
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  fontSize: 14,
                  color: '#d4d4d8',
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: pill.color,
                    marginRight: 8,
                    display: 'flex',
                  }}
                />
                {pill.label}
              </div>
            ))}
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
          <div style={{ flex: 1, background: '#22d3ee', display: 'flex' }} />
          <div style={{ flex: 1, background: '#ef4444', display: 'flex' }} />
          <div style={{ flex: 1, background: '#3b82f6', display: 'flex' }} />
          <div style={{ flex: 1, background: '#f59e0b', display: 'flex' }} />
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}
