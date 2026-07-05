import { useState } from 'react';
import type { FactionId, SpeciesId } from '../types';
import { FACTIONS } from '../data';
import { DUEL_STATS } from '../duel';
import { SpriteArt } from './SpriteArt';
import { playUi } from '../audio';

/* --------------------------------------------------------------------------
 * The Duels strategy guide: the basics of the exchange triangle, then an
 * in-depth per-champion section ("Learn more") with matchup advice.
 * ------------------------------------------------------------------------ */

interface ChampionTip {
  species: SpeciesId;
  role: string;
  strike: string;
  guard: string;
  special: string;
  beware: string;
}

const TIPS: Record<FactionId, ChampionTip[]> = {
  magma: [
    {
      species: 'trex',
      role: 'Slow colossus — wins wars of attrition.',
      strike: 'Trade freely into tanks and bruisers: 98 ATK out-muscles any counter-blow they answer with.',
      guard: 'Guard early against fast strikers (Wolves, Bighorn, Eagle). You block 70%, counter hard, and bank Fury while they spend theirs.',
      special: 'Tyrant Chomp ignores DEF. Save it for the Bear and the Porcupine, where a normal strike loses a third of its bite to armor.',
      beware: 'You act last at SPD 3 — never guard while the foe\u2019s Fury is full, because a special crushes straight through a guard.',
    },
    {
      species: 'lion',
      role: 'Balanced commander with tempo control.',
      strike: 'Your default. SPD 6 outdraws every tank, so you hit first and force them to answer wounded.',
      guard: 'When low against heavy hitters — a blocked haymaker plus your counter often swings the round.',
      special: 'Ember Roar stuns. Fire it the exchange BEFORE the enemy meter fills: the stun wastes their entire special turn.',
      beware: 'Don\u2019t slug colossi head-on for long — one crit from a Bear or T-Rex undoes two of your exchanges.',
    },
    {
      species: 'eagle',
      role: 'Fastest Magma blade — first strike in almost every trade.',
      strike: 'Strike relentlessly into slower foes. Your hit lands first, and a foe that falls first never hits back.',
      guard: 'Rarely. At DEF 8 even a blocked hit stings; you defend better by killing faster or diving.',
      special: 'Sky Dive evades EVERYTHING that exchange. Hold it as insurance: when the foe\u2019s meter fills, dodge their special and punish for 170%.',
      beware: 'Guarded foes. The counter-blow costs you more than you can afford — read the turtle and wait it out.',
    },
    {
      species: 'honeybadger',
      role: 'Berserker that gets scarier as it bleeds.',
      strike: 'Below 35% HP your ATK jumps 40%. When wounded, strike — hiding wastes your best moments.',
      guard: 'Early, while healthy, to bait counters and build Fury for the berserk phase.',
      special: 'Grudge Frenzy\u2019s three snaps shred low-DEF foes (Bees, Wolves, Eagle) — and every snap carries your berserk bonus.',
      beware: 'The Porcupine. Its quills tax every fast strike you land; force it to come to you instead.',
    },
    {
      species: 'scorpion',
      role: 'Flanker that wins the long game.',
      strike: 'Standard pressure at SPD 7 — you outdraw most of the Oasis roster.',
      guard: 'Guard while venom does the work: it ticks 6% of the victim\u2019s max HP at the end of every exchange.',
      special: 'Venom Sting scales with the victim\u2019s size. Sting the Bear (540 HP) and it bleeds ~32 a tick; stinging the Bees wastes it.',
      beware: 'Don\u2019t sting something already dying — the venom outlives the victim and the Fury is gone.',
    },
    {
      species: 'fireants',
      role: 'Cheap opener — the pyre spreads.',
      strike: 'Fast chip trades. You are expendable: every point of damage you land is pure profit for the champions behind you.',
      guard: 'When the enemy meter fills. You can afford to eat a special better than your heavies can.',
      special: 'Crawling Pyre burns 5% max HP for 4 exchanges. Light the biggest thing on the field, as early in its life as possible.',
      beware: 'Sweeping tanks. Once the burn is set, stop trading politely — every extra exchange is a gift to them.',
    },
  ],
  oasis: [
    {
      species: 'bear',
      role: 'The anchor — nothing pushes through faster.',
      strike: 'Trade into anything slower or staggered: 90 ATK breaks spirits even when blocked.',
      guard: 'Against fast strikers. Your counter-blow hits as hard as other champions\u2019 strikes.',
      special: 'Crushing Swat right before their big turn: −35% ATK for 2 exchanges defangs a berserk Badger or a charged T-Rex.',
      beware: 'Tyrant Chomp ignores your armor entirely. Against a full T-Rex meter, trade — never sit in guard.',
    },
    {
      species: 'bighorn',
      role: 'Explosive opener — the Comet strikes first.',
      strike: 'ALWAYS strike your first exchange after entering: the Comet Entrance passive adds 50% to it.',
      guard: 'Sparingly. Guarding wastes the tempo your SPD 8 buys you.',
      special: 'Comet Charge is the game\u2019s biggest single hit (240%). Fire it the moment it\u2019s full — holding it is losing it.',
      beware: 'Quills and thorns. A bristling Porcupine turns your all-out aggression into self-harm.',
    },
    {
      species: 'bees',
      role: 'Untouchable tempo thief.',
      strike: 'First in every trade at SPD 10. Chip, drain, and stay ahead of the exchange count.',
      guard: 'Almost never — at DEF 4 a guard saves you little. Your defense is the Veil.',
      special: 'Humming Veil when the foe\u2019s Fury is full: you evade their special outright AND drain 30 of their meter. The best defensive tool in the game.',
      beware: 'Long slugfests. 230 HP evaporates against tanks — win on tempo or don\u2019t engage.',
    },
    {
      species: 'wolves',
      role: 'Twin skirmishers — death by two cuts.',
      strike: 'Aggressive trading at SPD 8; you usually land first and force awkward answers.',
      guard: 'Into heavy single hitters (T-Rex, Bear) — banking a counter against a 90+ ATK strike is excellent value.',
      special: 'Twin Fang is two separate 115% bites. It is brutal into shredded armor or a staggered foe — both bites profit twice.',
      beware: 'Guard-heavy tanks in the early exchanges; feed them nothing until your meter is up.',
    },
    {
      species: 'porcupine',
      role: 'The patient fortress.',
      strike: 'Only into stunned or staggered foes — your 46 ATK is the sideshow, not the act.',
      guard: 'Constantly. With 28 DEF, a 70% block, a counter-blow AND 12% passive quills, attackers pay double for touching you.',
      special: 'Quill Nova, then guard: 35% reflect for 3 exchanges turns their best offense into self-harm.',
      beware: 'A full enemy Fury meter. Specials crush guards — when their meter fills, strike or take the special on your armor instead.',
    },
    {
      species: 'beetles',
      role: 'Chemical siege engine.',
      strike: 'Standard — but your damage is really the acid ledger, not the volley of the moment.',
      guard: 'While acid and allies do the work; you want to survive to cast the second Volley.',
      special: 'Acid Volley strips 18 DEF permanently, stacking to 36. Open the match by melting the enemy tank\u2019s armor — the debt lasts the entire battle.',
      beware: 'Fast blades. SPD 5 and modest HP means the Eagle and Wolves out-tempo you badly without an armor edge.',
    },
  ],
};

function TipRow({ icon, hue, label, text }: { icon: string; hue: number; label: string; text: string }) {
  return (
    <div className="guide-tip">
      <span className="guide-tip-label" style={{ ['--hue' as string]: hue }}>
        {icon} {label}
      </span>
      <p>{text}</p>
    </div>
  );
}

export function DuelGuide({
  faction,
  onClose,
}: {
  faction: FactionId;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<FactionId>(faction);
  const [depth, setDepth] = useState(false);

  return (
    <div className="duel-guide-overlay" onClick={onClose}>
      <div className="duel-guide" onClick={(e) => e.stopPropagation()}>
        <div className="duel-guide-head">
          <h3>Duels — Strategy Guide</h3>
          <button className="duel-guide-close" onClick={onClose} aria-label="Close guide">✕</button>
        </div>

        <div className="duel-guide-body">
          <h4>The exchange</h4>
          <p>
            Every turn, both champions secretly lock in a move, then the
            exchange resolves. <b>Speed decides who lands first</b> when both
            attack — and a champion that falls first never hits back.
          </p>

          <div className="guide-triangle">
            <div className="guide-tri-card strike-c">
              <b>⚔ Strike</b>
              <p>Your bread and butter. Builds the most Fury (+30, and +15 to whoever gets hit). Wins tempo against slower foes — but a guarded foe blocks 70% and counters.</p>
            </div>
            <div className="guide-tri-card guard-c">
              <b>🛡 Guard</b>
              <p>Blocks 70% of a strike and answers with a counter-blow. The right call when you predict a strike — but a <b>special crushes through guard</b> (only 25% blocked, no counter).</p>
            </div>
            <div className="guide-tri-card special-c">
              <b>✦ Special</b>
              <p>Needs a full Fury meter. Resolves <b>before</b> all strikes and smashes guards. Every champion\u2019s is different — read them below.</p>
            </div>
          </div>

          <h4>Reading the fight</h4>
          <ul>
            <li><b>Watch the foe\u2019s Fury bar.</b> When it\u2019s full, expect the special — never guard into it. Trade, or evade if your champion can.</li>
            <li><b>Both guard = standoff.</b> Nobody bleeds, both gain +20 Fury. Sometimes the patient play.</li>
            <li><b>Poison, burn and quills tick at the end of each exchange</b> — a stalling opponent still bleeds.</li>
            <li><b>Damage carries over.</b> Your winner keeps their wounds and Fury; the fresh challenger enters at full strength. Lead with fast, expendable chip fighters, hold your tank as the mid-battle anchor, and keep a fast closer for the end.</li>
            <li><b>A sacrifice can be strategy.</b> Feeding a wounded champion to a fresh enemy can drain them before your anchor walks in.</li>
          </ul>

          {!depth ? (
            <button
              className="btn btn-secondary guide-more"
              onClick={() => {
                setDepth(true);
                playUi('tap');
              }}
            >
              📖 Learn more — champion-by-champion guide
            </button>
          ) : (
            <>
              <h4>Champions in depth</h4>
              <div className="duel-faction-toggle">
                {(['magma', 'oasis'] as const).map((fid) => (
                  <button
                    key={fid}
                    className={`duel-fbtn ${fid} ${tab === fid ? 'selected' : ''}`}
                    onClick={() => {
                      setTab(fid);
                      playUi('tap');
                    }}
                  >
                    {FACTIONS[fid].name}
                  </button>
                ))}
              </div>
              {TIPS[tab].map((tip) => {
                const card = FACTIONS[tab].cards.find((c) => c.species === tip.species);
                if (!card) return null;
                const stats = DUEL_STATS[tip.species];
                return (
                  <div className="guide-champ" key={tip.species} style={{ ['--hue' as string]: card.hue }}>
                    <div className="guide-champ-head">
                      <div className="guide-champ-art">
                        <SpriteArt species={tip.species} hue={card.hue} />
                      </div>
                      <div>
                        <b>{card.name}</b>
                        <div className="guide-champ-role">{tip.role}</div>
                        <div className="guide-champ-stats">
                          HP {stats.hp} · ATK {stats.atk} · DEF {stats.def} · SPD {stats.spd}
                        </div>
                      </div>
                    </div>
                    <TipRow icon="⚔" hue={18} label="Strike" text={tip.strike} />
                    <TipRow icon="🛡" hue={205} label="Guard" text={tip.guard} />
                    <TipRow icon="✦" hue={265} label={stats.special.name} text={tip.special} />
                    <TipRow icon="⚠" hue={48} label="Beware" text={tip.beware} />
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
