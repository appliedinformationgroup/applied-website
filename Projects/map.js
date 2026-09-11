/**
 * Applied Information Group — Projects page map.
 *
 * Hosted here and loaded on the Webflow Projects page via jsDelivr:
 *   <script src="https://cdn.jsdelivr.net/gh/appliedinformationgroup/applied-website@main/Projects/map.js"></script>
 *
 * Everything Mapbox, and nothing else. The page's grid, list, view switcher
 * and URL handling stay in the page's own embed, which hands projects over
 * and says when the map is on screen. The two meet at window.AIGProjectsMap:
 *
 *   mount(container, points)  — show the map in `container`, loading Mapbox
 *                               GL on first use. Returns a Promise.
 *   update(points)            — new data after filtering or sorting. Safe to
 *                               call before the first mount; it just records
 *                               the points for when the map appears.
 *   unmount()                 — leaving the map view: stops the rotation and
 *                               closes any open card. The map itself is kept
 *                               so coming back is instant.
 *   getMap()                  — the Mapbox map, or null. An escape hatch for
 *                               one-off work from the page; this module does
 *                               not need it.
 *
 * A point is a plain object. Only lat and lng are required, the rest fill in
 * the card:
 *   { lat, lng, name, href, imgSrc, city, country }
 *
 * What the map does beyond showing markers:
 *   - a project's card opens in a panel along the bottom of the map, not in
 *     a bubble pinned to its marker — and that marker, or the cluster hiding
 *     it, lights up in the highlight colour while the card is up;
 *   - it's drawn on the page's own background colour rather than Mapbox's
 *     starfield, and follows the light/dark switch;
 *   - the globe turns slowly while idle, and stops the moment the visitor
 *     touches it, hovers a marker, or opens a project card;
 *   - while it turns, projects introduce themselves — a marker reaching the
 *     middle of the canvas opens its card for a few seconds, working through
 *     every project before any repeats.
 *
 * The map's CSS lives in its own page embed in Webflow — see the README.
 */
(function () {
  'use strict';

  if (window.AIGProjectsMap) return;

  const MAPBOX_VERSION = 'v3.2.0';
  const MAPBOX_CSS_URL = 'https://api.mapbox.com/mapbox-gl-js/' + MAPBOX_VERSION + '/mapbox-gl.css';
  const MAPBOX_JS_URL = 'https://api.mapbox.com/mapbox-gl-js/' + MAPBOX_VERSION + '/mapbox-gl.js';
  const MAPBOX_ACCESS_TOKEN =
    'pk.eyJ1IjoiYXBwbGllZC1pbmZvcm1hdGlvbi1ncm91cCIsImEiOiJjbGQxamI1c2gwZGZ2M25ueTFrcjl3cDE0In0.Ix4iBQ6SUwqdokXuPcFrRw';
  const MAP_STYLE_LIGHT = 'mapbox://styles/mapbox/light-v11';
  const MAP_STYLE_DARK = 'mapbox://styles/mapbox/dark-v11';
  const DEFAULT_MAP_CENTER = [0, 15];
  const DEFAULT_MAP_ZOOM = 2;
  const CLUSTER_MAX_ZOOM = 14;
  const CLUSTER_RADIUS = 50;
  const MARKER_RADIUS = 8;
  const CLUSTER_COLOR_FALLBACK = '#636366';
  const CLUSTER_TEXT_COLOR_FALLBACK = '#ffffff';
  // The marker whose card is open, and the cluster it's hiding inside, light
  // up in this colour. Set --_colors---map-marker-active on the page to
  // change it without touching this file.
  const MARKER_ACTIVE_COLOR_FALLBACK = '#34C759';
  const MARKER_ACTIVE_RADIUS = 11;
  const MAP_BACKGROUND_FALLBACK = '#fafafa';
  // How softly the globe's edge fades into that background colour.
  const MAP_HORIZON_BLEND = 0.04;
  // Idle rotation. Degrees per second (not per frame) so the globe turns at
  // the same rate on a 60Hz and a 120Hz display; the per-frame delta is
  // clamped so a backgrounded tab doesn't jump on return.
  const SPIN_DEGREES_PER_SECOND = 3;
  const MAX_SPIN_FRAME_SECONDS = 0.1;
  // Idle time after any interaction before the rotation picks up again.
  const SPIN_RESUME_DELAY_MS = 5000;
  // Shorter, because leaving a marker is a much weaker signal of intent than
  // dragging or zooming the map.
  const SPIN_HOVER_RESUME_DELAY_MS = 1500;
  // Past this zoom the visitor is looking at somewhere specific, so the globe
  // stays where they put it.
  const SPIN_MAX_ZOOM = 4;
  // Auto-showcase: how close to the vertical centre line a marker has to
  // drift before its card opens, and how long that card is held open.
  const SHOWCASE_TRIGGER_PX = 60;
  const SHOWCASE_EDGE_PADDING_PX = 80;
  const SHOWCASE_HOLD_MS = 4000;
  // How far the globe has to turn between cards. Paced in degrees rather than
  // seconds on purpose: a dozen projects can sit on nearly the same longitude
  // (London alone has more than that), and a plain timer lets them fire one
  // after another without the globe ever moving. At the rotation speed above
  // this is roughly eight seconds of travel.
  const SHOWCASE_MIN_LNG_GAP = 25;
  // A marker on the far side of the globe still projects onto the canvas, so
  // anything more than a quarter turn from the centre is ignored.
  const SHOWCASE_MAX_LNG_DISTANCE = 90;

  let mapboxLoadPromise = null;
  let map = null;
  let mapContainer = null;
  let mounted = false;
  let currentPoints = [];
  let panel = null;
  let panelContent = null;
  let cardOpen = false;
  let activePoint = null;
  let activeKey = null;
  let activeClusterId = null;
  let spinFrameId = null;
  let spinResumeTimer = null;
  let lastSpinFrameTime = 0;
  let showcaseActive = false;
  let showcaseTimer = null;
  // Centre longitude the globe has to travel away from before the next card
  // may open. Seeded with the starting centre so the map is seen turning
  // before the first project introduces itself.
  let showcaseAnchorLng = DEFAULT_MAP_CENTER[0];
  const shownShowcaseKeys = new Set();

  /* ── Mapbox GL, fetched on first use ─────────────────────────────────── */
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

  /* ── Points ──────────────────────────────────────────────────────────── */
  function normalisePoints(points) {
    return (points || [])
      .filter((point) => point && isFinite(Number(point.lat)) && isFinite(Number(point.lng)))
      .map((point) => Object.assign({}, point, { lat: Number(point.lat), lng: Number(point.lng) }));
  }

  function getPointKey(point) {
    return (point.href || '') + '|' + (point.name || '');
  }

  function buildGeoJson(points) {
    return {
      type: 'FeatureCollection',
      features: points.map((point, index) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [point.lng, point.lat] },
        properties: { idx: index, key: getPointKey(point) },
      })),
    };
  }

  /* ── Theme ───────────────────────────────────────────────────────────── */
  function getCurrentColorMode() {
    return document.body.classList.contains('u-dark-mode') ? 'dark' : 'light';
  }

  // Read off <body>, not <html>: the site's dark-mode overrides are declared
  // on `body.u-dark-mode`, so the same lookup against document.documentElement
  // always returns the light-mode value. An unresolved var() means the token
  // is missing — hand back an empty string so the caller's fallback wins.
  function getCssVariable(name) {
    const value = getComputedStyle(document.body).getPropertyValue(name).trim();
    return value.indexOf('var(') === 0 ? '' : value;
  }

  // The globe is drawn against the page's own background colour instead of
  // Mapbox's default starfield, so it reads as part of the page in both light
  // and dark mode. Re-run after every style switch — setStyle resets the
  // atmosphere along with everything else.
  function applyMapBackground() {
    const backgroundColor = getCssVariable('--_colors---background--primary') || MAP_BACKGROUND_FALLBACK;
    map.setFog({
      color: backgroundColor,
      'high-color': backgroundColor,
      'space-color': backgroundColor,
      'horizon-blend': MAP_HORIZON_BLEND,
      'star-intensity': 0,
    });
  }

  function applyThemeColors() {
    const clusterTextColor = getCssVariable('--_colors---text--inverse') || CLUSTER_TEXT_COLOR_FALLBACK;
    if (map.getLayer('cluster-count')) {
      map.setPaintProperty('cluster-count', 'text-color', clusterTextColor);
    }
    applyMarkerColors();
  }

  /* ── The highlighted project ─────────────────────────────────────────────
     While a card is open its marker is painted in the highlight colour and
     drawn a little larger. At world zoom most projects are inside a cluster
     rather than on their own, so the cluster holding it lights up instead —
     otherwise the card would point at nothing. */
  function applyMarkerColors() {
    if (!map) return;
    const markerColor = getCssVariable('--_colors---forground--primary') || CLUSTER_COLOR_FALLBACK;
    const activeColor = getCssVariable('--_colors---map-marker-active') || MARKER_ACTIVE_COLOR_FALLBACK;

    if (map.getLayer('unclustered-point')) {
      map.setPaintProperty(
        'unclustered-point',
        'circle-color',
        activeKey ? ['case', ['==', ['get', 'key'], activeKey], activeColor, markerColor] : markerColor
      );
      map.setPaintProperty(
        'unclustered-point',
        'circle-radius',
        activeKey ? ['case', ['==', ['get', 'key'], activeKey], MARKER_ACTIVE_RADIUS, MARKER_RADIUS] : MARKER_RADIUS
      );
    }

    if (map.getLayer('clusters')) {
      map.setPaintProperty(
        'clusters',
        'circle-color',
        activeClusterId === null
          ? markerColor
          : ['case', ['==', ['get', 'cluster_id'], activeClusterId], activeColor, markerColor]
      );
    }
  }

  function setActiveProject(point) {
    activePoint = point || null;
    activeKey = point ? getPointKey(point) : null;
    activeClusterId = null;
    applyMarkerColors();
    if (activeKey) findActiveCluster(activeKey);
  }

  // Which cluster on screen contains the highlighted project. Answered one
  // cluster at a time by the source, asynchronously, so every callback
  // re-checks that the same card is still open before painting.
  function findActiveCluster(key) {
    const source = map.getSource('gridbox-locations');
    if (!source || !map.getLayer('clusters')) return;

    map.queryRenderedFeatures(undefined, { layers: ['clusters'] }).forEach((cluster) => {
      source.getClusterLeaves(cluster.properties.cluster_id, Infinity, 0, (error, leaves) => {
        if (error || !leaves) return;
        if (activeKey !== key) return;
        if (!leaves.some((leaf) => leaf.properties.key === key)) return;
        activeClusterId = cluster.properties.cluster_id;
        applyMarkerColors();
      });
    });
  }

  /* ── Source + layers ─────────────────────────────────────────────────── */
  function addLocationLayers(geojson) {
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
          'circle-color': CLUSTER_COLOR_FALLBACK,
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
        paint: { 'text-color': CLUSTER_TEXT_COLOR_FALLBACK },
      });
    }

    if (!map.getLayer('unclustered-point')) {
      map.addLayer({
        id: 'unclustered-point',
        type: 'circle',
        source: 'gridbox-locations',
        filter: ['!', ['has', 'point_count']],
        paint: { 'circle-color': CLUSTER_COLOR_FALLBACK, 'circle-radius': MARKER_RADIUS },
      });
    }
  }

  /* ── Project card ────────────────────────────────────────────────────── */
  // CMS text goes into markup here, so a project named Bloomberg "Vault" or
  // an ampersand in a city doesn't break the card.
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatLocation(point) {
    return [point.city, point.country]
      .map((part) => (part || '').trim())
      .filter(Boolean)
      .join(', ');
  }

  function buildCardMarkup(point) {
    const location = formatLocation(point);
    const name = escapeHtml(point.name);

    return (
      '<a class="map-popup-card" href="' +
      escapeHtml(point.href || '#') +
      '">' +
      (point.imgSrc ? '<img class="map-popup-card_image" src="' + escapeHtml(point.imgSrc) + '" alt="' + name + '">' : '') +
      '<span class="map-popup-card_body">' +
      '<span class="map-popup-card_title">' +
      name +
      '</span>' +
      (location ? '<span class="map-popup-card_desc">' + escapeHtml(location) + '</span>' : '') +
      '</span>' +
      '</a>'
    );
  }

  /* ── The card panel ──────────────────────────────────────────────────────
     One card at a time, whether a click or the showcase opened it. It sits in
     a panel along the bottom edge of the map rather than in a bubble pinned
     to the marker, so a long name or a wide photo has somewhere to go and the
     card never covers the part of the globe you're looking at. The marker it
     belongs to lights up instead (see setActiveProject above).

     The panel is built here rather than in the Designer: it belongs to the
     map, and this way there is nothing to keep in sync in Webflow. */
  function ensurePanel(container) {
    if (panel && panel.isConnected) return panel;

    const host = (container && container.parentElement) || container;
    if (!host) return null;

    panel = host.querySelector('.map-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'map-panel';
      panel.innerHTML =
        '<button type="button" class="map-panel_close" aria-label="Close">&times;</button>' +
        '<div class="map-panel_content"></div>';
      host.appendChild(panel);
    }

    panelContent = panel.querySelector('.map-panel_content');

    if (!panel.dataset.bound) {
      panel.dataset.bound = 'true';
      panel.querySelector('.map-panel_close').addEventListener('click', closeCard);
      // Reading a card the map opened by itself keeps it up for as long as
      // the pointer is on it.
      panel.addEventListener('mouseenter', pauseShowcaseCountdown);
      panel.addEventListener('mouseleave', resumeShowcaseCountdown);
    }

    return panel;
  }

  function openCard(point, options) {
    const isShowcase = Boolean(options && options.showcase);
    if (!isShowcase) cancelShowcase();
    if (!ensurePanel(mapContainer)) return;

    stopSpin();
    window.clearTimeout(spinResumeTimer);

    panelContent.innerHTML = buildCardMarkup(point);
    panel.classList.toggle('is-auto', isShowcase);
    panel.classList.add('is-open');
    cardOpen = true;
    setActiveProject(point);
  }

  function closeCard() {
    if (!cardOpen) return;
    cardOpen = false;
    if (panel) panel.classList.remove('is-open');
    setActiveProject(null);

    if (showcaseActive) {
      releaseShowcase();
      startSpin();
      return;
    }
    // A card the visitor opened themselves: hold the globe still for a beat
    // after they dismiss it, and don't let the showcase jump in from wherever
    // they left the map.
    if (map) showcaseAnchorLng = map.getCenter().lng;
    scheduleSpinResume(SPIN_RESUME_DELAY_MS);
  }

  /* ── Idle rotation ───────────────────────────────────────────────────────
     The globe turns slowly on its own so the map reads as a live object and
     so projects come past the centre for the showcase to pick up. Anything
     the visitor does stops it; it resumes once they have been idle, and only
     while they are still looking at the whole world. */
  function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function canSpin() {
    return Boolean(
      map &&
        mounted &&
        mapContainer &&
        mapContainer.isConnected &&
        !cardOpen &&
        !prefersReducedMotion() &&
        map.getZoom() <= SPIN_MAX_ZOOM
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
      const center = map.getCenter();
      // Wrapped rather than left to grow: an unbounded longitude makes a
      // later easeTo animate the long way round the globe.
      center.lng = wrapLongitude(center.lng + SPIN_DEGREES_PER_SECOND * elapsedSeconds);
      map.setCenter(center);
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

  // A deliberate gesture — dragging, zooming, a click on the map — takes the
  // globe over, so any card the showcase put up is dismissed with it.
  // Hovering a marker only pauses (above): the card under the pointer stays
  // where it is.
  function interruptSpin() {
    cancelShowcase();
    pauseSpin();
  }

  /* ── Auto-showcase ───────────────────────────────────────────────────────
     While the globe idles, projects introduce themselves: when a marker
     drifts into the middle of the canvas its card opens, the rotation holds
     still long enough to read it, then it closes and the globe carries on.
     Every project gets a turn before any repeats. */
  function longitudeDistance(a, b) {
    const distance = Math.abs(a - b) % 360;
    return distance > 180 ? 360 - distance : distance;
  }

  function maybeShowcaseProject() {
    if (showcaseActive || cardOpen || !currentPoints.length) return;

    const canvas = map.getCanvas();
    const centerX = canvas.clientWidth / 2;
    const centerLng = map.getCenter().lng;
    if (longitudeDistance(centerLng, showcaseAnchorLng) < SHOWCASE_MIN_LNG_GAP) return;

    let nearest = null;
    let nearestDistance = Infinity;

    currentPoints.forEach((point) => {
      if (shownShowcaseKeys.has(getPointKey(point))) return;
      // A marker on the far side of the globe still projects onto the canvas,
      // so check the longitude before trusting the projection.
      if (longitudeDistance(point.lng, centerLng) > SHOWCASE_MAX_LNG_DISTANCE) return;

      const projected = map.project([point.lng, point.lat]);
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
    if (shownShowcaseKeys.size >= currentPoints.length) {
      // Everyone has had a turn — start over, keeping the one on screen so it
      // isn't the first to repeat.
      shownShowcaseKeys.clear();
      shownShowcaseKeys.add(getPointKey(nearest));
    }

    showcaseActive = true;
    stopSpin();
    openCard(nearest, { showcase: true });
    showcaseTimer = window.setTimeout(endShowcase, SHOWCASE_HOLD_MS);
  }

  function endShowcase() {
    if (!showcaseActive) return;
    // closeCard sees showcaseActive and hands the globe back itself.
    closeCard();
  }

  // Drops the showcase's hold on the globe and moves the anchor to wherever
  // the map is now, so the next card is a rotation away rather than one more
  // project at the same longitude.
  function releaseShowcase() {
    window.clearTimeout(showcaseTimer);
    showcaseActive = false;
    if (map) showcaseAnchorLng = map.getCenter().lng;
  }

  function cancelShowcase() {
    if (showcaseActive) closeCard();
    releaseShowcase();
  }

  function isCardOpen() {
    return cardOpen;
  }

  function pauseShowcaseCountdown() {
    window.clearTimeout(showcaseTimer);
  }

  function resumeShowcaseCountdown() {
    if (!showcaseActive) return;
    window.clearTimeout(showcaseTimer);
    showcaseTimer = window.setTimeout(endShowcase, SPIN_HOVER_RESUME_DELAY_MS);
  }

  /* ── Interactions ────────────────────────────────────────────────────── */
  function bindInteractions() {
    map.on('click', 'clusters', (event) => {
      interruptSpin();
      const clusterFeature = map.queryRenderedFeatures(event.point, { layers: ['clusters'] })[0];
      if (!clusterFeature) return;
      map
        .getSource('gridbox-locations')
        .getClusterExpansionZoom(clusterFeature.properties.cluster_id, (error, zoom) => {
          if (!error) map.easeTo({ center: clusterFeature.geometry.coordinates, zoom });
        });
    });

    map.on('click', 'unclustered-point', (event) => {
      const point = currentPoints[event.features[0].properties.idx];
      if (!point) return;
      openCard(point);
    });

    // A click on the globe itself, away from any marker, puts the card away —
    // the panel has a close button, but this is the gesture people reach for.
    map.on('click', (event) => {
      if (!cardOpen) return;
      const layers = ['clusters', 'unclustered-point'].filter((id) => map.getLayer(id));
      if (layers.length && map.queryRenderedFeatures(event.point, { layers: layers }).length) return;
      closeCard();
    });

    // Hovering a marker is enough to stop the globe under the pointer, so it
    // can be clicked without chasing it.
    ['clusters', 'unclustered-point'].forEach((layerId) => {
      map.on('mouseenter', layerId, () => {
        map.getCanvas().style.cursor = 'pointer';
        pauseSpin(SPIN_HOVER_RESUME_DELAY_MS);
      });
      map.on('mouseleave', layerId, () => {
        map.getCanvas().style.cursor = '';
        if (!cardOpen) scheduleSpinResume(SPIN_HOVER_RESUME_DELAY_MS);
      });
    });

    // movestart also fires for our own setCenter calls — originalEvent is
    // what separates a real gesture from the rotation itself.
    ['mousedown', 'touchstart', 'wheel', 'dragstart', 'zoomstart', 'rotatestart', 'pitchstart'].forEach(
      (eventName) => {
        map.on(eventName, interruptSpin);
      }
    );
    map.on('movestart', (event) => {
      if (event.originalEvent) interruptSpin();
    });
  }

  function switchBaseStyle() {
    map.setStyle(getCurrentColorMode() === 'dark' ? MAP_STYLE_DARK : MAP_STYLE_LIGHT);
    map.once('style.load', () => {
      addLocationLayers(buildGeoJson(currentPoints));
      applyThemeColors();
      applyMapBackground();
      window.requestAnimationFrame(() => {
        applyThemeColors();
        applyMapBackground();
        if (cardOpen) setActiveProject(activePoint);
      });
    });
  }

  function createMap(container) {
    mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;
    mapContainer = container;

    map = new mapboxgl.Map({
      container: container,
      style: getCurrentColorMode() === 'dark' ? MAP_STYLE_DARK : MAP_STYLE_LIGHT,
      center: DEFAULT_MAP_CENTER,
      zoom: DEFAULT_MAP_ZOOM,
      projection: 'globe',
    });

    map.on('load', () => {
      addLocationLayers(buildGeoJson(currentPoints));
      applyThemeColors();
      applyMapBackground();
      bindInteractions();
      window.requestAnimationFrame(() => {
        map.resize();
        startSpin();
      });

      const themeObserver = new MutationObserver(switchBaseStyle);
      themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    });

    return map;
  }

  /* ── Public interface ────────────────────────────────────────────────── */
  function mount(container, points) {
    if (points) setPoints(points);
    mounted = true;
    ensurePanel(container || mapContainer);

    if (map) {
      window.requestAnimationFrame(() => {
        map.resize();
        startSpin();
      });
      return Promise.resolve(map);
    }

    if (!container) return Promise.reject(new Error('AIGProjectsMap.mount needs a container element'));

    return loadMapboxAssets().then(() => {
      if (typeof mapboxgl === 'undefined') throw new Error('Mapbox GL did not define mapboxgl');
      return map || createMap(container);
    });
  }

  function setPoints(points) {
    currentPoints = normalisePoints(points);
    // Filtering changes which projects exist, so the showcase starts its
    // rotation over against the new set rather than carrying stale keys.
    shownShowcaseKeys.clear();
  }

  function update(points) {
    setPoints(points);
    if (!map || !map.getSource('gridbox-locations')) return;
    map.getSource('gridbox-locations').setData(buildGeoJson(currentPoints));
  }

  // Nothing should keep running against a map that is no longer on screen.
  // The map instance is kept, so coming back is instant.
  function unmount() {
    mounted = false;
    cancelShowcase();
    closeCard();
    stopSpin();
    window.clearTimeout(spinResumeTimer);
  }

  window.AIGProjectsMap = {
    mount: mount,
    update: update,
    unmount: unmount,
    getMap: function () {
      return map;
    },
    isCardOpen: isCardOpen,
  };
})();
