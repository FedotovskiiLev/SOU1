#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT HUP INT TERM
node --test "$ROOT/tests/custom-drum-bank.test.mjs" "$ROOT/tests/custom-drum-selection.test.mjs"
node "$ROOT/tests/custom-drum-bank-vectors.mjs" "$OUT/custom-banks.bin"
set -- -source 17 -target 17 -Xlint:all,-options -Werror -d "$OUT" "$ROOT/app/src/main/java/org/sou1/audio/LiveDrumPool.java" "$ROOT/app/src/main/java/org/sou1/audio/NativeDrumBankLoader.java" "$ROOT/app/src/main/java/org/sou1/audio/NativeDrumCatalog.java" "$ROOT/tests/CustomDrumBankTest.java"
if command -v javac >/dev/null 2>&1; then javac "$@"; else java -m jdk.compiler/com.sun.tools.javac.Main "$@"; fi
java -Xmx192m -cp "$OUT" org.sou1.audio.CustomDrumBankTest "$ROOT/docs" "$OUT/custom-banks.bin"
