---
title: Fact checking
description: How the editor and MCP server check a lesson's numbers, dates and named facts against Wikidata, the Smithsonian's volcano records and Wikipedia.
---

# Fact checking

For how to use this, see [Fact checking](../../guide/fact-checking.md).

A lesson states facts the speller is then asked about: how tall Everest is, when the
Eiffel Tower went up, how many people live in Paris, how much a cat weighs. The lesson
standard asks for anything a math question uses to be in the passage, and for anything
time-sensitive to be checked before it is written down. Fact checking compares a lesson's
numbers and dates with three sources:

- **[Wikidata](https://www.wikidata.org)**, for every fact.
- **The Smithsonian's [Global Volcanism Program](https://volcano.si.edu)** (GVP), for a
  volcano's height and eruptions.
- **[Wikipedia](https://en.wikipedia.org)**, read when neither of those can settle a
  fact, and only ever to confirm one.

It is in two places, which share one checker:

- **The editor's Check panel**, under the [lesson checks](./lesson-checks.md), as a
  **Facts** section with a **Check facts** button.
- **The MCP server's `check_facts` tool**, for an assistant to check figures before it
  writes them (see [Tools](../mcp-server/tools.md)).

## In the editor

The result is a snapshot. It lives on the editor page (`useFactCheck` in
`apps/web/src/lib/factCheck.js`), not in the panel, so closing the panel to go
to a finding keeps it. A fact whose quote is no longer in its passage
(`quoteStillThere`) is dropped from the list and counted under `facts.changed`,
so fixing a number clears its finding without checking again.

None of it is counted in the Check button's badge or the outline: those are
free and always current, and this is neither. The section is hidden on an
instance with no API URL, or one using Turnstile with no site key
(`hasAiChallenge()`), where it could only fail.

## How a check works

1. The editor sends the lesson's passages (`lessonPassages`, each
   `{ blockId, text }`), the lesson title and a token from the instance's AI
   check (see [AI suggestions](./ai-suggestions.md#the-shared-flow)) to the Worker:
   `POST /` with `mode: "factCheck"`.
2. The Worker asks the model to list the claims in the passages
   (`factCheckPrompt`, `FACT_CLAIMS_SCHEMA`).
3. Each claim's quote must be in a passage (`placeClaims`). A quote found in a
   different passage than the model said is moved there; one found nowhere is
   dropped.
4. `checkClaims` in `core/factCheck.ts` searches Wikipedia to turn names into
   candidate Wikidata items.
5. One SPARQL query reads every candidate's values.
6. It picks the item, converts units and compares.
7. It asks the Smithsonian, for volcanoes.
8. It reads Wikipedia's article, for what is left.
9. The Worker answers with `facts`, each
   `{ blockId, quote, status, entity, source, sourceUrl, found }` (or `reason`
   in place of `source` and `found` for an unknown).

The split is the important part. **Finding claims in prose** is a language problem, so the
Worker asks its [AI provider](./ai-suggestions.md#which-model-answers) to list them, with a schema that
only allows the properties and units the checker understands. **Judging a claim** is
deterministic and done in code. The model never says whether a fact is right, and a claim
whose quote isn't actually in a passage is dropped (step 3), so an invented fact can't
reach the author as a finding.

Over MCP, step 2 is the assistant itself: it passes claims to `check_facts`, and the tool
runs steps 4 to 8 with no AI provider involved.

A claim looks like this:

```json
{
  "subject": "Mount Everest",
  "kind": "mountain",
  "property": "height",
  "value": 8849,
  "unit": "m",
  "qualifier": "exact",
  "quote": "8,849 METERS"
}
```

`subject` is the thing's English name, `kind` a word or two for what it is (used to tell
Georgia the country from Georgia the state), and `property` one of the keys below. Dates
put the year in `value` (negative for BC) and may add `month` and `day`. A fact about a
kind of animal has the animal's singular name as its subject: "cats weigh about 4 kg" is
`{ subject: "Cat", kind: "animal", property: "mass", value: 4, unit: "kg" }`.

Each fact comes back with `status`, and either `reason` (for unknown) or `source`
(`wikidata`, `smithsonian` or `wikipedia`), `sourceUrl` and `found`, what that source says:
a value in the claim's unit, a date, the items a named fact can be, or an article's
sentence (`found.text`).

### What can be checked

Numbers, dates and named facts about one specific, named thing, and a few numbers about a
kind of animal. Each property maps to one or more Wikidata properties, tried in order; the
first the item has is used, and they are not pooled unless the table says so, so a tower's
elevation above sea level can't agree with a sentence about its height. The pooled ones
are words that honestly mean either ("leader" is a prime minister or a president).

A named fact ("CANBERRA is the capital of Australia") puts the name in `stated` instead
of a number in `value`: `{ subject: "Australia", property: "capital", stated: "Canberra" }`.

| Property              | Wikidata                                               | Also                        | For                                    |
| --------------------- | ------------------------------------------------------ | --------------------------- | -------------------------------------- |
| `height`              | height (P2048), else elevation (P2044)                 | the Smithsonian's summit    | buildings, statues, animals, mountains |
| `elevation`           | elevation above sea level (P2044)                      | the Smithsonian's summit    | places, summits                        |
| `length`, `width`     | P2043, P2049                                           |                             | rivers, bridges, walls, animals        |
| `depth`               | vertical depth (P4511)                                 |                             | lakes, seas, caves                     |
| `diameter`, `radius`  | P2386, P2120                                           |                             | planets, craters                       |
| `area`, `volume`      | P2046, P2234                                           |                             | countries, lakes                       |
| `population`          | P1082                                                  |                             | places                                 |
| `mass`, `speed`       | P2067, P2052                                           |                             | including kinds of animal              |
| `temperature`         | P2076                                                  |                             | stars, places                          |
| `distance_from_earth` | P2583                                                  |                             | things in space                        |
| `orbit_distance`      | semi-major axis (P2233)                                |                             | a planet's distance from the Sun       |
| `orbital_period`      | P2146                                                  |                             | a planet's year                        |
| `duration`            | P2047                                                  |                             | events, journeys                       |
| `lifespan`            | pooled: life expectancy (P2250), longest (P4214)       |                             | kinds of animal                        |
| `gestation`           | gestation period (P3063)                               |                             | kinds of animal                        |
| `litter_size`         | litter size (P7725)                                    |                             | kinds of animal                        |
| `born`, `died`        | P569, P570                                             |                             | people, animals                        |
| `began`               | inception (P571), start (P580), opening (P1619), P585  |                             | built, founded, formed                 |
| `ended`               | end time (P582), dissolved or demolished (P576)        |                             |                                        |
| `happened`            | point in time (P585), start (P580), launch date (P619) |                             | events, launches                       |
| `discovered`          | P575                                                   |                             |                                        |
| `published`           | P577                                                   |                             | books, films, songs                    |
| `last_eruption`       | none                                                   | the Smithsonian's eruptions | volcanoes                              |
| `erupted`             | none                                                   | the Smithsonian's eruptions | volcanoes                              |
| `capital`             | capital (P36)                                          |                             | countries, states, provinces           |
| `country`             | P17                                                    |                             | anything in a country                  |
| `continent`           | P30                                                    |                             |                                        |
| `region`              | pooled: located in (P131), location (P276)             |                             | the state, county or city it is in     |
| `language`            | official language (P37)                                |                             | countries, regions                     |
| `currency`            | P38                                                    |                             | countries                              |
| `leader`              | pooled: head of government (P6), head of state (P35)   |                             | the current prime minister, president  |
| `discoverer`          | discoverer or inventor (P61)                           |                             |                                        |
| `creator`             | pooled: author, creator, architect, composer, director |                             | books, works, buildings, films         |
| `named_after`         | P138                                                   |                             |                                        |
| `flows_into`          | mouth of the watercourse (P403)                        |                             | rivers                                 |

Every property can also be confirmed from Wikipedia (see
[Wikipedia's words](#wikipedias-words)).

Units cover metric and imperial length, area, volume, mass and speed, temperature in all
three scales, durations from seconds to thousands of years, astronomical units,
light-years and Earth masses. The table is `FACT_UNITS` in `core/factCheck.ts`, each entry
keyed to its Wikidata item so a value can be read in whatever unit Wikidata stores it in.

### What counts as agreeing

A passage rounds, and a source often holds several honest answers at once, so "agrees" is
deliberately generous and "disagrees" means something.

- **Any source agreeing is enough.** Wikidata is asked first, then the Smithsonian for a
  volcano, and a claim agrees if either has a value close enough. It disagrees only when a
  source has the property, none agrees, and every source asked answered: if the
  Smithsonian can't be reached, a volcano's height that Wikidata disagrees with is unknown
  (`lookup-failed`), since the Smithsonian might have agreed. Wikipedia is read when
  neither had a value, or when the one they had could only confirm the claim (below).
- **Every current value counts.** Deprecated statements never do. Everest has 8,848,
  8,848.86 and 8,850; the Eiffel Tower started in 1887 and opened in 1889. A passage using
  any of them is not wrong.
- **Except values with an end date, which never count.** Melbourne was Australia's
  capital until 1927, and Wikidata records it with that end date, so a passage saying it
  still is disagrees. The same rule retires former prime ministers and the height of a
  demolished building.
- **A named fact agrees when the stated thing is one of the current values.** The stated
  name is looked up the way a topic is (an exact label or alias, so "USA" finds the United
  States), and the claim agrees if any of the items it could mean is among them; a name
  the search doesn't know is compared as words against the value's label instead. The
  Nile's `country` is seven countries, and a passage naming any one of them is right.
- **A place can be named at any level.** When a `region` or `country` claim doesn't match
  the item's own values, it is checked against every place above the item as well,
  following "located in" (P131) upward. Wikidata puts Disneyland in Anaheim, which is in
  Orange County, which is in California, so "Disneyland is in California" agrees, and so
  does "Alton Towers is in England". Only current links are followed, by the same rule as
  an item's own values, so a county a town was moved out of doesn't count. A place above
  has to be the stated one by item or by its exact name, or its formal name ("Canton of
  Geneva" for Geneva): the "ends with" rule named facts use for people would let "Mexico"
  match New Mexico. That second lookup only runs for claims that would otherwise
  disagree, and alongside the Smithsonian's.
- **A population of 0 is no figure.** Wikidata gives a ruined or abandoned town (Pompeii)
  a population of 0, which says nothing about how many people lived there, so it is
  treated as missing and Wikipedia is read instead.
- **Except dated figures, where only the latest counts.** A population with several
  "point in time" qualifiers is compared with the most recent, and the finding says which
  year it is from ("2,103,778 as of 2023"). A passage agreeing with the 1910 census is out of
  date, not right.
- **A figure gets the rounding it was written with**: half a unit in its last place. "9,000
  meters" allows 500 either way; "8,849" allows 0.5. On top of that, 2% of the source's
  value, or 10% when the passage hedges ("about", "nearly").
- **"More than" and "less than" are bounds**, not rounded figures, so "more than 10,000
  meters" disagrees with Everest even though 10,000 is a round number. "Up to" is a
  "less than": "grows up to 2 meters long" is true of anything 2 meters or under, so it is
  checked as a ceiling rather than as a hedged figure near 2.
- **Wikidata's own error bounds** (a population "between 7 and 8 million") are honored.
- **Dates are compared as precisely as the source knows them.** A date known to the day is
  checked to the day, if the passage gives one; to the century, anywhere in it. Month and
  day are skipped for dates Wikidata records in the Julian calendar, which are days away
  from the same date in the Gregorian one. Very large years ("4.5 billion years ago") round
  like any big number; a year like 1960 does not, and means 1960.

The comparison is always done in the passage's unit, and that's the unit the finding
quotes the source in: a passage in feet is told "29,031.69 feet", not "8,848.86 meters".

### Kinds of animals

"Cats weigh about 4 kg" is true of a typical cat and false of plenty of real ones, and
Wikidata's figures for species are patchy: the jaguar's only mass is 800 grams, its birth
weight, so "jaguars weigh up to 100 kg" would read as wrong. So a fact about how a kind of
living thing is built or lives can be confirmed but is never called wrong. When a source
has a value and it doesn't match, the fact is unknown with reason `varies`, and the
finding still says what the source gives:
_"20 YEARS": Wikidata gives the lifespan of cat as 15 years. Animals vary, so this isn't
counted as wrong._

That applies to `lifespan`, `gestation` and `litter_size` always, and to `height`,
`length`, `width`, `mass` and `speed` when the item is a kind of living thing: it has a
scientific name (P225), or is a taxon, a breed, or one of Wikidata's "organisms known by
a particular common name" (P31). The house cat is the last kind: it has no scientific
name of its own on Wikidata. Facts that don't change from one animal to the next, like
when a species was discovered or who it is named after, are checked as for anything
else, and can be wrong.

`lifespan` pools life expectancy and the longest recorded life, so "cats live about 15
years" and "jaguars can live up to 28 years" both have something to match.

### The Smithsonian

The [Global Volcanism Program](https://volcano.si.edu) keeps the standard record of the
world's volcanoes active in roughly the last 12,000 years, with every dated eruption:
Vesuvius from 24 October 79, Mount St. Helens from 1 October 2004 to 27 January 2008. It
is current: eruptions still going on are updated as they go.

Wikidata names each volcano's GVP number (P1886), and the query in step 5 reads it along
with everything else, so the volcano is found the usual way and GVP is asked by number,
with nothing left to match by name. GVP answers through a public web feature service (no
key), and a check asks it twice in all, once for the volcanoes and once for their
eruptions, however many volcanoes the lesson mentions (`packages/core/src/smithsonian.ts`).

- **`height` and `elevation`** compare with the summit's height, alongside Wikidata's.
- **`last_eruption`** compares with the latest confirmed eruption, anywhere from its start
  to its end: "Mount St. Helens last erupted in 2004" and "in 2008" are both right. The
  latest is the one that went on latest, not the one that started latest: a long eruption
  can outlast a short one that began inside it. A date before it is out of date, and
  disagrees.
- **`erupted`** agrees with any eruption, confirmed or possible, the date falls in,
  allowing the eruption's own uncertainty (a radiocarbon date can be out by 150 years
  either way).
- **But a missing eruption is only wrong once the record is complete.** Before a volcano's
  first eruption dated to the month (which means someone saw it), GVP's eruptions are
  dated from the rocks and the list has gaps. A date there that matches nothing is unknown
  with reason `before-record`, not wrong.
- **Before 1583, a date is held to its year only.** A month and day that old may be
  Julian, and famous ones are argued over: GVP now dates the eruption that buried Pompeii
  to October 79, where the traditional date is 24 August. A passage saying August isn't
  flagged.

A finding about an eruption shows its span ("1 October 2004 to 27 January 2008"), and for
a date that matches none, the nearest eruption. Only volcanoes of the last 12,000 years are
read; an older one has no record, and is left to Wikidata and Wikipedia.

### Wikipedia's words

When the structured sources can't settle a fact, the checker reads the subject's English
Wikipedia article as plain text (`articleText` in `packages/core/src/wikipedia.ts`) and
looks for a sentence that says the same thing (`packages/core/src/factText.ts`). That is
when no source has a value (`no-value`), and also when the value a source had could only
ever confirm the fact: one that `varies`, or an eruption from `before-record`. A match
there turns the fact into agrees; no match leaves it as it was.

- **The sentence must be about the property.** Each property has a few words a sentence
  about it uses (`weigh` and `mass` for mass, `erupt` for an eruption), matched as the
  start of a word, and the sentence or the one before it must have one. Wikipedia often
  says "The average lifespan of pet cats has risen" and gives the figure in the next
  sentence.
- **So must the figure's clause.** A sentence is split into clauses at semicolons and at
  "and", "but", "while" and "whereas" (not the "and" of "between 64 and 67 days"). A
  figure whose clause has another property's words and none of the claim's is about that
  other property: in "it is 100 meters high and its crater is 200 meters wide", 200 meters
  can't confirm a height. A clause with no such words ("and males 76 to 158 kg") goes with
  its sentence.
- **Then its numbers, dates or names are compared with the same rules as a Wikidata
  value.** "Adult domestic cats typically weigh 4 to 5 kg (8.8 to 11.0 lb)", as the cat
  article says it with dashes, is read as a range in kilograms and one in pounds, so
  "about 10 pounds" matches. A claim's month or day has to be in the sentence too, not
  assumed from its year.
- **A year is not a count, and a measurement is not a year.** A plain four-digit number is
  read as a year only after a word that introduces one ("in 1887", "the 1980 eruption",
  "from 1887 to 1889") and with no unit after it, so "1500 m" and "1200 workers" can't
  confirm a date. A number read as a year (or as part of any date) isn't a count, so "In
  the 2011 census the village had 812 people" can't confirm a population of 2,000.
- **Where something is** (`country`, `continent`, `region`) has no such words, since an
  article can say it a dozen ways. It is read from the article's opening paragraphs only,
  which are about the subject; a country named further down could be a neighbor.
- **It only ever confirms.** Not finding a claim proves nothing, and nor does finding a
  sentence that seems to say otherwise: an article mentions many figures about many things.
  A fact Wikipedia doesn't confirm keeps whatever verdict it had (unknown).
- **English only**, since the words and month names are English. `checkClaims` takes a
  `language` option, and any language but `en` skips this step, but neither the Worker
  nor the MCP server passes one, so in practice every check is in English.
- **Each article is read once**, however many claims need it, and split into sentences
  once. Articles for claims that don't involve a volcano are read while the Smithsonian is
  being asked.
- **An article that can't be read** leaves a `no-value` fact as `lookup-failed`. A
  `varies` or `before-record` fact keeps its reason and what its source said, and is
  marked `incomplete`; either way the check isn't cached.

This is looser than a structured value, so it never overrides one that settles the fact
(an agree or a disagree), and the finding quotes the sentence (_"4 KG" matches Wikipedia, which
says: Adult domestic cats typically weigh 4-5 kg (8.8-11.0 lb)._) so the author can judge
it. It can still be fooled by a sentence about something else that happens to have the
property's word and the same figure.

### Picking the item

Names are turned into items through **Wikipedia's article search**
(`packages/core/src/wikipedia.ts`), not Wikidata's own. Wikidata's `wbsearchentities`
matches labels by prefix and ranks them in an order that has little to do with which thing
a lesson means: for "Hamlet" it puts a kind of village, a 1948 film and two given names
ahead of the play, and for "Amazon" the river is nowhere in the first eight. Wikipedia's
search ranks by how much an article matters and reads a phrase, so the subject is searched
together with its `kind` ("Hamlet play", "Georgia country", "Mercury planet") and the right
article comes first in every case tried. Each article names its Wikidata item, and the
data is read from there as before.

Two searches are made together, for the name alone and for the name with its `kind`, and
their top three articles are the candidates, the bare name's first. The name alone finds
what most people mean by it ("Hamlet" the play, "Titanic" the ship, "penicillin" itself);
the kind finds another sense where that is the one meant ("Amazon river", "Mercury
planet", "Georgia state"). Asking only with the kind was tried and ranks worse when the
top article doesn't say the kind: "penicillin medicine" puts the discovery of penicillin
above penicillin.

The one used is the first candidate whose article _title_ is the name with the kind added
and nothing else ("Mercury (planet)", "Amazon River", "Georgia (U.S. state)"); failing
that, the first. The name part of the title is compared with every word kept, however
short: "F (programming language)" is the kind with a name added, but the name isn't
Fortran, or C. A title that merely has the kind in it is something else: "Australian
country music" is not Australia. The title and not Wikidata's description, because a
description is prose that says "tragedy" for a play and "liner" for a ship, and matching a
word of it picked Ur-Hamlet over Hamlet. Having the property never
moves a candidate up past the first when a kind was given: "Titanic" the ship has no
creator on Wikidata, and the right answer is "no value", not the 1997 film's director.
Without a kind, a first that has nothing to check gives way to one that has: "Mercury" and
an orbital period is the planet. For a volcano's properties, having a GVP number counts as
having the property.

If Wikipedia finds no article, or doesn't answer, the name falls back to
`wbsearchentities`, whose order means little, so there the candidate that has the property
and whose description says it is the kind wins, then one that is the kind, then one that
has the property. A name found this way has no article, so step 8 has nothing to read.

The stated name of a named fact is resolved to its top Wikipedia article (so "USA" is the
United States, and "Fleming" is Alexander Fleming), with Wikidata's exact label matches as
the fallback, and then compared as words against the value's label if neither finds it:
the whole label, or its end, so "Fleming" is Alexander Fleming. One article, not three:
the second and third hits for a short name are other things, and a claim must not agree
because one of them happened to be a value.

When this picks wrong, the finding says so plainly ("Checked against Georgia (state of the
United States)"), which is why the item is always shown. The label and description come
from Wikidata when the item had anything to check, and from the article's title ("Georgia",
"country") otherwise.

### Why one SPARQL query

Values come from a single query to the [query service](https://query.wikidata.org) for every
candidate item and every property the claims need, rather than from each item's JSON.
Reading items would be simpler, but a popular item's JSON is large (the United States is
about 1.6 MB), and a check looks at several candidates for each name. The by-id query takes
well under a second. It also reads what decides the other sources: each item's scientific
name and what it is an instance of (for [kinds of animals](#kinds-of-animals)), and its GVP
number when a claim is about a volcano.

One quirk of the query service is handled in `parseSparqlTime`: it writes dates known to the
year or better in XSD 1.1, where year 0 is 1 BC, so 2560 BC comes back as -2559. Coarser
dates come back unshifted.

## Cost, limits and caching

A check is one model call and, typically, two Wikipedia searches per distinct subject
(the name, and the name with its kind), one per distinct stated name, and one SPARQL
query. Then two Smithsonian requests if any claim is about a volcano, and one Wikipedia
article read per subject that still needs one. It goes through the same AI check
and per-IP rate limiter as the other [AI helpers](./ai-suggestions.md) and costs one
token.

- **Limits.** At most 60 passages, 4,000 characters each and 40,000 in all
  (`cleanPassages` in `apps/api/src/lib/factCheck.js`), and 40 claims.
- **Results** are cached in KV for 7 days (`FACT_CHECK_TTL` in `routes/ai.js`), keyed on the lesson title and the passages' text
  in order (plus `FACT_CHECK_VERSION`, currently `v6`, to bump when the prompt or the rules change). A cache hit is served
  before the rate limiter and costs nothing. Block ids are not part of the key: they are
  attached to the cached facts per request, so two lessons with the same text both get
  their own ids back.
- A check where any source couldn't be reached (a fact with `lookup-failed`, or one marked
  `incomplete`) is **not cached**, so a blip isn't remembered for a week.
- **Wikimedia's responses** are held at the Cloudflare edge for a day. The Smithsonian's
  aren't: its GeoServer can report an error as an HTTP 200 with an XML body, and caching
  that would leave every volcano unchecked for a day after it recovered.
- **Wikimedia's rate limit.** Wikimedia allows a client with a descriptive User-Agent 200
  requests a minute across its APIs, and one without 10. The Worker's limit is shared by
  every author using it, which is the main reason for the edge cache. A request turned
  away (HTTP 429) leaves its facts unknown with `lookup-failed`, and the check uncached.
- **User-Agent.** The Worker sends
  `SpellingCreator/1.0 (https://spellingcreator.org; lesson fact checking)` to every
  source, and the MCP server sends the one it already uses for Commons.

A self-hosted instance needs outbound HTTPS to `en.wikipedia.org`,
`www.wikidata.org`, `query.wikidata.org` and
`webservices.volcano.si.edu`, as well as an AI provider and, if its AI check
is Turnstile, a Turnstile key.

## Where the code is

| File                                                  | Does                                                                                                                             |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/factCheck.ts`                      | The checker: properties, units, item matching, the SPARQL query, comparing, and asking each source. `checkClaims(claims, opts)`. |
| `packages/core/src/wikidata.ts`                       | The Wikidata requests: name search and SPARQL, shared with the [image search](./images.md).                                      |
| `packages/core/src/wikipedia.ts`                      | `articleItems`: which Wikidata item a name means, by its Wikipedia article. `articleText`: an article as plain text.             |
| `packages/core/src/smithsonian.ts`                    | The Global Volcanism Program: a volcano's record, and comparing eruption dates.                                                  |
| `packages/core/src/factText.ts`                       | Reading an article's sentences: the quantities, dates and names in each.                                                         |
| `apps/api/src/lib/factCheck.js`                       | The extraction prompt and schema, placing quotes, and calling the checker.                                                       |
| `apps/api/src/routes/ai.js`                           | The `factCheck` mode: the AI check, rate limit, cache.                                                                           |
| `packages/core/src/aiSuggest.ts`                      | `checkFacts()`, the browser's call to the Worker.                                                                                |
| `apps/web/src/lib/factCheck.js`                       | `useFactCheck()`, and the wording of findings (`describeFact`).                                                                  |
| `apps/web/src/components/editor/FactCheckSection.jsx` | The Facts section of the Check panel.                                                                                            |
| `apps/web/src/locales/en/checks.json`                 | Its wording, under `facts`.                                                                                                      |
| `apps/mcp/src/tools.js`                               | `check_facts`.                                                                                                                   |

`apps/web/src/lib/factCheck.test.js` fails when core gains a property or unit that
`checks.json` can't word, the same way the lesson checks' test guards their codes, and
`packages/core/src/factCheck.test.ts` fails when a property has no words for reading
Wikipedia.

## What it doesn't do

- **Facts that aren't a number, a date or a name** ("the Nile flows north") aren't
  checked. Comparing those means matching meaning, not values, and is where a model would
  start judging rather than extracting. Named facts are limited to the properties in the
  table for the same reason: each is one relation with a clear answer.
- **Facts about a whole kind of thing** are limited to the animal properties above.
  "Octopuses have three hearts" and "cats sleep 16 hours a day" aren't values any source
  holds, and are left out by the prompt.
- **It doesn't flag how big, heavy or fast a kind of animal is, how long it lives, or
  its young**, or a fact only Wikipedia could speak to. Those can only be confirmed.
- **Other sources were considered and left out.** REST Countries now needs an account
  and key, and its populations don't say what year they are from, so under "any source
  agreeing is enough" an out-of-date figure could match it. NASA's JPL API has no endpoint
  for planets' physical data, only text to parse, and Wikidata covers planets well.
  OpenStreetMap mostly repeats Wikidata for the well-known places lessons are about.
- **It doesn't change the lesson.** Every finding is for the author to look at.
