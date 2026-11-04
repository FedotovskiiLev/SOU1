#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# Required local Node + JDK checks. Does not build/install an APK or use network.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT HUP INT TERM
node "$ROOT/tools/generate-native-drum-catalog.mjs" --check
node --test "$ROOT/tests/native-drum-catalog.test.mjs"
node "$ROOT/tests/native-drum-bank-vectors.mjs" "$OUT/js-banks.bin"
set -- -source 17 -target 17 -Xlint:all,-options -Werror -d "$OUT" \
    "$ROOT/app/src/main/java/org/sou1/audio/LiveDrumPool.java" \
    "$ROOT/app/src/main/java/org/sou1/audio/NativeDrumBankLoader.java" \
    "$ROOT/app/src/main/java/org/sou1/audio/NativeDrumCatalog.java" \
    "$ROOT/tests/NativeDrumBankLoaderTest.java"
if command -v javac >/dev/null 2>&1; then javac "$@"
else java -m jdk.compiler/com.sun.tools.javac.Main "$@"; fi
java -Xmx192m -cp "$OUT" org.sou1.audio.NativeDrumBankLoaderTest "$ROOT/docs" "$OUT/js-banks.bin"
