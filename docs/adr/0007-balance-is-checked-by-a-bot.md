# 7. Balance is checked by a bot that plays the game

Status: accepted. Date: 2026-11-12.

## Context

A season is a hundred minutes long. Nobody can play enough full seasons by hand to know whether bedrock is reachable on a typical map, or what a price change does to the middle of the game.

## Decision

`scripts/balance.ts` is a bot that plays full seasons against the simulation with no browser. It sends only the commands a player could send. It prospects, stakes the best reading, works the hand loop, and buys each upgrade when it can afford it. It reports the day each tier was bought and the final cash, across as many seeds as asked for.

## Consequences

- A thirty-season run takes about a minute, so prices can be tuned against evidence.
- Because the bot plays through the real command interface, the situations it gets stuck in are ones a player can get stuck in. Its first runs found two stalls in the hand crew logic and one case of machines ignoring the wash plant. All three were real bugs, and all three are fixed.
- Its first runs also showed nearly half of all maps starting the player on barren ground. Camp is now placed beside paying ground.
- The bot is a fixed strategy. It says nothing about whether the game is fun, and a better player will beat its numbers.
