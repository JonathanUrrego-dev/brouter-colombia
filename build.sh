#!/bin/bash
set -e

echo "📦 Instalando Java..."
apt-get update -qq && apt-get install -y -qq default-jre-headless

echo "📥 Descargando BRouter JAR..."
mkdir -p /opt/brouter/profiles2

curl -sL "https://github.com/abrensch/brouter/releases/latest/download/brouter.jar" \
  -o /opt/brouter/brouter.jar

PROFILES_BASE="https://raw.githubusercontent.com/abrensch/brouter/master/misc/profiles2"
for profile in trekking fastbike mountainbike safety shortest; do
  curl -sL "${PROFILES_BASE}/${profile}.brf" \
    -o "/opt/brouter/profiles2/${profile}.brf"
done

echo "✅ Build listo"