# 3. Hired hands work like harvesters

Status: accepted. Date: 2026-11-10.

## Context

Hired hands were first given one job each: digger, screener or washer. In play testing this was confusing. With two hands it was unclear who should be where, and where a full bucket should go if the sieve was staffed by someone else.

## Decision

A hand sent to a claim runs the whole chain alone, the way a StarCraft worker harvests: dig, screen, wash, return. More hands sent the same way share the stations. Staffing a station full time is still possible but optional, and when a station is staffed everyone else simply sets buckets down beside it.

A hand who arrives at a station that is already loaded sets the bucket down and works the station.

## Consequences

- One right-click puts a new hire to work. There is no assembly line to design before anything happens.
- The planner is stateless. Each time a hand is idle it looks at the world and picks the most useful single step. That is easy to reason about and survives stations being moved or sold mid-job.
- A stateless crew can deadlock if every hand is holding something. The set-it-down rule exists to prevent that, and a regression test covers it. The balance bot found the original deadlock.
