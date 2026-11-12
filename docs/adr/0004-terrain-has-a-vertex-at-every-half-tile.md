# 4. The terrain has a vertex at every half tile

Status: accepted. Date: 2026-11-11.

## Context

Digging has to be visible, per tile, and neighbouring pits have to join into one excavation. A terrain mesh with one vertex per tile corner cannot lower a single tile, because every corner is shared by four tiles.

## Decision

The ground is one mesh with a vertex at every tile corner, every edge midpoint and every tile centre. A centre vertex drops with its own tile. An edge or corner vertex drops only as far as the shallowest tile that touches it.

Normals are recomputed only around the tile that changed, and only the changed rows of the vertex buffers are sent to the GPU.

## Consequences

- A single dug tile is a bowl. Two dug neighbours share a lowered edge. A fully dug area is a flat-bottomed pit with sloped walls, and the pit rule shows up as visible terraces.
- Four times the vertices of a corner-only grid. On the 256 map that is about 315,000 vertices.
- Depth is purely visual. The simulation knows loads remaining per layer, not heights.
