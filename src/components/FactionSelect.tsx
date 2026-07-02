import { useState } from 'react';
import type { FactionId } from '../types';
import { FACTIONS } from '../data';
import { SpriteArt } from './SpriteArt';
import { playUi } from '../audio';

export function FactionSelect({
  onConfirm,
  onBack,
}: {
  onConfirm: (faction: FactionId) => void;
  onBack: () => void;
}) {
  const [picked, setPicked] = useState<FactionId>('magma');

  return (
    <div className="faction-select">
      <h2>Choose your coalition</h2>
      {(['magma', 'oasis'] as const).map((fid) => {
        const f = FACTIONS[fid];
        return (
          <button
            key={fid}
            className={`faction-card ${fid} ${picked === fid ? 'selected' : ''}`}
            onClick={() => {
              setPicked(fid);
              playUi('tap');
            }}
          >
            <h3>{f.name}</h3>
            <div className="tagline">{f.tagline}</div>
            <div className="roster">
              {f.cards.map((c) => (
                <div className="unit-dot" key={c.id} title={c.name}>
                  {c.species && <SpriteArt species={c.species} hue={c.hue} />}
                </div>
              ))}
              <div
                className="unit-dot"
                title="Phase Spell"
                style={{ fontSize: '0.9rem', color: fid === 'magma' ? '#ffd76a' : '#8dffcf' }}
              >
                ✦
              </div>
            </div>
          </button>
        );
      })}
      <div className="menu-actions">
        <button className="btn btn-primary" onClick={() => onConfirm(picked)}>
          March to the Basalt Fields
        </button>
        <button className="btn btn-ghost" onClick={onBack}>
          ◂ Back
        </button>
      </div>
    </div>
  );
}
