# Prepared electronic drums, with an audible comparison

This branch adds real, pre-made audio files to the offline SOU1 rack. It does
not install Surge XT or turn a desktop VST into a browser plugin. Production
PWA/Android remain unchanged.

## What is included

Five **x0xproc1** one-shots by Kevin B. / Fugue State Audio: kick, snare, closed
hi-hat, open hi-hat and clap. These are the author's prepared electronic sounds,
created with synthesis and processing. They are not new oscillator formulas in
SOU1, and are not represented as recordings of a particular Roland machine.

The original stereo PCM24 files total 617,620 bytes. The compact bank is mono
PCM24/44.1 kHz, with one recording per articulation. There are no velocity layers,
round robins or a complete acoustic kit. SOU1's velocity and pan still apply.

The converter performs `(L+R)/2`, a fixed 15 Hz one-pole DC blocker and an 88-frame
endpoint fade. It retains every frame and does not resample or normalize the
hits. These are explicit compact-bank transformations, not a claim that a DC
measurement proved an audible defect in the source. The original WAVs are
identified by exact Git blob and SHA256 hashes in `assets/fsa-electronic/upstream.json`.

## Use it with the existing composition engine

```sh
node tools/music-for-video.mjs render --engine cc0 --drum-kit fsa-electronic --profile pulse --seed 7311 --seconds 32 --gain-db 4 --out output/electronic
node tools/music-for-video.mjs replay output/electronic.json --out output/electronic-repeat
```

In a JSON recipe, use `options.drumKit: "fsa-electronic"`. `vcsl` remains the
default and retains the previous PCM output. The choice is rejected by the
original `synth` backend; it is not silently ignored.

The new bank replaces kick/snare/closed hat. Original EventScore notes, timing,
gates, pan and layer gains are unchanged. VCSL marimba, toms, shaker and short
clash remain. The receipt lists both banks and the sample-instrument-to-bank
mapping; replay fingerprints the selected manifest. Open hat and clap are
available to the rack but the original EventScore does not generate them.

## Explicit drum-machine demo and common-note A/B

```sh
node tools/drum-machine.mjs examples/cues/drums-fsa.json output/drums
node tools/drum-machine.mjs examples/cues/drums-ab-old.json output/ab-old
node tools/drum-machine.mjs examples/cues/drums-ab-fsa.json output/ab-fsa
```

The first is a fixed-pattern sequencer with all five articulations, not a new
generative composition model. Patterns are `broken-beat` or `four-on-floor`,
1..32 bars, 60..180 BPM, 44.1/48 kHz. All events, frame counts and stats are saved.

The two A/B recipes use identical common kick/snare/closed-hat events. A is the
original pinned SOU1 oscillator voices and master, with the built-in scheduler
replaced by that same pattern and its startup fade disabled. B uses the prepared
samples. The old backend has no equivalent clap/open-hat voice, so `extended`
must be false for A. Different voices/master processing are the point of this
comparison; it is not an isolated impulse-response experiment.

Raw renders use the stated gain, **not loudness matching**. Compare at a suitable
listening level. An exported comparison preview may apply a separately reported
constant gain per segment; do not confuse this with source normalization or an
automatic mastering feature. Numeric checks cannot certify musical quality.

The hats share the rack's symmetric 5 ms choke group. Patterns never issue
zero-velocity or simultaneous open/closed hats. Direct rack clients must know
that same-frame order matters, a silent event can choke, and a full voice pool
rejects a new hit before choke. The renderers reject dropped/unmapped events.
There is a two-second transport tail; no automatic musical cadence.

## Provenance and rights

- [Pinned Stargate sample pack](https://github.com/stargatedaw/stargate-sample-pack/tree/dbfd6ec52d4ed53b60bdbea5fc6adf295127c027/stargate-sample-pack/fugue-state-audio)
- [Author's public-domain declaration](https://github.com/stargatedaw/stargate-sample-pack/blob/dbfd6ec52d4ed53b60bdbea5fc6adf295127c027/stargate-sample-pack/fugue-state-audio/readme.md)
- [CC0 licence](https://github.com/stargatedaw/stargate-sample-pack/blob/dbfd6ec52d4ed53b60bdbea5fc6adf295127c027/LICENSE)

The author's declaration and repository CC0 cover the selected samples, including
commercial music and sample redistribution. Copies are retained alongside the
bank. SOU1 code remains **AGPL-3.0-only**. Code, presets and recordings have
separate licences; this does not make Surge XT code/factory assets CC0 or grant
rights to arbitrary downloaded kits. No exclusive rights or platform-claim
immunity are promised.

To reproduce the bank from the five original files, already obtained separately:

```sh
python3 tools/prepare-fsa-bank.py /path/to/original-wavs /tmp/fsa-rebuilt
```

This verifies pinned source hashes and performs no downloads. Rendering needs
only Node and the included bank, not Python, ffmpeg, a DAW or network access.
Actual listening approval, browser/device playback and production integration
are still separate work.
