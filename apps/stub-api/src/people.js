// The made-up people the stub's hub is populated with. Practitioners write the
// lessons; Jordan is a parent and communication partner to a speller. None of
// them is a real account, and nothing they "say" is attributed to anyone real.

const uuid = (digit) => {
  const d = (n) => digit.repeat(n);
  return `${d(8)}-${d(4)}-4${d(3)}-8${d(3)}-${d(12)}`;
};

/** Everyone, by the key used to sign in as them (`maya`, or `maya@example.com`). */
export const PEOPLE = {
  maya: {
    id: uuid("1"),
    displayName: "Maya Rivera",
    bio: "<p>S2C practitioner. I write lessons for teen and adult spellers who like history and big questions.</p>",
  },
  daniel: {
    id: uuid("2"),
    displayName: "Daniel Okafor",
    bio: "<p>Practitioner and former museum educator. Most of my lessons start from an object or an animal.</p>",
  },
  priya: {
    id: uuid("3"),
    displayName: "Priya Shah",
    bio: "<p>S2C practitioner working with teens and adults. Long, curious lessons about science, places and people.</p>",
  },
  lars: {
    id: uuid("4"),
    displayName: "Lars Nielsen",
    bio: "<p>Practitioner in Copenhagen. Lessons in Danish and English.</p>",
  },
  jordan: {
    id: uuid("5"),
    displayName: "Jordan Ellis",
    bio: "<p>Parent and communication partner to Theo, 16.</p>",
  },
  sam: {
    id: uuid("6"),
    displayName: "Sam Carter",
    bio: "<p>Practitioner. Regulation first, then the good stuff.</p>",
  },
};

for (const [key, p] of Object.entries(PEOPLE)) {
  p.key = key;
  p.email = `${key}@example.com`;
}

export const byId = Object.fromEntries(
  Object.values(PEOPLE).map((p) => [p.id, p]),
);

/**
 * The person an email address (or a username's synthetic address) names. Only
 * the part before the `@` matters, so `maya`, `maya@example.com` and the
 * `maya@users.noreply.invalid` a username sign-in produces are all Maya.
 */
export function personFromEmail(email) {
  const local = String(email || "")
    .trim()
    .toLowerCase()
    .split("@")[0];
  return PEOPLE[local] ?? null;
}

/**
 * The person a session token names, from its `sub` claim, or null for anything
 * else (such as the anon key supabase-js sends before anyone has signed in).
 */
export function personFromToken(token) {
  try {
    const payload = JSON.parse(
      Buffer.from(String(token).split(".")[1], "base64url").toString(),
    );
    return byId[payload.sub] ?? null;
  } catch {
    return null;
  }
}

// Who follows whom, as [follower, followed].
export const FOLLOWS = [
  ["maya", "daniel"],
  ["jordan", "maya"],
  ["sam", "maya"],
  ["priya", "maya"],
  ["sam", "priya"],
  ["jordan", "priya"],
  ["daniel", "priya"],
  ["lars", "priya"],
  ["maya", "sam"],
  ["jordan", "daniel"],
  ["sam", "daniel"],
];

// Followers who aren't in the list above, so counts look like a community
// rather than six people.
export const EXTRA_FOLLOWERS = {
  [PEOPLE.priya.id]: 37,
  [PEOPLE.daniel.id]: 18,
  [PEOPLE.maya.id]: 9,
};
