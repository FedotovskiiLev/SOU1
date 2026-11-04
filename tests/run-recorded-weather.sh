#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT HUP INT TERM
if command -v javac >/dev/null 2>&1; then
 javac -source 17 -target 17 -Xlint:all,-options,-cast -Werror -d "$OUT" "$ROOT"/app/src/main/java/org/sou1/audio/*.java "$ROOT/tests/RecordedWeatherVectors.java"
else
 java -m jdk.compiler/com.sun.tools.javac.Main -source 17 -target 17 -Xlint:all,-options,-cast -Werror -d "$OUT" "$ROOT"/app/src/main/java/org/sou1/audio/*.java "$ROOT/tests/RecordedWeatherVectors.java"
fi
java -Xmx512m -cp "$OUT" RecordedWeatherVectors "$ROOT/docs" "$OUT/weather.bin"
node "$ROOT/tests/recorded-weather-parity.mjs" "$OUT/weather.bin"
