---
title: Translation
---

# Translation

Comments and published lessons can be translated into your language right in
the page. The translation happens on your own computer: nothing is sent to a
server, and nothing is saved. A translation lasts until you leave the page, and
the original is always one click away.

Translations go into the language the app is set to (see **Language** in
**Settings**).

## Translating a comment

On a lesson's **Discussion** tab, every comment with text has a **Translate**
action next to **Reply** and **Edit**. You don't need to be signed in, since
anyone can read comments.

Press **Translate** and the comment is swapped for its translation, with a line
saying "Translated from (language) on your device." Under it, **Show original**
brings the real comment back, and **Show translation** switches again. The
translation is plain text: bold, lists and other formatting come back when you
show the original.

If the comment is already in your language, a message says so and nothing is
translated.

## Translating a lesson

On a published lesson's **Lesson** tab, press **Translate** above the lesson.

A long lesson is translated a part at a time, in reading order: the title
first, then one section after another. Each part shows as soon as it's done, so
you can start reading from the top while the rest is still arriving. A line
above the lesson counts the parts ("3 of 12 parts done"), and **Cancel** stops
and puts the lesson back the way it was before you pressed **Translate**.

### What is translated, and what isn't

| Translated                                      | Left as written                                  |
| ----------------------------------------------- | ------------------------------------------------ |
| The lesson's title                              | Spelling words                                   |
| The text, paragraph by paragraph                | Names of the sites a VAKT activity links to      |
| Footnote notes                                  | Source citations and the Sources list            |
| Questions, their answers and their worked steps | Picture credits (photographers' names, licenses) |
| Picture captions                                |                                                  |
| VAKT activity text                              |                                                  |

Spelling words stay as they are because they are the material being spelled: a
translated word list would be a different lesson. A note under a translated
lesson says so. Like comments, translated paragraphs show without their bold
or italics; **Show original** brings them back.

Translation only changes what you're reading. The **Practice** tab, printing,
exports and forking always use the lesson as it was written.

## When it guesses the language wrong

The original language is worked out automatically, and short or mixed-language
text can fool it. You can always choose it yourself:

- If it can't tell, a language menu opens straight away: "Couldn't tell what
  language this is in. Which is it?"
- If the translation came from the wrong language, press **Wrong language?**
  next to **Show original**.
- If it says the text is already in your language and it isn't, or that it
  can't translate from the language it found, the message has a **Pick
  language** button.

Picking a language translates from that language instead. Cancelling puts back
whatever was there before.

## The first time

Chrome and Edge can translate with the browser's own built-in translator,
which downloads a small language pack the first time you use each pair of
languages.

Every other browser (and Chrome or Edge, for a pair their translator doesn't
offer) downloads a translation model to run in the page instead. It works in
any browser, but the first time takes a while:

- Translating into English from one of about twenty common languages uses a
  small model for that language, roughly 110 to 140 MB.
- Everything else uses one larger model of about 600 MB that covers every
  language Spelling Creator can translate.
- Browsers without a built-in way to tell languages apart also download a
  language detector of about 280 MB.

A progress bar shows the download, once per computer. To free the space, go to
**Settings**, find **Downloaded AI models** and press **Delete models**. Your
lessons aren't affected; the models download again next time you translate.

Spelling Creator can translate between around forty widely used languages.

For how translation works in the code, see the developer notes for
[comment translation](../developers/web-app/comment-translation.md) and
[lesson translation](../developers/web-app/lesson-translation.md).
