# Five complete prepared CC0 drum kits

The offline rack now includes **all 58 WAV one-shots** in the Fugue State Audio drums directory at `stargatedaw/stargate-sample-pack@dbfd6ec52d4ed53b60bdbea5fc6adf295127c027`. This is a complete, bounded source collection, not a claim to have collected every CC0 drum on the internet.

## Select a kit

| CLI kit | Sounds | Encoded mono WAV | Unique decoded Float32 | Character / extra articulations |
| --- | ---: | ---: | ---: | --- |
| `fsa-distkit` | 13 | 1,621,972 B | 2,161,860 B | Dist kit; crash, ride, claves, cowbell, zap |
| `fsa-sdbkit` | 10 | 921,444 B | 1,227,996 B | SDB; sub-a, FM percussion; **no cymbal** |
| `fsa-synthkit` | 11 | 1,116,452 B | 1,487,952 B | Synth kit; crash, ride, 8bit percussion |
| `fsa-x0xproc1` | 11 | 884,366 B | 1,178,504 B | x0x proc 1; crash, ride, rimshot |
| `fsa-x0xproc2` | 13 | 1,260,428 B | 1,679,800 B | x0x proc 2; generic cymbal, claves, cowbell, maracas, rimshot |

Every kit contains kick, snare, clap, closed/open hats and **three separately authored tom samples**. Names describe the source; they do not certify hardware 808/909 recordings or acoustic tuning. These are prepared electronic sounds, authored with synthesis. They are not procedurally synthesized each time by SOU1.

Only the selected kit is loaded, not all five. Across all five: 5,804,662 B encoded / 7,736,112 B unique decoded. Original stereo source WAV total: 11,649,836 B. Rack instruments copy sample buffers; aliased tom/cymbal instruments and the EventScore VCSL bank require extra memory. Unique decoded sizes are not whole-process RAM figures.

The earlier five-sound `fsa-electronic` starter and the default `vcsl` remain available. Existing default audio is unchanged. Full x0xproc1 shares byte-identical starter WAV timbres; it adds the remaining six original sounds.

```sh
node tools/music-for-video.mjs profiles
node tools/music-for-video.mjs render --engine cc0 --drum-kit fsa-distkit --profile pulse --seconds 32 --seed 7311 --gain-db 0 --out output/dist-pulse
node tools/drum-machine.mjs examples/cues/drums-synthkit.json output/synth-groove
node tools/music-for-video.mjs replay output/dist-pulse.json --out output/dist-repeat
```

Recipes for all five kits are in `examples/cues/drums-*.json`. `drum-machine` accepts `kit` plus optional `fills:true` for full kits. The common rhythm is unchanged; fills add real high/mid/low toms and the available cymbal. SDB never invents a missing cymbal. `source:"procedural"` is retained only for the honest original-oscillator comparison.

## EventScore and arbitrary stems

The original EventScore adapter preserves events/timing/pitch/gates/pan. Full kits replace kick, snare, closed hat and toms. Historical `short-clash` selects the kit's crash, or the generic x0xproc2 cymbal. **SDB keeps VCSL short-clash**, explicitly identified in `instrumentBanks`; it is a hybrid score render, not an all-SDB kit. Marimba remains VCSL and pad/bass/texture sine substitutes remain unchanged. Additional authored percussion is addressable by its sample ID even though original EventScore does not compose for it.

```js
import {renderDrumStem} from './tools/render-drum-stem.mjs';
const result = await renderDrumStem({
  kit: 'fsa-distkit', sampleRate: 48000,
  activeFrames: 48000 * 8, frames: 48000 * 10,
  events: [
    {instrument:'kick',frame:0,pitch:36,duration:100,velocity:0.8,pan:0.5},
    {instrument:'tom-mid',frame:24000,pitch:47,duration:100,velocity:0.6,pan:0.5}
  ]
});
// result.wav: stereo PCM24 WAV; result.report: full input events, bank/runtime hashes,
// output hash, voice accounting, peak/RMS and explicit limitations.
```

This API composes no new rhythm. Supply existing routed events and frame bounds to create an aligned drum stem for video or a DAW. It supports every sample ID in `assets/fsa-drums/catalog.json`, plus `toms` keys 45/47/49 and `short-clash` where actually present. Other tom keys or absent cymbals fail rather than silently remap. It has no VCSL fallback. Positive velocities only, up to 16,384 events, 44.1/48 kHz, at most 300 seconds, and at least 50 ms plus one frame after the stop. At `activeFrames`, voices release over 50 ms. Stop time is not an automatic musical ending.

One sample per articulation: **no velocity layers or round robins**. Hat choke remains symmetric and event-order dependent. Over-polyphony, unmapped events, clipping and nonfinite output are errors, not hidden losses. No mastering normalization, compressor or effects are added.

## Provenance, license, exact rebuild

[Author's public-domain statement](https://github.com/stargatedaw/stargate-sample-pack/blob/dbfd6ec52d4ed53b60bdbea5fc6adf295127c027/stargate-sample-pack/fugue-state-audio/readme.md), [CC0 license](https://github.com/stargatedaw/stargate-sample-pack/blob/dbfd6ec52d4ed53b60bdbea5fc6adf295127c027/LICENSE), and [complete pinned drums](https://github.com/stargatedaw/stargate-sample-pack/tree/dbfd6ec52d4ed53b60bdbea5fc6adf295127c027/stargate-sample-pack/fugue-state-audio/drums).

`assets/fsa-drums/upstream.json` retains source paths, Git blob SHA1, SHA256, original bytes and PCM metadata for every file. Each output manifest records the same source plus derivative hash and transforms. Author: Kevin B. / Fugue State Audio. Source CC0 permits music and sample redistribution; it does not promise exclusivity or immunity from platform claims. SOU1 code remains **AGPL-3.0-only**, not CC0.

Rebuild from a local exact copy of the original `drums/` directory, with all category folders:

```sh
python3 tools/prepare-fsa-drums.py /path/to/original/drums /tmp/rebuilt-fsa-drums
```

No download/install takes place. Inventory and every source hash are checked before use. Transform is deterministic stereo average → fixed 15 Hz DC blocker → final 88-frame fade → PCM24 ties-to-even, no dither. No trimming, per-sound normalization, resampling or concealed gain changes. RIFF odd-payload padding is explicit. All 58 output WAVs, five manifests and catalog were rebuilt and independently compared byte-for-byte.

## Larger optional sources, not bundled

- [Virtuosity Drums, Versilian Studios](https://versilian-studios.com/virtuosity-drums/): CC0 acoustic kit with detailed velocity mapping. Author's ZIP page says 1.1 GB. Actual pinned Git revision `9f04cf9a734527edfbb0a4eee1f674e45bbf71bc` has 4,858 sample files / **1,468,997,687 B**, entire checkout without Git history 1,488,884,901 B. Those are disk bytes, not decoded RAM. Full download and integration are not complete. 238 files exceed the current 1 MiB connector base64 limit. Do not treat adjacent velocities as round robin without reading each mapping.
- [Karoryfer Gogodze Phu Vol II](https://shop.karoryfer.com/pages/free-gogodze-phu-vol-ii): CC0, about 133 MB archive / over 400 MB extracted; 1,701 samples. An optional acoustic alternative with no full crash/ride section. Not downloaded or integrated.
- [Sonic Pi samples](https://github.com/sonic-pi-net/sonic-pi/blob/dev/LICENSE.md): sample license CC0, separate from the program's license. A possible compact supplementary collection, not silently included in these five kits.
- [AVL Drumkits](https://www.bandshed.net/avldrumkits/): compact alternatives, but **CC BY-SA 3.0**, not CC0, with a music-output exception. Not bundled in the CC0 selector.

No production PWA/Android change, desktop VST host, Surge installation, release or subjective listening approval is claimed by this work. Browser playback remains a separate unqualified integration.
