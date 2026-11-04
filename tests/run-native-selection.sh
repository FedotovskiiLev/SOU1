#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# Production Java helper + real bundled assets; NOT an Android SDK/APK/device test.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT HUP INT TERM
AUDIO="$ROOT/app/src/main/java/org/sou1/audio"
NATIVE="$ROOT/app/src/main/java/org/sou1"
set -- "$AUDIO/LiveDrumPool.java" "$AUDIO/NativeDrumCatalog.java" "$AUDIO/NativeDrumBankLoader.java" \
    "$AUDIO/LiveMelodicPool.java" "$AUDIO/NativeMelodicCatalog.java" "$AUDIO/NativeMelodicBankLoader.java" \
    "$AUDIO/EnvironmentAudio.java" "$AUDIO/RecordedWeather.java" "$AUDIO/NativeWeatherCatalog.java" "$AUDIO/NativeWeatherBankLoader.java" \
    "$AUDIO/DevelopmentConfig.java" "$NATIVE/NativeAudioSelection.java" "$NATIVE/DrumPreparation.java" \
    "$ROOT/tests/NativeAudioSelectionTest.java"
if command -v javac >/dev/null 2>&1; then
    javac -source 17 -target 17 -Xlint:all,-options,-cast -Werror -d "$OUT" "$@"
else
    java -m jdk.compiler/com.sun.tools.javac.Main -source 17 -target 17 -Xlint:all,-options,-cast -Werror -d "$OUT" "$@"
fi
java -Xmx512m -cp "$OUT" org.sou1.NativeAudioSelectionTest "$ROOT/docs"
sh "$ROOT/tests/run-native-drum-service.sh"
