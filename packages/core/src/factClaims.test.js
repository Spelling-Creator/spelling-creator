import { describe, expect, it } from "vitest";

import { prepareClaims } from "./factCheck.js";
import {
  FACT_CLAIMS_SCHEMA,
  PASSAGE_CLAIMS_SCHEMA,
  factCheckPrompt,
  parseClaimsReply,
  passageClaimsMessages,
  placeClaims,
} from "./factClaims.js";

const PASSAGE =
  "Mount Everest rises 8,849 METRES above sea level, on the border of NEPAL and China.";

describe("the two prompts", () => {
  it("share the rules, and only the Worker's numbers passages", () => {
    const worker = factCheckPrompt([{ text: PASSAGE }], "Big Things");
    const [system, user] = passageClaimsMessages(PASSAGE, "Big Things");
    expect(worker).toContain('"passage": the number of the passage');
    expect(system.content).not.toContain('"passage"');
    for (const line of [
      "- height: how tall something is",
      '- "qualifier": "about" when the passage hedges',
    ]) {
      expect(worker).toContain(line);
      expect(system.content).toContain(line);
    }
    expect(system.content).toContain(JSON.stringify(PASSAGE_CLAIMS_SCHEMA));
    expect(user.content).toBe(`Lesson: Big Things\n\n${PASSAGE}`);
  });

  it("asks the on-device model for every field but the passage", () => {
    expect(PASSAGE_CLAIMS_SCHEMA.properties.claims.items.required).toEqual(
      FACT_CLAIMS_SCHEMA.properties.claims.items.required.filter(
        (k) => k !== "passage",
      ),
    );
  });
});

describe("parseClaimsReply", () => {
  it("reads a reply into the schema's fields, in order", () => {
    const reply = `\`\`\`json
{"claims":[{"value":8849,"quote":"8,849 METRES","subject":"Mount Everest","extra":1,"property":"height","unit":"m"}]}
\`\`\``;
    const [claim] = parseClaimsReply(reply);
    expect(Object.keys(claim)).toEqual(
      PASSAGE_CLAIMS_SCHEMA.properties.claims.items.required,
    );
    expect(claim).toMatchObject({
      quote: "8,849 METRES",
      value: 8849,
      unit: "m",
    });
  });

  it("keeps what a reply cut off mid-list finished, and refuses prose", () => {
    const cut =
      '{"claims":[{"quote":"NEPAL","subject":"Mount Everest","property":"country","stated":"Nepal"},{"quote":"Chi';
    const [done, partial] = parseClaimsReply(cut);
    expect(done).toMatchObject({ quote: "NEPAL", stated: "Nepal" });
    // The half-written one comes back as a stub with no property, which
    // prepareClaims then refuses.
    expect(prepareClaims([partial]).claims).toEqual([]);
    expect(parseClaimsReply("There are no facts here.")).toBeNull();
    expect(parseClaimsReply('{"lesson_passage":[{"quote":"x"}]}')).toBeNull();
    expect(parseClaimsReply('{"claims":[]}')).toEqual([]);
  });
});

describe("placeClaims", () => {
  it("drops a quote that is in no passage", () => {
    const placed = placeClaims(
      [
        { passage: 1, quote: "8,849 metres", unit: "m" },
        { passage: 1, quote: "8,850 METRES", unit: "m" },
      ],
      [{ text: PASSAGE }],
    );
    expect(placed).toHaveLength(1);
    expect(placed[0].passage).toBe(0);
  });
});
