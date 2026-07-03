/* ============================================================================
 * VAALBARA: THE LAST OASIS — vector-art.ts
 * Procedural species drawings — the zero-asset offline fallback used when a
 * painted sprite or animation sheet is unavailable, plus small UI portraits.
 * ========================================================================== */

import type { SpeciesId, UnitState } from './types';

export function drawSpecies(
  ctx: CanvasRenderingContext2D, species: SpeciesId, s: number, t: number, u?: UnitState,
): void {
  const walk = Math.sin(t * 8) * (u?.action === 'move' ? 1 : 0.3);
  switch (species) {
    case 'trex': {
      // Tail
      ctx.fillStyle = 'hsl(12 45% 34%)';
      ctx.beginPath();
      ctx.moveTo(-s * 0.5, -s * 0.25);
      ctx.quadraticCurveTo(-s * 1.25, -s * 0.32 + walk * 2, -s * 1.35, -s * 0.02);
      ctx.quadraticCurveTo(-s * 1.0, -s * 0.02, -s * 0.45, s * 0.1);
      ctx.closePath();
      ctx.fill();
      // Legs
      ctx.fillStyle = 'hsl(12 42% 28%)';
      ctx.beginPath();
      ctx.roundRect(-s * 0.34 + walk * 2.4, -s * 0.1, s * 0.26, s * 0.55, 3);
      ctx.roundRect(s * 0.02 - walk * 2.4, -s * 0.1, s * 0.26, s * 0.55, 3);
      ctx.fill();
      // Body
      const bg = ctx.createLinearGradient(0, -s, 0, s * 0.4);
      bg.addColorStop(0, 'hsl(14 55% 44%)');
      bg.addColorStop(1, 'hsl(10 45% 30%)');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.ellipse(-s * 0.1, -s * 0.32, s * 0.62, s * 0.42, -0.18, 0, Math.PI * 2);
      ctx.fill();
      // Head + jaw
      ctx.beginPath();
      ctx.ellipse(s * 0.52, -s * 0.66, s * 0.4, s * 0.28, 0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'hsl(8 50% 24%)';
      ctx.beginPath();
      ctx.moveTo(s * 0.36, -s * 0.56);
      ctx.lineTo(s * 0.92, -s * 0.5 + Math.abs(walk) * 2);
      ctx.lineTo(s * 0.4, -s * 0.42);
      ctx.closePath();
      ctx.fill();
      // Teeth + eye
      ctx.fillStyle = '#f4ead8';
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(s * (0.5 + i * 0.13), -s * 0.55);
        ctx.lineTo(s * (0.54 + i * 0.13), -s * 0.46);
        ctx.lineTo(s * (0.58 + i * 0.13), -s * 0.55);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = 'hsl(50 100% 60%)';
      ctx.beginPath();
      ctx.arc(s * 0.55, -s * 0.72, s * 0.05, 0, Math.PI * 2);
      ctx.fill();
      // Back plates
      ctx.fillStyle = 'hsl(6 60% 25%)';
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(-s * 0.55 + i * s * 0.26, -s * 0.62);
        ctx.lineTo(-s * 0.45 + i * s * 0.26, -s * 0.86);
        ctx.lineTo(-s * 0.34 + i * s * 0.26, -s * 0.62);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'lion': {
      // Tail
      ctx.strokeStyle = 'hsl(36 60% 45%)';
      ctx.lineWidth = s * 0.09;
      ctx.beginPath();
      ctx.moveTo(-s * 0.55, -s * 0.3);
      ctx.quadraticCurveTo(-s * 0.95, -s * 0.5 + walk * 2, -s * 0.85, -s * 0.75);
      ctx.stroke();
      // Legs
      ctx.fillStyle = 'hsl(36 55% 42%)';
      ctx.beginPath();
      ctx.roundRect(-s * 0.4 + walk * 2, -s * 0.05, s * 0.17, s * 0.42, 3);
      ctx.roundRect(s * 0.12 - walk * 2, -s * 0.05, s * 0.17, s * 0.42, 3);
      ctx.fill();
      // Body
      const bg = ctx.createLinearGradient(0, -s * 0.7, 0, s * 0.2);
      bg.addColorStop(0, 'hsl(40 70% 56%)');
      bg.addColorStop(1, 'hsl(33 60% 42%)');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.ellipse(-s * 0.05, -s * 0.3, s * 0.52, s * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      // Mane — radial gradient sunburst
      const mg = ctx.createRadialGradient(s * 0.42, -s * 0.52, s * 0.05, s * 0.42, -s * 0.52, s * 0.42);
      mg.addColorStop(0, 'hsl(28 80% 48%)');
      mg.addColorStop(1, 'hsl(14 75% 30%)');
      ctx.fillStyle = mg;
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + t * 0.4;
        ctx.beginPath();
        ctx.ellipse(s * 0.42 + Math.cos(a) * s * 0.16, -s * 0.52 + Math.sin(a) * s * 0.16, s * 0.2, s * 0.12, a, 0, Math.PI * 2);
        ctx.fill();
      }
      // Face
      ctx.fillStyle = 'hsl(40 70% 58%)';
      ctx.beginPath();
      ctx.arc(s * 0.42, -s * 0.52, s * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2a1608';
      ctx.beginPath();
      ctx.arc(s * 0.49, -s * 0.56, s * 0.035, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'hsl(20 50% 32%)';
      ctx.beginPath();
      ctx.ellipse(s * 0.58, -s * 0.47, s * 0.05, s * 0.035, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'eagle': {
      const flap = Math.sin(t * 10) * 0.7;
      // Wings
      const wg = ctx.createLinearGradient(0, -s, 0, 0);
      wg.addColorStop(0, 'hsl(24 55% 40%)');
      wg.addColorStop(1, 'hsl(18 45% 26%)');
      ctx.fillStyle = wg;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.35);
        ctx.quadraticCurveTo(side * s * 0.5, -s * 0.75 - flap * s * 0.4 * side * side, side * s * 1.0, -s * 0.45 - flap * s * 0.5);
        ctx.quadraticCurveTo(side * s * 0.55, -s * 0.25, 0, -s * 0.18);
        ctx.closePath();
        ctx.fill();
      }
      // Body
      ctx.fillStyle = 'hsl(20 40% 28%)';
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.3, s * 0.24, s * 0.38, 0.15, 0, Math.PI * 2);
      ctx.fill();
      // White head
      ctx.fillStyle = '#efe8da';
      ctx.beginPath();
      ctx.arc(s * 0.16, -s * 0.62, s * 0.15, 0, Math.PI * 2);
      ctx.fill();
      // Beak
      ctx.fillStyle = 'hsl(42 90% 55%)';
      ctx.beginPath();
      ctx.moveTo(s * 0.28, -s * 0.64);
      ctx.lineTo(s * 0.42, -s * 0.58);
      ctx.lineTo(s * 0.27, -s * 0.54);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(s * 0.2, -s * 0.64, s * 0.03, 0, Math.PI * 2);
      ctx.fill();
      // Tail feathers
      ctx.fillStyle = '#efe8da';
      ctx.beginPath();
      ctx.moveTo(-s * 0.18, -s * 0.1);
      ctx.lineTo(-s * 0.48, s * 0.08);
      ctx.lineTo(-s * 0.1, -0.0);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'honeybadger': {
      // Low, long body
      const bg = ctx.createLinearGradient(0, -s * 0.6, 0, s * 0.1);
      bg.addColorStop(0, 'hsl(0 0% 82%)');
      bg.addColorStop(0.45, 'hsl(0 0% 75%)');
      bg.addColorStop(0.5, 'hsl(0 0% 22%)');
      bg.addColorStop(1, 'hsl(0 0% 14%)');
      ctx.fillStyle = 'hsl(0 0% 16%)';
      ctx.beginPath();
      ctx.roundRect(-s * 0.42 + walk * 1.6, -s * 0.02, s * 0.16, s * 0.3, 2);
      ctx.roundRect(s * 0.16 - walk * 1.6, -s * 0.02, s * 0.16, s * 0.3, 2);
      ctx.fill();
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.ellipse(-s * 0.02, -s * 0.26, s * 0.55, s * 0.27, 0, 0, Math.PI * 2);
      ctx.fill();
      // Head
      ctx.fillStyle = 'hsl(0 0% 20%)';
      ctx.beginPath();
      ctx.ellipse(s * 0.5, -s * 0.32, s * 0.22, s * 0.17, 0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'hsl(0 0% 84%)';
      ctx.beginPath();
      ctx.ellipse(s * 0.46, -s * 0.42, s * 0.2, s * 0.08, 0.15, 0, Math.PI);
      ctx.fill();
      // Eye + claws
      const rage = u && u.buffs.berserk;
      ctx.fillStyle = rage ? 'hsl(0 100% 55%)' : '#fff';
      ctx.beginPath();
      ctx.arc(s * 0.55, -s * 0.35, s * 0.035, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ddd';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(s * (0.24 + i * 0.05) - walk * 1.6, s * 0.28);
        ctx.lineTo(s * (0.28 + i * 0.05) - walk * 1.6, s * 0.36);
        ctx.stroke();
      }
      break;
    }
    case 'scorpion': {
      ctx.fillStyle = 'hsl(285 30% 30%)';
      // Legs
      ctx.strokeStyle = 'hsl(285 30% 26%)';
      ctx.lineWidth = s * 0.05;
      for (let i = 0; i < 3; i++) {
        for (const side of [-1, 1]) {
          const lx = -s * 0.2 + i * s * 0.2;
          ctx.beginPath();
          ctx.moveTo(lx, -s * 0.15);
          ctx.lineTo(lx + side * s * 0.18, s * 0.02 + Math.sin(t * 9 + i) * 1.5);
          ctx.lineTo(lx + side * s * 0.26, s * 0.14);
          ctx.stroke();
        }
      }
      // Segmented body
      const sg = ctx.createLinearGradient(0, -s * 0.4, 0, 0);
      sg.addColorStop(0, 'hsl(288 38% 42%)');
      sg.addColorStop(1, 'hsl(282 34% 26%)');
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.18, s * 0.42, s * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      // Claws
      ctx.beginPath();
      ctx.ellipse(s * 0.5, -s * 0.28, s * 0.15, s * 0.1, 0.5, 0, Math.PI * 2);
      ctx.ellipse(s * 0.5, -s * 0.05, s * 0.15, s * 0.1, -0.5, 0, Math.PI * 2);
      ctx.fill();
      // Tail arcs over the back to a glowing stinger
      ctx.strokeStyle = 'hsl(286 36% 36%)';
      ctx.lineWidth = s * 0.11;
      ctx.beginPath();
      const curl = Math.sin(t * 3) * 0.06;
      ctx.moveTo(-s * 0.35, -s * 0.2);
      ctx.quadraticCurveTo(-s * 0.75, -s * (0.75 + curl), -s * 0.3, -s * (0.85 + curl));
      ctx.stroke();
      ctx.fillStyle = 'hsl(320 90% 60%)';
      ctx.beginPath();
      ctx.arc(-s * 0.28, -s * (0.86 + curl), s * 0.08, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'fireants': {
      // A single ant (the swarm is three units).
      const ag = ctx.createLinearGradient(0, -s * 0.5, 0, 0);
      ag.addColorStop(0, 'hsl(16 90% 52%)');
      ag.addColorStop(1, 'hsl(4 80% 36%)');
      ctx.fillStyle = ag;
      // Abdomen, thorax, head
      ctx.beginPath();
      ctx.ellipse(-s * 0.3, -s * 0.2, s * 0.24, s * 0.17, 0, 0, Math.PI * 2);
      ctx.ellipse(0, -s * 0.24, s * 0.14, s * 0.11, 0, 0, Math.PI * 2);
      ctx.ellipse(s * 0.22, -s * 0.26, s * 0.13, s * 0.11, 0, 0, Math.PI * 2);
      ctx.fill();
      // Glow abdomen tip
      ctx.fillStyle = `hsla(30 100% 60% / ${0.6 + Math.sin(t * 6) * 0.3})`;
      ctx.beginPath();
      ctx.arc(-s * 0.42, -s * 0.2, s * 0.08, 0, Math.PI * 2);
      ctx.fill();
      // Legs
      ctx.strokeStyle = 'hsl(6 70% 30%)';
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(-s * 0.1 + i * s * 0.12, -s * 0.15);
        ctx.lineTo(-s * 0.16 + i * s * 0.12 + walk * 2, s * 0.05);
        ctx.stroke();
      }
      // Mandibles
      ctx.strokeStyle = 'hsl(16 90% 55%)';
      ctx.beginPath();
      ctx.moveTo(s * 0.32, -s * 0.3);
      ctx.quadraticCurveTo(s * 0.44, -s * 0.28, s * 0.4, -s * 0.2);
      ctx.stroke();
      break;
    }
    case 'bear': {
      // Legs
      ctx.fillStyle = 'hsl(25 40% 22%)';
      ctx.beginPath();
      ctx.roundRect(-s * 0.42 + walk * 2, -s * 0.02, s * 0.24, s * 0.5, 4);
      ctx.roundRect(s * 0.1 - walk * 2, -s * 0.02, s * 0.24, s * 0.5, 4);
      ctx.fill();
      // Massive body
      const bg = ctx.createLinearGradient(0, -s * 0.95, 0, s * 0.3);
      bg.addColorStop(0, 'hsl(28 45% 38%)');
      bg.addColorStop(1, 'hsl(22 40% 24%)');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.ellipse(-s * 0.05, -s * 0.42, s * 0.6, s * 0.5, -0.1, 0, Math.PI * 2);
      ctx.fill();
      // Head + ears + snout
      ctx.beginPath();
      ctx.arc(s * 0.45, -s * 0.72, s * 0.26, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s * 0.3, -s * 0.94, s * 0.09, 0, Math.PI * 2);
      ctx.arc(s * 0.58, -s * 0.94, s * 0.09, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'hsl(30 45% 52%)';
      ctx.beginPath();
      ctx.ellipse(s * 0.62, -s * 0.66, s * 0.13, s * 0.09, 0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1c0f06';
      ctx.beginPath();
      ctx.arc(s * 0.68, -s * 0.68, s * 0.04, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s * 0.48, -s * 0.76, s * 0.035, 0, Math.PI * 2);
      ctx.fill();
      // Claw swipe arcs
      ctx.strokeStyle = 'hsl(40 30% 75%)';
      ctx.lineWidth = 1.6;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(s * (0.16 + i * 0.06) - walk * 2, s * 0.42);
        ctx.lineTo(s * (0.2 + i * 0.06) - walk * 2, s * 0.5);
        ctx.stroke();
      }
      break;
    }
    case 'bighorn': {
      // Legs
      ctx.fillStyle = 'hsl(35 25% 40%)';
      ctx.beginPath();
      ctx.roundRect(-s * 0.34 + walk * 2.4, -s * 0.05, s * 0.14, s * 0.42, 2);
      ctx.roundRect(s * 0.18 - walk * 2.4, -s * 0.05, s * 0.14, s * 0.42, 2);
      ctx.fill();
      // Body
      const bg = ctx.createLinearGradient(0, -s * 0.7, 0, s * 0.15);
      bg.addColorStop(0, 'hsl(38 30% 58%)');
      bg.addColorStop(1, 'hsl(32 26% 42%)');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.ellipse(-s * 0.02, -s * 0.34, s * 0.5, s * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      // Head
      ctx.fillStyle = 'hsl(35 28% 50%)';
      ctx.beginPath();
      ctx.ellipse(s * 0.42, -s * 0.5, s * 0.2, s * 0.16, 0.35, 0, Math.PI * 2);
      ctx.fill();
      // Curled horns — the signature
      ctx.strokeStyle = 'hsl(38 45% 68%)';
      ctx.lineWidth = s * 0.1;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(s * 0.36, -s * 0.62, s * 0.17, -0.5, Math.PI * 1.35);
      ctx.stroke();
      ctx.lineWidth = s * 0.07;
      ctx.beginPath();
      ctx.arc(s * 0.36, -s * 0.62, s * 0.09, 0.4, Math.PI * 1.7);
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.fillStyle = '#221507';
      ctx.beginPath();
      ctx.arc(s * 0.5, -s * 0.52, s * 0.03, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'bees': {
      // A cloud of buzzing bees.
      for (let i = 0; i < 7; i++) {
        const a = t * (3 + (i % 3)) + i * 0.9;
        const bx = Math.cos(a) * s * (0.3 + (i % 3) * 0.14);
        const by = -s * 0.4 + Math.sin(a * 1.4) * s * 0.3;
        // Wings
        ctx.fillStyle = `rgba(220,240,255,${0.5 + Math.sin(t * 30 + i) * 0.3})`;
        ctx.beginPath();
        ctx.ellipse(bx - 1, by - 3, 3, 1.6, Math.sin(t * 30 + i), 0, Math.PI * 2);
        ctx.fill();
        // Body with stripes
        ctx.fillStyle = 'hsl(48 95% 55%)';
        ctx.beginPath();
        ctx.ellipse(bx, by, 3.6, 2.4, 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1a1206';
        ctx.fillRect(bx - 1.2, by - 2.2, 1.1, 4.4);
      }
      break;
    }
    case 'wolves': {
      // Sleek body
      ctx.fillStyle = 'hsl(215 12% 38%)';
      ctx.beginPath();
      ctx.roundRect(-s * 0.36 + walk * 2, -s * 0.02, s * 0.13, s * 0.36, 2);
      ctx.roundRect(s * 0.2 - walk * 2, -s * 0.02, s * 0.13, s * 0.36, 2);
      ctx.fill();
      const bg = ctx.createLinearGradient(0, -s * 0.6, 0, s * 0.1);
      bg.addColorStop(0, 'hsl(214 15% 55%)');
      bg.addColorStop(1, 'hsl(216 14% 36%)');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.ellipse(-s * 0.02, -s * 0.28, s * 0.46, s * 0.24, -0.05, 0, Math.PI * 2);
      ctx.fill();
      // Bushy tail
      ctx.beginPath();
      ctx.ellipse(-s * 0.5, -s * 0.4 + walk, s * 0.22, s * 0.1, -0.6, 0, Math.PI * 2);
      ctx.fill();
      // Head with pointed ears
      ctx.beginPath();
      ctx.ellipse(s * 0.42, -s * 0.44, s * 0.18, s * 0.14, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(s * 0.3, -s * 0.54);
      ctx.lineTo(s * 0.32, -s * 0.74);
      ctx.lineTo(s * 0.42, -s * 0.58);
      ctx.closePath();
      ctx.fill();
      // Muzzle + eye
      ctx.fillStyle = 'hsl(214 12% 70%)';
      ctx.beginPath();
      ctx.moveTo(s * 0.52, -s * 0.46);
      ctx.lineTo(s * 0.68, -s * 0.4);
      ctx.lineTo(s * 0.52, -s * 0.36);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'hsl(190 100% 65%)';
      ctx.beginPath();
      ctx.arc(s * 0.46, -s * 0.47, s * 0.03, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'porcupine': {
      // Quills — radiating strokes with gradient tips
      for (let i = 0; i < 15; i++) {
        const a = Math.PI * (0.95 + (i / 15) * 1.15) + Math.sin(t * 2 + i) * 0.03;
        const qLen = s * (0.55 + (i % 3) * 0.12);
        ctx.strokeStyle = i % 2 ? 'hsl(35 25% 68%)' : 'hsl(20 20% 30%)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(-s * 0.05, -s * 0.3);
        ctx.lineTo(-s * 0.05 + Math.cos(a) * qLen, -s * 0.3 - Math.abs(Math.sin(a)) * qLen);
        ctx.stroke();
      }
      // Body
      const bg = ctx.createLinearGradient(0, -s * 0.5, 0, s * 0.1);
      bg.addColorStop(0, 'hsl(25 30% 34%)');
      bg.addColorStop(1, 'hsl(20 26% 22%)');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.24, s * 0.42, s * 0.26, 0, 0, Math.PI * 2);
      ctx.fill();
      // Face
      ctx.fillStyle = 'hsl(28 32% 44%)';
      ctx.beginPath();
      ctx.ellipse(s * 0.4, -s * 0.22, s * 0.15, s * 0.11, 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#160c04';
      ctx.beginPath();
      ctx.arc(s * 0.5, -s * 0.24, s * 0.035, 0, Math.PI * 2);
      ctx.fill();
      // Little feet
      ctx.fillStyle = 'hsl(20 26% 18%)';
      ctx.beginPath();
      ctx.roundRect(-s * 0.24 + walk, -s * 0.02, s * 0.12, s * 0.14, 2);
      ctx.roundRect(s * 0.1 - walk, -s * 0.02, s * 0.12, s * 0.14, 2);
      ctx.fill();
      break;
    }
    case 'beetles': {
      // Shell with iridescent gradient
      const bg = ctx.createLinearGradient(-s * 0.4, -s * 0.6, s * 0.4, 0);
      bg.addColorStop(0, 'hsl(150 45% 30%)');
      bg.addColorStop(0.5, 'hsl(170 55% 38%)');
      bg.addColorStop(1, 'hsl(130 45% 26%)');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.ellipse(-s * 0.05, -s * 0.26, s * 0.42, s * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      // Wing split line
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-s * 0.4, -s * 0.26);
      ctx.lineTo(s * 0.3, -s * 0.26);
      ctx.stroke();
      // Head
      ctx.fillStyle = 'hsl(140 35% 22%)';
      ctx.beginPath();
      ctx.arc(s * 0.4, -s * 0.28, s * 0.13, 0, Math.PI * 2);
      ctx.fill();
      // Abdomen cannon aims up-forward
      ctx.save();
      ctx.translate(-s * 0.36, -s * 0.34);
      ctx.rotate(-0.8 + Math.sin(t * 2.4) * 0.06);
      ctx.fillStyle = 'hsl(80 45% 35%)';
      ctx.beginPath();
      ctx.roundRect(-s * 0.06, -s * 0.34, s * 0.12, s * 0.34, 3);
      ctx.fill();
      ctx.fillStyle = `hsla(70 90% 60% / ${0.5 + Math.sin(t * 5) * 0.3})`;
      ctx.beginPath();
      ctx.arc(0, -s * 0.36, s * 0.06, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // Legs
      ctx.strokeStyle = 'hsl(140 30% 20%)';
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(-s * 0.15 + i * s * 0.15, -s * 0.1);
        ctx.lineTo(-s * 0.2 + i * s * 0.15 + walk * 1.5, s * 0.08);
        ctx.stroke();
      }
      // Eye
      ctx.fillStyle = 'hsl(60 100% 70%)';
      ctx.beginPath();
      ctx.arc(s * 0.45, -s * 0.31, s * 0.03, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
}
