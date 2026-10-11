---
title: AI writing help
---

# AI writing help

The editor has three AI helpers for when you'd like a starting point: ideas for
a lesson topic, a block of text for a section, and a question for a section.
Everything they write lands in your lesson as ordinary, editable content, so
change anything you like.

They only work when the Spelling Creator site you're using has AI set up;
otherwise the window shows an error instead. Each one shows a short verification check before it runs (the box that
confirms a person is asking), and what you ask for is sent to the site's server
and on to an AI service. To check a lesson you've written, see
[Lesson checks](./lesson-checks.md) and [AI lesson fixes](./ai-lesson-fixes.md)
instead.

## Lesson ideas

Under the lesson's title there's an age range menu (**Any age** until you pick
one) and a **Suggest ideas** button beside it.

1. Press **Suggest ideas**. The **Suggest lesson ideas with AI** window opens
   and says which age range the ideas are for. If none is set, you can set one
   first or go ahead with general ideas.
2. Press **Generate**. A handful of topics comes back, each a short title and
   a one-line description.
3. Choose one to use its title as your lesson's title. **Generate more** asks
   for a fresh batch instead.

The age range picks topics that people of that age tend to find interesting.
It isn't a reading level: the AI is told that spellers understand far more
than they can say, and never to simplify a topic or pitch it below their age.

The ideas don't write the lesson for you. They give you a title to start from,
and the rest is up to you and the other helpers.

## Text for a section

Each section's toolbar has a **Generate with AI** menu. Choose **Text** to open
**Suggest text with AI**.

1. The section's name is what the text will be about, so give the section a
   name first. There's nothing else to fill in. The lesson's title is used too,
   so the text fits the rest of the lesson.
2. Press **Generate**. The text appears in the window for you to read.
3. Press **Insert** to add it to the section as a new text block.

The AI is asked to write unusual or important words in ALL CAPS, so they stand
out as possible spelling words, and it may include numbers you can use for
number questions.

Asking again about the same section name in the same lesson gives you the same
text straight away, because the answer is remembered on the server. If you
don't like it and you're signed in, press the thumbs down under the text. That
removes it from the server's memory, and **Generate fresh** then writes a new
one. You can still **Insert anyway** if you change your mind.

## A question for a section

Choose **Question** from the same **Generate with AI** menu to open **Suggest a
question with AI**.

1. Give the section a name first: that's what the question will be about.
2. Pick a **Question type**. The list is the same as the **Add question**
   menu: Single answer, Number answer, Multiple answers, Suggested answers,
   Paraphrase, Open ended, Would you rather and Background knowledge.
3. Press **Generate**.

The question goes straight into the section as a new question block, with its
answer (or suggested answers, or worked steps for a number question) filled in
where the type has one. There's no preview first, so read it over and edit it
like any other question.

The section's text is sent along, so the question can be answered from your
passage. For **Background knowledge** it works the other way round: the
question asks about something the passage doesn't explain. The questions
already in the section are sent too, so you don't get a repeat. Questions are
never remembered on the server, so asking again gives you a different one.

Once you've added it, the [lesson checks](./lesson-checks.md) look over the new
question like any other.

## When something goes wrong

- "Give this section a name first, then try again." means the section has no
  name yet.
- "Verification failed. Please try again." means the verification check didn't
  pass. Close the window and open it again.
- "Too Many Requests" means a lot of AI requests came from your connection in
  the last minute. Wait a moment and try again.
- "Upstream AI error" means the AI service didn't answer. Try again later.

For how these work in the code, see the
[developer notes](../developers/web-app/ai-suggestions.md).
