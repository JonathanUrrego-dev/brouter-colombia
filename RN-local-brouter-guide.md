# Guía: Probar el servidor BRouter local desde React Native

Este documento explica cómo conectar tu aplicación React Native a tu servidor BRouter local (ejecutándose en `localhost:10000`) para pruebas.

## 1) Resumen rápido
- Asegúrate de que el servidor esté en ejecución: `node --env-file=.env server.js`.
- Usa la dirección correcta según dónde ejecutes la app:
  - iOS Simulator: `http://localhost:10000`
  - Android Emulator (Android Studio): `http://10.0.2.2:10000`
  - Genymotion: `http://10.0.3.2:10000`
  - Dispositivo físico (teléfono): `http://<IP-DE-TU-PC>:10000` (ej. `http://192.168.1.42:10000`) — asegúrate de desactivar o permitir en el firewall y que el servidor esté escuchando en `0.0.0.0`.

## 2) Endpoints importantes
- Salud: `GET /health` → ejemplo: `http://localhost:10000/health`
- Ruta BRouter: `GET /brouter` con params (ejemplo `lonlats`, `profile`, `format`).

Ejemplo completo (GeoJSON):
```
http://<HOST>:10000/brouter?lonlats=-74.0721,4.7109|-74.0536,4.7005&profile=trekking&alternativeidx=0&format=geojson
```

## 3) Código de ejemplo: servicio de rutas (React Native)
Guarda esto en `src/services/brouterLocal.js` o similar.

```javascript
// src/services/brouterLocal.js
const HOST = /* para Android emulator: 'http://10.0.2.2:10000' */ 'http://10.0.2.2:10000';

export async function fetchRoute(start, end, profile = 'trekking') {
  const lonlats = `${start.longitude},${start.latitude}|${end.longitude},${end.latitude}`;
  const url = `${HOST}/brouter?lonlats=${encodeURIComponent(lonlats)}&profile=${encodeURIComponent(profile)}&alternativeidx=0&format=geojson`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`BRouter HTTP ${res.status}`);
  const geojson = await res.json();
  return geojson; // GeoJSON FeatureCollection
}
```

## 4) Convertir GeoJSON a coordenadas para `react-native-maps`
La geometría de BRouter viene en formato GeoJSON con coordenadas `[lon, lat]`. Convierte a `{ latitude, longitude }`:

```javascript
function geojsonToLatLngs(geojson) {
  const feat = geojson.features && geojson.features[0];
  if (!feat) return [];
  const coords = feat.geometry.coordinates; // array de [lon, lat]
  return coords.map(([lon, lat]) => ({ latitude: lat, longitude: lon }));
}
```

## 5) Ejemplo de componente (simplificado)

```javascript
import React, { useState } from 'react';
import { Button, View } from 'react-native';
import MapView, { Polyline } from 'react-native-maps';
import { fetchRoute } from '../services/brouterLocal';

export default function RouteTest() {
  const [coords, setCoords] = useState([]);

  const start = { latitude: 4.7109, longitude: -74.0721 };
  const end   = { latitude: 4.7005, longitude: -74.0536 };

  async function onGetRoute() {
    try {
      const geojson = await fetchRoute(start, end, 'trekking');
      const latlngs = geojson.features[0].geometry.coordinates.map(([lon, lat]) => ({ latitude: lat, longitude: lon }));
      setCoords(latlngs);
    } catch (e) {
      console.error('Route error', e);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <MapView style={{ flex: 1 }} initialRegion={{ latitude: 4.706, longitude: -74.062, latitudeDelta: 0.03, longitudeDelta: 0.03 }}>
        {coords.length > 0 && <Polyline coordinates={coords} strokeWidth={4} strokeColor="#007bff" />}
      </MapView>
      <Button title="Obtener ruta" onPress={onGetRoute} />
    </View>
  );
}
```

## 6) Probar desde Postman / curl (repaso)
- Salud:
```
curl.exe -sS http://localhost:10000/health -w "\nHTTP_STATUS:%{http_code}\n"
```
- Ruta (guardar en archivo):
```
curl.exe -sS "http://localhost:10000/brouter?lonlats=-74.0721,4.7109|-74.0536,4.7005&profile=trekking&alternativeidx=0&format=geojson" > route.geojson
```

## 7) Problemas comunes y soluciones
- Error de conexión / ECONNREFUSED: comprueba que `server.js` esté en ejecución y que el puerto sea `10000`.
- Usas un emulador Android: recuerda `10.0.2.2` (Android Studio). Si usas Genymotion: `10.0.3.2`.
- Dispositivo físico: usa la IP de tu PC y abre el puerto en el firewall.
- CORS no suele ser problema para apps nativas; si pruebas desde navegador web, necesitarás CORS habilitado.

## 8) De cara a producción
- No uses `localhost` ni direcciones de emulador. Despliega tu servidor (Render/Cloud) y usa la URL pública HTTPS.
- Asegúrate de usar `R2_PUBLIC_URL` y que las tiles estén accesibles desde el servidor en producción.

---

Archivo creado automáticamente por la guía de pruebas local. Si quieres, lo adapto para integrarlo directamente en `src/services/routing.js`.
