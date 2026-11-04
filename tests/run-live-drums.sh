#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# Pure JDK numerical/API checks; Node adds comparison against canonical JS.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT HUP INT TERM
# Source/target also work in slim JDKs without the --release symbol archives.
if command -v javac >/dev/null 2>&1; then
    javac -source 17 -target 17 -Xlint:all,-options -Werror -d "$OUT" "$ROOT/app/src/main/java/org/sou1/audio/LiveDrumPool.java" "$ROOT/tests/LiveDrumPoolTest.java"
else
    java -m jdk.compiler/com.sun.tools.javac.Main -source 17 -target 17 -Xlint:all,-options -Werror -d "$OUT" "$ROOT/app/src/main/java/org/sou1/audio/LiveDrumPool.java" "$ROOT/tests/LiveDrumPoolTest.java"
fi
if command -v node >/dev/null 2>&1; then
    node --input-type=module - "$ROOT/docs/live-drum-pool.js" > "$OUT/js-vectors.tsv" <<'JS'
import {readFile} from 'node:fs/promises';
const source = await readFile(process.argv[2], 'utf8');
const {LiveDrumPool} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const ids = ['kick', 'snare', 'closed-hat', 'toms', 'short-clash'];
const zone = (sampleIndex, keyLow = 0, keyHigh = 127, velocityLow = 0, velocityHigh = 1) =>
  ({sampleIndex, keyLow, keyHigh, velocityLow, velocityHigh});
for (const rate of [8000, 44100, 48000]) {
  const samples = Array.from({length: 4}, (_, j) => Float32Array.from({length: rate / 2},
    (_, i) => (((i * 13 + j * 11) % 97) - 48) / 31));
  const instruments = ids.map(id => ({id, gain: 1, oneShot: true, chokeGroup: null, zones: [zone(0)]}));
  instruments[0].gain = .72; instruments[0].zones = [zone(0, 35, 38, 0, .5), zone(1, 36, 40, .5, 1)];
  instruments[1].zones = [zone(2), zone(3)];
  instruments[2].gain = .6; instruments[2].chokeGroup = 'metal'; instruments[2].zones = [zone(1), zone(3)];
  instruments[3].gain = .9; instruments[3].zones = [zone(2, 41, 64)];
  instruments[4].gain = .8; instruments[4].chokeGroup = 'metal';
  const pool = new LiveDrumPool(rate, {sampleRate: rate, samples, instruments});
  const gains = new Float64Array([1, 1, 1, 1, 1]);
  let enabled = true;
  for (let frame = 0; frame < 6000; frame++) {
    if (frame === 1900) { enabled = false; pool.setEnabled(false); }
    if (frame === 2200) { enabled = true; pool.setEnabled(true); }
    if (frame === 2500) gains[1] = .2;
    if (frame === 3000) pool.stop();
    if (frame === 3050) pool.release();
    if (frame === 4100) { enabled = false; pool.setEnabled(false); pool.reset(); }
    if (frame === 4120) { enabled = true; pool.setEnabled(true); }
    if (frame === 4500) gains[2] = NaN;
    if (frame === 4800) gains[2] = 3;
    if (frame % 83 === 0) pool.trigger(5 + frame % 5, 35 + frame % 32, (frame % 9) / 8, (frame % 5) / 4);
    if (frame % 251 === 0) pool.trigger(5, 36, NaN, 0);
    if (frame === 1000) for (let i = 0; i < 30; i++) pool.trigger(6, 38, .8, .25);
    pool.next(gains, enabled);
    console.log([rate, frame, pool.outputL, pool.outputR, pool.activeVoices,
      pool.stats.accepted, pool.stats.dropped, pool.stats.unmapped, pool.stats.choked, pool.enabled].join('\t'));
  }
}
JS
    java -cp "$OUT" LiveDrumPoolTest "$OUT/js-vectors.tsv"
else
    java -cp "$OUT" LiveDrumPoolTest
    printf '%s\n' 'SKIP JS/native vectors: Node is not installed; Java API checks passed.'
fi
