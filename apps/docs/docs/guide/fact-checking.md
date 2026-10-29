---
title: Fact checking
description: How the editor compares a lesson's numbers, dates and names with Wikidata, the Smithsonian and Wikipedia, and what counts as agreeing or disagreeing.
---

# Fact checking

A lesson states facts the speller is then asked about: how tall Everest is,
when the Eiffel Tower went up, how many people live in Paris, how much a cat
weighs. Fact checking compares the numbers, dates and names in your passages
with three sources:

- **[Wikidata](https://www.wikidata.org)**, for every fact.
- **The Smithsonian's [Global Volcanism Program](https://volcano.si.edu)**, for
  a volcano's height and eruptions.
- **[Wikipedia](https://en.wikipedia.org)**, read when neither of those can
  settle a fact, and only ever to confirm one.

Sources can be out of date or wrong too, so treat what it finds as things to
look into, not verdicts.

## See it in action

<DemoVideo name="editor-fact-check" title="Checking a lesson's facts">
A copy of a lesson from the hub, its facts checked from the Check panel. One
date is worth a look (Wikidata gives a different start date for ENIAC), and
eight others match Wikidata and Wikipedia. The lesson is a real one from the
hub.
</DemoVideo>

## Running a check

Open **Check lesson** (the **Check** button in the editor's top bar) and scroll
to the **Facts** section at the bottom. Press **Check facts**. After the usual
verification check, gray placeholder lines show while the check runs, then you
see:

- **Facts a source disagrees with**, grouped by section. Each reads like
  _"8,000 METERS": Wikidata gives the height of Mount Everest as 8,848.86
  meters._ and, like any finding in the panel, takes you to its passage when
  you choose it. Under it is "Checked against" the Wikidata item it was
  compared with, its description and an **Open on Wikidata** link, because a
  name can match the wrong thing and you are the one who can tell. When the
  answer came from the Smithsonian or Wikipedia, a second link (**Open the
  volcano's record** or **Open the article**) opens that page too.
- **A count of the rest**, behind **Show N more**: facts that matched, and
  facts that couldn't be checked. A fact that couldn't be checked isn't a
  problem, only a gap in the sources: no item by that name, no source with a
  value, a unit the check can't convert, a fact about a kind of animal that
  didn't match, or a source that didn't answer. A match from Wikipedia quotes
  the article's sentence, so you can see it says what your passage says.

The result is a snapshot. When you change the words a fact was found in, that
fact drops off the list and is counted under "N facts have changed in the
lesson since this check", so fixing a number clears its finding without
checking again. Closing the panel to go to a finding keeps the result. **Check
again** runs a fresh check.

Nothing it finds blocks anything, and none of it is counted in the **Check**
button's number or the outline: those are always current, and this is a
snapshot you asked for.

The **Facts** section only appears when the Spelling Creator site you're using
has AI set up. Your passages are sent to that site's server, and an AI service
lists the facts in them. The AI never decides whether a fact is right: that is
done by comparing with the sources, and a fact whose words aren't actually in
your passage is thrown away.

## What can be checked

Numbers, dates and names stated about one specific, named thing:

- **Sizes and amounts**: height, height above sea level, length, width, depth,
  diameter, radius, area, volume, population, mass, speed and temperature.
- **Space**: distance from Earth, average distance from what something orbits,
  and the time to go once around its orbit.
- **Dates**: when someone was born or died; when something was built,
  founded, started, ended, happened, discovered or released; a volcano's last
  eruption, or any one eruption.
- **Names**: a capital, the country, continent or region something is in, an
  official language, a currency, a country's current leader, who discovered or
  invented something, who made it, what it is named after, and where a river
  flows into.
- **Kinds of animal**: how big, heavy, long, tall or fast they are, how long
  they live, how long they are pregnant, and how many young they have.

Metric and imperial units all work, as do temperatures in Celsius, Fahrenheit
and kelvin, durations from seconds to thousands of years, astronomical units,
light-years and Earth masses. Findings quote the source in the unit your
passage uses: a passage in feet is told "29,031.69 feet", not "8,848.86 meters".

## What counts as agreeing

A passage rounds, and a source often holds several honest answers at once, so
"agrees" is deliberately generous and "disagrees" means something.

- **Any source agreeing is enough.** A fact only disagrees when a source has a
  value, none agrees, and every source asked actually answered.
- **Every current value counts.** Everest is listed as 8,848, 8,848.86 and
  8,850 meters; the Eiffel Tower was started in 1887 and opened in 1889. A
  passage using any of them is not wrong.
- **Values that have ended don't count.** Melbourne was Australia's capital
  until 1927, so a passage saying it still is disagrees. The same goes for
  former prime ministers and the height of a building that has been knocked
  down.
- **A name agrees when it's one of the current answers.** The Nile flows
  through several countries, and a passage naming any one of them is right.
  Short names work too: "USA" finds the United States.
- **A place can be named at any level.** Wikidata puts Disneyland in Anaheim,
  and a passage that says it's in California, or in the United States, is
  right too.
- **For dated figures, only the latest counts.** A population is compared with
  the most recent count, and the finding says which year it is from
  ("2,103,778 as of 2023"). A passage that agrees with a 1910 census is out of
  date, not right. A population of 0, which Wikidata gives ruined towns like
  Pompeii, isn't compared at all, since it says nothing about how many people
  lived there.
- **A figure gets the rounding it was written with**, plus a little more. "9,000
  meters" allows 500 either way; "8,849" allows half a meter. On top of that, 2%
  of the source's value, or 10% when the passage hedges ("about", "nearly").
- **"More than", "less than" and "up to" are limits**, not rounded figures, so
  "more than 10,000 meters" disagrees with Everest. "Grows up to 2 meters long"
  is true of anything 2 meters or under.
- **Dates are compared as precisely as the source knows them.** A date known to
  the day is checked to the day, if your passage gives one.

### Kinds of animals

"Cats weigh about 4 kg" is true of a typical cat and false of plenty of real
ones, and the sources' figures for animals are patchy. So a fact about how big,
heavy or fast a kind of animal is, how long it lives, or its young can be
confirmed but is never called wrong. When a source's figure doesn't match, the
finding still tells you what it says:
_"20 YEARS": Wikidata gives the lifespan of cat as 15 years. Animals vary, so
this isn't counted as wrong._

Facts that don't change from one animal to the next, like when a species was
discovered or who it is named after, are checked as for anything else, and can
be wrong.

### Volcanoes

The Global Volcanism Program keeps the standard record of the world's
volcanoes active in roughly the last 12,000 years, with every dated eruption,
and keeps it current.

- **Height** is compared with the summit's height, alongside Wikidata's.
- **"Last erupted"** is compared with the latest eruption, anywhere from its
  start to its end: "Mount St. Helens last erupted in 2004" and "in 2008" are
  both right.
- **"Erupted in"** agrees with any eruption the date falls in, allowing for
  how uncertain the eruption's own date is.
- **Older eruptions are treated carefully.** Before a volcano's eruptions were
  written down as they happened, the record has gaps, so a date there that
  matches nothing is left as "couldn't be checked", not called wrong. Before
  the year 1583 only the year is compared: the traditional date of the eruption
  that buried Pompeii is 24 August 79, while the record now says October, and a
  passage saying August isn't flagged.

### Wikipedia

When the other sources can't settle a fact, the check reads the subject's
English Wikipedia article and looks for a sentence that says the same thing,
about the same property. A match turns the fact into a match and quotes the
sentence (_"4 KG" matches Wikipedia, which says: Adult domestic cats typically
weigh 4-5 kg (8.8-11.0 lb)._) so you can judge it yourself. Wikipedia can only
ever confirm a fact: not finding something in an article proves nothing.

## When it picks the wrong thing

A name can mean several things: Georgia the country or the state, Mercury the
planet or the element. The check uses a word or two about what the thing is to
pick, and usually gets it right, but when it doesn't, the finding says so
plainly ("Checked against Georgia (state of the United States)"). That's why
the item it used is always shown.

## What it doesn't do

- **Facts that aren't a number, a date or a name** ("the Nile flows north")
  aren't checked.
- **Facts about a whole kind of thing**, other than the animal facts above,
  are left out: "octopuses have three hearts" and "cats sleep 16 hours a day"
  aren't values any of these sources hold.
- **Numbers in a made-up story or a word problem** are left out.
- **It doesn't change your lesson.** Every finding is for you to look at.

## Limits

A check reads up to 60 passages and up to 40 facts. Checking the same text
again within a week gives the same answer straight away without counting
toward the per-minute limit on AI requests. A check where a source couldn't be
reached isn't remembered, so you can try again later.

For how fact checking works in the code, see the
[developer notes](../developers/web-app/fact-checking.md).
