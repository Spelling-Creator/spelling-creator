// More passages to train on than the hub has. The hub's lessons hold about
// one checkable fact a passage and leave whole properties out (no capitals,
// no planets, one length), so this has Claude write the passage half of a
// lesson section on topics chosen to cover every property the checker knows,
// in the hub lessons' style, through the Claude Code CLI like label.mjs.
// label.mjs then labels them exactly as it labels the hub.
//
//   node scripts/fact-eval/write-passages.mjs [--model opus] [--jobs 3]
//
// Some topics are there to have no checkable fact at all (a made-up story, a
// word problem, facts about a whole kind of animal), because a model that
// lists nothing for those is half the job. Whether a written fact is true does
// not matter here: the model learns to list what a passage says, and the
// checker judges it.
//
// Written to data/synthetic/<slug>.json, which is committed (and published
// with the dataset, CC BY 4.0); a topic already there is skipped.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { askClaude } from "./claude.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const { values: args } = parseArgs({
  options: {
    model: { type: "string", default: "opus" },
    jobs: { type: "string", default: "3" },
    data: { type: "string", default: path.join(here, "data") },
  },
});

const FACTS =
  "Include several specific numbers, dates or names where the topic has them, some exact and some rounded or hedged (about, nearly, more than, up to).";

// [title, what the passage should cover]
const TOPICS = [
  [
    "Mount Kilimanjaro",
    `its height, where it is and when it was first climbed. ${FACTS}`,
  ],
  ["K2", `its height in feet as well as metres and the first ascent. ${FACTS}`],
  [
    "The Danube",
    `its length, the countries it flows through and the sea it flows into. ${FACTS}`,
  ],
  [
    "The Mississippi River",
    `its length in miles, the states along it and where it ends. ${FACTS}`,
  ],
  ["Lake Baikal", `its depth, its area and its age. ${FACTS}`],
  ["The Dead Sea", `its elevation below sea level and its saltiness. ${FACTS}`],
  [
    "The Burj Khalifa",
    `its height, when it opened, the city it stands in and its architect. ${FACTS}`,
  ],
  [
    "The Golden Gate Bridge",
    `its length, when building began and when it opened. ${FACTS}`,
  ],
  [
    "The Statue of Liberty",
    `its height, who designed it and when it was dedicated. ${FACTS}`,
  ],
  [
    "The Sydney Opera House",
    `its architect, when it opened and the city it is in. ${FACTS}`,
  ],
  ["The Taj Mahal", `who had it built, when and where. ${FACTS}`],
  [
    "Mars",
    `its diameter, its distance from the Sun and the length of its year. ${FACTS}`,
  ],
  [
    "Jupiter",
    `its size, its distance from the Sun, its year and its moons. ${FACTS}`,
  ],
  [
    "The Moon",
    `its distance from Earth, its diameter and the first landing. ${FACTS}`,
  ],
  [
    "Proxima Centauri",
    `its distance in light-years and when it was discovered. ${FACTS}`,
  ],
  [
    "The Sun",
    `its temperature, its mass compared with Earth and its age. ${FACTS}`,
  ],
  ["Japan", `its capital, its population, its currency and its area. ${FACTS}`],
  [
    "Kenya",
    `its capital, its language, the continent and its population. ${FACTS}`,
  ],
  ["Canada", `its capital, its area, its languages and its currency. ${FACTS}`],
  [
    "Iceland",
    `its capital, its population and its glaciers and volcanoes. ${FACTS}`,
  ],
  [
    "Peru",
    `its capital, its language and Machu Picchu's age and height above sea level. ${FACTS}`,
  ],
  [
    "New Zealand",
    `its capital, its two main islands and its population. ${FACTS}`,
  ],
  [
    "Tokyo",
    `its population, the country it is in and when it became the capital. ${FACTS}`,
  ],
  [
    "Istanbul",
    `its population, the two continents it sits on and its old names. ${FACTS}`,
  ],
  [
    "Marie Curie",
    `when and where she was born, what she discovered and when she died. ${FACTS}`,
  ],
  ["Isaac Newton", `when he was born and died and what he published. ${FACTS}`],
  [
    "Ada Lovelace",
    `when she was born, her famous notes and when she died. ${FACTS}`,
  ],
  [
    "Nikola Tesla",
    `where and when he was born, his inventions and when he died. ${FACTS}`,
  ],
  [
    "Frida Kahlo",
    `when and where she was born, her paintings and her home city. ${FACTS}`,
  ],
  [
    "Wolfgang Amadeus Mozart",
    `when he was born and died, his city and his operas. ${FACTS}`,
  ],
  [
    "Galileo Galilei",
    `when he was born, what he discovered with his telescope and when. ${FACTS}`,
  ],
  [
    "The Discovery of Penicillin",
    `who discovered it, when and where. ${FACTS}`,
  ],
  [
    "The Discovery of Pluto",
    `who discovered it, when, and how far away it is. ${FACTS}`,
  ],
  ["X-rays", `who discovered them and when. ${FACTS}`],
  [
    "The Hobbit",
    `who wrote it, when it was published and what came after it. ${FACTS}`,
  ],
  [
    "Charlotte's Web",
    `who wrote it, when it was published and the farm it is set on. ${FACTS}`,
  ],
  [
    "Star Wars",
    `who created it, when the first film came out and how long it ran. ${FACTS}`,
  ],
  [
    "Apollo 11",
    `when it launched, how long the mission lasted and who flew it. ${FACTS}`,
  ],
  [
    "The Sinking of the Titanic",
    `when it sank, its length and where it was built. ${FACTS}`,
  ],
  [
    "The Fall of the Berlin Wall",
    `when it was built, how long it stood and when it fell. ${FACTS}`,
  ],
  [
    "The First Modern Olympic Games",
    `when and where they were held and who started them. ${FACTS}`,
  ],
  [
    "America's Name",
    `who the Americas were named after and when the name was first used. ${FACTS}`,
  ],
  [
    "Mount Everest's Name",
    `who it was named after, its height and its first ascent. ${FACTS}`,
  ],
  [
    "The Great Barrier Reef",
    `its length, its area and the country it is off. ${FACTS}`,
  ],
  [
    "The Sahara",
    `its area, the countries it covers and its hottest temperatures. ${FACTS}`,
  ],
  [
    "The Eiffel Tower",
    `its height in feet, when it was built and who built it. ${FACTS}`,
  ],
  [
    "The International Space Station",
    `its speed, its height above Earth and when it was launched. ${FACTS}`,
  ],
  [
    "The Channel Tunnel",
    `its length, how deep it goes and when it opened. ${FACTS}`,
  ],
  // No checkable facts: these teach the model to list nothing.
  [
    "Cheetahs",
    "how cheetahs run, hunt and raise cubs, as facts about cheetahs in general. No named individual animal, place, person or date.",
  ],
  [
    "Octopuses",
    "how octopuses change colour, solve problems and hide, as facts about octopuses in general. No named individual, place, person or date.",
  ],
  [
    "Honeybees",
    "how a hive works and how bees make honey, as facts about bees in general. No named place, person or date.",
  ],
  [
    "How Rainbows Form",
    "how sunlight and raindrops make a rainbow. General science only: no named place, person, date or measurement of one specific thing.",
  ],
  [
    "A Garden Grows",
    "a made-up story about a girl called Maya planting a vegetable garden, with the numbers of seeds and days in the story. Nothing real or checkable.",
  ],
  [
    "The Bake Sale",
    "a made-up story about a neighbourhood bake sale, with prices and numbers of cakes as a word problem would have them. Nothing real or checkable.",
  ],
  [
    "Why Music Matters",
    "why people everywhere make music and how it makes us feel. Opinions and general ideas only, no specific facts.",
  ],
  [
    "Making Friends",
    "what it takes to make and keep a friend. Ideas and feelings only, no facts.",
  ],
  // People and history, the hub's own main subjects, where the first
  // fine-tune got subjects and properties wrong. A life also has moments that
  // are not checkable (moving, studying, marrying), which the model must leave
  // out. Nothing about the held-out lessons (Einstein, relativity, Pompeii,
  // Vesuvius).
  ...[
    "Leonardo da Vinci",
    "Charles Darwin",
    "Jane Goodall",
    "Katherine Johnson",
    "Alan Turing",
    "Grace Hopper",
    "Louis Braille",
    "Helen Keller",
    "Stephen Hawking",
    "Temple Grandin",
    "Ludwig van Beethoven",
    "William Shakespeare",
    "Cleopatra",
    "Nelson Mandela",
    "Amelia Earhart",
    "Thomas Edison",
    "Alexander Graham Bell",
    "The Wright Brothers",
    "Rosalind Franklin",
    "Srinivasa Ramanujan",
    "Hedy Lamarr",
    "Johannes Gutenberg",
    "Ibn Battuta",
    "Harriet Tubman",
    "Mary Anning",
    "Dmitri Mendeleev",
    "Gregor Mendel",
    "Florence Nightingale",
    "Hokusai",
    "Wangari Maathai",
  ].map((who) => [
    who,
    `the life of ${who}: when and where they were born, their best-known work, discovery or invention and when, a few moments from their life such as moving, studying or a turning point, and when they died if they have. ${FACTS}`,
  ]),
  ...[
    [
      "The Great Fire of London",
      "when it started, how long it burned and what was rebuilt after",
    ],
    [
      "The Panama Canal",
      "when building began, when it opened, its length and who built it",
    ],
    [
      "The Rosetta Stone",
      "when and where it was found, how old it is and who deciphered it",
    ],
    [
      "Tutankhamun's Tomb",
      "when it was found, by whom, and when the young king lived",
    ],
    [
      "The Terracotta Army",
      "when it was made, for which emperor, when it was found and how many figures",
    ],
    ["Angkor Wat", "when it was built, where, and its size"],
    ["Stonehenge", "how old it is, where it is and the size of its stones"],
    ["Voyager 1", "when it launched, how far away it is now and what it found"],
    [
      "The Hubble Space Telescope",
      "when it launched, its size, its height above Earth and what it showed",
    ],
    [
      "The Printing Press",
      "who invented it, when and where, and the first famous book it printed",
    ],
    [
      "The Telephone",
      "who invented it, when, and the first words spoken on it",
    ],
    [
      "The Periodic Table",
      "who published it, when, and how many elements it holds now",
    ],
    ["The Structure of DNA", "who found it, when, and where the work was done"],
    ["Vaccines", "who made the first vaccine, when, and against which disease"],
    ["The Silk Road", "when it began, how long it was and the cities along it"],
    ["The Library of Alexandria", "when it was founded, where, and by whom"],
    ["The First Bicycle", "who built it, when and where, and how it changed"],
    [
      "The Story of Tea",
      "where tea comes from, when it reached Europe and the countries that grow the most",
    ],
    [
      "Video Games",
      "the first famous games, who made them and when they came out",
    ],
    ["The Mona Lisa", "who painted it, when, where it hangs and its size"],
    [
      "The Great Pyramid of Giza",
      "when it was built, for which pharaoh, its height and its age",
    ],
    ["The Magna Carta", "when it was sealed, where, and by which king"],
    ["The Battle of Hastings", "when it happened, who fought and where"],
    [
      "The First Transatlantic Flight",
      "who flew it, when, from where to where and how long it took",
    ],
  ].map(([title, what]) => [title, `${what}. ${FACTS}`]),
  // More with no checkable facts.
  [
    "A Day at the Beach",
    "a made-up story about a family's day at the beach, with the number of shells they found and the hours they stayed. Nothing real or checkable.",
  ],
  [
    "Counting Marbles",
    "a made-up story that works like a word problem: two friends share and swap marbles, with numbers. Nothing real or checkable.",
  ],
  [
    "Why We Dream",
    "what dreams might be for and how they feel. General ideas only: no named scientist, study, place or date.",
  ],
  [
    "How Plants Grow",
    "how seeds sprout and plants use sunlight and water. General science only: no named place, person, date or measurement of one specific thing.",
  ],
  [
    "Being Brave",
    "what courage means and small brave things people do every day. Ideas and feelings only, no facts.",
  ],
  [
    "Owls",
    "how owls hunt at night, turn their heads and fly silently, as facts about owls in general. No named individual animal, place, person or date.",
  ],
];

const SYSTEM =
  "You write passages for Spelling to Communicate (S2C) lessons, read aloud to nonspeaking spellers. Answer only with the structured output.";

const SCHEMA = {
  type: "object",
  properties: {
    paragraphs: { type: "array", items: { type: "string" } },
  },
  required: ["paragraphs"],
  additionalProperties: false,
};

const prompt = (title, about) =>
  `Write the passage for one section of a lesson titled "${title}": two short paragraphs, 60 to 110 words each, plain prose for a curious reader of any age. Put 3 to 5 of the harder, less common words in ALL CAPS, as these lessons do. Cover ${about} Describe other places and cultures with curiosity. Return the two paragraphs.`;

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const dir = path.join(args.data, "synthetic");
await mkdir(dir, { recursive: true });
const queue = [...TOPICS];
let written = 0;
await Promise.all(
  Array.from({ length: Number(args.jobs) }, async () => {
    while (queue.length) {
      const [title, about] = queue.shift();
      const file = path.join(dir, `${slug(title)}.json`);
      try {
        await readFile(file);
        continue;
      } catch {
        // not written yet
      }
      try {
        const reply = await askClaude(prompt(title, about), {
          model: args.model,
          system: SYSTEM,
          schema: SCHEMA,
        });
        await writeFile(
          file,
          JSON.stringify(
            {
              id: `synthetic-${slug(title)}`,
              title,
              about,
              model: args.model,
              passages: reply.paragraphs,
            },
            null,
            2,
          ),
        );
        written += 1;
        console.log(`  ${title}: ${reply.paragraphs.length} paragraphs`);
      } catch (e) {
        console.log(`  ${title}: ${e.message}`);
      }
    }
  }),
);
console.log(`${written} written, ${TOPICS.length} topics in ${dir}`);
