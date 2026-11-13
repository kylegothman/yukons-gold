# 8. Gear covers tiles, and people path around it

Date: 2026-11-13

## Context

Gear used to be a point on one tile. Anything could be stacked on anything, people walked through machines, and a mining excavator took up as much ground as a bucket. Raids also needed fences that actually keep someone out.

## Decision

Each kind of gear has a footprint in tiles (`FOOTPRINT` in `src/data/balance.ts`), and `item.x, item.y` is its top-left tile. An occupancy grid is rebuilt once a tick from the items on the ground. Placement is refused unless every tile of the footprint is free. Movement goes through `waypoint()` in `src/sim/systems/nav.ts`: a straight line when nothing is in the way, otherwise A* over the grid, eight directions, no corner cutting, re-planned every three seconds.

Fences are a second kind of blocker that stops raiders but not the owner's crew. Vehicles are left out of the grid because they move.

## Consequences

- The grid is derived from state, so saves and determinism are untouched.
- A search that fails is cached until the next re-plan. Without that, one walled-off unit cost more than the rest of the simulation put together.
- A unit heading for a machine counts as arrived when it is beside the footprint, so every order that used to walk onto a station's tile still works.
- Fences cannot trap the player's own people, which rules out a class of deadlocks at the cost of some realism.
