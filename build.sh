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

# Download brouter ZIP directly (known URL from v1.7.9 release)
BROUTER_ZIP_URL="https://github.com/abrensch/brouter/releases/download/v1.7.9/brouter-1.7.9.zip"
echo "⬇️  Descargando $BROUTER_ZIP_URL"
node --input-type=module << 'JSEOF'
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
const url = process.env.BROUTER_ZIP_URL;
const resp = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'render-build/1.0' } });
console.log('[dl] HTTP', resp.status, url);
if (!resp.ok) { console.error('[dl] Error HTTP', resp.status); process.exit(1); }
await pipeline(resp.body, createWriteStream('/tmp/brouter-release.zip'));
const { statSync } = await import('fs');
const sz = statSync('/tmp/brouter-release.zip').size;
console.log('[dl] ✅', Math.round(sz/1024/1024) + 'MB descargados');
if (sz < 1000000) { console.error('[dl] Archivo demasiado pequeño:', sz, 'bytes'); process.exit(1); }
JSEOF
if [ $? -ne 0 ]; then echo "❌ Descarga fallida"; exit 1; fi

# Extract the largest JAR from the ZIP
echo "📦 Extrayendo JAR del ZIP..."
unzip -l /tmp/brouter-release.zip | grep '\.jar'
mkdir -p /tmp/brouter-jars
unzip -j /tmp/brouter-release.zip '*.jar' -d /tmp/brouter-jars/
JAR_FILE=$(ls -S /tmp/brouter-jars/*.jar | head -1)
cp "$JAR_FILE" "$BR_DIR/brouter.jar"
rm -rf /tmp/brouter-release.zip /tmp/brouter-jars

# Validate
file_size=$(stat -c%s "$BR_DIR/brouter.jar" 2>/dev/null || echo 0)
if [ "$file_size" -lt 5000000 ]; then
  echo "❌ JAR inválido o demasiado pequeño: $file_size bytes"; exit 1
fi
echo "✅ BRouter JAR listo ($((file_size / 1000000))MB)"

PROFILES_BASE="https://raw.githubusercontent.com/abrensch/brouter/master/misc/profiles2"
for profile in trekking fastbike mountainbike safety shortest; do
  curl -sL "${PROFILES_BASE}/${profile}.brf" -o "$BR_DIR/profiles2/${profile}.brf"
done

echo "✅ Build listo (archivos en $BR_DIR)."
