# 1. The simulation is separate from the view

Status: accepted. Date: 2026-11-09.

## Context

The game needs to be testable without a browser, and it should be possible to add multiplayer later without rewriting the rules. Game logic that lives inside a rendering engine's update loop makes both of those hard.

## Decision

The rules live in `src/sim` as plain TypeScript with no rendering imports. The simulation advances in fixed ticks, ten a second. Every player action reaches it as a command object, such as `{ c: 'dig', unit: 3, tx: 40, ty: 12 }`. All randomness comes from one seeded generator whose state is part of the game state. Every unit, item and wallet has an owner id, even with one player.

The view reads the state to draw it and sends commands. It never writes to the state.

## Consequences

- The same seed and the same commands always produce the same game. Tests assert on this.
- The whole rule set is covered by tests that run in about three seconds, and a bot can play a hundred-day season in about two.
- Multiplayer becomes a transport problem: send the command objects over a network instead of straight to the local simulation.
- The view has to interpolate between ticks to look smooth, which is extra code.
- Nothing in the simulation may read a clock or call `Math.random`. That discipline has to be kept.
