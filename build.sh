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

# Use Node.js to find and download the release ZIP from GitHub API
cat > /tmp/download-jar.mjs << 'JSEOF'
import { createWriteStream } from 'fs';
import { statSync } from 'fs';
import { pipeline } from 'stream/promises';

const outDir = process.argv[2]; // e.g. /opt/render/project/src/brouter
const zipPath = '/tmp/brouter-release.zip';

console.log('[jar-dl] Consultando GitHub API...');
const api = await fetch('https://api.github.com/repos/abrensch/brouter/releases/latest', {
  headers: { 'User-Agent': 'render-build/1.0' }
});
if (!api.ok) { console.error('[jar-dl] GitHub API HTTP', api.status); process.exit(1); }

const rel = await api.json();
console.log('[jar-dl] Release:', rel.tag_name);
console.log('[jar-dl] Assets:', rel.assets?.map(a => a.name).join(', '));

const asset = rel.assets?.find(a => a.name.endsWith('.zip') || a.name.endsWith('.jar'));
if (!asset) { console.error('[jar-dl] No se encontró .zip ni .jar'); process.exit(1); }

console.log('[jar-dl] Descargando:', asset.name, `(${Math.round(asset.size/1024/1024)}MB)`);
const resp = await fetch(asset.browser_download_url, {
  redirect: 'follow', headers: { 'User-Agent': 'render-build/1.0' }
});
if (!resp.ok) { console.error('[jar-dl] Download HTTP', resp.status); process.exit(1); }

const destPath = asset.name.endsWith('.jar') ? `${outDir}/brouter.jar` : zipPath;
await pipeline(resp.body, createWriteStream(destPath));
console.log('[jar-dl] ✅ Descargado en', destPath);
JSEOF

node /tmp/download-jar.mjs "$BR_DIR"
if [ $? -ne 0 ]; then
  echo "❌ No se pudo descargar el release. Abortando build."
  exit 1
fi

# If we got a ZIP, extract the JAR from it
if [ -f /tmp/brouter-release.zip ]; then
  echo "📦 Extrayendo JAR del ZIP..."
  # List contents to find the JAR
  unzip -l /tmp/brouter-release.zip | grep '\.jar'
  # Extract only the JAR file(s)
  unzip -j /tmp/brouter-release.zip '*.jar' -d /tmp/brouter-jars/
  # Copy the largest JAR as brouter.jar (the -all jar is the full one)
  JAR_FILE=$(ls -S /tmp/brouter-jars/*.jar | head -1)
  cp "$JAR_FILE" "$BR_DIR/brouter.jar"
  rm -rf /tmp/brouter-release.zip /tmp/brouter-jars
  echo "✅ JAR extraído: $JAR_FILE"
fi

# Validate
file_size=$(stat -c%s "$BR_DIR/brouter.jar" 2>/dev/null || echo 0)
if [ "$file_size" -lt 5000000 ]; then
  echo "❌ JAR inválido o demasiado pequeño: $file_size bytes"
  exit 1
fi
echo "✅ BRouter JAR listo ($((file_size / 1000000))MB)"

PROFILES_BASE="https://raw.githubusercontent.com/abrensch/brouter/master/misc/profiles2"
for profile in trekking fastbike mountainbike safety shortest; do
  curl -sL "${PROFILES_BASE}/${profile}.brf" -o "$BR_DIR/profiles2/${profile}.brf"
done

echo "✅ Build listo (archivos en $BR_DIR)."
