window.initProjectsMap = function () {
    if (window.aigMap) return window.aigMap;
    if (typeof mapboxgl === 'undefined') return;

    mapboxgl.accessToken = 'pk.eyJ1IjoiYXBwbGllZC1pbmZvcm1hdGlvbi1ncm91cCIsImEiOiJjbGQxamI1c2gwZGZ2M25ueTFrcjl3cDE0In0.Ix4iBQ6SUwqdokXuPcFrRw';

    const mapEl = document.getElementById('map');
    if (!mapEl) return;

    const STYLES = {
      dark: 'mapbox://styles/mapbox/dark-v11',
      light: 'mapbox://styles/applied-information-group/cmr3a1400000u01s883gfbh0f',
    };

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

    function getThemeColors() {
      return {
        marker: cssVar('--_colors---map-marker') || '#2C2C2E',
        markerActive: cssVar('--_colors---map-marker-active') || '#34C759',
        officeMarker: cssVar('--_colors---office-marker') || '#34C759',
        daynightColor: cssVar('--map-daynight-color') || '#000000',
        daynightOpacity: parseFloat(cssVar('--map-daynight-opacity')) || 0.18,
      };
    }

    /* ── Build GeoJSON from hidden CMS inputs, tagging each with its continent ── */
    const mapLocations = {
      type: 'FeatureCollection',
      features: [],
    };

    const officeLocations = {
      type: 'FeatureCollection',
      features: [],
    };

    const list = document.getElementById('location-list');
    const items = list ? Array.from(list.children) : [];

    items.forEach((item) => {
      const lat = item.querySelector('#locationLatitude')?.value;
      const lng = item.querySelector('#locationLongitude')?.value;
      const name = item.querySelector('#locationName')?.value;
      const id = item.querySelector('#locationID')?.value;

      if (!lat || !lng) return;

      mapLocations.features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [Number(lng), Number(lat)],
        },
        properties: {
          name: name || id || '',
          continent: lookupContinent(Number(lng), Number(lat)),
        },
      });
    });

    const officeList = document.getElementById('office-location-list');
    const officeItems = officeList ? Array.from(officeList.children) : [];

    officeItems.forEach((item) => {
      const lat = item.querySelector('#officeLocationLatitude')?.value;
      const lng = item.querySelector('#officeLocationLongitude')?.value;
      const name = item.querySelector('#officeLocationName')?.value;
      const id = item.querySelector('#officeLocationID')?.value;

      if (!lat || !lng) return;

      officeLocations.features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [Number(lng), Number(lat)],
        },
        properties: {
          name: name || id || '',
        },
      });
    });

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
      el.innerHTML = '<table class="continent-stats_table"><tbody>' + rows + '</tbody></table>';
    }

    renderContinentStats(countByContinent(mapLocations.features));

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

    /* ── Day/night terminator ── */
    function addDayNightLayer(map) {
      if (typeof GeoJSONTerminator === 'undefined') return;

      const colors = getThemeColors();
      const geoJSON = new GeoJSONTerminator();

      if (!map.getSource('daynight')) {
        map.addSource('daynight', {
          type: 'geojson',
          data: geoJSON,
        });
      } else {
        map.getSource('daynight').setData(geoJSON);
      }

      if (!map.getLayer('daynight')) {
        map.addLayer({
          id: 'daynight',
          type: 'fill',
          source: 'daynight',
          paint: {
            'fill-color': colors.daynightColor,
            'fill-opacity': colors.daynightOpacity,
          },
        });
      } else {
        map.setPaintProperty('daynight', 'fill-color', colors.daynightColor);
        map.setPaintProperty('daynight', 'fill-opacity', colors.daynightOpacity);
      }
    }

    function updateDayNightLayer(map) {
      if (typeof GeoJSONTerminator === 'undefined') return;
      if (!map.getSource('daynight')) return;

      const colors = getThemeColors();
      map.getSource('daynight').setData(new GeoJSONTerminator());

      if (map.getLayer('daynight')) {
        map.setPaintProperty('daynight', 'fill-color', colors.daynightColor);
        map.setPaintProperty('daynight', 'fill-opacity', colors.daynightOpacity);
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
          },
        });
      } else {
        map.setPaintProperty('offices-points', 'circle-color', colors.officeMarker);
      }
    }

    function bindHover(map) {
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

      map.on('mouseenter', 'locations-points', showHover);
      map.on('mouseleave', 'locations-points', hideHover);

      map.on('mouseenter', 'offices-points', showHover);
      map.on('mouseleave', 'offices-points', hideHover);
    }

    function rebuildMapLayers(map) {
      map.setProjection('mercator');
      addDayNightLayer(map);
      addProjectLocations(map);
      addContinentLayers(map);
      addOfficeLocations(map);
      bindHover(map);
    }

    function switchBaseStyle(map) {
      const nextStyle = STYLES[currentMode()] || STYLES.light;

      map.setStyle(nextStyle);

      map.once('style.load', () => {
        rebuildMapLayers(map);
      });
    }

    const map = new mapboxgl.Map({
      container: 'map',
      style: STYLES[currentMode()] || STYLES.light,
      center: [10, 20],
      zoom: 1.5,
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
      rebuildMapLayers(map);

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
        updateDayNightLayer(map);
      }, 60000);

      const obs = new MutationObserver(() => {
        switchBaseStyle(map);
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
