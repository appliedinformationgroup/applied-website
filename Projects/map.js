/**
 * Applied Information Group — Projects page map + view switcher.
 *
 * Hosted here and loaded on the Webflow Projects page via jsDelivr:
 *   <script src="https://cdn.jsdelivr.net/gh/appliedinformationgroup/applied-website@main/Projects/map.js"></script>
 *
 * This is the whole Projects Gridbox script, not the map alone: the map has
 * no data source of its own, it reads the Grid's DOM, so the two can't be
 * split without duplicating the CMS bindings. The matching page CSS lives in
 * the page's "page-style" embed in Webflow.
 *
 * Map behaviour, beyond the grid/list/map switching:
 *   - the globe sits on the page's own background colour rather than
 *     Mapbox's default starfield, in both light and dark mode;
 *   - it turns slowly while idle, and stops the moment the visitor touches
 *     it, hovers a marker, or opens a project card;
 *   - while it turns, projects introduce themselves — a marker reaching the
 *     middle of the canvas opens its card for a few seconds, working through
 *     every project before any repeats.
 */
(function () {
  'use strict';
  /**
   * Single source of truth is the Grid; List and Map are built at runtime
   * from its DOM, so nothing is duplicated in the Designer or CMS bindings.
   *
   * List is a real <table>: sortable <th scope="col"> headers, <th
   * scope="row"> for each project name (with an expand <button> plus a
   * convenience whole-row click for mouse users), and a sibling detail
   * <tr> for the photo. The photo is NOT built until the row is actually
   * expanded for the first time (lazy), and copies the source image's full
   * srcset/sizes/alt — not just a single resolved src — so the browser
   * picks the right rendition for the list's own layout. Sorting stays
   * in-memory only (Grid's DOM is never touched).
   */
  function initProjectsGridbox() {
    const MAPBOX_VERSION = 'v3.2.0';
    const MAPBOX_CSS_URL = 'https://api.mapbox.com/mapbox-gl-js/' + MAPBOX_VERSION + '/mapbox-gl.css';
    const MAPBOX_JS_URL = 'https://api.mapbox.com/mapbox-gl-js/' + MAPBOX_VERSION + '/mapbox-gl.js';
    const MAPBOX_ACCESS_TOKEN = 'pk.eyJ1IjoiYXBwbGllZC1pbmZvcm1hdGlvbi1ncm91cCIsImEiOiJjbGQxamI1c2gwZGZ2M25ueTFrcjl3cDE0In0.Ix4iBQ6SUwqdokXuPcFrRw';
    const MAP_STYLE_LIGHT = 'mapbox://styles/mapbox/light-v11';
    const MAP_STYLE_DARK = 'mapbox://styles/mapbox/dark-v11';
    const DEFAULT_MAP_CENTER = [0, 15];
    const DEFAULT_MAP_ZOOM = 2;
    const CLUSTER_MAX_ZOOM = 14;
    const CLUSTER_RADIUS = 50;
    const MARKER_RADIUS = 8;
    const CLUSTER_COLOR_FALLBACK = '#636366';
    const CLUSTER_TEXT_COLOR_FALLBACK = '#ffffff';
    const MAP_BACKGROUND_FALLBACK = '#fafafa';
    // How softly the globe's edge fades into that background colour.
    const MAP_HORIZON_BLEND = 0.04;
    // Idle rotation. Degrees per second (not per frame) so the globe turns
    // at the same rate on a 60Hz and a 120Hz display; the per-frame delta is
    // clamped so a backgrounded tab doesn't jump on return.
    const SPIN_DEGREES_PER_SECOND = 3;
    const MAX_SPIN_FRAME_SECONDS = 0.1;
    // Idle time after any interaction before the rotation picks up again.
    const SPIN_RESUME_DELAY_MS = 5000;
    // Shorter, because leaving a marker is a much weaker signal of intent
    // than dragging or zooming the map.
    const SPIN_HOVER_RESUME_DELAY_MS = 1500;
    // Past this zoom the visitor is looking at somewhere specific, so the
    // globe stays where they put it.
    const SPIN_MAX_ZOOM = 4;
    // Auto-showcase: how close to the vertical centre line a marker has to
    // drift before its card opens, how long the card is held open, and how
    // long the globe turns again before the next one may open.
    const SHOWCASE_TRIGGER_PX = 60;
    const SHOWCASE_EDGE_PADDING_PX = 80;
    const SHOWCASE_HOLD_MS = 4000;
    // How far the globe has to turn between cards. Paced in degrees rather
    // than seconds on purpose: a dozen projects can sit on nearly the same
    // longitude (London alone has more than that), and a plain timer lets
    // them fire one after another without the globe ever moving. At the
    // rotation speed above this is roughly eight seconds of travel.
    const SHOWCASE_MIN_LNG_GAP = 25;
    // A marker on the far side of the globe still projects onto the canvas,
    // so anything more than a quarter turn from the centre is ignored.
    const SHOWCASE_MAX_LNG_DISTANCE = 90;
    const SCROLL_GUARD_DELAY_MS = 150;
    // Same open/close motion as the Expertise services accordion (see the
    // "Services - script" component) so both patterns feel identical. The
    // duration and easing are mirrored in the CSS transition on
    // .project-row_description-reveal — change both together.
    const REVEAL_DURATION_MS = 300;
    const REVEAL_EASING = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
    const REVEAL_SETTLE_MS = 320;
    // Matches the max-width breakpoint of the single-column list layout in
    // the page CSS — below it the Description collapses too, above it the
    // Description is always visible and only the photo animates.
    const MOBILE_LAYOUT_QUERY = '(max-width: 767px)';
    const TOOLTIP_TEXT = 'View';
    const TOOLTIP_PLACEMENT = 'bottom';
    const TOOLTIP_THEME = 'applied';
    const TOOLTIP_POLL_INTERVAL_MS = 250;
    const TOOLTIP_MAX_POLL_ATTEMPTS = 40;
    const SORT_ICON_SVG =
      '<svg class="project-table_sort-icon" width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M10 15.5625L3.75 9.3125L4.625 8.4375L10 13.8125L15.375 8.4375L16.25 9.3125L10 15.5625Z" fill="#707070"/></svg>';

    const root = document.getElementById('projects-gridbox-section');
    if (!root) return;

    const viewButtons = document.querySelectorAll('.view-button');
    if (!viewButtons.length) return;

    const gridEl = document.getElementById('gridbox-grid-wrapper');
    const listEl = document.getElementById('gridbox-list-container');
    const mapEl = document.getElementById('gridbox-map-outer');
    if (!gridEl || !listEl || !mapEl) return;

    const viewAnchor = document.createComment('gridbox-view-anchor');
    gridEl.parentNode.insertBefore(viewAnchor, gridEl.nextSibling);
    listEl.remove();
    mapEl.remove();

    let activeView = 'grid';
    let mapboxLoadPromise = null;
    let gridboxMap = null;
    let rowIdCounter = 0;
    let currentMapPoints = [];
    let activePopup = null;
    let spinFrameId = null;
    let spinResumeTimer = null;
    let lastSpinFrameTime = 0;
    let showcaseActive = false;
    let showcaseTimer = null;
    // Centre longitude the globe has to travel away from before the next
    // card may open. Seeded with the starting centre so the map is seen
    // turning before the first project introduces itself.
    let showcaseAnchorLng = DEFAULT_MAP_CENTER[0];
    const shownShowcaseKeys = new Set();
    let activeSort = { column: null, direction: null };
    let tippyWaitTimer = null;

    function isMobileLayout() {
      return window.matchMedia(MOBILE_LAYOUT_QUERY).matches;
    }

    function initScrollHoverGuard() {
      let scrollTimeout;
      window.addEventListener(
        'scroll',
        () => {
          document.body.classList.add('is-scrolling');
          clearTimeout(scrollTimeout);
          scrollTimeout = setTimeout(() => {
            document.body.classList.remove('is-scrolling');
          }, SCROLL_GUARD_DELAY_MS);
        },
        { passive: true }
      );
    }

    function loadMapboxAssets() {
      if (mapboxLoadPromise) return mapboxLoadPromise;
      mapboxLoadPromise = new Promise((resolve, reject) => {
        const stylesheet = document.createElement('link');
        stylesheet.rel = 'stylesheet';
        stylesheet.href = MAPBOX_CSS_URL;
        stylesheet.onerror = () => reject(new Error('Mapbox CSS failed to load'));
        document.head.appendChild(stylesheet);

        const script = document.createElement('script');
        script.src = MAPBOX_JS_URL;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Mapbox JS failed to load'));
        document.body.appendChild(script);
      });
      return mapboxLoadPromise;
    }

    function markMapOnlyItems() {
      const gridList = gridEl.querySelector('.projects-gridbox');
      if (!gridList) return;
      Array.from(gridList.children).forEach((item) => {
        const meta = item.querySelector('.gridbox-item-meta');
        const flagText = meta?.querySelector('.meta-map-only')?.textContent?.trim().toLowerCase();
        const isMapOnly = flagText === 'true' || flagText === 'yes';
        item.classList.toggle('is-map-only-item', isMapOnly);
      });
    }

    function getCategoryNames(meta) {
      if (!meta) return [];
      return Array.from(meta.querySelectorAll('.meta-category-name'))
        .map((el) => el.textContent?.trim())
        .filter(Boolean);
    }

    function readBooleanFlag(meta, selector) {
      const text = meta?.querySelector(selector)?.textContent?.trim().toLowerCase();
      return text === 'true' || text === 'yes';
    }

    function getGridItems({ includeMapOnly = false } = {}) {
      const items = [];
      const gridList = gridEl.querySelector('.projects-gridbox');
      if (!gridList) return items;

      Array.from(gridList.children).forEach((item) => {
        const isMapOnly = item.classList.contains('is-map-only-item');
        if (isMapOnly && !includeMapOnly) return;

        const computedStyle = window.getComputedStyle(item);
        const isFilteredByFinsweet = !isMapOnly && computedStyle.display === 'none';
        if (isFilteredByFinsweet) return;

        const card = item.querySelector('.projects-card');
        if (!card) return;

        const meta = item.querySelector('.gridbox-item-meta');
        const caseStudyLink = item.querySelector('.projects-card_link');
        const caseStudyHref = caseStudyLink?.getAttribute('href') || '';
        const imageEl = card.querySelector('img');

        items.push({
          name: card.querySelector('h2, h3')?.textContent?.trim() || '',
          // Real "Description" field, read from the hidden meta block — the
          // visible .paragraph on the card is bound to "Hook" (a short
          // tagline), which is a different field and was being shown here
          // by mistake.
          description: meta?.querySelector('.meta-description')?.textContent?.trim() || '',
          imgSrc: imageEl?.getAttribute('src') || '',
          imgSrcset: imageEl?.getAttribute('srcset') || '',
          imgSizes: imageEl?.getAttribute('sizes') || '',
          imgAlt: imageEl?.getAttribute('alt') || '',
          href: card.getAttribute('href') || '#',
          city: meta?.querySelector('.meta-city')?.textContent?.trim() || '',
          country: meta?.querySelector('.meta-country')?.textContent?.trim() || '',
          categories: getCategoryNames(meta),
          isCaseStudy: readBooleanFlag(meta, '.meta-is-case-study') && Boolean(caseStudyHref),
          caseStudyHref,
          lat: parseFloat(meta?.querySelector('.coord-lat')?.textContent),
          lng: parseFloat(meta?.querySelector('.coord-lng')?.textContent),
        });
      });

      return items;
    }

    function getMappablePoints(items) {
      return items.filter((item) => !isNaN(item.lat) && !isNaN(item.lng));
    }

    function formatLocation(item) {
      return [item.city, item.country].filter(Boolean).join(', ');
    }

    function formatSector(item) {
      return item.categories.length ? item.categories.join(', ') : '\u2014';
    }

    function getSortValue(item, columnKey) {
      if (columnKey === 'project') return (item.name || '').toLowerCase();
      if (columnKey === 'sector') return (item.categories[0] || '').toLowerCase();
      if (columnKey === 'location') return (item.city || '').toLowerCase();
      return '';
    }

    function sortItems(items, columnKey, direction) {
      return [...items].sort((a, b) => {
        const comparison = getSortValue(a, columnKey).localeCompare(getSortValue(b, columnKey), undefined, {
          numeric: true,
          sensitivity: 'base',
        });
        return direction === 'asc' ? comparison : -comparison;
      });
    }

    function handleSortHeaderClick(columnKey) {
      const isSameColumn = activeSort.column === columnKey;
      const nextDirection = isSameColumn && activeSort.direction === 'asc' ? 'desc' : 'asc';
      activeSort = { column: columnKey, direction: nextDirection };
      renderListView();
    }

    // aria-sort lives natively on <th> — no role attribute needed here, a
    // real table header cell already has that semantics built in.
    function buildSortableHeaderCell(columnKey, label) {
      const cell = document.createElement('th');
      cell.scope = 'col';

      const isActive = activeSort.column === columnKey;
      cell.setAttribute('aria-sort', isActive ? (activeSort.direction === 'asc' ? 'ascending' : 'descending') : 'none');

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'project-table_sort-button';
      button.innerHTML = '<span>' + label + '</span>' + SORT_ICON_SVG;
      button.addEventListener('click', () => handleSortHeaderClick(columnKey));

      cell.appendChild(button);
      return cell;
    }

    function buildTableHead() {
      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      headRow.appendChild(buildSortableHeaderCell('project', 'project'));

      const descriptionCell = document.createElement('th');
      descriptionCell.scope = 'col';
      descriptionCell.textContent = 'description';
      headRow.appendChild(descriptionCell);

      headRow.appendChild(buildSortableHeaderCell('sector', 'sector'));
      headRow.appendChild(buildSortableHeaderCell('location', 'location'));

      const caseStudyHeaderCell = document.createElement('th');
      caseStudyHeaderCell.scope = 'col';
      caseStudyHeaderCell.innerHTML = '<span class="visually-hidden">Case study link</span>';
      headRow.appendChild(caseStudyHeaderCell);

      thead.appendChild(headRow);
      return thead;
    }

    // The ms-code-tooltip-* attributes match the convention the rest of the
    // site uses (MEMBERSCRIPT #110, loaded in the site footer). They are
    // written here for consistency and as the single place the copy lives,
    // but that script only scans the DOM once on DOMContentLoaded — these
    // links don't exist yet at that point, so initCaseStudyTooltips below
    // does the actual wiring, reading the values back off the attributes.
    // The aria-label stays more specific than the tooltip on purpose: a
    // screen-reader user hears which project the link belongs to, while the
    // visible tooltip only needs the short verb.
    function buildCaseStudyLink(item) {
      const link = document.createElement('a');
      link.className = 'project-table_case-study-link icon-button';
      link.href = item.caseStudyHref;
      link.setAttribute('aria-label', 'View case study: ' + item.name);
      link.setAttribute('ms-code-tooltip-' + TOOLTIP_PLACEMENT, TOOLTIP_TEXT);
      link.setAttribute('ms-code-tooltip-theme', TOOLTIP_THEME);
      link.innerHTML =
        '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M17 9.98337L9.86305 17L8.71302 15.8694L12.3661 12.2779L14.0911 10.7815L14.0573 10.6817L10.6748 10.8147H3V9.18527H10.6748L14.0573 9.31829L14.0911 9.21853L12.3661 7.72209L8.71302 4.13064L9.86305 3L17 9.98337Z" fill="currentColor"/></svg>';
      return link;
    }

    // Runs after every list render, because sorting and Finsweet filtering
    // both rebuild the table from scratch and hand back brand new link
    // elements each time. The _tippy guard keeps a second pass over the
    // same element from stacking a duplicate instance.
    function initCaseStudyTooltips() {
      if (typeof window.tippy !== 'function') return;
      listEl.querySelectorAll('.project-table_case-study-link').forEach((link) => {
        if (link._tippy) return;
        window.tippy(link, {
          content: link.getAttribute('ms-code-tooltip-' + TOOLTIP_PLACEMENT),
          placement: TOOLTIP_PLACEMENT,
          theme: link.getAttribute('ms-code-tooltip-theme'),
        });
      });
    }

    // Tippy is fetched asynchronously by the footer script, so on the first
    // render it may not be on window yet. Poll briefly rather than give up,
    // and stop after ~10s so a failed CDN load doesn't leave a live timer
    // running for the rest of the session. Only one poll runs at a time —
    // the callback re-scans every link anyway, so extra renders that land
    // during the wait are covered by the pass already scheduled.
    function whenTippyReady(callback) {
      if (typeof window.tippy === 'function') {
        callback();
        return;
      }
      if (tippyWaitTimer) return;

      let attempts = 0;
      tippyWaitTimer = window.setInterval(() => {
        attempts += 1;
        if (typeof window.tippy === 'function') {
          window.clearInterval(tippyWaitTimer);
          tippyWaitTimer = null;
          callback();
        } else if (attempts >= TOOLTIP_MAX_POLL_ATTEMPTS) {
          window.clearInterval(tippyWaitTimer);
          tippyWaitTimer = null;
        }
      }, TOOLTIP_POLL_INTERVAL_MS);
    }

    // Height-animated open/close, ported from the Expertise accordion: the
    // element is clipped, height goes 0 -> measured scrollHeight, then
    // settles on auto so later reflows (resize, font swap) aren't pinned to
    // a stale pixel value. A <tr> can't be animated or clipped this way —
    // table rows ignore overflow and height transitions — so the wrapper
    // inside the cell is what actually moves; the row itself is only
    // unhidden before, and re-hidden after, the transition.
    function initCollapsible(el) {
      el.style.overflow = 'hidden';
      el.style.transition = 'height ' + REVEAL_DURATION_MS / 1000 + 's ' + REVEAL_EASING;
      el.style.height = '0px';
    }

    function expandCollapsible(el) {
      el.style.height = 'auto';
      const targetHeight = el.scrollHeight;
      el.style.height = '0px';
      el.offsetHeight;
      el.style.height = targetHeight + 'px';
      window.setTimeout(() => {
        el.style.height = 'auto';
      }, REVEAL_SETTLE_MS);
    }

    function collapseCollapsible(el, onSettled) {
      el.style.height = el.scrollHeight + 'px';
      el.offsetHeight;
      el.style.height = '0px';
      window.setTimeout(onSettled, REVEAL_SETTLE_MS);
    }

    // Builds the expanded photo lazily — only the first time a row is
    // opened — copying the source card's full responsive attributes
    // (srcset/sizes/alt), not just a single resolved src, so the browser
    // can still pick the right rendition for this context.
    //
    // Three nested wrappers, each doing one job: _reveal is the clipped box
    // whose height animates, _reveal-inner carries the vertical spacing (it
    // has to sit inside the animated box, or it pops in as a jump), and
    // _image-frame holds the fixed 3:2 ratio. The <img> is absolutely
    // positioned inside the frame so its intrinsic size never feeds back
    // into the table's automatic column sizing — which is what used to
    // shift the whole grid when a wide photo was opened.
    function buildLazyImage(item) {
      const reveal = document.createElement('div');
      reveal.className = 'project-details-row_reveal';

      const inner = document.createElement('div');
      inner.className = 'project-details-row_reveal-inner';

      const frame = document.createElement('div');
      frame.className = 'project-details-row_image-frame';

      const img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = item.imgAlt || item.name;
      if (item.imgSrcset) img.setAttribute('srcset', item.imgSrcset);
      if (item.imgSizes) img.setAttribute('sizes', item.imgSizes);
      img.src = item.imgSrc;

      frame.appendChild(img);
      inner.appendChild(frame);
      reveal.appendChild(inner);
      initCollapsible(reveal);
      return reveal;
    }

    // One data row plus its sibling (initially hidden) detail row. The
    // expand <button> lives in the first cell (a <tr> can't itself act as
    // one clickable overlay in a real table); a click listener on the whole
    // <tr> forwards clicks anywhere in the row to that button for mouse
    // users, while real keyboard/screen-reader interaction goes through the
    // button itself — skipped when the click was already on a real link or
    // button, so the case-study link and the trigger don't double-fire.
    // The detail row carries the same forwarding listener, so clicking the
    // photo collapses the row too, matching the shared hover treatment.
    // The project name cell is a <th scope="row">, identifying the row,
    // matching <th scope="col"> on the column headers.
    function buildTableRow(item) {
      rowIdCounter += 1;
      const headingId = 'project-heading-' + rowIdCounter;
      const detailsId = 'project-details-' + rowIdCounter;

      const row = document.createElement('tr');
      row.className = 'project-row';

      const nameCell = document.createElement('th');
      nameCell.scope = 'row';
      nameCell.className = 'project-row_name-cell';
      nameCell.innerHTML =
        '<h2 id="' +
        headingId +
        '" class="heading w-variant-513f6b2b-0a3f-91d4-27c7-e631c50dee8c" data-wf--heading--settings-variant---size="h3-20px">' +
        item.name +
        '</h2>';

      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'project-row_trigger';
      trigger.setAttribute('aria-expanded', 'false');
      trigger.setAttribute('aria-controls', detailsId);
      trigger.setAttribute('aria-labelledby', headingId);
      nameCell.appendChild(trigger);
      row.appendChild(nameCell);

      // The two wrappers around the paragraph are inert on desktop (their
      // rules are inside the mobile media query) and only come alive below
      // 767px, where the Description collapses along with the photo instead
      // of being toggled with display:none.
      const descriptionCell = document.createElement('td');
      descriptionCell.setAttribute('data-label', 'Description');
      descriptionCell.innerHTML =
        '<div class="project-row_description-reveal"><div class="project-row_description-reveal-inner">' +
        '<p alignment="" color="tertiary" weight="" data-wf--paragraph--settings-variant="body-paragraph-20px" class="paragraph">' +
        item.description +
        '</p></div></div>';
      row.appendChild(descriptionCell);

      const sectorCell = document.createElement('td');
      sectorCell.setAttribute('data-label', 'Sector');
      sectorCell.textContent = formatSector(item);
      row.appendChild(sectorCell);

      const locationCell = document.createElement('td');
      locationCell.setAttribute('data-label', 'Location');
      locationCell.textContent = formatLocation(item);
      row.appendChild(locationCell);

      const caseStudyCell = document.createElement('td');
      caseStudyCell.className = 'project-row_case-study-cell';
      if (item.isCaseStudy) caseStudyCell.appendChild(buildCaseStudyLink(item));
      row.appendChild(caseStudyCell);

      // Same 5 cells as the data row above it (not colspan=5), so the image
      // cell — the 2nd cell, matching Description — gets exactly that
      // column's rendered width for free from the table's own layout. The
      // <img> itself isn't created here — only on first expand, see
      // toggleRow — so collapsed rows never load an image they may never show.
      const detailsRow = document.createElement('tr');
      detailsRow.id = detailsId;
      detailsRow.className = 'project-details-row';
      detailsRow.hidden = true;

      const detailsSpacerCell = document.createElement('td');
      detailsRow.appendChild(detailsSpacerCell);

      const detailsImageCell = document.createElement('td');
      detailsImageCell.className = 'project-details-row_image-cell';
      detailsRow.appendChild(detailsImageCell);

      detailsRow.appendChild(document.createElement('td'));
      detailsRow.appendChild(document.createElement('td'));
      detailsRow.appendChild(document.createElement('td'));

      trigger.addEventListener('click', () => toggleRow(row, trigger, detailsRow, detailsImageCell, item));
      row.addEventListener('click', (event) => {
        if (event.target.closest('a, button')) return;
        trigger.click();
      });
      detailsRow.addEventListener('click', (event) => {
        if (event.target.closest('a, button')) return;
        trigger.click();
      });

      return { row, detailsRow };
    }

    // Desktop animates one region (the photo); mobile animates two in
    // parallel (Description, then the photo below it), both on the same
    // duration and easing so they read as a single movement.
    //
    // Above the mobile breakpoint the Description is permanently visible,
    // so its wrapper is only written to — height auto on open, cleared on
    // close — without a transition. That bookkeeping matters even though
    // nothing is visible: it leaves the wrapper in the right state if the
    // window is later resized down past 767px.
    //
    // On close, .is-expanded and the row's hidden attribute are held back
    // until the transition finishes: .is-expanded is what moves the bottom
    // border from the summary row down onto the details row, so dropping it
    // up front would flash a second line above the still-shrinking photo.
    // The aria-expanded re-check guards the case where the row is reopened
    // mid-collapse — that pending timeout must not then hide it again.
    function toggleRow(row, trigger, detailsRow, detailsImageCell, item) {
      const isExpanded = trigger.getAttribute('aria-expanded') === 'true';
      trigger.setAttribute('aria-expanded', String(!isExpanded));

      const onMobile = isMobileLayout();
      const descriptionReveal = row.querySelector('.project-row_description-reveal');

      if (!isExpanded) {
        if (item.imgSrc && !detailsImageCell.firstChild) {
          detailsImageCell.appendChild(buildLazyImage(item));
        }
        row.classList.add('is-expanded');
        detailsRow.hidden = false;

        const photoReveal = detailsImageCell.querySelector('.project-details-row_reveal');
        if (photoReveal) expandCollapsible(photoReveal);

        if (descriptionReveal) {
          if (onMobile) {
            expandCollapsible(descriptionReveal);
          } else {
            descriptionReveal.style.height = 'auto';
          }
        }
        return;
      }

      if (descriptionReveal) {
        if (onMobile) {
          collapseCollapsible(descriptionReveal, () => {
            if (trigger.getAttribute('aria-expanded') === 'true') return;
            descriptionReveal.style.removeProperty('height');
          });
        } else {
          descriptionReveal.style.removeProperty('height');
        }
      }

      const finishCollapse = () => {
        if (trigger.getAttribute('aria-expanded') === 'true') return;
        row.classList.remove('is-expanded');
        detailsRow.hidden = true;
      };

      const photoReveal = detailsImageCell.querySelector('.project-details-row_reveal');
      if (photoReveal) {
        collapseCollapsible(photoReveal, finishCollapse);
        return;
      }

      // No photo for this project: on mobile the row still has to stay put
      // until the Description has finished sliding shut.
      if (onMobile && descriptionReveal) {
        window.setTimeout(finishCollapse, REVEAL_SETTLE_MS);
        return;
      }
      finishCollapse();
    }

    function renderListView() {
      listEl.innerHTML = '';
      const table = document.createElement('table');
      table.className = 'project-table';

      const caption = document.createElement('caption');
      caption.className = 'visually-hidden';
      caption.textContent = 'Projects';
      table.appendChild(caption);

      table.appendChild(buildTableHead());

      const tbody = document.createElement('tbody');
      let items = getGridItems();
      if (activeSort.column) items = sortItems(items, activeSort.column, activeSort.direction);
      items.forEach((item) => {
        const { row, detailsRow } = buildTableRow(item);
        tbody.appendChild(row);
        tbody.appendChild(detailsRow);
      });
      table.appendChild(tbody);

      listEl.appendChild(table);
      whenTippyReady(initCaseStudyTooltips);
    }

    function refreshMapMarkers() {
      if (!gridboxMap || !gridboxMap.getSource('gridbox-locations')) return;
      currentMapPoints = getMappablePoints(getGridItems({ includeMapOnly: true }));
      gridboxMap.getSource('gridbox-locations').setData(buildMapGeoJson(currentMapPoints));
      // Filtering changes which projects exist, so the showcase starts its
      // rotation over against the new set rather than carrying stale keys.
      shownShowcaseKeys.clear();
    }

    function observeGridChanges() {
      const gridList = gridEl.querySelector('.projects-gridbox');
      if (!gridList) return;

      let refreshQueued = false;
      const observer = new MutationObserver(() => {
        if (refreshQueued) return;
        refreshQueued = true;
        requestAnimationFrame(() => {
          refreshQueued = false;
          markMapOnlyItems();
          refreshMapMarkers();
          if (activeView === 'list') renderListView();
        });
      });

      observer.observe(gridList, { childList: true, attributes: true, attributeFilter: ['style', 'class'], subtree: true });
    }

    function mountActiveView(el) {
      [listEl, mapEl].forEach((node) => {
        if (node.isConnected) node.remove();
      });
      if (el) viewAnchor.parentNode.insertBefore(el, viewAnchor.nextSibling);
    }

    function getCurrentColorMode() {
      const body = document.body;
      if (body.classList.contains('u-dark-mode')) return 'dark';
      return 'light';
    }

    // Read off <body>, not <html>: the site's dark-mode overrides are
    // declared on `body.u-dark-mode`, so the same lookup against
    // document.documentElement always returns the light-mode value. An
    // unresolved var() means the token is missing — hand back an empty
    // string so the caller's fallback colour wins.
    function getCssVariable(name) {
      const value = getComputedStyle(document.body).getPropertyValue(name).trim();
      return value.indexOf('var(') === 0 ? '' : value;
    }

    // The globe is drawn against the page's own background colour instead
    // of Mapbox's default starfield, so it reads as part of the page in both
    // light and dark mode. Re-run after every style switch — setStyle resets
    // the atmosphere along with everything else.
    function applyMapBackground(map) {
      const backgroundColor = getCssVariable('--_colors---background--primary') || MAP_BACKGROUND_FALLBACK;
      map.setFog({
        color: backgroundColor,
        'high-color': backgroundColor,
        'space-color': backgroundColor,
        'horizon-blend': MAP_HORIZON_BLEND,
        'star-intensity': 0,
      });
    }

    function buildMapPopupMarkup(item) {
      const location = formatLocation(item);
      return (
        '\
      <a class="map-popup-card" href="' +
        item.href +
        '">\
        ' +
        (item.imgSrc ? '<img class="map-popup-card_image" src="' + item.imgSrc + '" alt="' + item.name + '">' : '') +
        '\
        <span class="map-popup-card_body">\
          <span class="map-popup-card_title">' +
        item.name +
        '</span>\
          ' +
        (location ? '<span class="map-popup-card_desc">' + location + '</span>' : '') +
        '\
        </span>\
      </a>\
    '
      );
    }

    function buildMapGeoJson(points) {
      return {
        type: 'FeatureCollection',
        features: points.map((point, index) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [point.lng, point.lat] },
          properties: { idx: index },
        })),
      };
    }

    function addMapLocationLayers(map, geojson) {
      if (!map.getSource('gridbox-locations')) {
        map.addSource('gridbox-locations', {
          type: 'geojson',
          data: geojson,
          cluster: true,
          clusterMaxZoom: CLUSTER_MAX_ZOOM,
          clusterRadius: CLUSTER_RADIUS,
        });
      } else {
        map.getSource('gridbox-locations').setData(geojson);
      }

      if (!map.getLayer('clusters')) {
        map.addLayer({
          id: 'clusters',
          type: 'circle',
          source: 'gridbox-locations',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': '#2C2C2E',
            'circle-radius': ['step', ['get', 'point_count'], 20, 100, 30, 750, 40],
          },
        });
      }

      if (!map.getLayer('cluster-count')) {
        map.addLayer({
          id: 'cluster-count',
          type: 'symbol',
          source: 'gridbox-locations',
          filter: ['has', 'point_count'],
          layout: {
            'text-field': '{point_count_abbreviated}',
            'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
            'text-size': 16,
          },
          paint: { 'text-color': '#fff' },
        });
      }

      if (!map.getLayer('unclustered-point')) {
        map.addLayer({
          id: 'unclustered-point',
          type: 'circle',
          source: 'gridbox-locations',
          filter: ['!', ['has', 'point_count']],
          paint: { 'circle-color': '#000', 'circle-radius': MARKER_RADIUS },
        });
      }
    }

    function applyMapThemeColors(map) {
      const clusterAndMarkerColor = getCssVariable('--_colors---forground--primary') || CLUSTER_COLOR_FALLBACK;
      const clusterTextColor = getCssVariable('--_colors---text--inverse') || CLUSTER_TEXT_COLOR_FALLBACK;

      if (map.getLayer('clusters')) {
        map.setPaintProperty('clusters', 'circle-color', ['step', ['get', 'point_count'], clusterAndMarkerColor, 100, clusterAndMarkerColor, 750, clusterAndMarkerColor]);
      }
      if (map.getLayer('unclustered-point')) {
        map.setPaintProperty('unclustered-point', 'circle-color', clusterAndMarkerColor);
      }
      if (map.getLayer('cluster-count')) {
        map.setPaintProperty('cluster-count', 'text-color', clusterTextColor);
      }
    }

    /* ── Project card ──────────────────────────────────────────────────
       One popup at a time, whether it was opened by a click or by the
       showcase below. The rotation always stops while a card is up, and
       the resume is scheduled from whatever closed it. */
    function getPointKey(item) {
      return (item.href || '') + '|' + item.name;
    }

    function openProjectCard(item, coordinates, options) {
      const isShowcase = Boolean(options && options.showcase);
      if (!isShowcase) cancelShowcase();
      closeProjectCard();
      stopSpin();
      window.clearTimeout(spinResumeTimer);

      activePopup = new mapboxgl.Popup({
        className: isShowcase ? 'map-popup--auto' : '',
        // An auto-opened card shouldn't vanish on the next stray click —
        // it closes itself on a timer, or when the visitor opens another.
        closeOnClick: !isShowcase,
      })
        .setLngLat(coordinates || [item.lng, item.lat])
        .setHTML(buildMapPopupMarkup(item))
        .addTo(gridboxMap);

      activePopup.on('close', handleProjectCardClose);

      // Reading an auto-opened card keeps it open for as long as the
      // pointer is on it.
      const element = isShowcase && activePopup.getElement();
      if (element) {
        element.addEventListener('mouseenter', pauseShowcaseCountdown);
        element.addEventListener('mouseleave', resumeShowcaseCountdown);
      }
    }

    // Closes the card from our side: the listener comes off first so the
    // handler below only ever runs for a close the visitor triggered.
    function closeProjectCard() {
      if (!activePopup) return;
      const popup = activePopup;
      activePopup = null;
      popup.off('close', handleProjectCardClose);
      popup.remove();
    }

    function handleProjectCardClose() {
      activePopup = null;
      if (showcaseActive) {
        releaseShowcase();
        startSpin();
        return;
      }
      // A card the visitor opened themselves: hold the globe still for a
      // beat after they dismiss it, and don't let the showcase jump in from
      // wherever they left the map.
      showcaseAnchorLng = gridboxMap ? gridboxMap.getCenter().lng : showcaseAnchorLng;
      scheduleSpinResume(SPIN_RESUME_DELAY_MS);
    }

    /* ── Idle rotation ─────────────────────────────────────────────────
       The globe turns slowly on its own so the map reads as a live object
       and so projects come past the centre for the showcase to pick up.
       Anything the visitor does stops it; it resumes once they have been
       idle, and only while they are still looking at the whole world. */
    function prefersReducedMotion() {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function canSpin() {
      return Boolean(
        gridboxMap &&
          activeView === 'map' &&
          mapEl.isConnected &&
          !activePopup &&
          !prefersReducedMotion() &&
          gridboxMap.getZoom() <= SPIN_MAX_ZOOM
      );
    }

    function wrapLongitude(lng) {
      return ((((lng + 180) % 360) + 360) % 360) - 180;
    }

    function startSpin() {
      if (spinFrameId !== null || !canSpin()) return;
      lastSpinFrameTime = 0;
      spinFrameId = window.requestAnimationFrame(stepSpin);
    }

    function stepSpin(timestamp) {
      spinFrameId = null;
      if (!canSpin()) return;

      if (lastSpinFrameTime) {
        const elapsedSeconds = Math.min((timestamp - lastSpinFrameTime) / 1000, MAX_SPIN_FRAME_SECONDS);
        const center = gridboxMap.getCenter();
        // Wrapped rather than left to grow: an unbounded longitude makes a
        // later easeTo animate the long way round the globe.
        center.lng = wrapLongitude(center.lng + SPIN_DEGREES_PER_SECOND * elapsedSeconds);
        gridboxMap.setCenter(center);
        maybeShowcaseProject();
      }

      lastSpinFrameTime = timestamp;
      spinFrameId = window.requestAnimationFrame(stepSpin);
    }

    function stopSpin() {
      if (spinFrameId !== null) {
        window.cancelAnimationFrame(spinFrameId);
        spinFrameId = null;
      }
      lastSpinFrameTime = 0;
    }

    function scheduleSpinResume(delay) {
      window.clearTimeout(spinResumeTimer);
      spinResumeTimer = window.setTimeout(startSpin, delay);
    }

    function pauseSpin(resumeDelay) {
      stopSpin();
      scheduleSpinResume(resumeDelay === undefined ? SPIN_RESUME_DELAY_MS : resumeDelay);
    }

    // A deliberate gesture — dragging, zooming, a click on the map — takes
    // the globe over, so any card the showcase put up is dismissed with it.
    // Hovering a marker only pauses (above): the card under the pointer
    // stays where it is.
    function interruptSpin() {
      cancelShowcase();
      pauseSpin();
    }

    /* ── Auto-showcase ─────────────────────────────────────────────────
       While the globe idles, projects introduce themselves: when a marker
       drifts into the middle of the canvas its card opens, the rotation
       holds still long enough to read it, then it closes and the globe
       carries on. Every project gets a turn before any repeats. */
    function longitudeDistance(a, b) {
      const distance = Math.abs(a - b) % 360;
      return distance > 180 ? 360 - distance : distance;
    }

    function maybeShowcaseProject() {
      if (showcaseActive || activePopup || !currentMapPoints.length) return;

      const canvas = gridboxMap.getCanvas();
      const centerX = canvas.clientWidth / 2;
      const centerLng = gridboxMap.getCenter().lng;
      if (longitudeDistance(centerLng, showcaseAnchorLng) < SHOWCASE_MIN_LNG_GAP) return;

      let nearest = null;
      let nearestDistance = Infinity;

      currentMapPoints.forEach((point) => {
        if (shownShowcaseKeys.has(getPointKey(point))) return;
        // A marker on the far side of the globe still projects onto the
        // canvas, so check the longitude before trusting the projection.
        if (longitudeDistance(point.lng, centerLng) > SHOWCASE_MAX_LNG_DISTANCE) return;

        const projected = gridboxMap.project([point.lng, point.lat]);
        if (projected.y < SHOWCASE_EDGE_PADDING_PX) return;
        if (projected.y > canvas.clientHeight - SHOWCASE_EDGE_PADDING_PX) return;

        const distance = Math.abs(projected.x - centerX);
        if (distance < SHOWCASE_TRIGGER_PX && distance < nearestDistance) {
          nearest = point;
          nearestDistance = distance;
        }
      });

      if (!nearest) return;

      shownShowcaseKeys.add(getPointKey(nearest));
      if (shownShowcaseKeys.size >= currentMapPoints.length) {
        // Everyone has had a turn — start over, keeping the one on screen
        // so it isn't the first to repeat.
        shownShowcaseKeys.clear();
        shownShowcaseKeys.add(getPointKey(nearest));
      }

      showcaseActive = true;
      stopSpin();
      openProjectCard(nearest, [nearest.lng, nearest.lat], { showcase: true });
      showcaseTimer = window.setTimeout(endShowcase, SHOWCASE_HOLD_MS);
    }

    function endShowcase() {
      if (!showcaseActive) return;
      closeProjectCard();
      releaseShowcase();
      startSpin();
    }

    // Drops the showcase's hold on the globe and moves the anchor to wherever
    // the map is now, so the next card is a rotation away rather than one
    // more project at the same longitude.
    function releaseShowcase() {
      window.clearTimeout(showcaseTimer);
      showcaseActive = false;
      if (gridboxMap) showcaseAnchorLng = gridboxMap.getCenter().lng;
    }

    function cancelShowcase() {
      if (showcaseActive) closeProjectCard();
      releaseShowcase();
    }

    function pauseShowcaseCountdown() {
      window.clearTimeout(showcaseTimer);
    }

    function resumeShowcaseCountdown() {
      if (!showcaseActive) return;
      window.clearTimeout(showcaseTimer);
      showcaseTimer = window.setTimeout(endShowcase, SPIN_HOVER_RESUME_DELAY_MS);
    }

    // Leaving the map view: nothing should keep running against a map that
    // is no longer on the page.
    function suspendMapView() {
      cancelShowcase();
      closeProjectCard();
      stopSpin();
      window.clearTimeout(spinResumeTimer);
    }

    function bindMapInteractions(map) {
      map.on('click', 'clusters', (event) => {
        interruptSpin();
        const clusterFeature = map.queryRenderedFeatures(event.point, { layers: ['clusters'] })[0];
        map.getSource('gridbox-locations').getClusterExpansionZoom(clusterFeature.properties.cluster_id, (error, zoom) => {
          if (!error) map.easeTo({ center: clusterFeature.geometry.coordinates, zoom });
        });
      });

      map.on('click', 'unclustered-point', (event) => {
        const pointIndex = event.features[0].properties.idx;
        const item = currentMapPoints[pointIndex];
        if (!item) return;
        openProjectCard(item, event.features[0].geometry.coordinates);
      });

      // Hovering a marker is enough to stop the globe under the pointer, so
      // it can be clicked without chasing it.
      ['clusters', 'unclustered-point'].forEach((layerId) => {
        map.on('mouseenter', layerId, () => {
          map.getCanvas().style.cursor = 'pointer';
          pauseSpin(SPIN_HOVER_RESUME_DELAY_MS);
        });
        map.on('mouseleave', layerId, () => {
          map.getCanvas().style.cursor = '';
          if (!activePopup) scheduleSpinResume(SPIN_HOVER_RESUME_DELAY_MS);
        });
      });

      // movestart also fires for our own setCenter calls — originalEvent is
      // what separates a real gesture from the rotation itself.
      ['mousedown', 'touchstart', 'wheel', 'dragstart', 'zoomstart', 'rotatestart', 'pitchstart'].forEach((eventName) => {
        map.on(eventName, interruptSpin);
      });
      map.on('movestart', (event) => {
        if (event.originalEvent) interruptSpin();
      });
    }

    function switchMapBaseStyle(map) {
      const nextStyle = getCurrentColorMode() === 'dark' ? MAP_STYLE_DARK : MAP_STYLE_LIGHT;
      map.setStyle(nextStyle);
      map.once('style.load', () => {
        addMapLocationLayers(map, buildMapGeoJson(currentMapPoints));
        applyMapThemeColors(map);
        applyMapBackground(map);
        requestAnimationFrame(() => {
          applyMapThemeColors(map);
          applyMapBackground(map);
        });
      });
    }

    function initProjectsMap() {
      if (gridboxMap) {
        refreshMapMarkers();
        requestAnimationFrame(() => {
          gridboxMap.resize();
          startSpin();
        });
        return;
      }
      if (typeof mapboxgl === 'undefined') return;

      const mapContainer = mapEl.querySelector('#map');
      if (!mapContainer) return;

      mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

      currentMapPoints = getMappablePoints(getGridItems({ includeMapOnly: true }));
      const geojson = buildMapGeoJson(currentMapPoints);
      const initialStyle = getCurrentColorMode() === 'dark' ? MAP_STYLE_DARK : MAP_STYLE_LIGHT;

      const map = new mapboxgl.Map({
        container: mapContainer,
        style: initialStyle,
        center: DEFAULT_MAP_CENTER,
        zoom: DEFAULT_MAP_ZOOM,
        projection: 'globe',
      });
      gridboxMap = map;

      map.on('load', () => {
        addMapLocationLayers(map, geojson);
        applyMapThemeColors(map);
        applyMapBackground(map);
        bindMapInteractions(map);
        requestAnimationFrame(() => {
          map.resize();
          startSpin();
        });

        const themeObserver = new MutationObserver(() => switchMapBaseStyle(map));
        themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
      });
    }

    function setActiveViewButton(display) {
      viewButtons.forEach((button) => {
        const isActive = getViewFromButton(button) === display;
        button.classList.toggle('vb-active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
      });
    }

    function setActiveView(display) {
      activeView = display;
      root.setAttribute('data-view', display);
      setActiveViewButton(display);
      gridEl.hidden = display !== 'grid';
      if (display !== 'map') suspendMapView();

      if (display === 'grid') mountActiveView(null);
      if (display === 'list') {
        renderListView();
        mountActiveView(listEl);
      }
      if (display === 'map') {
        mountActiveView(mapEl);
        loadMapboxAssets()
          .then(initProjectsMap)
          .catch((error) => console.error(error));
      }
    }

    function getViewFromButton(button) {
      if (button.classList.contains('view-button--list')) return 'list';
      if (button.classList.contains('view-button--map')) return 'map';
      return 'grid';
    }

    function initViewButtons() {
      viewButtons.forEach((button) => {
        button.addEventListener('click', (event) => {
          event.preventDefault();
          const display = getViewFromButton(button);
          const url = new URL(window.location);
          url.searchParams.set('display', display);
          window.history.replaceState({}, '', url);
          setActiveView(display);
        });
      });
    }

    markMapOnlyItems();
    observeGridChanges();
    initViewButtons();
    initScrollHoverGuard();

    const params = new URLSearchParams(window.location.search);
    setActiveView(params.get('display') || 'grid');
  }

  // Loaded from a CDN, so this may run either before or after
  // DOMContentLoaded depending on where the <script> ends up in Webflow's
  // output. Cover both, and refuse to run twice if the tag is ever
  // duplicated across embeds.
  if (window.__aigProjectsGridboxLoaded) return;
  window.__aigProjectsGridboxLoaded = true;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initProjectsGridbox);
  } else {
    initProjectsGridbox();
  }
})();
