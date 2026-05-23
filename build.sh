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

# Download JAR using Node.js fetch (handles redirects reliably)
# Try several sources in order
JAR_URLS=(
  "https://github.com/abrensch/brouter/releases/download/v1.7.9/brouter-1.7.9-all.jar"
  "https://github.com/abrensch/brouter/releases/latest/download/brouter.jar"
  "https://repo1.maven.org/maven2/de/cm/btools/brouter/1.7.9/brouter-1.7.9.jar"
)

jar_ok=0
for url in "${JAR_URLS[@]}"; do
  echo "⬇️  Intentando descargar JAR desde: $url"
  node --input-type=module << JSEOF
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
const url = '${url}';
try {
  const resp = await fetch(url, { redirect: 'follow' });
  console.log('[jar-dl] HTTP', resp.status, 'desde', url);
  if (!resp.ok) process.exit(1);
  await pipeline(resp.body, createWriteStream('${BR_DIR}/brouter.jar'));
  console.log('[jar-dl] Descarga completa');
} catch(e) {
  console.error('[jar-dl] Error:', e.message);
  process.exit(1);
}
JSEOF
  if [ $? -eq 0 ]; then
    file_size=$(stat -c%s "$BR_DIR/brouter.jar" 2>/dev/null || echo 0)
    if [ "$file_size" -gt 5000000 ]; then
      echo "✅ JAR válido ($((file_size / 1000000))MB)"
      jar_ok=1
      break
    else
      echo "⚠️ Archivo demasiado pequeño: ${file_size} bytes"
      rm -f "$BR_DIR/brouter.jar"
    fi
  else
    echo "⚠️ Falló descarga desde $url"
    rm -f "$BR_DIR/brouter.jar"
  fi
done

if [ "$jar_ok" -ne 1 ]; then
  echo "❌ No se pudo descargar un JAR válido. Abortando build."
  exit 1
fi

PROFILES_BASE="https://raw.githubusercontent.com/abrensch/brouter/master/misc/profiles2"
for profile in trekking fastbike mountainbike safety shortest; do
  curl -sL "${PROFILES_BASE}/${profile}.brf" -o "$BR_DIR/profiles2/${profile}.brf"
done

echo "✅ Build listo (archivos en $BR_DIR)."
