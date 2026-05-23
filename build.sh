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

curl -sL "https://github.com/abrensch/brouter/releases/latest/download/brouter.jar" -o "$BR_DIR/brouter.jar"

PROFILES_BASE="https://raw.githubusercontent.com/abrensch/brouter/master/misc/profiles2"
for profile in trekking fastbike mountainbike safety shortest; do
  curl -sL "${PROFILES_BASE}/${profile}.brf" -o "$BR_DIR/profiles2/${profile}.brf"
done

echo "✅ Build listo (archivos en $BR_DIR)."
echo "Asegúrate de que tu Start script use BR_DIR='$BR_DIR' o lee env var BROUTER_DIR si lo prefieres."
