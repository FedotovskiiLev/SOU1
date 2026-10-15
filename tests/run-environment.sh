#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT HUP INT TERM
if command -v javac >/dev/null 2>&1; then
 javac -d "$OUT" "$ROOT/app/src/main/java/org/sou1/audio/EnvironmentAudio.java" "$ROOT/tests/EnvironmentAudioTest.java"
else
 java -m jdk.compiler/com.sun.tools.javac.Main -d "$OUT" "$ROOT/app/src/main/java/org/sou1/audio/EnvironmentAudio.java" "$ROOT/tests/EnvironmentAudioTest.java"
fi
java -cp "$OUT" EnvironmentAudioTest
node "$ROOT/tests/environment-audio.test.mjs"
