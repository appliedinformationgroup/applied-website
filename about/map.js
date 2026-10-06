window.initProjectsMap = function () {
    if (window.aigMap) return window.aigMap;
    if (typeof mapboxgl === 'undefined') return;

    mapboxgl.accessToken = 'pk.eyJ1IjoiYXBwbGllZC1pbmZvcm1hdGlvbi1ncm91cCIsImEiOiJjbGQxamI1c2gwZGZ2M25ueTFrcjl3cDE0In0.Ix4iBQ6SUwqdokXuPcFrRw';

    const mapEl = document.getElementById('map');
    if (!mapEl) return;

    /* One style for both light and dark mode — its layer visibility is
       managed in Mapbox Studio, so the JS never swaps or edits it. Only the
       layers this script adds itself are recoloured when the mode changes. */
    const MAP_STYLE = 'mapbox://styles/applied-information-group/cmc3jjpo7008x01sb3evl6jlb';

    /* ── World-fit camera ──
       Always shows this same lat/lng box, sized to whatever the container's
       current pixel dimensions are — a fixed zoom can't do that, since how
       much of the world it shows scales with container size, not just its
       aspect ratio. Cropped short of the true poles (Mercator can't reach
       ±90° anyway) to skip mostly-empty Antarctica/high-Arctic space and
       keep markers larger within the box. Recomputed on every resize since
       the container can change size at any breakpoint. */
    const WORLD_BOUNDS = [
      [-180, -55], // southwest
      [180, 75], // northeast
    ];
    const WORLD_FIT_OPTIONS = { padding: 16, animate: false };

    /* White ring around every project and office dot, drawn outside the
       dot's radius. */
    const DOT_OUTLINE_WIDTH = 1;
    const DOT_OUTLINE_COLOR = '#FFFFFF';

    /* Country polygons with a CONTINENT property, from Natural Earth (public domain). */
    const CONTINENTS_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson';

    /* ── Continent lookup for the counts (UN M49 region codes → continent name) ── */
    const CONTINENT_ORDER = [
      'Africa',
      'Antarctica',
      'Asia',
      'Europe',
      'North America',
      'Oceania',
      'South America',
    ];

    const M49_CONTINENT = [
      ['005', 'South America'],
      ['021', 'North America'],
      ['013', 'North America'],
      ['029', 'North America'],
      ['003', 'North America'],
      ['002', 'Africa'],
      ['009', 'Oceania'],
      ['142', 'Asia'],
      ['150', 'Europe'],
      ['010', 'Antarctica'],
    ];

    function continentFromGroups(groups) {
      const codes = new Set((groups || []).filter((code) => /^\d{3}$/.test(code)));
      for (let i = 0; i < M49_CONTINENT.length; i++) {
        if (codes.has(M49_CONTINENT[i][0])) return M49_CONTINENT[i][1];
      }
      return null;
    }

    function lookupContinent(lng, lat) {
      if (typeof countryCoder === 'undefined') return null;

      const features = countryCoder.featuresContaining([lng, lat], true);
      for (let i = 0; i < features.length; i++) {
        const continent = continentFromGroups(features[i].properties.groups);
        if (continent) return continent;
      }

      const match = countryCoder.feature([lng, lat]);
      return continentFromGroups(match && match.properties && match.properties.groups);
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function currentMode() {
      const b = document.body;
      if (!b) return 'light';
      if (b.classList.contains('u-dark-mode')) return 'dark';
      if (b.classList.contains('u-light-mode')) return 'light';
      return 'light';
    }

    function cssVar(name) {
      return getComputedStyle(document.body).getPropertyValue(name).trim();
    }

    /* Projects stay black in both modes; offices and the continent highlight
       share the highlight colour (the basemap is green, so it isn't green). */
    function getThemeColors() {
      const highlight = cssVar('--map--highlight') || '#FF3B30';
      return {
        marker: cssVar('--neutral--950') || '#0A0A0A',
        markerActive: highlight,
        officeMarker: highlight,
        daynightColor: cssVar('--map-daynight-color') || '#000000',
        daynightOpacity: parseFloat(cssVar('--map-daynight-opacity')) || 0.18,
      };
    }

    /* ── Build GeoJSON from hidden CMS inputs, tagging each with its continent ──

       A Collection List repeats its embed once per item, so an id on those
       inputs is duplicated across every project and office. The fields are
       matched on data-* attributes instead, read relative to the item they sit
       in. The legacy id selectors are kept as fallbacks so a cached copy of
       this script still finds embeds that have not been republished yet.

       Webflow also caps an unpaginated Collection List at 100 rendered items,
       so a list past that size needs pagination enabled in the Designer. Once
       it is, this follows the list's own "Next" link (Webflow's standard
       .w-pagination-next, stable across sites) and fetches/merges each
       further page in the background — the map paints with whatever is on
       the page immediately, then fills in as later pages arrive. A list
       without pagination just resolves after the one page, unchanged from
       before. */
    const FIELD_SELECTORS = {
      id: '[data-location-id], #locationID, #officeLocationID',
      latitude: '[data-location-latitude], #locationLatitude, #officeLocationLatitude',
      longitude: '[data-location-longitude], #locationLongitude, #officeLocationLongitude',
      name: '[data-location-name], #locationName, #officeLocationName',
    };

    function parseFeatures(list, withContinent) {
      const features = [];

      list.querySelectorAll(FIELD_SELECTORS.latitude).forEach((latEl) => {
        const scope = latEl.closest('.w-dyn-item') || latEl.parentElement || list;
        const lat = latEl.value;
        const lng = scope.querySelector(FIELD_SELECTORS.longitude)?.value;
        const name = scope.querySelector(FIELD_SELECTORS.name)?.value;
        const id = scope.querySelector(FIELD_SELECTORS.id)?.value;

        if (!lat || !lng) return;

        const properties = { name: name || id || '' };
        if (withContinent) {
          properties.continent = lookupContinent(Number(lng), Number(lat));
        }

        features.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [Number(lng), Number(lat)],
          },
          properties,
        });
      });

      return features;
    }

    function nextPageHref(list) {
      const wrapper = list.closest('.w-dyn-list') || list.parentElement;
      const nextLink = wrapper ? wrapper.querySelector('.w-pagination-next[href]') : null;
      const href = nextLink && nextLink.getAttribute('href');
      return href && href !== '#' ? href : null;
    }

    /* Resolves with every feature across all pages. Never throws — a failed
       fetch/parse on a later page just stops there and returns what has been
       gathered so far. */
    async function collectFeatures(listId, withContinent) {
      const list = document.getElementById(listId);
      if (!list) return [];

      let features = parseFeatures(list, withContinent);
      let href = nextPageHref(list);
      const visited = new Set();
      let guard = 0;

      while (href && !visited.has(href) && guard < 25) {
        visited.add(href);
        guard += 1;

        let doc;
        try {
          const res = await fetch(href, { credentials: 'same-origin' });
          if (!res.ok) break;
          doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        } catch (err) {
          console.warn('[aig-map] pagination fetch failed, stopping at page ' + (guard + 1) + ':', err.message);
          break;
        }

        const pageList = doc.getElementById(listId);
        if (!pageList) break;

        features = features.concat(parseFeatures(pageList, withContinent));
        href = nextPageHref(pageList);
      }

      return features;
    }

    const mapLocations = { type: 'FeatureCollection', features: [] };
    const officeLocations = { type: 'FeatureCollection', features: [] };

    /* ── Continent stats panel ── */
    function countByContinent(features) {
      const counts = Object.fromEntries(CONTINENT_ORDER.map((name) => [name, 0]));
      features.forEach((feat) => {
        const c = feat.properties.continent;
        if (c && c in counts) counts[c] += 1;
      });
      return counts;
    }

    function renderContinentStats(counts) {
      const el = document.getElementById('continent-stats');
      if (!el) return;

      if (!el.dataset.hoverBound) {
        el.dataset.hoverBound = 'true';

        const rowFromEvent = (event) => {
          const target = event.target;
          if (!target || !target.closest) return null;
          return target.closest('tr[data-continent]');
        };

        el.addEventListener('mouseover', (event) => {
          const row = rowFromEvent(event);
          if (!row) return;
          row.classList.add('is-hovered');
          if (typeof window.aigHighlightContinent === 'function') {
            window.aigHighlightContinent(row.dataset.continent);
          }
        });

        el.addEventListener('mouseout', (event) => {
          const row = rowFromEvent(event);
          if (!row) return;
          const next = event.relatedTarget;
          if (next && row.contains(next)) return;
          row.classList.remove('is-hovered');
          if (typeof window.aigClearContinentHighlight === 'function') {
            window.aigClearContinentHighlight();
          }
        });
      }

      const rows = CONTINENT_ORDER.filter((name) => counts[name] > 0)
        .map(
          (name) =>
            '<tr data-continent="' +
            escapeHtml(name) +
            '"><th scope="row">' +
            escapeHtml(name) +
            '</th><td>' +
            counts[name] +
            '</td></tr>'
        )
        .join('');

      if (!rows) {
        el.hidden = true;
        el.innerHTML = '';
        return;
      }

      el.hidden = false;
      el.innerHTML =
  '<table class="continent-stats_table">' +
  '<thead><tr><th scope="col">Continent</th><th scope="col">Projects</th></tr></thead>' +
  '<tbody>' + rows + '</tbody>' +
  '</table>';
    }

    /* ── Continent polygon highlight ── */
    let continentShapes = { type: 'FeatureCollection', features: [] };
    let hoveredContinent = null;
    const NO_CONTINENT_FILTER = ['==', ['get', 'CONTINENT'], '__none__'];

    function continentFilter() {
      return hoveredContinent ? ['==', ['get', 'CONTINENT'], hoveredContinent] : NO_CONTINENT_FILTER;
    }

    function addContinentLayers(map) {
      if (!continentShapes.features.length) return;

      const colors = getThemeColors();
      const beforeId = map.getLayer('locations-points') ? 'locations-points' : undefined;

      if (!map.getSource('continents')) {
        map.addSource('continents', { type: 'geojson', data: continentShapes });
      } else {
        map.getSource('continents').setData(continentShapes);
      }

      if (!map.getLayer('continent-fill')) {
        map.addLayer(
          {
            id: 'continent-fill',
            type: 'fill',
            source: 'continents',
            filter: continentFilter(),
            paint: {
              'fill-color': colors.markerActive,
              'fill-opacity': 0.18,
            },
          },
          beforeId
        );
      } else {
        map.setPaintProperty('continent-fill', 'fill-color', colors.markerActive);
        map.setFilter('continent-fill', continentFilter());
      }

      if (!map.getLayer('continent-outline')) {
        map.addLayer(
          {
            id: 'continent-outline',
            type: 'line',
            source: 'continents',
            filter: continentFilter(),
            paint: {
              'line-color': colors.markerActive,
              'line-width': 1,
              'line-opacity': 0.6,
            },
          },
          beforeId
        );
      } else {
        map.setPaintProperty('continent-outline', 'line-color', colors.markerActive);
        map.setFilter('continent-outline', continentFilter());
      }
    }

    /* ── Day/night shading ──
       A smooth twilight gradient rather than a hard-edged night polygon:
       each pixel's darkness follows how far the sun is below the horizon
       there, easing from sunset (0°) to full night at TWILIGHT_DEGREES
       below it (18° is astronomical twilight, the real end of dusk). It's
       painted into a small image the GPU stretches over the map, so the
       fade is seamless, and there's no polygon for Mapbox to mis-fill —
       the old one could draw stray wedges as the sun moved. Full night is
       --map-daynight-color at --map-daynight-opacity. */
    const TWILIGHT_DEGREES = 18;
    const DAYNIGHT_IMAGE_SIZE = 256;
    const MERCATOR_MAX_LAT = 85.051129;
    const DAYNIGHT_COORDINATES = [
      [-180, MERCATOR_MAX_LAT],
      [180, MERCATOR_MAX_LAT],
      [180, -MERCATOR_MAX_LAT],
      [-180, -MERCATOR_MAX_LAT],
    ];
    const DEG = Math.PI / 180;

    /* Where the sun is directly overhead: its declination (as a latitude)
       and the longitude it's over, from the standard low-precision solar
       formulas — accurate to well under 0.1°, far finer than a pixel. */
    function subsolarPoint(date) {
      const d = date.getTime() / 86400000 - 10957.5; // days since J2000.0
      const g = (357.529 + 0.98560028 * d) * DEG; // mean anomaly
      const q = 280.459 + 0.98564736 * d; // mean longitude
      const lambda = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG; // ecliptic longitude
      const epsilon = (23.439 - 0.00000036 * d) * DEG; // axial tilt
      const rightAscension = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda)) / DEG;
      const declination = Math.asin(Math.sin(epsilon) * Math.sin(lambda)) / DEG;
      const siderealTime = 280.46061837 + 360.98564736629 * d; // at Greenwich

      let lng = (rightAscension - siderealTime) % 360;
      if (lng > 180) lng -= 360;
      if (lng < -180) lng += 360;
      return { lat: declination, lng };
    }

    /* Any CSS colour (hex, rgb, hsl, oklch…) → [r, g, b, a] bytes. */
    function colorToRgba(color) {
      const ctx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d');
      ctx.fillStyle = '#000000';
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      return ctx.getImageData(0, 0, 1, 1).data;
    }

    function renderDayNightImage(color) {
      const size = DAYNIGHT_IMAGE_SIZE;
      const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size });
      const ctx = canvas.getContext('2d');
      const image = ctx.createImageData(size, size);
      const rgba = colorToRgba(color);
      const sun = subsolarPoint(new Date());
      const sinDec = Math.sin(sun.lat * DEG);
      const cosDec = Math.cos(sun.lat * DEG);

      const cosHourAngle = new Float64Array(size);
      for (let x = 0; x < size; x++) {
        const lng = -180 + ((x + 0.5) * 360) / size;
        cosHourAngle[x] = Math.cos((lng - sun.lng) * DEG);
      }

      for (let y = 0; y < size; y++) {
        // Mapbox stretches an image evenly in Mercator y, not in latitude,
        // so each row's latitude comes from the inverse Mercator.
        const mercatorY = Math.PI * (1 - (2 * (y + 0.5)) / size);
        const lat = 2 * Math.atan(Math.exp(mercatorY)) - Math.PI / 2;
        const a = Math.sin(lat) * sinDec;
        const b = Math.cos(lat) * cosDec;

        for (let x = 0; x < size; x++) {
          const sinAltitude = Math.max(-1, Math.min(1, a + b * cosHourAngle[x]));
          const altitude = Math.asin(sinAltitude) / DEG;
          let t = Math.min(1, Math.max(0, -altitude / TWILIGHT_DEGREES));
          t = t * t * (3 - 2 * t); // smoothstep: eases into and out of twilight

          const i = (y * size + x) * 4;
          image.data[i] = rgba[0];
          image.data[i + 1] = rgba[1];
          image.data[i + 2] = rgba[2];
          image.data[i + 3] = Math.round(t * rgba[3]);
        }
      }

      ctx.putImageData(image, 0, 0);
      return canvas.toDataURL();
    }

    /* Adds the shading, or — once it exists — repaints it for the sun's
       current position and the current theme colour/opacity. */
    function addDayNightLayer(map) {
      const colors = getThemeColors();
      const url = renderDayNightImage(colors.daynightColor);

      if (!map.getSource('daynight')) {
        map.addSource('daynight', { type: 'image', url, coordinates: DAYNIGHT_COORDINATES });
      } else {
        map.getSource('daynight').updateImage({ url, coordinates: DAYNIGHT_COORDINATES });
      }

      if (!map.getLayer('daynight')) {
        map.addLayer({
          id: 'daynight',
          type: 'raster',
          source: 'daynight',
          paint: {
            'raster-opacity': colors.daynightOpacity,
            'raster-fade-duration': 0,
          },
        });
      } else {
        map.setPaintProperty('daynight', 'raster-opacity', colors.daynightOpacity);
      }
    }

    function addProjectLocations(map) {
      const colors = getThemeColors();

      if (!map.getSource('locations')) {
        map.addSource('locations', {
          type: 'geojson',
          data: mapLocations,
        });
      } else {
        map.getSource('locations').setData(mapLocations);
      }

      if (!map.getLayer('locations-points')) {
        map.addLayer({
          id: 'locations-points',
          type: 'circle',
          source: 'locations',
          paint: {
            'circle-color': colors.marker,
            'circle-radius': 4,
            'circle-stroke-width': DOT_OUTLINE_WIDTH,
            'circle-stroke-color': DOT_OUTLINE_COLOR,
          },
        });
      } else {
        map.setPaintProperty('locations-points', 'circle-color', colors.marker);
      }
    }

    function addOfficeLocations(map) {
      const colors = getThemeColors();

      if (!map.getSource('offices')) {
        map.addSource('offices', {
          type: 'geojson',
          data: officeLocations,
        });
      } else {
        map.getSource('offices').setData(officeLocations);
      }

      if (!map.getLayer('offices-points')) {
        map.addLayer({
          id: 'offices-points',
          type: 'circle',
          source: 'offices',
          paint: {
            'circle-color': colors.officeMarker,
            'circle-radius': 8,
            'circle-stroke-width': DOT_OUTLINE_WIDTH,
            'circle-stroke-color': DOT_OUTLINE_COLOR,
          },
        });
      } else {
        map.setPaintProperty('offices-points', 'circle-color', colors.officeMarker);
      }
    }

    /* Hover label for office markers only — project markers have none. */
    function bindOfficeHover(map) {
      let hoverPopup;

      function showHover(e) {
        map.getCanvas().style.cursor = 'pointer';

        const feature = e.features[0];
        const name = feature.properties.name || '';

        if (!name) return;

        if (hoverPopup) hoverPopup.remove();

        hoverPopup = new mapboxgl.Popup({
          closeButton: false,
          closeOnClick: false,
          className: 'hover-popup',
          offset: 14,
        })
          .setLngLat(feature.geometry.coordinates)
          .setHTML('<div class="hover-label">' + escapeHtml(name) + '</div>')
          .addTo(map);
      }

      function hideHover() {
        map.getCanvas().style.cursor = '';
        if (hoverPopup) {
          hoverPopup.remove();
          hoverPopup = null;
        }
      }

      map.on('mouseenter', 'offices-points', showHover);
      map.on('mouseleave', 'offices-points', hideHover);
    }

    /* Adds this script's own layers the first time; after that each add*()
       finds its layer already there and just re-applies the current theme
       colours, so this doubles as the light/dark recolour. */
    function applyMapLayers(map) {
      addDayNightLayer(map);
      addProjectLocations(map);
      addContinentLayers(map);
      addOfficeLocations(map);
    }

    const map = new mapboxgl.Map({
      container: 'map',
      style: MAP_STYLE,
      bounds: WORLD_BOUNDS,
      fitBoundsOptions: WORLD_FIT_OPTIONS,
      projection: 'mercator',
      renderWorldCopies: true,

      // lock the viewport
      scrollZoom: false,
      boxZoom: false,
      dragRotate: false,
      dragPan: false,
      keyboard: false,
      doubleClickZoom: false,
      touchZoomRotate: false,
      touchPitch: false,
    });

    window.aigMap = map;

    /* The zoom needed to fit WORLD_BOUNDS depends on the container's actual
       pixel size, not just its 16:9 aspect ratio — so refit whenever that
       size changes (viewport resize, orientation change, a breakpoint
       swapping in different CSS). The map's interactions are all locked
       above, so there's no user camera state this could ever clobber. */
    if (typeof ResizeObserver !== 'undefined') {
      const worldFitObserver = new ResizeObserver(() => {
        map.resize();
        map.fitBounds(WORLD_BOUNDS, WORLD_FIT_OPTIONS);
      });
      worldFitObserver.observe(mapEl);
    }

    /* Populate the sources once the CMS data (all pages of it) is in. Runs
       independently of map/style load — whichever finishes second applies
       the data: if the source already exists this updates it directly, and
       if not, applyMapLayers() picks up the already-populated features
       when it runs. */
    collectFeatures('location-list', true).then((features) => {
      mapLocations.features = features;
      renderContinentStats(countByContinent(mapLocations.features));
      if (map.getSource('locations')) map.getSource('locations').setData(mapLocations);
    });

    collectFeatures('office-location-list', false).then((features) => {
      officeLocations.features = features;
      if (map.getSource('offices')) map.getSource('offices').setData(officeLocations);
    });

    /* Exposed for the stats panel's hover handlers */
    window.aigHighlightContinent = function (name) {
      hoveredContinent = name || null;
      if (!map.getLayer('continent-fill')) return;
      map.setFilter('continent-fill', continentFilter());
      map.setFilter('continent-outline', continentFilter());
    };

    window.aigClearContinentHighlight = function () {
      window.aigHighlightContinent(null);
    };

    map.on('load', () => {
      map.setProjection('mercator');
      applyMapLayers(map);
      bindOfficeHover(map);

      /* Country polygons load separately — the map, markers, and stats
         all work without waiting on this; the highlight just activates
         once it lands. */
      fetch(CONTINENTS_URL)
        .then((res) => {
          if (!res.ok) throw new Error('Continent shapes failed to load: ' + res.status);
          return res.json();
        })
        .then((data) => {
          continentShapes = data;
          addContinentLayers(map);
        })
        .catch((err) => {
          console.warn('[aig-map] continent highlight unavailable:', err.message);
        });

      if (window._dayNightInterval) {
        clearInterval(window._dayNightInterval);
      }

      window._dayNightInterval = setInterval(() => {
        addDayNightLayer(map);
      }, 60000);

      /* Body classes can change for reasons other than the theme (scroll
         interactions, etc.), so only recolour when the mode actually flips. */
      let lastMode = currentMode();
      const obs = new MutationObserver(() => {
        const mode = currentMode();
        if (mode === lastMode) return;
        lastMode = mode;
        applyMapLayers(map);
      });

      obs.observe(document.body, {
        attributes: true,
        attributeFilter: ['class'],
      });

      map.resize();
    });

    return map;
  };

  document.addEventListener('DOMContentLoaded', function () {
    window.initProjectsMap();
  });
