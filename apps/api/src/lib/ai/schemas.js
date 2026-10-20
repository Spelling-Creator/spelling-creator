// Structured-output schemas for the question suggester, one per question type.
// They mirror the block shapes the editor builds in src/lib/questions.js:
// buildQuestionBlock maps this JSON onto the editable block (e.g. wrapping each
// "multiple" answer string in an { id, text } row). Plain JSON Schema — each
// provider adapter converts it to whatever shape its own API expects.
export const QUESTION_SCHEMAS = {
  number: {
    type: "object",
    properties: {
      prompt: { type: "string" },
      answer: { type: "number" },
      steps: { type: "array", items: { type: "string" } },
    },
    required: ["prompt", "answer"],
    additionalProperties: false,
  },
  single: {
    type: "object",
    properties: { prompt: { type: "string" }, answer: { type: "string" } },
    required: ["prompt", "answer"],
    additionalProperties: false,
  },
  multiple: {
    type: "object",
    properties: {
      prompt: { type: "string" },
      answers: { type: "array", items: { type: "string" } },
    },
    required: ["prompt", "answers"],
    additionalProperties: false,
  },
  multiple_open: {
    type: "object",
    properties: {
      prompt: { type: "string" },
      answers: { type: "array", items: { type: "string" } },
    },
    required: ["prompt", "answers"],
    additionalProperties: false,
  },
  // The free-response types with the same empty shape. They are listed
  // separately rather than folded together because the request names the type
  // and an unlisted one is refused outright — a type in the editor's menu with
  // no entry here is a button that returns an error. `open` stays for lessons
  // that still hold the legacy type.
  paraphrase: {
    type: "object",
    properties: { prompt: { type: "string" } },
    required: ["prompt"],
    additionalProperties: false,
  },
  // A tight open may offer a few examples of what would count; they are not
  // an answer key, so the list may be empty.
  tight_open: {
    type: "object",
    properties: {
      prompt: { type: "string" },
      answers: { type: "array", items: { type: "string" } },
    },
    required: ["prompt", "answers"],
    additionalProperties: false,
  },
  broad_open: {
    type: "object",
    properties: { prompt: { type: "string" } },
    required: ["prompt"],
    additionalProperties: false,
  },
  open: {
    type: "object",
    properties: { prompt: { type: "string" } },
    required: ["prompt"],
    additionalProperties: false,
  },
  wyr: {
    type: "object",
    properties: { prompt: { type: "string" } },
    required: ["prompt"],
    additionalProperties: false,
  },
  background: {
    type: "object",
    properties: { prompt: { type: "string" }, answer: { type: "string" } },
    required: ["prompt", "answer"],
    additionalProperties: false,
  },
};

// How to describe each question type in the prompt, and the type-specific rules
// the model must follow so its JSON matches the schema above.
// The names the Open Spelling Lesson Format gives the types, which is what a
// lesson designer would call them.
export const QUESTION_LABELS = {
  number: "math (number-answer)",
  single: "known-answer",
  multiple: "semi-open (multiple accepted answers)",
  multiple_open: "semi-open (suggested answers)",
  paraphrase: "paraphrase",
  tight_open: "tight open",
  broad_open: "broad open",
  open: "open-ended",
  wyr: "would-you-rather",
  background: "prior-knowledge",
};

export const QUESTION_INSTRUCTIONS = {
  number:
    'The question must have a single numeric answer. Put that number in the "answer" field. Break the working-out into short steps a speller could follow and put them, in order, in the "steps" array (use an empty array if the problem is too simple to need steps).',
  single:
    'The question must have a single short typed answer (a word or brief phrase). Do not make the answer a number under any circumstances. Do not provide answer options. Put the correct answer in "answer".',
  multiple:
    'The question must have several distinct correct answers, any one of which a speller could spell to be marked correct (the speller only needs to give one). If you generate a single answer, consider that a failure. Do not provide answer options. Put each accepted answer as a separate string in "answers".',
  multiple_open:
    'The question must be bounded by the lesson\'s topic or theme but leave room for the speller to improvise: a synonym, a definition in their own words, or an example from the subject. Unlike a multiple-answer question, the answers you give are SUGGESTIONS for whoever is marking, not the only correct responses: a speller who answers something else that fits the topic is also right. Do not require the answer to appear in the lesson text. Put two or three short suggested answers, each ideally a single word, as separate strings in "answers".',
  paraphrase:
    'Write a question that asks the speller to restate part of the lesson text in their own words ("In your own words, explain..." or "In your own words, describe..."). It tests whether they understood the passage, not what they think of it. Do not provide answer options or a model answer. Put the question in "prompt".',
  tight_open:
    'Write a tight open question: there is no single right answer, and the speller answers quickly, in one word, from their own everyday world ("Name something that gives off light", "Name a color of a crayon"). Name an everyday category almost anyone can answer at once. Link it lightly to the lesson\'s theme, but the answer must come from the speller\'s own life, never from the lesson text, and must need no reasoning, nothing abstract and no vocabulary puzzle. Vary the stem ("Name a...", "Name something that...", "Name a place where..."); never write "a word that comes to mind". Put the question in "prompt", and two or three one-word EXAMPLES of what would count in "answers" (they are examples, not the only right answers; an empty list is fine).',
  broad_open:
    'Write a broad open question: there is no single right answer, and the speller gives their own opinion, reasoning, prediction or idea, often in a sentence or more ("Why do you think...?", "If you could..., what would you...?", "...Defend your answer."). Ask what the speller thinks, not what the passage said: "In your own words, explain..." is a paraphrase question, not this. Do not provide answer options or a model answer. Put the question in "prompt".',
  open: 'Write a question that invites a free response in the speller\'s own words. Do not provide answer options or a model answer. Put the question in "prompt".',
  wyr: 'Write a "Would you rather" question: a choice between exactly two options, each drawn from or inspired by the lesson\'s topic ("Would you rather watch an opera or a movie?"). Start the prompt with "Would you rather" and join the two options with "or". It asks for an opinion, so there is no right answer. Do not provide answer options or a model answer. Make both options concrete and comparably attractive, so the choice is a real one. Put the question in "prompt".',
  background:
    'The question must test prior knowledge that is NOT explained anywhere in the lesson text, because the speller is expected to already know it. Do not ask about anything the lesson text covers. Put the question in "prompt" and the correct answer (a word or brief phrase) in "answer".',
};

// Structured-output schema for the lesson-idea suggester: a short list of lesson
// topic ideas pitched at an age range, each with a title the user can adopt as
// their lesson title and a one-line description of what it would cover.
export const LESSON_IDEA_SCHEMA = {
  type: "object",
  properties: {
    ideas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
        },
        required: ["title", "description"],
        additionalProperties: false,
      },
    },
  },
  required: ["ideas"],
  additionalProperties: false,
};
