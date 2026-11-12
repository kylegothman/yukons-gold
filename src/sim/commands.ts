import type { Job } from './state';

// Every player action is one of these. The view only ever sends commands;
// later the same objects can travel over a network.
export type Command =
  | { c: 'move'; p: number; units: number[]; x: number; y: number }
  | { c: 'dig'; p: number; unit: number; tx: number; ty: number }
  | { c: 'testpan'; p: number; unit: number; tx: number; ty: number; deep?: boolean }   // deep = core drill
  | { c: 'pickup'; p: number; unit: number; item: number }
  | { c: 'use'; p: number; unit: number; station: number }
  | { c: 'drop'; p: number; unit: number }
  | { c: 'place'; p: number; unit: number; x: number; y: number }
  | { c: 'job'; p: number; units: number[]; job: Job }
  | { c: 'buyClaim'; p: number; x0: number; y0: number }   // top-left tile of the 8 x 8 claim
  | { c: 'relocate'; p: number; unit: number; item: number; x: number; y: number }
  | { c: 'buy'; p: number; what: string; x?: number; y?: number }
  | { c: 'sell'; p: number; item: number }
  | { c: 'fire'; p: number; unit: number }
  | { c: 'drive'; p: number; unit: number; item: number }
  | { c: 'dismount'; p: number; unit: number }
  | { c: 'fuel'; p: number; item: number };
