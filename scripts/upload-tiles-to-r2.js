// scripts/upload-tiles-to-r2.js
import { createWriteStream, existsSync, statSync } from 'fs';
import { mkdir, readFile } from 'fs/promises';
import { pipeline } from 'stream/promises';
import path from 'path';

const WORKER_URL    = process.env.WORKER_URL;
const UPLOAD_SECRET = process.env.UPLOAD_SECRET;

const TILES = [
  'W80_S5.rd5',   // Pacifico, Narino sur (lat -5 a 0)
  'W75_S5.rd5',   // Bogota sur, Putumayo (lat -5 a 0)
  'W70_S5.rd5',   // Amazonia sur (lat -5 a 0)
  'W80_N0.rd5',   // Valle del Cauca (lat 0 a 5)
  'W75_N0.rd5',   // Antioquia, Medellin (lat 0 a 5)
  'W70_N0.rd5',   // Amazonia (lat 0 a 5)
  'W75_N5.rd5',   // Costa Caribe, Barranquilla (lat 5 a 10)
  'W70_N5.rd5',   // Guajira, Cesar (lat 5 a 10)
];

const BROUTER_BASE = 'https://brouter.de/brouter/segments4';
const LOCAL_DIR    = './tiles-temp';

async function downloadTile(filename) {
  const localPath = path.join(LOCAL_DIR, filename);
  if (existsSync(localPath) && statSync(localPath).size > 0) {
    console.log(`📦 ${filename} ya existe localmente`);
    return localPath;
  }

  console.log(`⬇️  Descargando ${filename} desde brouter.de...`);
  const res = await fetch(`${BROUTER_BASE}/${filename}`);
  if (!res.ok) throw new Error(`brouter.de respondió ${res.status}`);

  await pipeline(res.body, createWriteStream(localPath));
  console.log(`✅ Descargado (${(statSync(localPath).size / 1024 / 1024).toFixed(1)} MB)`);
  return localPath;
}

async function uploadTile(filename, localPath) {
  console.log(`☁️  Subiendo ${filename} al Worker...`);

  const fileBuffer = await readFile(localPath);
  const res = await fetch(`${WORKER_URL}/${filename}`, {
    method:  'PUT',
    headers: {
      'Content-Type':    'application/octet-stream',
      'X-Upload-Secret': UPLOAD_SECRET,
    },
    body: fileBuffer,
  });

  if (!res.ok) throw new Error(`Worker respondió ${res.status}: ${await res.text()}`);

  const json = await res.json();
  if (json.skipped) {
    console.log(`⏭️  ${filename} ya estaba en R2\n`);
  } else {
    console.log(`✅ ${filename} en R2 (${(json.bytes / 1024 / 1024).toFixed(1)} MB)\n`);
  }
}

async function main() {
  if (!WORKER_URL || !UPLOAD_SECRET) {
    console.error('❌ Faltan variables WORKER_URL y/o UPLOAD_SECRET');
    process.exit(1);
  }

  await mkdir(LOCAL_DIR, { recursive: true });
  console.log(`🗺️  Subiendo ${TILES.length} tiles de Colombia...\n`);

  for (const tile of TILES) {
    try {
      const localPath = await downloadTile(tile);
      await uploadTile(tile, localPath);
    } catch (err) {
      console.error(`❌ Error con ${tile}: ${err.message}`);
    }
  }

  console.log('🎉 Proceso terminado.');
}

main().catch(console.error);