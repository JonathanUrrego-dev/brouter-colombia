#!/bin/bash
set -euo pipefail

echo "📦 Preparando entorno BRouter (sin apt, usando JRE local)..."

# Work directory inside the repo (writable on Render)
BR_DIR="$PWD/brouter"
mkdir -p "$BR_DIR"

# Download a lightweight JRE (Eclipse Temurin 17) and extract locally
JRE_CANDIDATES=(
  "https://github.com/adoptium/temurin17-binaries/releases/latest/download/OpenJDK17U-jre_x64_linux_hotspot.tar.gz"
  "https://corretto.aws/downloads/latest/amazon-corretto-17-x64-linux-jdk.tar.gz"
  "https://cdn.azul.com/zulu/bin/zulu17.52.13-ca-jre17.0.9-linux_x64.tar.gz"
)

mkdir -p "$BR_DIR/jre"
download_ok=0
for url in "${JRE_CANDIDATES[@]}"; do
  echo "⬇️  Intentando descargar JRE desde: $url"
  if curl -sSL --retry 3 --output jre.tar.gz "$url"; then
    # verify it's a gzip tarball
    if tar -tzf jre.tar.gz >/dev/null 2>&1; then
      echo "📦 Archivo JRE válido, extrayendo..."
      tar -xzf jre.tar.gz -C "$BR_DIR/jre" --strip-components=1
      rm jre.tar.gz
      download_ok=1
      break
    else
      echo "⚠️ Descarga no es un tar.gz válido (posible HTML). Probando siguiente URL..."
      rm -f jre.tar.gz
    fi
  else
    echo "⚠️ Falló la descarga desde $url"
  fi
done

if [ "$download_ok" -ne 1 ]; then
  echo "❌ No se pudo descargar un JRE válido. Abortando build."
  exit 1
fi

export JAVA_HOME="$BR_DIR/jre"
export PATH="$JAVA_HOME/bin:$PATH"

echo "☑ Java instalado localmente en $JAVA_HOME (java -version):"
java -version || true

echo "📥 Descargando BRouter JAR y perfiles..."
mkdir -p "$BR_DIR/profiles2"

# Use Node.js to download the JAR (handles redirects + GitHub API)
cat > /tmp/download-jar.mjs << 'JSEOF'
import { createWriteStream } from 'fs';
import { statSync } from 'fs';
import { pipeline } from 'stream/promises';

const outPath = process.argv[2];

async function tryDownload(url, label) {
  console.log(`[jar-dl] Intentando: ${label || url}`);
  const resp = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'render-build/1.0' }
  });
  console.log(`[jar-dl] HTTP ${resp.status}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  await pipeline(resp.body, createWriteStream(outPath));
  const size = statSync(outPath).size;
  if (size < 5_000_000) throw new Error(`Archivo demasiado pequeño: ${size} bytes`);
  console.log(`[jar-dl] ✅ ${Math.round(size / 1024 / 1024)}MB descargados`);
}

// 1. Try GitHub API to get the real latest release URL
try {
  console.log('[jar-dl] Consultando GitHub API...');
  const api = await fetch('https://api.github.com/repos/abrensch/brouter/releases/latest', {
    headers: { 'User-Agent': 'render-build/1.0' }
  });
  if (api.ok) {
    const rel = await api.json();
    const asset = rel.assets?.find(a => a.name.endsWith('.jar'));
    if (asset) {
      console.log(`[jar-dl] Release: ${rel.tag_name}, asset: ${asset.name}`);
      await tryDownload(asset.browser_download_url, asset.name);
      process.exit(0);
    } else {
      console.warn('[jar-dl] No se encontró .jar en el release:', rel.tag_name);
      console.warn('[jar-dl] Assets:', rel.assets?.map(a => a.name).join(', '));
    }
  } else {
    console.warn('[jar-dl] GitHub API HTTP', api.status);
  }
} catch (e) {
  console.warn('[jar-dl] GitHub API falló:', e.message);
}

// 2. Fallback to direct URLs
const fallbacks = [
  'https://github.com/abrensch/brouter/releases/latest/download/brouter.jar',
];
for (const url of fallbacks) {
  try {
    await tryDownload(url);
    process.exit(0);
  } catch (e) {
    console.warn(`[jar-dl] ⚠️ ${e.message}`);
  }
}
process.exit(1);
JSEOF

node /tmp/download-jar.mjs "$BR_DIR/brouter.jar"
if [ $? -ne 0 ]; then
  echo "❌ No se pudo descargar el JAR. Abortando build."
  exit 1
fi

PROFILES_BASE="https://raw.githubusercontent.com/abrensch/brouter/master/misc/profiles2"
for profile in trekking fastbike mountainbike safety shortest; do
  curl -sL "${PROFILES_BASE}/${profile}.brf" -o "$BR_DIR/profiles2/${profile}.brf"
done

echo "✅ Build listo (archivos en $BR_DIR)."
