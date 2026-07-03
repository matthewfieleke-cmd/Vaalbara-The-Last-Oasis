# Vaalbara: The Last Oasis

A high-fidelity, mobile-first multiplayer PWA tactics game — real-time arena battles with the resource economy and card cycling of Clash Royale, set on the dying supercontinent of Vaalbara. Painted arenas and frame-animated characters, procedural particles and a fully synthesized Zimmer-style score — zero audio files, offline-capable.

## Play

- **Instantly, offline** — open the app and hit Battle. Without Firebase keys the game runs in Local Guest Mode against a scripted opponent, with your profile stored in LocalStorage.
- **Online** — provide Firebase Realtime Database keys (see below) and the Battle button matchmakes you live against another player.

## The Game

### Two-phase match (~8 minutes)

1. **The Basalt Fields (5 min)** — jagged black rock, sulfur vents that punish campers, and magma rivers crossed only at the rock bridges — the arena painting IS the collision geometry. Deploy units from your baseline with a **drag-to-fling vector**. Accumulate **Dominance** — 50% territory pushed, 50% damage dealt.
2. **The Transition** — the camera pans up; survivors physically march into the Oasis carrying their remaining HP. The Dominance leader receives the **Vaalbara Blessing** (+10% speed & damage).
3. **The Oasis (3 min)** — a vibrant pond ecosystem. Aqua income **doubles**. Deep shallows slow heavy units 40%, reeds grant stealth, lily pads sink under colossal units, and lotus blooms burst into 15% AOE healing mist. Win by **king-of-the-hill** majority control of the pond. A 50/50 meter at the buzzer is an official Tie.

### The 7-card deck matrix

Each coalition runs 6 animals + 1 shifting phase spell (4 in hand, cycling):

| The Magma Vanguard | The Oasis Syndicate |
| --- | --- |
| **T-Rex** — colossal tank, ground-stomp chip damage, chomps flyers | **Bear** — sweeping tank, hits 3 tiles, swats flyers |
| **Lion** — commander, deployment roar freezes adjacent enemies | **Bighorn Sheep** — knight-move charger, 3× first strike + knockback |
| **Eagle** — air assassin, hunts the lowest-HP unit | **Swarm of Bees** — hovers over enemies, caps their range at 1 |
| **Honey Badger** — berserker: 2× attack speed + CC immunity below 30% HP | **Pack of Wolves** — pair, +15% damage when adjacent |
| **Scorpion** — diagonal-only flanker, first sting stuns | **Porcupine** — reflects 20% of melee damage |
| **Fire Ants** — line of 3, stacking acid burn | **Bombardier Beetles** — anti-air line artillery, slowing splash pools |
| **Phase Spell** — Sulfur Cloud (P1) / Thicket (P2) | **Phase Spell** — Sulfur Cloud (P1) / Thicket (P2) |

**Lava Rain** — the once-per-round sidebar ultimate: a 1.2 s telegraphed shadow, then three-tier circular devastation (enemies only, flyers hit hardest at the centre).

## Architecture

Strictly decoupled headless simulation:

| File | Role |
| --- | --- |
| `src/types.ts` | Strict coordinate & state contracts. The whole world is serialisable data. |
| `src/data.ts` | Faction rosters, deck matrix, every balance number in one place. |
| `src/engine.ts` | Deterministic headless sim over a **continuous world** on a 300 ms tick: corridor routing + steering + wall-slide + unit separation, projectiles, phase orchestration, `TickDriver` (real-time pacing + async input queue + rewind/replay desync reconciliation), `BotBrain`. |
| `src/navmask.ts` | Collision/terrain masks baked offline from the arena paintings (`scripts/gen-navmask.mjs`). |
| `src/sprites.ts` | Painted-art pipeline: background keying, film-strip splitting into run/attack animation frames. |
| `src/audio.ts` | Web Audio synthesizer: per-species SFX profiles + generative two-layer soundtrack that crossfades between phases and tracks battle intensity. |
| `src/net.ts` | Firebase matchmaking/relay (dynamically imported only when keys exist) + LocalStorage guest mode. |
| `src/render.ts` | Procedural 2.5D canvas at 60fps: gradient terrain, vector animals, particle engines (lava sparks, ash, ripples, glowing mist), and **visual catch-up interpolation** that smooths both normal tick motion and network corrections. |
| `src/App.tsx` + `src/components/` | Portrait UI shell: intro cinematic, menu hub, faction select, matchmaking, battle HUD, results. |

Inputs are always asynchronous and execute on the **next** tick — locally and online alike — so both clients replay an identical input stream over an identical seed.

## Development

```bash
npm install
npm run dev        # local dev server
npm run build      # typecheck + production build to dist/
```

## Deployment (GitHub Pages, free)

Push to `main`. The included workflow (`.github/workflows/deploy.yml`) builds and publishes to GitHub Pages automatically — enable **Settings → Pages → Source: GitHub Actions** once. The Vite `base: './'` config makes the bundle path-independent, so it works at `https://<user>.github.io/<repo>/` with no changes.

## Enabling online multiplayer

Create a free Firebase project with a Realtime Database, then either:

- add to `index.html`:

```html
<script>
  window.VAALBARA_FIREBASE = {
    apiKey: "YOUR_API_KEY",
    databaseURL: "https://your-project-default-rtdb.firebaseio.com"
  };
</script>
```

- or set `VITE_FIREBASE_API_KEY` and `VITE_FIREBASE_DB_URL` at build time,
- or store the same JSON under the `vaalbara.firebase` LocalStorage key.

No keys? The game silently stays in Local Guest Mode and is fully playable.
