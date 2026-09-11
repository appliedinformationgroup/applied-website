# Projects page — `map.js`

The script behind the Projects page's Grid / List / Map switcher, loaded into
Webflow from this repo via jsDelivr.

```html
<script src="https://cdn.jsdelivr.net/gh/appliedinformationgroup/applied-website@main/Projects/map.js"></script>
```

It is the whole Gridbox script rather than the map alone: the map has no data
source of its own, it reads the Grid's DOM, so the two can't be split without
duplicating the CMS bindings.

## Installing it in Webflow

1. Open the Projects page, find the embed holding the old Gridbox script (the
   one starting `Projects Gridbox — view switcher`), and replace its entire
   contents with the `<script src="…">` tag above.
2. Add the CSS below to the page's existing **page-style** embed.
3. Publish.

Nothing else in the Designer changes. The map view still needs the same
markup it has today — a `#gridbox-map-outer` wrapper containing an empty
`#map` div — and the Grid still needs its hidden `.gridbox-item-meta` block
per item (`.coord-lat`, `.coord-lng`, `.meta-city`, `.meta-country`,
`.meta-description`, `.meta-map-only`, `.meta-is-case-study`).

## CSS to add

```css
  /* ===== Map view ===== */
  /* Replaces the existing #gridbox-map-outer rule — only the background is
     new. The globe is drawn on this colour by map.js, so the container
     carries it too and there's no flash of white while Mapbox boots. */
  #gridbox-map-outer {
    width: 100%;
    height: 75vh;
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

Pacing is set by the constants at the top of `initProjectsGridbox`:

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

jsDelivr caches `@main` for up to 12 hours, so a push won't show up on the
live site immediately. To pick up a change straight away, either purge it:

```
https://purge.jsdelivr.net/gh/appliedinformationgroup/applied-website@main/Projects/map.js
```

or pin the tag to a release/commit (`@v1.0.0`, or `@<sha>`) and bump it in
Webflow when you want the change to land — which is the safer habit for a
live site, since it can't update underneath you.
