# Title-page format

**Historical.** Hoard no longer keeps titles in Grimoire: everything lives in Hoard's own store. This file now describes only what the one-time import (`scripts/onehome/`) reads from the old title pages, and what Stacks (the companion books app) still does for books.

How a movie, show or game was stored in Grimoire. Grimoire itself knows nothing about it: these are ordinary pages, tags and properties.

Books use the same page shape with `type:: book` and belong to Stacks (its own `docs/title-page-format.md`). Hoard never reads or changes a page whose `type` is `book`, and Stacks never changes a page whose `type` is anything else. When a book and a movie share a name, the book page is `Title (book)`.

## A title page

```
Starfall (2021)
- tags:: [[media]], [[Watch with Priya]]
  type:: movie
  status:: want
  rec:: Claude
  imdb:: tt1000419
  year:: 2021
  runtime:: 155
  genre:: Action, Adventure, Drama
  rt:: 83
  summary:: A mining crew finds a fallen star on a frozen moon.
- Notes and reviews go here as ordinary blocks.
```

- **Page name:** `Title (Year)`, or just `Title` when the year isn't known. An existing page for the title (like `The Quiet Harbor`) is used as is; never make a second page for the same work.
- **The first top-level block holds the properties,** one `key:: value` per line. Every other block on the page is a note or review.
- **A page is a title** when its first block's `tags` line includes `[[media]]` and it has a `type`.

## Properties

| Key | Values | Who sets it |
|---|---|---|
| `tags` | `[[media]]` first, then any tags, as `[[Full Tag Name]]` | anyone |
| `type` | `movie`, `show`, `game` | anyone |
| `status` | `want`, `doing`, `done`, `dropped` | anyone; Hoard sets `done` when Jellyfin reports a title played (Infuse reports to Jellyfin) |
| `rating` | whole number `1` to `5` | the user |
| `rec` | who recommended it, e.g. `Kai`, `Maya R`, `Claude` | anyone |
| `finished` | date `YYYY-MM-DD`, when status became done | the user, or Hoard when status becomes done |
| `progress` | free text, e.g. `S2E4` | the user |
| `imdb` | IMDb ID, e.g. `tt1000419` | Hoard (movies, shows) |
| `year` | four-digit year | Hoard |
| `runtime` | minutes, e.g. `155` | Hoard (movies, shows) |
| `genre` | comma-separated, e.g. `Action, Adventure` | Hoard |
| `rt` | Rotten Tomatoes percent, e.g. `83`; often absent for shows | Hoard (movies, shows) |
| `summary` | one or two sentences | Hoard |
| `director`, `writer`, `cast` | comma-separated names (up to 3, 4 and 4) | Hoard |

Lines with other keys (for example `why::`) are left alone.

## Older forms Hoard accepts

Hoard reads these and writes the plain form the next time it changes that line:

- Keys in any case, with or without a space before `::`: `Status:: to-play`, `rating :: 4`.
- Tags written as `#Anime` or `#[[Cozy Mystery]]` in the `tags` line, besides `[[Anime]]`.
- Windows line endings.
- Status words: `TODO`, `to-play`, `installed`, `to read` mean want; `reading`, `playing`, `watching` mean doing; `played`, `watched`, `read`, `finished` mean done.
- Ratings: `5/5` and `4.0` mean 5 and 4; `TBD` means no rating.

## Tags and tag groups

- Tags are ordinary Grimoire pages linked from the `tags` line. Use full names that read on their own: `Watch with Priya`, never `Priya`, so a tag never lands on a person's page.
- A tag's group is one line on the tag's own page: `group:: Vibe`. Starting groups: **With** (Watch with Priya, Watch with Theo), **Vibe** (Cozy Mystery, Rainy Day, Background), **Style** (Anime, Mockumentary). A tag without a group is shown under Other.
- `[[media]]` is not shown as a tag in Hoard.
