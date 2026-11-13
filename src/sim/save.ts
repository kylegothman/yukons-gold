import { createGame } from './mapgen';
import type { GameState, Tile } from './state';

// A save holds everything except the untouched ground. The map is rebuilt from
// its seed and only tiles that have changed are stored, which keeps even the
// largest map well inside what a browser will store.

const FIELDS = ['organicLeft', 'topsoilLeft', 'brownLeft', 'blueLeft', 'bedrockLeft', 'sample', 'owner'] as const;

export interface SaveData { v: 4; seed: number; size: number; core: Omit<GameState, 'tiles' | 'events'>; tiles: number[] }

export function serialize(s: GameState): SaveData {
  const fresh = createGame(s.seed, s.size).tiles, tiles: number[] = [];
  s.tiles.forEach((t, i) => {
    const f = fresh[i];
    if (FIELDS.every(k => t[k] === f[k]) && !t.known && !t.ripped && !t.drilled) return;
    tiles.push(i, ...FIELDS.map(k => t[k]), (t.known ? 1 : 0) | (t.ripped ? 2 : 0) | (t.drilled ? 4 : 0));
  });
  const { tiles: _t, events: _e, ...core } = s;
  return { v: 4, seed: s.seed, size: s.size, core: JSON.parse(JSON.stringify(core)), tiles };
}

export function deserialize(d: SaveData): GameState {
  const s = createGame(d.seed, d.size), step = FIELDS.length + 2;
  for (let p = 0; p < d.tiles.length; p += step) {
    const t = s.tiles[d.tiles[p]] as Tile & Record<string, number | boolean>;
    FIELDS.forEach((k, j) => { t[k] = d.tiles[p + 1 + j]; });
    const flags = d.tiles[p + step - 1];
    t.known = !!(flags & 1); t.ripped = !!(flags & 2); t.drilled = !!(flags & 4);
  }
  return { ...s, ...JSON.parse(JSON.stringify(d.core)), tiles: s.tiles, events: [] };
}
