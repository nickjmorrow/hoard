---
name: hoard
description: "How to add, rate, tag, finish, note and suggest movies, shows and games in the Hoard media app, through the hoard_* tools. Use when the user says 'add X to my watchlist', 'I finished X', 'I've seen X', 'rate X', 'tag X', or asks 'what should I watch/play', or names a title to track. Books are not covered here."
trigger: "adding, rating, tagging, finishing or suggesting movies, shows or games"
---

# Media titles

Hoard is the user's movies, shows and games app, and everything about a title lives there: status, rating, tags, who recommended it, notes and reviews, and the details it looks up (year, runtime, genre, Rotten Tomatoes, summary, cast). The `hoard_*` tools are the way in.

Never create or edit a Grimoire page for a title: Grimoire is the user's notebook, not Hoard's database. If they write about a film in their journal, that's ordinary journaling; Hoard doesn't read it. Books are not part of this: a page whose `type` is `book` belongs to the books app; never change one.

## Rules

- Check `hoard_library` before adding or suggesting anything; it shows what the user has, wants, dropped or passed on.
- One title per work. `hoard_add` returns `existed: true` when it's already there; say so instead of adding again.
- A same-name title with a different year is a different work (Starfall 1984, Starfall 2021): pass the year.
- Never name the tracker's internals to the user; just say what happened ("Added Far Field to your want list").

## Adding a title

`hoard_add` with `name` (no year in it), `type` (`movie`, `show` or `game`), `year` when known, `tags` (full names), `rec` (who recommended it: `Kai`, `Maya R`; `Claude` if you did) and `status` (`want` by default; `doing`, `done` or `dropped` if the user has already started, watched or dropped it).

Leave the rest to Hoard: it fills in IMDb, runtime, genre, Rotten Tomatoes, summary, director, writer, cast and poster within a few minutes. Games are typed by hand and get no lookup.

## Changing a title

`hoard_set` with the title's `page_id` from `hoard_library`. Only what you pass changes.

- `status`, `tags`, `rec`: any time the user asks. `tags` replaces the whole list, so include the tags it already has.
- `rating` (whole number 1 to 5): only when the user gives a rating.
- `finished` (`YYYY-MM-DD`): only when the user gives a date; `status: done` sets today's date when it's left out.
- `progress` (free text like `S2E4`): only when the user says where they are.

"I've seen X" or "I watched X": find it with `hoard_library` (or `hoard_add` it with `status: done` if it isn't there), set `done`, and ask for a rating only if the user seems to be in a talking mood.

## Notes and reviews

`hoard_get` shows one title in full, with its notes (each with an id). `hoard_note` adds a note, or with `note_id` replaces one. Write what the user says in their words; never summarize or improve it.

## Tags

- Full names that read on their own: `Watch with Priya`, never `Priya`.
- Reuse existing tags (`hoard_library` lists them with their groups). Example groups: With (Watch with Priya), Vibe (Cozy Mystery, Rainy Day), Style (Anime). Tags without a group show under Other.
- Groups are set in the Hoard app's Tags screen; there's no tool for them.

## Suggesting

1. `hoard_library` for what the user has. Don't suggest anything already there, including what they dropped, and lean on what they rated 4 or 5 and their tags.
2. Recommend outward-facing picks (why it's good, who made it), a few at a time. Ask what mood or format they want if unclear, with a default.
3. `hoard_suggest` (from one tag, person or set of titles) has Hoard check each pick is a real title, drop what the user already has or passed on, and put the rest in the Suggestions inbox in the app.
4. Add a pick to the want list only when the user says so: `hoard_add` with `rec: Claude`.
