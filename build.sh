#!/bin/bash
set -euo pipefail

echo "📦 Preparando entorno BRouter (sin apt, usando JRE local)..."

# Work directory inside the repo (writable on Render)
BR_DIR="$PWD/brouter"
mkdir -p "$BR_DIR"

# Download a lightweight JRE (Eclipse Temurin 17) and extract locally
JRE_URL="https://github.com/adoptium/temurin17-binaries/releases/latest/download/OpenJDK17U-jre_x64_linux_hotspot.tar.gz"
echo "⬇️  Descargando JRE desde $JRE_URL"
curl -sL "$JRE_URL" -o jre.tar.gz
mkdir -p "$BR_DIR/jre"
tar -xzf jre.tar.gz -C "$BR_DIR/jre" --strip-components=1
rm jre.tar.gz

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
