#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
JS_ROOT=${1:-$ROOT}
FACTORY=${2:-docs/instrument-engine.js}
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT HUP INT TERM
if command -v javac >/dev/null 2>&1; then
  javac -source 17 -target 17 -Xlint:all,-options,-cast -Werror -d "$OUT" "$ROOT"/app/src/main/java/org/sou1/audio/*.java "$ROOT/tests/LegacyEnginePcmFixture.java" "$ROOT/tests/DevelopingEngineTest.java" "$ROOT/tests/RecordedMelodicEngineVectors.java"
else
  java -m jdk.compiler/com.sun.tools.javac.Main -source 17 -target 17 -Xlint:all,-options,-cast -Werror -d "$OUT" "$ROOT"/app/src/main/java/org/sou1/audio/*.java "$ROOT/tests/LegacyEnginePcmFixture.java" "$ROOT/tests/DevelopingEngineTest.java" "$ROOT/tests/RecordedMelodicEngineVectors.java"
fi
java -Xmx768m -cp "$OUT" RecordedMelodicEngineVectors "${MELODIC_ASSETS_ROOT:-$JS_ROOT/docs}" "${DRUM_ASSETS_ROOT:-$JS_ROOT/docs}" "$OUT/vectors"
node "$ROOT/tests/recorded-melodic-engine-parity.mjs" "$JS_ROOT" "$OUT/vectors" "$FACTORY"
