---
title: What an assistant can do
---

# What an assistant can do

Once an AI assistant is [connected to Spelling Creator](./connect.md), you can ask it for
things in plain words, the way you would ask a colleague. It works in Spelling Creator as
you, using your account, so anything it saves is yours and shows your name. This page
covers what you can ask for, what it checks with you first, and how it keeps lessons in
shape.

## Write a lesson

Tell it the topic and anything else that matters: who the lesson is for, how long it
should be, words or facts you want included, sources you'd like it to use. It writes the
passages and questions, saves the lesson as a **private draft**, and gives you a link to
open it.

A full lesson is a lot to get right in one go, so the assistant may build it a section or
two at a time. Each pass is saved as its own version with a short name ("Add section 3:
the cat's senses"), so you can see how the lesson came together.

If you don't want to use an account at all, ask it for a **lesson file** instead. It hands
you a file to save, which you open in the editor with **Import JSON or OSLF** (in the menu,
next to **Import Word document**). Nothing is stored online. Ask for an **OSLF file** and
it hands you the same lesson in the
[Open Spelling Lesson Format](https://github.com/playforge-coding/open-spelling-lesson-format),
which tools other than Spelling Creator can read too; it can also give you a lesson that's
already on the hub that way.

### The lesson it writes by default

Unless you ask for something else, the assistant follows the app's default lesson
standards:

- **6 sections**, each with an optional picture at the top, then **two short paragraphs**.
  Harder vocabulary in the passage is written in CAPITALS.
- **4 spelling words** per section, each 6 to 9 letters long, related to the topic but
  different from the capitalized vocabulary.
- **15 questions** per section, in a set order: 3 green (one fact from the passage), 1
  blue (prior knowledge the passage doesn't give), 2 purple (a number from the passage,
  then a word problem with worked steps), 2 orange (semi-open questions), 4 pink tight
  opens (quick one-word answers from everyday life), 1 brown paraphrase (the passage
  retold in the speller's own words), then 2 pink broad opens that invite a full sentence
  of the speller's own thinking. See [Question blocks](../question-blocks.md) for what
  each color means.
- No [VAKT activities](../vakt-activities.md), "Would you rather" questions, sources or
  footnotes unless you ask for them.

These are defaults, not rules. Spelling is practiced in many different ways (see
[What is Spelling Creator](../../intro.md)), and no single approach is the standard one. The
question types follow the
[Open Spelling Lesson Format](https://github.com/playforge-coding/open-spelling-lesson-format);
the counts and order are the app's own. If you work differently, just say so. Ask for four sections, a
different mix of questions, longer passages or a different order, and the assistant will
write it that way.

## It checks lessons before saving

Every lesson the assistant saves is checked against those default standards first. These
are the same checks behind the **Check** button in the editor (see
[Lesson checks](../lesson-checks.md)): things like every green answer appearing word for
word in its passage, no spelling word hiding inside an answer, and no question giving away
another question's answer.

- **Problems** (things that would confuse a speller or mark a right answer wrong) stop the
  save. The assistant is told exactly what's wrong and fixes it, usually without you
  noticing.
- **Suggestions** (the usual shape of a lesson, like having 6 sections) don't stop
  anything. The assistant may mention them.

If you've asked for something the checks don't allow, such as a three-section lesson, the
assistant can save it anyway. In some apps you'll get a box asking you to confirm,
listing what would be skipped; say no and nothing is saved.

When it edits a lesson that already has problems (one written in the editor, say), it's
only held to problems its own edit adds. It should still tell you the lesson isn't clean,
and you'll see the rest in the editor's Check panel.

## Edit a lesson

Ask it to fix a typo, reword a question, swap a spelling word or add a section. By default
it doesn't change your lesson straight away: it **proposes** the change. It makes a private
copy of the lesson, edits the copy, and opens a proposal on the original, so you see what it
did before anything changes. The lesson itself doesn't change until its author merges the
proposal. See [Proposals](../pull-requests.md) for how reviewing works.

If you'd rather skip that step, tell it to edit the lesson directly (for example "just save
it straight to the lesson"). It then changes your lesson straight away for the rest of the
conversation. It also edits directly while it's still building a lesson it created for you
in the same conversation. Every direct change shows up in the lesson's version history (the
**History** tab on its hub page, or **Version history** in the editor) with a note saying an
AI assistant made it, so you can see exactly what changed and undo it if you don't like it.

A lesson that belongs to someone else can only be changed by a proposal, since nobody can
save over another person's lesson.

If you are editing the lesson live in the editor at the same time, bring the assistant
into the session instead. See [Live sessions](./live-sessions.md).

## How proposals work

A few things to know:

- The assistant gives you a link to the proposal and stops there. It never merges a
  proposal itself, even one on your own lesson.
- If you ask for more changes, it updates the same proposal rather than opening a second
  one.
- The private copy counts toward your limit of 8 private drafts. Ask the assistant to
  delete it once the proposal has been merged or declined.
- The proposal says an AI assistant wrote it. That matters most on your own lesson, where
  the proposal is opened under your name.

### Deciding a proposal in the chat

In apps that can show interactive cards in the conversation (such as Claude), asking the
assistant to show you a proposal brings up a card right in the chat. It shows the
proposal's title, who made it, counts of blocks added, changed, removed and moved, and a
short list of the changes. If you're the lesson's author or a trusted collaborator, it has
**Merge** and **Decline** buttons; everyone gets **Open in the web app**.

The decision is yours. The assistant is told to wait while the card is showing, not to
choose for you. A few cases still have to go to the web app:

- If the same block was changed both in the lesson and in the proposal, **Merge** is
  grayed out, because choosing between the two versions needs them side by side. Use
  **Open in the web app**.
- If the app can't carry your click back to Spelling Creator, the card shows only **Open
  in the web app**.

In apps without cards, the assistant describes the proposal and gives you its link.

## Check facts

Ask the assistant to check the facts in a lesson, or it may do so on its own while
writing. It compares numbers, dates and named facts (a country's capital, who discovered
something) with Wikidata, the Smithsonian's records of volcanoes, and Wikipedia.

When a source disagrees, the assistant should tell you what the source says and let you
decide, unless it's confident the lesson is wrong. Sources can be out of date or mistaken
too. A fact about a kind of animal ("cats weigh about 4 kg") is never called wrong, only
"couldn't confirm", since animals vary. See [Fact checking](../fact-checking.md) for the
same check in the editor.

## Pick pictures

The assistant finds freely licensed pictures on Wikimedia Commons. (Pixabay, which the
editor also searches, isn't available to assistants.) The required credit line is added
under each picture automatically.

In apps that can show interactive cards, the pictures appear as a row you can scroll
through, each with its license and author. You choose:

- **Add to lesson** puts the picture straight into the lesson (at the top of its section,
  when the assistant has said which section it's for).
- **Use this one** appears instead when the picture can't be placed directly; clicking it
  tells the assistant which picture you picked, and it adds it.
- **Commons** opens the picture's page on Wikimedia Commons.

The assistant is told to stop and wait while the pictures are on screen, so the choice is
yours. In apps without cards, the assistant reads the descriptions and picks one itself.
Either way, you can ask for a different picture, or replace it in the editor, which keeps
it in the same place. See [Images](../images.md).

## Publish, unpublish and tidy up

Lessons the assistant creates are private drafts until you decide otherwise. Ask it to
**publish** a lesson and it goes on the public hub under your name, where anyone can read,
copy and build on it. You need a display name set before you can publish (see
[Profiles](../profiles.md)). Ask it to **unpublish** and the lesson goes back to being a
private draft.

It can also list your lessons, browse what's already on the hub (to find ideas or avoid
writing a lesson that exists), and delete lessons you no longer want.

## What it asks you first

Three things are your decision, not the assistant's:

- **Deleting a lesson.** This can't be undone, and the lesson's whole version history goes
  with it. If you only want it off the hub, unpublish it instead.
- **Publishing a lesson.** Putting a lesson in front of the public under your name is your
  call. Unpublishing is never asked about, since it only makes a lesson less visible.
- **Overriding the lesson standards.** Saving a lesson the checks would stop.

In apps that support it, Spelling Creator itself asks you with a confirmation box, and your
answer decides. If you say no to publishing, the lesson is still saved, just as a private
draft. Many apps can't show these boxes yet. There, the assistant is told to ask you in
the conversation first, but Spelling Creator can't make it, so be clear about what you
want.

For how the tools behind all this work, see the
[developer reference](../../developers/mcp-server/tools.md).
