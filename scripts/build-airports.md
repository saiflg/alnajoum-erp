# Airport dataset

`apps/web/public/data/airports.json` (~6,000 airports, every entry with a
real 3-letter IATA code) powers the `AirportInput` typeahead used on the
homepage flight-search teaser and the portal's multi-leg search form (see
`apps/web/src/lib/airports.ts`).

## Why this exists as a generated file, not hand-written data

Earlier versions of `AirportInput` used a hand-curated list of ~90
airports. When asked for full worldwide coverage, the right call was
**not** to type thousands of IATA codes from memory — that's exactly the
kind of bulk-factual task where an LLM will quietly get individual codes
wrong at real scale, and a travel booking app is a bad place for silently
incorrect airport codes. Instead, the dataset is built from
[OpenFlights](https://github.com/jpatokal/openflights)' open airport
database, a long-standing, widely-used open dataset in the aviation/travel
software world (public domain / open license — see the OpenFlights repo).

## Regenerating it

```bash
curl -sSL -o /tmp/airports.dat https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat
node scripts/build-airports.js /tmp/airports.dat
```

This overwrites `apps/web/public/data/airports.json`. Re-run it
periodically to pick up new/renamed airports upstream — there's no
automation for this yet (see README's Remaining tasks).

## Format

Each entry is `{ code, city, country, name }` — `code` is the 3-letter
IATA code (unique; the source file's rows are deduplicated by code,
keeping the first occurrence), the other three fields are as OpenFlights
records them (occasional inconsistent capitalization/spelling is
upstream, not introduced by the transform).

## What's deliberately excluded

Entries without a valid IATA code (many small airstrips only have an ICAO
code) are dropped — this dataset is for customer-facing route search, not
a complete aviation database, so only bookable/commercially-relevant
airports matter here.
