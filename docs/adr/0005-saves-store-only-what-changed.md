# 5. Saves store only what changed

Status: accepted. Date: 2026-11-12.

## Context

The game saves to browser storage, which is limited to about 5 MB. Writing the whole state as JSON was fine at 64 by 64 tiles, but a 256 by 256 map has 65,536 tiles and came to several megabytes.

## Decision

The map is a pure function of its seed and size, so a save does not store it. A save holds the seed, the size, the units, items and players, and a flat list of only the tiles that differ from a freshly generated map.

## Consequences

- A save on the largest map with one claim is under 100 KB. A test asserts this.
- Loading regenerates the map first, which takes a moment on the largest size.
- Any change to map generation invalidates old saves, because the baseline they were diffed against no longer exists. The save key carries a version for that reason.
