# Guigui acoustic CC0 kit: soft and dynamic

Two additional offline presets use the **17 authored acoustic Guigui samples by menegass**, distributed as FLAC by Sonic Pi at commit `df6f17e4625b0451fa2af8accf2e1e641c7ad458`.

- `guigui-soft`: the kick, snare, tom, ride and splash aliases always select their soft recording. All original articulations remain directly addressable.
- `guigui-dynamic`: seven aliases use separate soft/hard recordings, with soft at velocity ≤0.6 and hard above 0.6. Two discrete layers, no crossfade, calibration or round robin.

Both share the same 17 WAV assets: **1,410,206 bytes encoded / 2,818,916 bytes unique decoded Float32**. Source FLAC total: 891,093 bytes. The rack copies some buffers for aliases, so these are not whole-process RAM figures. Load one selected preset, not two banks at once.

## Honest articulation names

The source provides two kick, two snare, six tom, two ride and two splash recordings, plus closed/open hats and a sound the author calls **Half Cymbal**. Ride is not crash. The splash filenames say SPLASH while original descriptions say crash; both are recorded in provenance. Half Cymbal is not advertised as a verified pedal/chick sound. It has no inferred hat-choke group.

There is **no clap**. The sample-based drum-machine demo's extended mode adds the available open hat and omits clap rather than inventing or secretly borrowing one. There are real, separate high/mid/low tom recordings; 49/47/45 are articulation keys, not claims about concert pitch. The EventScore historical `short-clash` key selects the Guigui splash.

```sh
node tools/drum-machine.mjs examples/cues/drums-guigui-soft.json output/acoustic-soft
node tools/drum-machine.mjs examples/cues/drums-guigui-dynamic.json output/acoustic-dynamic
node tools/music-for-video.mjs render --engine cc0 --drum-kit guigui-dynamic --profile pulse --seconds 32 --seed 7311 --gain-db 0 --out output/acoustic-score
```

Use `source:"samples"` for these drum-machine recipes. The previous `source:"fsa"` label is reserved for the electronic FSA sounds. `renderDrumStem` also accepts either Guigui kit for arbitrary supplied note events, with its existing bounded input and exact event-accounting rules.

EventScore already scales note velocity by its layer gain. That means a quiet default profile may remain below 0.6 and use only soft samples even when the dynamic kit is selected. This adapter preserves those original note values; it does not silently increase volume or rewrite note dynamics. To compare the two timbres directly, use the identical-note drum demos, whose accented notes exceed the split. Volume and timbre controls are not separated in the existing EventScore contract.

## Source quality checks, not listening approval

All 17 FLAC files were losslessly decoded with installed ffmpeg. Every decoded PCM MD5 matches FLAC STREAMINFO, including the exact frame count, 44.1 kHz rate and mono PCM16 format. Repackaging only replaces the WAV container header. **No PCM sample is changed**: no normalization, DC filter, fade, resample, trim or claimed repair.

Five original hard recordings touch PCM digital rails: bass 186 samples, snare 33, high/mid/low tom 18/27/30. The longest continuous same-rail sequence is 1–2 samples. This is not evidence of sustained flat-top clipping, pristine recording, or subjective audible quality. It predates decoding. All first samples are zero; last samples are within ±2 LSB. Raw numerical QC is retained in `assets/guigui-drums/source-qc.json` and summarized per sample in each manifest.

The comparison preview uses identical note events, a constant per-segment gain toward measured −23 LUFS, and MP3 compression. No compressor, limiter or audio restoration is added. A user listening decision is still needed before describing either sound as preferred.

## Licensing and scope

- [Pinned official Sonic Pi Samples license](https://github.com/sonic-pi-net/sonic-pi/blob/df6f17e4625b0451fa2af8accf2e1e641c7ad458/LICENSE.md#samples): CC0, separate from the program's code licenses.
- [Pinned per-file author/source mapping](https://github.com/sonic-pi-net/sonic-pi/blob/df6f17e4625b0451fa2af8accf2e1e641c7ad458/etc/samples/README.md).
- [Original Guigui acoustic drum pack](https://freesound.org/people/menegass/packs/6393/).

For eight files, CC0 was independently retrieved from the individual original Freesound pages. For nine, the evidence is the pinned official Sonic Pi CC0 declaration and per-file author mapping; the current original license page was not independently retrieved. No conflicting condition was found in these 17. This distinction is explicit in `upstream.json` and each output manifest. Our hashes identify the Sonic Pi FLAC, not original Freesound WAVs; upstream may have trimmed or otherwise processed those originals.

The complete Sonic Pi samples folder is **not** imported or endorsed wholesale. Research excluded `perc_till`, whose original description mentions a CC BY 4.0 remix component despite its CC0 badge, and `hat_bdu`, whose third-party TR606 source permissions were not established. “Load all usable CC0 drums” requires checking actual source chains, not trusting a folder label. These excluded files are not bundled.

SOU1 code remains AGPL-3.0-only. The included audio is declared CC0. No code from Sonic Pi is imported. Its complete upstream license document is retained for provenance; the Samples section is the relevant section for these audio assets.

## Deterministic rebuild

Keep the exact pinned FLAC files and their previously losslessly decoded WAVs under `decoded/`, with the filenames recorded in `source-qc.json`:

```sh
python3 tools/prepare-guigui-drums.py /path/to/verified/sonic-pi-menegass /tmp/rebuilt-guigui
```

The script checks every FLAC's Git blob SHA1 and SHA256, every decoded WAV's PCM format/frame count and MD5, and writes canonical PCM16 WAVs plus both manifests. It does not download, install or decode arbitrary software. The source acquisition metadata is immutable; its initial `pcmDecoded:false` is superseded by the separate verified decode report.

Offline implementation only. Production PWA/Android, GUI audio playback, VST hosting and a release are not included in this change.
