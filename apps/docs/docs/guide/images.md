---
title: Pictures
---

# Pictures

You can add pictures to any section, either your own or free pictures found
from inside the editor. Every picture has a caption you write and, when it
needs one, a credit for whoever made it.

## Adding a picture

In a section's toolbar:

- **Add image** uploads a picture from your device. You can pick several at
  once.
- **Search images** opens a search for free pictures.

Under a picture, buttons set its **alignment** (left, center or right) and its
**size** (Small, Medium, Large or Full). **Replace** swaps the picture for
another one, either with **Upload file** or **Search online**.

## Searching for free pictures

**Search images** searches two free picture libraries. Switch between them
with the toggle at the top of the dialog:

- **Pixabay**, a library of free photos and illustrations.
- **Wikimedia Commons**, the picture library behind Wikipedia, which has
  pictures of almost any real place, animal, object or person.

Type what you're looking for, press **Search**, and click a picture to add it.
It's added with its credit already filled in and the caption left empty for
you to write.

When your search names one particular thing (such as "lion", "Paris" or "Great
Pyramid of Giza") and you're searching Wikimedia Commons, the first results are
the pictures Wikidata (Wikipedia's database of facts) lists for that thing.
Each has a label saying what it shows, such as **Main picture**, **From
above**, **At night**, **Map**, **Where it lives** or **Flag**. A line above
the pictures says which thing they're for, so if a search for "Mercury" found
the car brand instead of the planet, you can tell before picking one.

Pixabay search may ask you to complete a quick check that you're a person
before it searches.

## Captions and credits

Each picture has two lines of text under it:

- the **caption**, which you write, saying what the picture shows, and
- the **credit**, the line the picture's license asks for, such as
  `Image (by Jane Doe, CC BY-SA 4.0) via Wikimedia Commons` or
  `Image by jsmith from Pixabay`.

Pictures from a search come with their credit filled in. A picture you upload
starts with no credit, and you can type one in if it needs it.

The credit is kept separate from the caption so that each part is only used
where it belongs:

| Where                          | Caption         | Credit                       |
| ------------------------------ | --------------- | ---------------------------- |
| Lesson page and Preview        | Shown, italic   | Shown, in smaller type below |
| Interactive mode               | Shown           | Shown, in smaller type below |
| Word and PDF                   | Printed, italic | Printed, small and gray      |
| Description for screen readers | Used            | Never                        |
| Read aloud                     | Read            | Never                        |
| Translation                    | Translated      | Never                        |
| Lesson summaries               | Used            | Never                        |

So a license is never read aloud to a speller in the middle of a lesson, and
rewriting a caption never deletes the credit.

## Removing a credit

The **Credit** field is under the caption field, a little smaller. You can
correct it like any other field. If you empty it, the app asks first ("Remove
the image credit?"), because most free pictures, including everything on
Wikimedia Commons that isn't public domain, may only be used with a credit.
The question only appears once you leave the field, so clearing it to type a
correction doesn't set it off. **Keep the credit** puts it back as it was, and
**Remove it** removes it.

Replacing a picture with one from your device removes the old credit, since it
named whoever made the old picture. Replacing it from a search puts in the new
picture's credit. Either way the caption stays.

## Older lessons

In lessons made before credits had their own field, the credit was written at
the end of the caption. The app recognizes the credit lines it wrote itself and
shows them as credits, without changing the lesson. The first time you edit
that picture's caption or credit, the two are saved separately.

A picture's caption and credit are both kept when you export to Word and import
the document again.

For how this works, see the [developer notes](../developers/web-app/images.md).
