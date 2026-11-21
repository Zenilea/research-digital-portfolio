# Research digital portfolio

My AP Research portfolio site. The project asks whether an epoxy seal closes the gaps in
3D-printed PLA, and whether that seal lasts through 20 rounds of 70% isopropyl alcohol disinfection.

Live site: https://zenilea.github.io/research-digital-portfolio/

It is a static site built with [Astro](https://astro.build). Every push to `main` rebuilds it
and publishes it to GitHub Pages.

## Where the words live

The text is kept apart from the layout, so most edits are one line in one file.

| To change | Edit |
| --- | --- |
| My name, the title in the browser tab, "Last updated", the nav | `src/data/site.json` |
| Home, including the big hero title (`titleLines`) | `src/data/home.json` |
| How it works | `src/data/how.json` |
| Research page text, key sources, the gap table | `src/data/research.json` |
| The literature review | `src/writing/literature-review.md` |
| Process, the plan, the timeline, the results list | `src/data/process.json` |
| About | `src/data/about.json` |
| The portrait | `src/assets/portrait.jpg` (4:5, already black and white) |

Common edits:

- **Timeline.** In `process.json`, each item has a `state`: `done`, `next`, `upcoming` or `event`.
  Move an item along by changing its state, and give it a `when` date once it has happened.
  Update `asOf` there and `lastUpdated` in `site.json` at the same time.
- **Hero title.** The big title on Home is `titleLines` in `home.json`, one entry per line.
  The same words are in `title` in `site.json`, which is used for the browser tab and the share image.
  Change both, then run `npm run images`.
- **Hero title font.** In `site.json`, set `heroTitleFont` to `"sans"` or `"serif"`.
- **Results.** When the experiment has run, the Results section in `src/pages/process.astro`
  is the place for the numbers and graphs. Until then it says nothing has been measured.

## Sources

The source library comes from my sources workbook. The workbook itself is not in this repo.

```
npm run sources -- "path/to/the workbook.xlsx"
```

That rewrites `src/data/sources.json` with the rows as typed. The checked version of each row
(short authors, year, plain summary, link, APA reference) is in `src/data/source-extras.json`:

- `overrides` holds the checked details for a row.
- `added` holds sources that are cited in the literature review but are not in the workbook.
- `unconfirmed` and `exclude` list rows that are held back from the site, with the reason.

A new workbook row shows on the site as typed until it has an entry in `overrides`.
`npm test` fails if a published source is missing a checked reference, so nothing unchecked slips through.

## Run it on my computer

Needs [Node.js](https://nodejs.org) 22.23.4 or newer (the version Astro asks for).

```
npm install
npm run dev        # the site at http://localhost:4321/research-digital-portfolio/
```

Before pushing:

```
npm run build:ci   # build, then the rule check and the data tests
```

`npm run verify` also runs the browser tests (phone, tablet and desktop widths, no JavaScript,
reduced motion). Those need Playwright: `npm i -D playwright` and `npx playwright install chromium`.

## Rules the build enforces

`scripts/check-dist.mjs` reads every built page and stops the deploy if it finds:

- the word "sterilization" (or "sterile", "sterilant", or any other word built on "steril")
  used for my own work. It is only allowed inside other people's wording: source titles, the
  literature review and the reference list. My treatment is **disinfection**. The word
  "sterility" is allowed, because the site says the study is not about it.
- the phrase "no research exists"
- an email address or phone number, in the text or in a link
- an image without alt text, a link that goes nowhere, or two parts of a page with the same id
- an idea diagram without the label "Illustration of the idea, not results."

`npm test` also checks a few facts in the data files: the parts table adds up, the bend-rig step
on the timeline has a full date or no date (not a guessed month), and the source library does
not say "every source" while some sources are held back.

## Publishing

1. Push to `main`.
2. The **Deploy to GitHub Pages** action builds, checks and publishes the site (about a minute).
3. One-time setup: repo **Settings > Pages > Source: GitHub Actions**.

If the repo is ever renamed, change `REPO` in `site.config.mjs`. That one file sets the
address for the build, the check and the tests. Then fix the live link at the top of this file.

## Images

`npm run images` remakes the icons and the share image (`public/og.png`) from the title in
`site.json`. Run it if the title or `public/favicon.svg` changes.
