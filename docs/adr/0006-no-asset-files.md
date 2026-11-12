# 6. No asset files

Status: accepted. Date: 2026-11-09.

## Context

This is a one-person project with no artist and no sound designer. Asset pipelines also complicate hosting, and the game needs to run as a single page inside a portfolio site.

## Decision

Every model is assembled in code from primitive shapes. Every sound is synthesized with Web Audio when it plays. The production build inlines all code into one HTML file.

## Consequences

- The game is one file of about a megabyte. It can be opened from disk, hosted anywhere, or embedded in a frame.
- The look is deliberately low-poly. Anything more detailed would need real art and a decision to start shipping assets.
- Models are tweaked by editing numbers and reloading, which is slower than using a modelling tool.
