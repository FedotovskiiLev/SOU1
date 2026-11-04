#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT HUP INT TERM
# Focused score-only validation; no aggregate suite, Android build or device run.
if command -v javac >/dev/null 2>&1; then
    javac -source 17 -target 17 -Xlint:all,-options,-cast -Werror -d "$OUT" \
        "$ROOT"/app/src/main/java/org/sou1/audio/*.java "$ROOT/tests/DevelopmentScoreTest.java"
else
    java -m jdk.compiler/com.sun.tools.javac.Main -source 17 -target 17 -Xlint:all,-options,-cast -Werror -d "$OUT" \
        "$ROOT"/app/src/main/java/org/sou1/audio/*.java "$ROOT/tests/DevelopmentScoreTest.java"
fi
java -cp "$OUT" DevelopmentScoreTest
java -cp "$OUT" DevelopmentScoreTest vectors "$OUT"
node "$ROOT/tests/development-parity.mjs" "$OUT" "${DEVELOPMENT_SCORE_JS:-$ROOT/docs/development-score.js}"
