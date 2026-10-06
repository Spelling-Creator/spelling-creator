---
title: Fact checking
---

# Fact checking

A lesson states facts the speller is then asked about: how tall Everest is, when the
Eiffel Tower went up, how many people live in Paris. The lesson standard asks for anything
a math question uses to be in the passage, and for anything time-sensitive to be checked
before it is written down. Fact checking compares a lesson's numbers and dates with
[Wikidata](https://www.wikidata.org).

It is in two places, which share one checker:

- **The editor's Check panel**, under the [lesson checks](./lesson-checks.md), as a
  **Facts** section with a **Check facts** button.
- **The MCP server's `check_facts` tool**, for an assistant to check figures before it
  writes them (see [Tools](/mcp-server/tools#checking-facts)).

## What the author sees

Pressing **Check facts** (after the usual Turnstile challenge) shows skeleton rows while
the check runs, then:

- **Facts Wikidata disagrees with**, grouped by section. Each reads like
  _"8,000 METRES": Wikidata gives the height of Mount Everest as 8,848.86 meters._ and,
  like any finding, leads to its passage. Under it is the Wikidata item it was checked
  against, with its description and a link, because a name can match the wrong thing and
  the author is the one who can tell.
- **A count of the rest**, behind **Show N more**: facts that matched, and facts that
  couldn't be checked (no such item, no such value on it, a unit the checker can't
  convert, or no reply). The second kind isn't a problem, only a gap in Wikidata.

The result is a snapshot. A fact whose words are no longer in its passage is dropped from
the list and counted under "N facts have changed in the lesson since this check", so fixing
a number clears its finding without checking again. Closing the panel to go to a finding
keeps the result; it lives on the editor page (`useFactCheck`), not in the panel.

Nothing blocks, as with the other checks. And none of it is counted in the Check button's
badge or the outline: those are free and always current, and this is neither.

The section is hidden on an instance with no API URL or no Turnstile site key, where it
could only fail.

## How a check works

```text
 Editor ──passages + Turnstile token──▶ Worker (POST /, mode: "factCheck")
                                          │ 1. model lists the claims in the passages
                                          │ 2. each quote must be in its passage
                                          ▼
                                  core/factCheck checkClaims
                                          │ 3. wbsearchentities: names to candidate items
                                          │ 4. one SPARQL query: every candidate's values
                                          │ 5. pick the item, convert units, compare
                                          ▼
 Editor ◀──facts: { blockId, quote, status, entity, wikidata }──
```

The split is the important part. **Finding claims in prose** is a language problem, so the
Worker asks its [AI provider](./ai-text-suggestions.md) to list them, with a schema that
only allows the properties and units the checker understands. **Judging a claim** is
deterministic and done in code. The model never says whether a fact is right, and a claim
whose quote isn't actually in a passage is dropped (step 2), so an invented fact can't
reach the author as a finding.

Over MCP, step 1 is the assistant itself: it passes claims to `check_facts`, and the tool
runs steps 3 to 5 with no AI provider involved.

A claim looks like this:

```json
{
  "subject": "Mount Everest",
  "kind": "mountain",
  "property": "height",
  "value": 8849,
  "unit": "m",
  "qualifier": "exact",
  "quote": "8,849 METRES"
}
```

`subject` is the thing's English name, `kind` a word or two for what it is (used to tell
Georgia the country from Georgia the state), and `property` one of the keys below. Dates
put the year in `value` (negative for BC) and may add `month` and `day`.

### What can be checked

Only numbers and dates about one specific, named thing. Each property maps to one or more
Wikidata properties, tried in order; the first the item has is used, and they are never
pooled, so a tower's elevation above sea level can't agree with a sentence about its
height.

| Property              | Wikidata                                               | For                                    |
| --------------------- | ------------------------------------------------------ | -------------------------------------- |
| `height`              | height (P2048), else elevation (P2044)                 | buildings, statues, animals, mountains |
| `elevation`           | elevation above sea level (P2044)                      | places, summits                        |
| `length`, `width`     | P2043, P2049                                           | rivers, bridges, walls                 |
| `depth`               | vertical depth (P4511)                                 | lakes, seas, caves                     |
| `diameter`, `radius`  | P2386, P2120                                           | planets, craters                       |
| `area`, `volume`      | P2046, P2234                                           | countries, lakes                       |
| `population`          | P1082                                                  | places                                 |
| `mass`, `speed`       | P2067, P2052                                           |                                        |
| `temperature`         | P2076                                                  | stars, places                          |
| `distance_from_earth` | P2583                                                  | things in space                        |
| `orbit_distance`      | semi-major axis (P2233)                                | a planet's distance from the Sun       |
| `orbital_period`      | P2146                                                  | a planet's year                        |
| `duration`            | P2047                                                  | events, journeys                       |
| `born`, `died`        | P569, P570                                             | people, animals                        |
| `began`               | inception (P571), start (P580), opening (P1619), P585  | built, founded, formed                 |
| `ended`               | end time (P582), dissolved or demolished (P576)        |                                        |
| `happened`            | point in time (P585), start (P580), launch date (P619) | events, launches                       |
| `discovered`          | P575                                                   |                                        |
| `published`           | P577                                                   | books, films, songs                    |

Units cover metric and imperial length, area, volume, mass and speed, temperature in all
three scales, durations from seconds to thousands of years, astronomical units,
light-years and Earth masses. The table is `FACT_UNITS` in `core/factCheck.js`, each entry
keyed to its Wikidata item so a value can be read in whatever unit Wikidata stores it in.

### What counts as agreeing

A passage rounds, and Wikidata often holds several honest answers at once, so "agrees" is
deliberately generous and "disagrees" means something.

- **Every current value counts.** Deprecated statements never do. Everest has 8,848,
  8,848.86 and 8,850; the Eiffel Tower started in 1887 and opened in 1889. A passage using
  any of them is not wrong.
- **Except dated figures, where only the latest counts.** A population with several
  "point in time" qualifiers is compared with the most recent, and the finding says which
  year it is from ("2,103,778 as of 2023"). A passage agreeing with the 1910 census is out of
  date, not right.
- **A figure gets the rounding it was written with**: half a unit in its last place. "9,000
  metres" allows 500 either way; "8,849" allows 0.5. On top of that, 2% of Wikidata's value,
  or 10% when the passage hedges ("about", "nearly").
- **"More than" and "less than" are bounds**, not rounded figures, so "more than 10,000
  metres" disagrees with Everest even though 10,000 is a round number. "Up to" is a
  "less than": "grows up to 2 metres long" is true of anything 2 metres or under, so it is
  checked as a ceiling rather than as a hedged figure near 2.
- **Wikidata's own error bounds** (a population "between 7 and 8 million") are honoured.
- **Dates are compared as precisely as Wikidata knows them.** A date known to the day is
  checked to the day, if the passage gives one; to the century, anywhere in it. Month and
  day are skipped for dates Wikidata records in the Julian calendar, which are days away
  from the same date in the Gregorian one. Very large years ("4.5 billion years ago") round
  like any big number; a year like 1960 does not, and means 1960.

The comparison is always done in the passage's unit, and that's the unit the finding
quotes Wikidata in: a passage in feet is told "29,031.69 feet", not "8,848.86 meters".

### Picking the item

`wbsearchentities` returns up to three candidates for each name. The one used is, in
order: one that has the property _and_ whose description mentions the claim's `kind`; one
that has the property; one whose description mentions the kind; the top result. A search
for "Mercury" finds the planet and the element, and only one of them has an orbital
period.

When this picks wrong, the finding says so plainly ("Checked against Georgia (state of the
United States)"), which is why the item is always shown.

### Why one SPARQL query

Values come from a single query to the [query service](https://query.wikidata.org) for every
candidate item and every property the claims need, rather than from each item's JSON.
Reading items would be simpler, but a popular item's JSON is large (the United States is
about 1.6 MB), and a check looks at several candidates for each name. The by-id query takes
well under a second.

One quirk of the query service is handled in `parseSparqlTime`: it writes dates known to the
year or better in XSD 1.1, where year 0 is 1 BC, so 2560 BC comes back as -2559. Coarser
dates come back unshifted.

## Cost, limits and caching

A check is one model call and, typically, one search per distinct name plus one SPARQL
query. It goes through the same Turnstile check and per-IP rate limiter as the other
[AI helpers](./ai-text-suggestions.md) and costs one token.

- **Limits.** At most 60 passages, 4,000 characters each and 40,000 in all, and 40 claims.
- **Results** are cached in KV for 7 days, keyed on the lesson title and the passages' text
  in order (plus a version string to bump when the rules change). A cache hit is served
  before the rate limiter and costs nothing. Block ids are not part of the key: they are
  attached to the cached facts per request, so two lessons with the same text both get
  their own ids back.
- A check where Wikidata couldn't be reached is **not cached**, so a blip isn't
  remembered for a week.
- **Wikidata's responses** are held at the Cloudflare edge for a day.
- **User-Agent.** Wikimedia throttles or refuses requests without a descriptive
  User-Agent. The Worker sends
  `SpellingCreator/1.0 (https://spellingcreator.org; lesson fact checking)`, and the MCP
  server sends the one it already uses for Commons.

A self-hosted instance needs outbound HTTPS to `www.wikidata.org` and
`query.wikidata.org`, as well as an AI provider and a Turnstile key.

## Where the code is

| File                                                  | Does                                                                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `packages/core/src/factCheck.js`                      | The checker: properties, units, item matching, the SPARQL query, comparison. `checkClaims(claims, opts)`. |
| `apps/api/src/lib/factCheck.js`                       | The extraction prompt and schema, placing quotes, and calling the checker.                                |
| `apps/api/src/routes/ai.js`                           | The `factCheck` mode: Turnstile, rate limit, cache.                                                       |
| `packages/core/src/aiSuggest.js`                      | `checkFacts()`, the browser's call to the Worker.                                                         |
| `apps/web/src/lib/factCheck.js`                       | `useFactCheck()`, and the wording of findings (`describeFact`).                                           |
| `apps/web/src/components/editor/FactCheckSection.jsx` | The Facts section of the Check panel.                                                                     |
| `apps/web/src/locales/en/checks.json`                 | Its wording, under `facts`.                                                                               |
| `apps/mcp/src/tools.js`                               | `check_facts`.                                                                                            |

`apps/web/src/lib/factCheck.test.js` fails when core gains a property or unit that
`checks.json` can't word, the same way the lesson checks' test guards their codes.

## What it doesn't do

- **Facts without a number or date** ("the Nile flows north") aren't checked. Comparing
  those means matching meaning, not values, and is where a model would start judging
  rather than extracting.
- **Facts about a whole kind of thing** ("octopuses have three hearts") mostly aren't on
  Wikidata as values, and are left out by the prompt.
- **It doesn't change the lesson.** Every finding is for the author to look at.
