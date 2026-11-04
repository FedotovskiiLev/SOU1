#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
JS=${DEVELOPMENT_SCORE_JS:-$ROOT/docs/development-score.js}
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT HUP INT TERM
# Keep all original 948 cases; also compare their events against pinned frozen v1.
DEVELOPMENT_SCORE_JS="$JS" sh "$ROOT/tests/run-development-score.sh"
if command -v javac >/dev/null 2>&1; then
    javac -source 17 -target 17 -Xlint:all,-options,-cast -Werror -d "$OUT" \
        "$ROOT"/app/src/main/java/org/sou1/audio/*.java "$ROOT/tests/DevelopmentScoreTest.java" "$ROOT/tests/DevelopmentConfigTest.java"
else
    java -m jdk.compiler/com.sun.tools.javac.Main -source 17 -target 17 -Xlint:all,-options,-cast -Werror -d "$OUT" \
        "$ROOT"/app/src/main/java/org/sou1/audio/*.java "$ROOT/tests/DevelopmentScoreTest.java" "$ROOT/tests/DevelopmentConfigTest.java"
fi
java -cp "$OUT" DevelopmentConfigTest
node "$ROOT/tests/development-config-parity.mjs" prepare "$OUT" "$JS"
java -cp "$OUT" DevelopmentConfigTest vectors "$OUT/configured-input.tsv" "$OUT"
node "$ROOT/tests/development-config-parity.mjs" verify "$OUT" "$JS"
