import { useEffect, useRef } from 'react';
import type { Profile } from '../types';
import { discoverFirebaseKeys } from '../net';

/** Main menu hub with a live procedural ember-scape backdrop. */
export function Menu({
  profile,
  onPlay,
  onDuel,
  onReplayIntro,
}: {
  profile: Profile;
  onPlay: () => void;
  onDuel: () => void;
  onReplayIntro: () => void;
}) {
  const bgRef = useRef<HTMLCanvasElement>(null);
  const online = !!discoverFirebaseKeys();

  useEffect(() => {
    const canvas = bgRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    const start = performance.now();
    const frame = () => {
      const t = (performance.now() - start) / 1000;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = Math.max(1, Math.round(rect.width * dpr));
      const H = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }
      // Split world: magma glow bleeding from the top, oasis glow from below.
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, 'hsl(356 45% 10%)');
      g.addColorStop(0.45, 'hsl(280 24% 9%)');
      g.addColorStop(1, 'hsl(170 45% 8%)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      // Slow lava striations up top.
      for (let i = 0; i < 4; i++) {
        ctx.strokeStyle = `hsla(${16 + i * 6} 95% ${45 + i * 5}% / ${0.12 - i * 0.02})`;
        ctx.lineWidth = 22 - i * 4;
        ctx.beginPath();
        for (let x = 0; x <= W; x += 12) {
          const y = H * 0.12 + i * 26 + Math.sin(x * 0.01 + t * 0.4 + i * 2) * 16;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // Water shimmer down below.
      for (let i = 0; i < 4; i++) {
        ctx.strokeStyle = `hsla(${175 + i * 8} 80% ${45 + i * 6}% / ${0.1 - i * 0.018})`;
        ctx.lineWidth = 16 - i * 3;
        ctx.beginPath();
        for (let x = 0; x <= W; x += 12) {
          const y = H * 0.86 + i * 16 + Math.sin(x * 0.014 - t * 0.6 + i) * 8;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // Rising embers and falling motes.
      for (let i = 0; i < 30; i++) {
        const up = i % 2 === 0;
        const px = ((i * 811) % W) + Math.sin(t * 0.7 + i) * 20;
        const cycle = (t * (14 + (i % 5) * 8) + i * 131) % H;
        const py = up ? H - cycle : cycle;
        ctx.fillStyle = up
          ? `hsla(20 95% 60% / ${0.25 + (i % 3) * 0.12})`
          : `hsla(165 90% 60% / ${0.2 + (i % 3) * 0.1})`;
        ctx.beginPath();
        ctx.arc(px, py, 1 + (i % 3) * 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="menu">
      <canvas className="menu-bg" ref={bgRef} />
      <div className="game-title">
        <div className="pre">One land · One water · Two armies</div>
        <h1>VAALBARA</h1>
        <div className="sub">The Last Oasis</div>
      </div>

      <div className="profile-chip">
        <span><b>{profile.name}</b></span>
        <span>W <b>{profile.wins}</b></span>
        <span>L <b>{profile.losses}</b></span>
        <span>T <b>{profile.ties}</b></span>
      </div>

      <div className="net-badge">
        <span className={`dot ${online ? 'online' : 'local'}`} />
        {online ? 'Live matchmaking ready' : 'Local guest mode · instant play'}
      </div>

      <div className="menu-actions">
        <button className="btn btn-primary" onClick={onPlay}>
          ⚔ Battle
        </button>
        <button className="btn btn-duel" onClick={onDuel}>
          ⚜ Duels
          <span className="btn-note">champion vs champion</span>
        </button>
        <button className="btn btn-ghost" onClick={onReplayIntro}>
          ▸ Replay intro cinematic
        </button>
      </div>
    </div>
  );
}
