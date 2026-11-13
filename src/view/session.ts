import type { Command } from '../sim/commands';
import { MAP_SIZE } from '../data/balance';
import { createGame } from '../sim/mapgen';
import { SaveData, deserialize, serialize } from '../sim/save';
import type { GameState } from '../sim/state';
import { Sfx } from './audio';

const SAVE_KEY = 'yukons-gold-save-v4';

// Shared between the Phaser scene and the DOM HUD. Holds the sim state, the
// outgoing command queue, and view-only UI state (selection, modes, speed).
export class Session {
  state: GameState;
  queue: Command[] = [];
  me = 0;
  selUnits = new Set<number>();
  selItem = -1;
  selTile: { x: number; y: number } | null = null;
  mode: '' | 'testpan' | 'drill' | 'claim' | 'place' | 'move' = '';
  pending: string | number | null = null; // store id being placed, or item id being moved
  icons: Record<string, string> = {};
  night = 0;
  sfx = new Sfx();
  speed = 1;
  paused = true;
  started = false;
  hint = '';
  onToast: (text: string) => void = () => {};
  onRestart: () => void = () => {};

  constructor(public seed: number, public size = MAP_SIZE) { this.state = createGame(seed, size); }
  send(c: Command) { this.queue.push(c); }
  get player() { return this.state.players[this.me]; }
  get boss() { return this.state.units.find(u => u.owner === this.me && u.boss)!; }
  /** Autosave to this browser. Storage can be missing or full, so failures are ignored. */
  save() {
    if (!this.started) return;
    try {
      if (this.state.over) localStorage.removeItem(SAVE_KEY);
      else localStorage.setItem(SAVE_KEY, JSON.stringify(serialize(this.state)));
    } catch { /* play on without a save */ }
  }
  static peekSave(): SaveData | null {
    try { const raw = localStorage.getItem(SAVE_KEY); const d = raw ? JSON.parse(raw) : null; return d && d.v === 4 && d.core && !d.core.over ? d : null; } catch { return null; }
  }
  resume(): boolean {
    const d = Session.peekSave(); if (!d) return false;
    this.seed = d.seed; this.size = d.size; this.state = deserialize(d); this.queue = [];
    this.selUnits.clear(); this.selItem = -1; this.selTile = null; this.mode = ''; this.pending = null;
    this.speed = 1; this.paused = false; this.started = true;
    this.onRestart();
    return true;
  }
  restart(seed: number, size = this.size) {
    this.seed = seed; this.size = size; this.state = createGame(seed, size); this.queue = [];
    this.selUnits.clear(); this.selItem = -1; this.selTile = null; this.mode = ''; this.pending = null;
    this.speed = 1; this.paused = false; this.started = true;
    this.onRestart();
  }
}
