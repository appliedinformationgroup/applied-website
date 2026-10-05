# Projects page — `map.js`

The Projects page map: Mapbox, and only Mapbox. Served from this repo via
jsDelivr, and **not** a script tag on the page: the page's Gridbox embed
fetches it the first time someone opens the map view, so a visitor who never
does — every phone, where the map view is hidden, and anyone who stays on the
grid — downloads none of it. Mapbox GL itself, the heavy part at about 1 MB,
is fetched by this file in turn, on the same first open.

The URL lives in the embed, in `MAP_MODULE_URL`, pinned to a **commit**:

```js
const MAP_MODULE_URL = 'https://cdn.jsdelivr.net/gh/appliedinformationgroup/applied-website@<sha>/Projects/map.js';
```

Pin a commit SHA, not a branch. jsDelivr reads everything between `@` and the
first slash as the version, so a branch name containing a slash —
`claude/focused-newton-ut2er3` — is read as version `claude` and file
`focused-newton-ut2er3/Projects/map.js`, and 404s. A SHA also never changes
under the live site: a new version goes live when the embed is updated to it.

The page's grid, list, view switcher and URL handling stay in the page's own
embed, where they already work. That embed decides when the map is on screen
and hands over the projects to show; this file does everything else.

## The interface

The two meet at `window.AIGProjectsMap`:

| Call | What it does |
| --- | --- |
| `mount(container, points)` | Show the map in `container`, loading Mapbox GL on first use. Returns a Promise. Calling it again re-uses the map already built. |
| `update(points)` | New data after filtering or sorting. Safe before the first mount — it just records the points for when the map appears. |
| `unmount()` | Leaving the map view: stops the rotation, closes any open card. The map is kept, so coming back is instant. |
| `getMap()` | The Mapbox map, or `null`. An escape hatch for one-off work from the page. |

A point is a plain object. Only `lat` and `lng` are required; the rest fill in
the card:

```js
{ lat, lng, name, hook, categories, city, country, imgSrc, href, actionsHtml }
```

The text reads name, then `hook` — the one-line description — in
`.map-popup-card_hook`, then a line of `categories` (an array) and the
location, joined with dots, in `.map-popup-card_desc`:
"city · transport · London, UK".

With an `href`, the whole card is a link there. Without one it isn't a link,
and `actionsHtml` — HTML from the page, inserted as-is — is shown instead, in
`.map-popup-card_actions`: centred over the photo, the way the grid card shows
its button, or under the text when there's no photo. The photo and the
actions share a `.map-popup-card_media` wrapper, which is what they're
centred against. The page decides which a project
gets: on the Projects page a case study links to its page, and anything else
carries the grid card's own "Ask about this project" button, cloned with its
Designer classes and its `mailto:` subject set to the project name.

## Installing it in Webflow

1. Update the Gridbox embed to the version that talks to `AIGProjectsMap`
   and loads this file itself, with `MAP_MODULE_URL` pointing at the commit
   you want. There is no separate `<script>` tag for `map.js` — remove it if
   an earlier install added one.
2. If the map view button is hidden at a breakpoint, the map view is off
   there too, even for a `?display=map` link — the embed falls back to the
   grid rather than fetch a map nobody can switch to.
3. Split the old page-style embed in two: the map CSS below, and the grid +
   list CSS (everything else, unchanged). No selector appears in both, so the
   order of the two embeds doesn't matter.
4. Publish.

Nothing to build in the Designer for the card panel — `map.js` creates it and
ships the CSS that makes it a panel, so it works with or without the embed
below. That embed is for tuning the look.

Nothing else in the Designer changes. The map view still needs the same markup
it has today — a `#gridbox-map-outer` wrapper containing an empty `#map` div —
and the Grid still needs its hidden `.gridbox-item-meta` block per item
(`.coord-lat`, `.coord-lng`, `.meta-city`, `.meta-country`,
`.meta-description`, `.meta-map-only`, `.meta-is-case-study`).

## Map CSS embed

The map half of the old page-style embed. The Mapbox popup rules are gone —
the card is no longer a popup — replaced by the panel rules below. The
`.map-popup-card` block is unchanged and is where to start on the card's
look; `.map-panel` is the container around it.

`map.js` injects its own baseline for `.map-panel` — enough to make it a
panel at the bottom of the map, and the card's hover, and nothing more. It goes
in at the top of `<head>`, so everything here lands after it and wins. Drop a
rule from this embed and the panel still works, it just looks plainer.

```css
  /* The marker — or the cluster hiding it — whose card is open. */
  :root {
    --_colors---map-marker-active: #34c759;
  }
  body.u-dark-mode {
    --_colors---map-marker-active: #30d158;
  }

  #gridbox-map-outer {
    width: 100%;
    height: 75vh;
    /* The positioning context for the card panel, and what clips it: a closed
       panel is tucked out of sight below the map rather than overlapping
       whatever follows the section. */
    position: relative;
    overflow: hidden;
    /* The globe is drawn on this colour by map.js, so the container carries
       it too and there's no flash of white while Mapbox boots. */
    background-color: var(--_colors---background--primary, #fafafa);
  }
  #gridbox-map-outer #map {
    width: 100%;
    height: 100%;
  }

  /* ===== The project card panel =====
     A card floating in the bottom-left corner of the map, in from its edges
     by the page's own gutter. map.js builds it — there is nothing to add in
     the Designer — and flies a clicked project into the space to its right. */
  .map-panel {
    /* The gap between the card and the map's edges. */
    --map-panel-offset: var(--_containers---container-large--padding-x, 1.5rem);
    position: absolute;
    left: var(--map-panel-offset);
    bottom: var(--map-panel-offset);
    z-index: 2;
    width: calc(100% - 2 * var(--map-panel-offset));
    max-width: 400px;
    border: 1px solid var(--_colors---button--border--inverse, #e5e5e5);
    border-radius: 8px;
    box-shadow: 0px 0px 20px 2.5px rgba(0, 0, 0, 0.1);
    background-color: var(--_colors---background--primary, #fafafa);
    color: var(--_colors---text--primary, #0a0a0a);
    overflow: hidden;
    opacity: 0;
    transform: translateY(calc(100% + var(--map-panel-offset)));
    transition:
      transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94),
      opacity 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  }
  .map-panel.is-open {
    opacity: 1;
    transform: translateY(0);
  }
  /* .map-panel.is-auto is set when the map opened the card by itself rather
     than the visitor clicking a marker. No styles by default — it's here to
     style the two differently if you ever want to. */
  @media (prefers-reduced-motion: reduce) {
    .map-panel {
      transition: none;
    }
  }

  /* ===== The card itself =====
     Unchanged from the old popup — same classes, same markup, it just has a
     panel around it now instead of a Mapbox bubble. This is the block to
     play with for the card's look. */
  .map-popup-card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    text-decoration: none;
    color: inherit;
    width: 100%;
    padding: 24px;
  }
  .map-popup-card_image {
    width: 100%;
    aspect-ratio: 448/310;
    object-fit: cover;
    display: block;
  }
  .map-popup-card_body {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
  }
  .map-popup-card_title {
    font-size: 20px;
    line-height: 1.2;
    letter-spacing: -0.1px;
    color: var(--_colors---text--primary, #0a0a0a);
    font-weight: 500;
  }
  .map-popup-card_hook {
    font-size: 20px;
    line-height: 1.3;
    letter-spacing: -0.1px;
    color: var(--_colors---text--tertiary, #707070);
  }
  .map-popup-card_desc {
    font-size: 15px;
    line-height: 1.3;
    color: var(--_colors---text--tertiary, #707070);
  }
```

The other embed holds the grid and list CSS — everything not listed here,
unchanged. No selector appears in both.

## How the map behaves

- **Case study or enquiry** — the card does what the grid card does. A case
  study is a link to its page; any other project isn't a link, and carries
  the "Ask about this project" email button instead.
- **Hover** — the same as the grid card, and driven by the page's own
  `--image-hover-scale`, `--image-hover-duration` and `--image-hover-easing`,
  so changing those changes both. A case study's photo grows; any other
  project's photo stays still while its button fades in and the card dims to
  75%. Where there's no hover — phones, tablets — the button is simply always
  showing, and keyboard focus reveals it too. A case-study card carries an
  `is-link` class for styling the two apart.
- **Closing a card** — click anywhere on the map, away from a marker, or press
  Escape. There's no close button.
- **Branding** — the Mapbox wordmark and the © Mapbox / © OpenStreetMap line
  are off, since the site credits them elsewhere. Mapbox's terms ask for both
  on the map; `SHOW_MAPBOX_BRANDING` at the top of `map.js` brings them back.
- **Clicking a project** — the map flies to it, zoomed in to at least
  `CARD_FOCUS_ZOOM`, and centres it in the space to the right of the card, so
  the card never covers it. The card is measured when it opens, so restyling
  it can't break that.
- **The card** — a project's card floats in the bottom-left corner of the
  map, in from its edges by `--map-panel-offset` (the page gutter), rather
  than in a bubble pinned to its marker, so a long name or a
  wide photo has room and the card never covers the part of the globe you're
  looking at. `map.js` builds the panel itself; there's nothing to add in the
  Designer.
- **The highlight** — while a card is up, its marker is painted in
  `--_colors---map-marker-active` and drawn larger. At world zoom most
  projects sit inside a cluster rather than on their own, so the cluster
  holding it lights up instead — otherwise the card would point at nothing.
- **Background** — the globe is drawn on the page's own
  `--_colors---background--primary` instead of Mapbox's starfield, and
  follows the light/dark switch.
- **Idle rotation** — the globe turns slowly on its own. Dragging, zooming,
  hovering a marker or opening a card stops it; it picks up again once the
  visitor has been idle, and only while they're still looking at the whole
  world (past `SPIN_MAX_ZOOM` it stays where they put it). Visitors who ask
  for reduced motion get a static map.
- **Auto-showcase** — while it turns, projects introduce themselves: a marker
  reaching the middle of the canvas opens its card for a few seconds. Every
  project gets a turn before any repeats, and resting the pointer on a card
  keeps it open.

Pacing is set by the constants at the top of the file:

| Constant | Default | What it does |
| --- | --- | --- |
| `SPIN_DEGREES_PER_SECOND` | `3` | Rotation speed — a full turn takes two minutes |
| `SPIN_RESUME_DELAY_MS` | `5000` | Idle time after a gesture before it turns again |
| `SPIN_MAX_ZOOM` | `4` | Above this zoom the globe stays put |
| `SHOWCASE_HOLD_MS` | `4000` | How long an auto-opened card stays up |
| `SHOWCASE_MIN_LNG_GAP` | `25` | Degrees the globe must turn between cards |
| `SHOWCASE_TRIGGER_PX` | `60` | How close to the centre line a marker has to be |
| `MARKER_ACTIVE_RADIUS` | `11` | Size of the highlighted marker, against `MARKER_RADIUS` 8 |

`SHOWCASE_MIN_LNG_GAP` is the one to reach for first: it's what stops a dozen
London projects firing one after another without the globe ever moving.

## Caching

jsDelivr caches a branch for up to 12 hours, so a push won't show up on the
live site immediately. To pick up a change straight away, either purge it:

```
https://purge.jsdelivr.net/gh/appliedinformationgroup/applied-website@main/Projects/map.js
```

or pin the tag to a release/commit (`@v1.0.0`, or `@<sha>`) and bump it in
Webflow when you want the change to land — which is the safer habit for a
live site, since it can't update underneath you.
