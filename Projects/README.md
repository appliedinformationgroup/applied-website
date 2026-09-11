# Projects page — `map.js`

The Projects page map: Mapbox, and only Mapbox. Loaded into Webflow from this
repo via jsDelivr.

```html
<script src="https://cdn.jsdelivr.net/gh/appliedinformationgroup/applied-website@main/Projects/map.js"></script>
```

Until this is merged to `main`, point the tag at a **commit** instead:

```html
<script src="https://cdn.jsdelivr.net/gh/appliedinformationgroup/applied-website@224157133ca9ae4c9128be82ac965b66adc9aef9/Projects/map.js"></script>
```

Not at the branch. jsDelivr reads everything between `@` and the first slash
as the version, so a branch name containing a slash —
`claude/focused-newton-ut2er3` — is read as version `claude` and file
`focused-newton-ut2er3/Projects/map.js`, and 404s. Commit SHAs have no
slashes, and have the bonus of never changing under the live site.

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
{ lat, lng, name, href, imgSrc, city, country }
```

The page's own grid items already carry those fields, so they go over
untouched — extra properties are ignored.

## Installing it in Webflow

1. Add the `<script src="…">` tag above to the Projects page, before the
   Gridbox embed. (If it lands later the embed waits for it, but before is
   one less thing happening.)
2. Update the Gridbox embed to the version that talks to `AIGProjectsMap`
   instead of driving Mapbox itself.
3. Split the old page-style embed in two: the map CSS below, and the grid +
   list CSS (everything else, unchanged). No selector appears in both, so the
   order of the two embeds doesn't matter.
4. Publish.

Nothing else in the Designer changes. The map view still needs the same markup
it has today — a `#gridbox-map-outer` wrapper containing an empty `#map` div —
and the Grid still needs its hidden `.gridbox-item-meta` block per item
(`.coord-lat`, `.coord-lng`, `.meta-city`, `.meta-country`,
`.meta-description`, `.meta-map-only`, `.meta-is-case-study`).

## Map CSS embed

The map half of the old page-style embed, in full. Everything from
`#gridbox-map-outer` down is new or changed; the popup rules above it are
unchanged from what was already on the page.

```css
  .mapboxgl-popup-content {
    width: 400px !important;
    pointer-events: auto;
    border-radius: 8px;
    border: 1px solid var(--_colors---button--border--inverse, #e5e5e5);
    box-shadow: 0px 0px 20px 2.5px rgba(0, 0, 0, 0.1);
    padding: 0;
    color: var(--_colors---text--primary, #0a0a0a);
    overflow: hidden;
    background-color: var(--_colors---background--primary, #fafafa);
  }
  @media screen and (max-width: 480px) {
    .mapboxgl-popup-content {
      width: 250px !important;
    }
    .mapboxgl-popup {
      width: 250px !important;
    }
  }
  .mapboxgl-popup-anchor-bottom .mapboxgl-popup-tip {
    border-top-color: var(--_colors---background--primary, #fafafa);
  }
  .mapboxgl-popup-anchor-top .mapboxgl-popup-tip {
    border-top-color: var(--_colors---background--primary, #fafafa);
  }
  .mapboxgl-popup {
    max-width: 400px !important;
  }
  .mapboxgl-popup-close-button {
    display: none !important;
  }
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
  .map-popup-card_desc {
    font-size: 15px;
    line-height: 1.3;
    color: var(--_colors---text--tertiary, #707070);
  }
  #gridbox-map-outer {
    width: 100%;
    height: 75vh;
    /* The globe is drawn on this colour by map.js, so the container carries
       it too and there's no flash of white while Mapbox boots. */
    background-color: var(--_colors---background--primary, #fafafa);
  }
  #gridbox-map-outer #map {
    width: 100%;
    height: 100%;
  }
  /* A card the map opened by itself while the globe turned, rather than one
     the visitor clicked. Opacity only — Mapbox positions the popup with a
     transform on this same element. */
  .map-popup--auto {
    animation: map-popup-in 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94) both;
  }
  @keyframes map-popup-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .map-popup--auto {
      animation: none;
    }
  }
```

The other embed holds the grid and list CSS — everything not listed here,
unchanged. No selector appears in both.

## How the map behaves

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
