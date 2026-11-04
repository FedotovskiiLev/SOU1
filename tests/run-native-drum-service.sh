#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# Pure-Java lifecycle checks, NOT an Android SDK/APK/device compilation.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT HUP INT TERM
if command -v javac >/dev/null 2>&1; then
    javac -source 17 -target 17 -Xlint:all,-options -Werror -d "$OUT" "$ROOT/app/src/main/java/org/sou1/DrumPreparation.java" "$ROOT/tests/DrumPreparationTest.java" "$ROOT/tests/NativeServiceSyntaxTest.java"
else
    java -m jdk.compiler/com.sun.tools.javac.Main -source 17 -target 17 -Xlint:all,-options -Werror -d "$OUT" "$ROOT/app/src/main/java/org/sou1/DrumPreparation.java" "$ROOT/tests/DrumPreparationTest.java" "$ROOT/tests/NativeServiceSyntaxTest.java"
fi
java -cp "$OUT" org.sou1.DrumPreparationTest
java -cp "$OUT" org.sou1.NativeServiceSyntaxTest "$ROOT/app/src/main/java/org/sou1/PlaybackService.java" "$ROOT/app/src/main/java/org/sou1/MainActivity.java" "$ROOT/app/src/main/java/org/sou1/DrumPreparation.java"
node "$ROOT/tests/native-drum-service-contract.test.mjs"
