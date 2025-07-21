<template>
  <div class="dem-lookup-app">
    <!-- Control Panel -->
    <div class="control-panel">
      <h2>DEM Lookup Demo</h2>

      <!-- URL Input -->
      <div class="url-section">
        <label for="pmtiles-url">PMTiles URL:</label>
        <select v-model="selectedUrl" class="url-select" @change="loadDEM">
          <option value="https://static.mah.priv.at/cors/AT-10m-png.pmtiles">Austria 10m PNG</option>
          <option value="https://static.mah.priv.at/cors/AT-10m-webp.pmtiles">Austria 10m WebP</option>
          <option value="https://static.mah.priv.at/cors/DTM_Italy_20m_v2b_by_Sonny.pmtiles">Italy 20m WebP</option>
          <option value="custom">Custom URL...</option>
        </select>
        <input v-if="selectedUrl === 'custom'" v-model="customUrl" class="custom-url-input"
          placeholder="Enter custom PMTiles URL" @keyup.enter="loadDEM" />
        <button class="load-btn" :disabled="loading" @click="loadDEM">Load DEM</button>
      </div>

      <!-- Status Display -->
      <div class="status-section">
        <div class="status-grid">
          <div class="status-item"><strong>Status:</strong> {{ status }}</div>
          <div v-if="demInfo" class="status-item"><strong>Bounds:</strong> {{ formatBounds(demInfo.bounds) }}</div>
          <div v-if="demInfo" class="status-item">
            <strong>Zoom Levels:</strong> {{ demInfo.minZoom }} - {{ demInfo.maxZoom }}
          </div>
          <div v-if="demInfo" class="status-item"><strong>Encoding:</strong> {{ demInfo.encoding }}</div>
          <div v-if="demInfo" class="status-item">
            <strong>Resolution:</strong> {{ demInfo.metersPerPixel.toFixed(2) }} m/pixel
          </div>
          <div v-if="demInfo" class="status-item">
            <strong>Tile Size:</strong> {{ demInfo.tileSize }}px ({{ tileSizeKm.toFixed(2) }} km/edge)
          </div>
          <div class="status-item"><strong>Cached Tiles:</strong> {{ cacheSize }}</div>
          <div v-if="precacheProgress.total > 0" class="status-item">
            <strong>Precache Progress:</strong> {{ precacheProgress.current }}/{{ precacheProgress.total }}
          </div>
        </div>
      </div>

      <!-- Last Lookup Result -->
      <div v-if="lastResult" class="result-section">
        <h3>Last Elevation Lookup</h3>
        <div class="result-grid">
          <div class="result-item">
            <strong>Position:</strong> {{ lastResult.lat.toFixed(6) }}, {{ lastResult.lon.toFixed(6) }}
          </div>
          <div class="result-item"><strong>Elevation:</strong> {{ lastResult.elevation.toFixed(1) }} m</div>
          <div class="result-item"><strong>RGB Values:</strong> ({{ lastResult.rgbValues.join(', ') }})</div>
          <div class="result-item"><strong>Tile Coords:</strong> {{ lastResult.tileCoords.join('/') }}</div>
        </div>
      </div>

      <!-- Bounding Box Controls -->
      <div class="bbox-section">
        <h3>Bounding Box Precache</h3>
        <button :class="{ active: bboxMode }" class="bbox-btn" @click="toggleBboxMode">
          {{ bboxMode ? 'Cancel Drawing' : 'Draw Bounding Box' }}
        </button>
        <button :disabled="!currentBbox || precaching" class="precache-btn" @click="precacheBbox">
          {{ precaching ? 'Precaching...' : 'Precache Tiles' }}
        </button>
        <button class="clear-btn" @click="clearCache">Clear Cache</button>
        <div v-if="currentBbox" class="bbox-info">
          <strong>Current BBox:</strong>
          N:{{ currentBbox.north.toFixed(4) }}, S:{{ currentBbox.south.toFixed(4) }}, E:{{
            currentBbox.east.toFixed(4)
          }}, W:{{ currentBbox.west.toFixed(4) }}
        </div>
      </div>
    </div>

    <!-- Map Container -->
    <div class="map-container">
      <div ref="mapElement" class="map" />

      <!-- Cursor Popup -->
      <div v-if="cursorElevation && showCursorPopup"
        :style="{ left: cursorPos.x + 10 + 'px', top: cursorPos.y - 30 + 'px' }" class="cursor-popup">
        Elevation: {{ cursorElevation.toFixed(1) }}m
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { DEMLookup } from '@/utils/DEMLookup';

// Reactive data
const mapElement = ref(null);
const map = ref(null);
const demLookup = ref(null);
const selectedUrl = ref('https://static.mah.priv.at/cors/AT-10m-png.pmtiles');
const customUrl = ref('');
const loading = ref(false);
const status = ref('Ready');
const demInfo = ref(null);
const cacheSize = ref(0);
const lastResult = ref(null);
const bboxMode = ref(false);
const currentBbox = ref(null);
const precaching = ref(false);
const precacheProgress = ref({ current: 0, total: 0 });
const cursorElevation = ref(null);
const cursorPos = ref({ x: 0, y: 0 });
const showCursorPopup = ref(false);

// Computed
const tileSizeKm = computed(() => {
  if (!demLookup.value) return 0;
  return demLookup.value.getTileSizeInKm();
});

// Map drawing variables
let bboxRectangle = null;
let bboxStartLatLng = null;

// Initialize the app
onMounted(async () => {
  initMap();
  await loadDEM();
});

function initMap() {
  map.value = L.map(mapElement.value).setView([47.5, 13.5], 10);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
  }).addTo(map.value);

  // Add mouse tracking for cursor elevation
  map.value.on('mousemove', handleMouseMove);
  map.value.on('mouseout', () => {
    showCursorPopup.value = false;
  });

  // Handle bounding box drawing
  map.value.on('mousedown', handleMouseDown);
  map.value.on('mouseup', handleMouseUp);
}

async function loadDEM() {
  try {
    loading.value = true;
    status.value = 'Loading DEM...';

    const url = selectedUrl.value === 'custom' ? customUrl.value : selectedUrl.value;
    if (!url) {
      status.value = 'Please enter a valid URL';
      return;
    }

    demLookup.value = new DEMLookup(url, { debug: true, maxCacheSize: 100 });
    demInfo.value = await demLookup.value.getDEMInfo();

    if (demInfo.value) {
      status.value = 'DEM loaded successfully';

      // Fit map to DEM bounds
      const bounds = demInfo.value.bounds;
      map.value.fitBounds([
        [bounds[1], bounds[0]], // [minLat, minLon]
        [bounds[3], bounds[2]], // [maxLat, maxLon]
      ]);
    } else {
      status.value = 'Failed to load DEM';
    }
  } catch (error) {
    console.error('Error loading DEM:', error);
    status.value = `Error: ${error.message}`;
  } finally {
    loading.value = false;
  }
}

async function handleMouseMove(e) {
  if (!demLookup.value) return;

  // Update cursor position for popup
  const mapContainer = mapElement.value;
  const rect = mapContainer.getBoundingClientRect();
  cursorPos.value = {
    x: e.originalEvent.clientX - rect.left,
    y: e.originalEvent.clientY - rect.top,
  };

  // Debounce elevation lookup
  clearTimeout(handleMouseMove.timeoutId);
  handleMouseMove.timeoutId = setTimeout(async () => {
    try {
      const result = await demLookup.value.getElevation(e.latlng.lat, e.latlng.lng);
      if (result) {
        cursorElevation.value = result.elevation;
        showCursorPopup.value = true;
        lastResult.value = {
          lat: e.latlng.lat,
          lon: e.latlng.lng,
          elevation: result.elevation,
          rgbValues: result.rgbValues,
          tileCoords: result.tileCoords,
        };
        updateCacheSize();
      } else {
        cursorElevation.value = null;
        showCursorPopup.value = false;
      }
    } catch (error) {
      console.error('Error during elevation lookup:', error);
    }
  }, 100);
}

function handleMouseDown(e) {
  if (!bboxMode.value) return;

  bboxStartLatLng = e.latlng;
  if (bboxRectangle) {
    map.value.removeLayer(bboxRectangle);
  }
}

function handleMouseUp(e) {
  if (!bboxMode.value || !bboxStartLatLng) return;

  const endLatLng = e.latlng;
  const bounds = L.latLngBounds(bboxStartLatLng, endLatLng);

  bboxRectangle = L.rectangle(bounds, {
    color: '#ff7800',
    weight: 2,
    fillOpacity: 0.2,
  }).addTo(map.value);

  currentBbox.value = {
    north: bounds.getNorth(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    west: bounds.getWest(),
  };

  bboxMode.value = false;
  bboxStartLatLng = null;
}

function toggleBboxMode() {
  bboxMode.value = !bboxMode.value;
  if (!bboxMode.value) {
    bboxStartLatLng = null;
  }
}

async function precacheBbox() {
  if (!currentBbox.value || !demLookup.value) return;

  try {
    precaching.value = true;
    precacheProgress.value = { current: 0, total: 0 };

    const result = await demLookup.value.preCacheBoundingBox(currentBbox.value);

    result.progress = (current, total) => {
      precacheProgress.value = { current, total };
    };

    status.value = `Precached ${result.cached}/${result.total} tiles`;
    updateCacheSize();
  } catch (error) {
    console.error('Error precaching tiles:', error);
    status.value = `Error precaching: ${error.message}`;
  } finally {
    precaching.value = false;
    precacheProgress.value = { current: 0, total: 0 };
  }
}

function clearCache() {
  if (demLookup.value) {
    demLookup.value.clearCache();
    updateCacheSize();
    status.value = 'Cache cleared';
  }
}

function updateCacheSize() {
  if (demLookup.value) {
    cacheSize.value = demLookup.value.getCacheSize();
  }
}

function formatBounds(bounds) {
  return `[${bounds[0].toFixed(2)}, ${bounds[1].toFixed(2)}, ${bounds[2].toFixed(2)}, ${bounds[3].toFixed(2)}]`;
}

onUnmounted(() => {
  if (handleMouseMove.timeoutId) {
    clearTimeout(handleMouseMove.timeoutId);
  }
});
</script>

<style scoped>
.dem-lookup-app {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
}

.control-panel {
  background: #f5f5f5;
  padding: 1rem;
  border-bottom: 1px solid #ddd;
  max-height: 40vh;
  overflow-y: auto;
}

.control-panel h2 {
  margin: 0 0 1rem 0;
  color: #333;
}

.url-section {
  margin-bottom: 1rem;
}

.url-section label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: bold;
}

.url-select,
.custom-url-input {
  width: 70%;
  padding: 0.5rem;
  margin-right: 0.5rem;
  border: 1px solid #ccc;
  border-radius: 4px;
}

.load-btn,
.bbox-btn,
.precache-btn,
.clear-btn {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  margin-right: 0.5rem;
}

.load-btn {
  background: #007cba;
  color: white;
}

.bbox-btn {
  background: #28a745;
  color: white;
}

.bbox-btn.active {
  background: #dc3545;
}

.precache-btn {
  background: #17a2b8;
  color: white;
}

.clear-btn {
  background: #6c757d;
  color: white;
}

.load-btn:disabled,
.precache-btn:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.status-section,
.result-section,
.bbox-section {
  margin-bottom: 1rem;
  padding: 1rem;
  background: #ffffff;
  border-radius: 4px;
  border: 1px solid #ccc;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.status-section h3,
.result-section h3,
.bbox-section h3 {
  margin: 0 0 0.75rem 0;
  color: #222;
  font-size: 1.2rem;
  font-weight: 600;
}

.status-grid,
.result-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 0.75rem;
  font-size: 1.1rem;
}

.status-item,
.result-item {
  padding: 0.5rem;
  background: #f8f9fa;
  border-radius: 3px;
  border-left: 3px solid #007cba;
  color: #212529;
  font-weight: 500;
}

.status-item strong,
.result-item strong {
  color: #1a1a1a;
  font-weight: 700;
}

.bbox-info {
  margin-top: 0.5rem;
  font-size: 0.9rem;
  color: #666;
}

.map-container {
  flex: 1;
  position: relative;
}

.map {
  width: 100%;
  height: 100%;
  cursor: crosshair;
}

.cursor-popup {
  position: absolute;
  background: rgba(0, 0, 0, 0.8);
  color: white;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.9rem;
  pointer-events: none;
  z-index: 1000;
  white-space: nowrap;
}
</style>
