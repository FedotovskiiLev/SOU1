#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT HUP INT TERM
if command -v javac >/dev/null 2>&1; then
    javac -d "$OUT" "$ROOT/app/src/main/java/org/sou1/audio/AmbientEngine.java" "$ROOT/app/src/main/java/org/sou1/audio/EnvironmentAudio.java" "$ROOT/tests/AmbientEngineTest.java" "$ROOT/tests/EventScoreTest.java" "$ROOT/tests/CompositionEngineTest.java" "$ROOT/tests/NoteHistoryTest.java"
else
    java -m jdk.compiler/com.sun.tools.javac.Main -d "$OUT" "$ROOT/app/src/main/java/org/sou1/audio/AmbientEngine.java" "$ROOT/app/src/main/java/org/sou1/audio/EnvironmentAudio.java" "$ROOT/tests/AmbientEngineTest.java" "$ROOT/tests/EventScoreTest.java" "$ROOT/tests/CompositionEngineTest.java" "$ROOT/tests/NoteHistoryTest.java"
fi
java -cp "$OUT" AmbientEngineTest

java -cp "$OUT" EventScoreTest

java -cp "$OUT" CompositionEngineTest

java -cp "$OUT" NoteHistoryTest
