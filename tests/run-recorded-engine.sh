#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT HUP INT TERM
# The unchanged EnvironmentAudio has one redundant-cast warning.
if command -v javac >/dev/null 2>&1; then
    javac -source 17 -target 17 -Xlint:all,-options,-cast -Werror -d "$OUT" \
        "$ROOT"/app/src/main/java/org/sou1/audio/*.java "$ROOT/app/src/main/java/org/sou1/DrumPreparation.java" "$ROOT"/tests/*.java
else
    java -m jdk.compiler/com.sun.tools.javac.Main -source 17 -target 17 -Xlint:all,-options,-cast -Werror -d "$OUT" \
        "$ROOT"/app/src/main/java/org/sou1/audio/*.java "$ROOT/app/src/main/java/org/sou1/DrumPreparation.java" "$ROOT"/tests/*.java
fi
java -cp "$OUT" RecordedDrumEngineTest "$ROOT/tests/legacy-engine-pcm.sha256"
if command -v node >/dev/null 2>&1; then
    java -cp "$OUT" RecordedDrumEngineTest vectors "$OUT"
    node "$ROOT/tests/recorded-engine-parity.mjs" "$OUT"
else
    printf '%s\n' 'SKIP JS/native engine vectors: Node not installed; Java checks passed.'
fi
# Existing test sources are unmodified. This compiles the new dependency too.
java -cp "$OUT" AmbientEngineTest
java -cp "$OUT" EventScoreTest
java -cp "$OUT" CompositionEngineTest
java -cp "$OUT" NoteHistoryTest
java -cp "$OUT" EnvironmentAudioTest
sh "$ROOT/tests/run-live-drums.sh"
