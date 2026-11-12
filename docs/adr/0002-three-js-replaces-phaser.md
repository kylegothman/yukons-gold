# 2. Three.js replaces Phaser

Status: accepted. Date: 2026-11-11. Supersedes the original choice of Phaser 3.

## Context

The first build was 2D isometric in Phaser 3. It played well, but the art direction asked for lit terrain, real shadows and pits you can see into. A 2D sprite engine cannot do those, and faking them was going to cost more than switching.

## Decision

The view was rewritten in Three.js. The camera keeps the old isometric angle and adds quarter-turn rotation. The HUD stayed as DOM elements over the canvas.

## Consequences

- Terrain, shadows, water and time of day are real 3D. Tiles sink as they are dug.
- The switch touched only `src/view`. The simulation and its tests did not change, which is the first decision record paying for itself.
- The game now needs WebGL 2 and a reasonable GPU. The default 128 by 128 map draws several hundred thousand triangles a frame.
- Picking can no longer assume a flat grid. The cursor ray is marched against the terrain height field.
