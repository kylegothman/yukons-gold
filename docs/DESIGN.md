# Yukon's Gold: design document

This is the game as built. Every number here is also in `src/data/balance.ts`, which is the source of truth if the two ever disagree.

## The game in one paragraph

A real-time gold mining game with StarCraft-style command and PlateUp!-style item handling. You start as one prospector with a shovel, sieve, bucket and pan, $1,000 in cash, and a bill of $50 a day. You sample ground, stake a claim, and move dirt by hand through dig, sieve and pan. Profits buy hired hands and machines until you are running a mine down to bedrock. A season lasts 100 days and your score is the cash you finish with. Hitting $0 ends it early.

## Controls

One input scheme carries the whole game. Left-click selects, right-click acts: walk, pick up, dig, use a station, climb into a machine. It works the same for a single miner on day 1 and for a box-selected crew on day 60.

| Input | Does |
| --- | --- |
| Left-click, or drag a box | Select a miner, a piece of gear, or a crew |
| Right-click | The obvious action for what is under the cursor; a hint by the cursor says what that is |
| T | Test pan mode |
| R | Core drill mode (needs the drill rig) |
| C | Stake a claim |
| B | Supply store |
| M | Move the selected gear to a tile you click |
| G | Drop what you are carrying |
| F | Find your miner |
| Q, E | Rotate the camera a quarter turn |
| WASD, arrows, two-finger scroll | Move the camera |
| Scroll wheel, pinch, + and - | Zoom |
| Space, 1, 2, 3 | Pause, 1x, 2x, 4x speed |

## The map

The map is a grid of square tiles: 64, 128 (default) or 256 to a side. A creek runs from the top edge to the bottom. Camp is placed on the creek bank at the spot with the most paying ground within a short walk, so no season starts in a dead zone.

### Layers

Every tile has five layers. Gold in a layer is its loads times its grade.

| Layer | Loads per tile | Grade multiplier | Dug by |
| --- | --- | --- | --- |
| Organic | 12 | 0.2x | Shovel, or any excavator |
| Topsoil | 16 | 0.5x | Mini excavator and up |
| Brown | 36 | 1x | A dozer rips it first, then a mid excavator and up digs it |
| Blue | 60 | 3x | Large excavator and up |
| Bedrock | 12 | 8x | Mining excavator. It comes out as ore |

One load is a 5-gallon bucket.

### Where the gold is

One seeded noise field sets each tile's richness. The values are skewed hard, so most ground is nearly barren, some is decent, and a few percent is bonanza. The field is smooth, so rich tiles form streaks and pockets, and a random per-tile jitter means the neighbour of a rich tile is likely rich but can still be a dud. A tile's richness times the layer multiplier gives that layer's grade, so a rich tile is rich all the way down and richest at bedrock.

Organic grades fall into bands:

| Band | Grams per load | By hand you |
| --- | --- | --- |
| Trace | under 0.1 | go broke |
| Low | 0.1 to 0.3 | roughly break even |
| Fair | 0.3 to 0.7 | make steady money |
| Rich | 0.7 to 1.5 | bank money for upgrades |
| Bonanza | 1.5 and up | get rich |

### Prospecting

All grades start hidden. A test pan takes 3 seconds, costs nothing, works anywhere, and reads the organic layer as a band. Three readings in ten are off by one band. Digging a tile proves its organic grade. The drill rig core-samples a tile for $100 and shows the exact grade of all five layers.

### Claims

You can test pan anywhere but dig only on ground you have claimed. A claim is 8 by 8 tiles, centred wherever you point, and may not overlap another. The first is free. The second costs $2,000 and each one after costs 50% more than the last.

### The pit rule

A tile may be at most one layer deeper than its shallowest neighbour. Layer k of a tile can be dug once all four neighbours have lost their first k layers. Unclaimed ground never opens, so the outer ring of a lone claim stays at organic depth. Reaching bedrock on one tile takes a pit about nine tiles wide across several claims.

## Getting gold out of the ground

### By hand

| Step | Where | Time | Result |
| --- | --- | --- | --- |
| Dig | A tile on your claim | 5 s per load | A bucket of pay dirt |
| Sieve | The sieve, set down anywhere | 4 s per load | A bucket of screened fines |
| Wash | A pan or sluice beside the creek | 6 s per load in a pan, 2 s in a sluice | Gold, sold at once for $100 a gram |

A pan recovers 70% of the gold in a load and a sluice 90%. Washing dirt that skipped the sieve takes three times as long. A unit carries one thing at a time. A wheelbarrow carries 4 loads and an ATV with trailer carries 8 and moves faster.

### Hired hands

Select a hand and right-click your claim. They mine on their own, like a harvester: dig, screen, wash, come back. Add more hands the same way and they share the stations. You can also right-click a hand onto the sieve or a pan to staff it full time, after which everyone else sets buckets down there and walks off. A hand who finds a station already loaded sets the bucket down and works the station, so a crew cannot seize up with every hand holding a full bucket.

### By machine

Right-click a hired hand onto any vehicle to make them its driver, then right-click your claim.

- **Excavators** scoop a tile and haul the load to a processor, or tip it into a dump truck waiting nearby. The pit deepens around the tile you clicked.
- **The dozer** rips the brown layer of every tile it can reach.
- **The dump truck** parks beside the nearest working excavator, takes 48 loads, and hauls to the plant.
- **The fuel truck** carries 200 gallons from a tank out to any vehicle below half.

Processors pass loads down a line of touching machines:

- **Trommel** (24-load hopper, 1.5 s a load) feeds a sluice on a touching tile, which then washes on its own.
- **Wash plant** (96-load hopper, 0.5 s a load, 95% recovery) screens and washes in one. Vehicles prefer it to a trommel.
- **Crusher** takes bedrock ore and feeds a touching **mill**, which feeds a touching wash plant.

Pans, sluices and wash plants need water: the creek, or a running pump within 10 tiles.

## Money

One real minute is one game day. Cash drains continuously.

Daily burn = $50 living costs + $75 for each hired hand + upkeep for every machine you own, working or not.

Diesel is separate. It costs $4 a gallon and is burned only while a machine works. Stationary machines draw from a tank within range. Vehicles drive to a tank when low, or wait for the fuel truck. With no diesel, machines stop and a note above them says why.

Gear sells back at half price.

### The store

Buying a tier's key item opens the next tier.

| Tier | Gear | Price | Upkeep per day |
| --- | --- | --- | --- |
| 1 | Extra bucket | $50 | $0 |
| 1 | Wheelbarrow | $300 | $0 |
| 1 | Hired hand | $200 | $75 |
| 1 | Sluice box (opens tier 2) | $800 | $10 |
| 2 | Trommel | $1,500 | $30 |
| 2 | Diesel tank, 100 gallons, 8-tile reach | $500 | $0 |
| 2 | Mini excavator, 6 loads a scoop (opens tier 3) | $3,500 | $75 |
| 2 | Pump and hose | $1,250 | $15 |
| 2 | ATV and trailer | $2,000 | $0 |
| 2 | Drill rig | $1,500 | $10 |
| 3 | Dozer | $10,000 | $150 |
| 3 | Mid excavator, 12 loads a scoop (opens tier 4) | $16,000 | $200 |
| 3 | Wash plant | $12,000 | $200 |
| 3 | Dump truck | $8,000 | $100 |
| 3 | 500-gallon tank, 10-tile reach | $1,000 | $0 |
| 3 | Fuel truck | $5,000 | $50 |
| 4 | Large excavator, 24 loads a scoop (opens tier 5) | $250,000 | $500 |
| 4 | 2,000-gallon tank, 12-tile reach | $3,000 | $0 |
| 5 | Mining excavator, 40 loads a scoop | $600,000 | $1,250 |
| 5 | Crusher | $150,000 | $250 |
| 5 | Mill | $200,000 | $300 |

Diesel burned per day of work: mini excavator 6 gallons, mid 10, large 20, mining 40, dozer 12, dump truck 8, fuel truck 6, trommel 3, wash plant 8, crusher 10, mill 10, pump 2.

### How the prices were set

A bot that sends only player commands plays full seasons (`npm run balance`). Across 30 maps at the prices above it bought its first excavator around day 17, a wash plant around day 38, a large excavator around day 45 and a mining excavator around day 50. It reached bedrock in 22 of the 30 seasons and went broke in one. The bot is a competent player, not an expert: it samples a few dozen tiles, stakes the best reading and buys each upgrade as soon as it can afford it.

## Everything else

- **Time of day.** The sun crosses the sky so shadows swing, dusk turns warm, and night is moonlit with lantern glow and fireflies at about daytime brightness. Nothing gets harder to see.
- **Saving.** The season autosaves in the browser once a game day, on pause, and when the tab is hidden. The map is rebuilt from its seed and only changed tiles are stored.
- **Sound.** Synthesized in code. A button in the top bar mutes it.
- **Tutorial.** One short checklist per tier, shown until it is done. It can be minimized.

## Known simplifications

- Units walk in straight lines. Nothing blocks movement, so there is no pathfinding.
- Hills are scenery. The simulation treats the map as flat.
- Store orders arrive instantly on the tile you pick.
- An organic layer holds 12 loads where a real 10 by 10 by 2 foot layer would hold about 300, so tiles dig out and claims matter.
- Single player. The simulation is deterministic and command-driven so that multiplayer can be added in a separate version.
