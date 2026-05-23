// src/services/routing.js

const BROUTER_URL  = process.env.BROUTER_URL  || '';
const VALHALLA_URL = 'https://valhalla1.openstreetmap.de';
const OSRM_URL     = 'https://router.project-osrm.org';

const PROFILES = {
  brouter:  'trekking',
  valhalla: 'bicycle',
  osrm:     'bike',
};

const TIMEOUTS = {
  brouter:  10000,
  valhalla: 10000,
  osrm:     8000,
};

// ─── Motores ─────────────────────────────────────────────────────────────────

async function routeWithBRouter(start, end) {
  if (!BROUTER_URL) throw new Error('BROUTER_URL no configurada');

  const url =
    `${BROUTER_URL}/brouter` +
    `?lonlats=${start.longitude},${start.latitude}|${end.longitude},${end.latitude}` +
    `&profile=${PROFILES.brouter}&alternativeidx=0&format=geojson`;

  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUTS.brouter) });
  if (!res.ok) throw new Error(`BRouter HTTP ${res.status}`);
  return normalizeBRouter(await res.json());
}

async function routeWithValhalla(start, end) {
  const res = await fetch(`${VALHALLA_URL}/route`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    signal:  AbortSignal.timeout(TIMEOUTS.valhalla),
    body: JSON.stringify({
      locations: [
        { lon: start.longitude, lat: start.latitude },
        { lon: end.longitude,   lat: end.latitude },
      ],
      costing: PROFILES.valhalla,
      costing_options: { bicycle: { bicycle_type: 'Mountain' } },
    }),
  });
  if (!res.ok) throw new Error(`Valhalla HTTP ${res.status}`);
  return normalizeValhalla(await res.json());
}

async function routeWithOSRM(start, end) {
  const url =
    `${OSRM_URL}/route/v1/${PROFILES.osrm}/` +
    `${start.longitude},${start.latitude};` +
    `${end.longitude},${end.latitude}` +
    `?overview=full&geometries=geojson&steps=true`;

  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUTS.osrm) });
  if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
  return normalizeOSRM(await res.json());
}

// ─── Normalizadores ───────────────────────────────────────────────────────────

function normalizeBRouter(data) {
  const feature = data.features[0];
  const props   = feature.properties;
  return {
    coordinates: feature.geometry.coordinates.map(([lng, lat]) => ({ latitude: lat, longitude: lng })),
    distanceKm:  props['track-length'] / 1000,
    durationMin: props['total-time']   / 60,
  };
}

function normalizeValhalla(data) {
  const leg = data.trip.legs[0];
  return {
    coordinates: decodePolyline6(leg.shape),
    distanceKm:  data.trip.summary.length,
    durationMin: data.trip.summary.time / 60,
  };
}

function normalizeOSRM(data) {
  const route = data.routes[0];
  return {
    coordinates: route.geometry.coordinates.map(([lng, lat]) => ({ latitude: lat, longitude: lng })),
    distanceKm:  route.distance / 1000,
    durationMin: route.duration / 60,
  };
}

function decodePolyline6(encoded) {
  const coords = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let shift = 0, result = 0, byte;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; }
    while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : result >> 1;

    shift = 0; result = 0;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; }
    while (byte >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : result >> 1;

    coords.push({ latitude: lat / 1e6, longitude: lng / 1e6 });
  }
  return coords;
}

// ─── Cliente con fallback ────────────────────────────────────────────────────

const ENGINES = [
  { name: 'brouter',  fn: routeWithBRouter },
  { name: 'valhalla', fn: routeWithValhalla },
  { name: 'osrm',     fn: routeWithOSRM },
];

/**
 * @param {{ latitude: number, longitude: number }} start
 * @param {{ latitude: number, longitude: number }} end
 * @returns {Promise<{ coordinates, distanceKm, durationMin, usedEngine }>}
 */
export async function getRoute(start, end) {
  const errors = [];

  for (const engine of ENGINES) {
    try {
      console.log(`[routing] Intentando ${engine.name}...`);
      const route = await engine.fn(start, end);
      console.log(`[routing] ✅ ${engine.name}`);
      return { ...route, usedEngine: engine.name };
    } catch (err) {
      console.warn(`[routing] ⚠️ ${engine.name}: ${err.message}`);
      errors.push(`${engine.name}: ${err.message}`);
    }
  }

  throw new Error(`Todos los motores fallaron:\n${errors.join('\n')}`);
}