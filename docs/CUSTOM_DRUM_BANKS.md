# Bounded per-role recorded drum assembly

This component adds an explicit preparation API, not a second playback engine.
It selects five existing recorded instruments from the nine bundled CC0 kits.
No sound is downloaded from an upstream site, clipped, normalized, trimmed,
randomized or remixed. The existing preparation-only resampling remains intact.
Existing whole-kit code, assets, source locks and default outputs are unchanged.

## JavaScript API

`docs/custom-drum-selection.js` is a dependency-free pure selector for UI and
service validation. `docs/custom-drum-bank.js` imports and re-exports its complete
API, preserving the preparation API. The selection module exports these frozen
small registries:

- `CUSTOM_DRUM_KITS`: `vcsl`, `fsa-electronic`, `fsa-distkit`, `fsa-sdbkit`,
  `fsa-synthkit`, `fsa-x0xproc1`, `fsa-x0xproc2`, `guigui-soft`, `guigui-dynamic`.
- `CUSTOM_DRUM_ROLES`: `kick`, `snare`, `hihat`, `toms`, `cymbal`.
- `CUSTOM_DRUM_INSTRUMENTS`: `kick`, `snare`, `closed-hat`, `toms`, `short-clash`.

`normalizeCustomDrumSelection(baseKit, overrides = {})` returns a deeply frozen
selector with `baseKit`, all five `overrides`, all five `resolvedKits`, and `key`.
A missing role means `inherit`. Explicitly choosing the base kit canonicalizes to
`inherit`. Unknown own keys, non-string values, accessor properties, non-plain
objects, unknown kits, URLs and procedural/recorded mixtures reject before I/O.
No coercion, URL decoding, inherited property interpretation or path construction
from user tokens is performed.

`customDrumSelectionKey(baseKit, overrides = {})` returns the canonical key.
`isSupportedDrumSelection(key)` returns a boolean; procedural is false.
`parseCustomDrumSelection(key)` accepts only canonical keys and returns the same
frozen selector. A plain kit ID denotes all inherited roles. A custom key is:

```
custom-v1|BASE|KICK|SNARE|HIHAT|TOMS|CYMBAL
```

Each field is either a closed recorded kit ID or, for a role, `inherit`.
Noncanonical custom strings that are equivalent to a plain kit ID are rejected.
This keeps the existing String-based asynchronous preparation lifecycle usable.

`prepareCustomDrumBank(baseKit, overrides, rate, {fetcher, assetBaseUrl})` returns
`{wireBank, report}`. `rate` is an integer from 8,000 through 192,000 Hz.
With all roles inherited it calls the existing `prepareDrumBank` unchanged and
returns exactly its original report and PCM. That path retains its original
schema. A changed selection returns `sou1.prepared-custom-drums.v1`.

Keep procedural audio on its existing whole-engine path. The new APIs reject
`procedural`, including all-inherit procedural input. They never create a mixed
procedural/recorded bank or recover a failed selected kit by substituting another.

## Deterministic random UI combinations

`deterministicRandomDrumOverrides(seed, baseKit, overrides = {}, locks = {})`
returns a frozen raw five-role override object, without PCM, I/O or audio imports.
The seed must be an unsigned 32-bit integer, 0 through 4,294,967,295. Each role
uses its own fixed integer hash, so changing a lock, another role or the base kit
does not reroll unlocked roles. An unlocked role draws one of the nine recorded
kit IDs, independently of the other roles. This is reproducible UI variety, not
cryptographic randomness.

A true role lock preserves its original input exactly: explicit base ID stays
that ID, explicit `inherit` stays `inherit`, and an omitted locked role becomes
`inherit`. A false or absent lock allows the role to be redrawn. Canonicalize only
when constructing the preparation key; keep these raw values in editable UI
state so explicit choices are not silently changed into inheritance.

Unknown lock keys, non-boolean lock values, accessors, invalid override values,
invalid seeds and procedural bases reject. The UI should disable per-role/random
assembly while its base is procedural. Randomization does not modify its input
objects and does not change any preparation or playback semantics.

## Native Java API

The only modified production Java file is `NativeDrumBankLoader.java`.

- `normalizeCustomSelection(String baseKit, Map<String,String> overrides)`
- `customSelectionKey(String baseKit, Map<String,String> overrides)`
- `parseCustomSelection(String key)`
- `prepareCustom(String baseKit, Map<String,String> overrides, int rate,
  AssetReader reader[, Budgets budgets])`
- `prepareSelection(String key, int rate, AssetReader reader[, Budgets budgets])`

`CustomSelection` and its maps are immutable. `CUSTOM_ROLES` and the existing
`supportedKits()` are immutable small registries. Use an empty map for no native
overrides; null is rejected. Both preparation entry points return the existing
`Prepared` type with an immutable `LiveDrumPool.Bank`. No mutable PCM accessor was
added and `LiveDrumPool` is unchanged. Plain IDs delegate to the old `prepare`
path. Existing `Report` fields retain their values. New `selection` and `memory`
fields are null on that old path; new maps/lists are empty.

For a custom selection Java preflights all selected source and final PCM budgets
before opening even the lock file. It verifies the immutable catalog lock, every
selected source manifest and all WAVs declared by those sources. Preparation
remains synchronous off-thread, cancellation uses the existing interruption
checks, streams close on errors, and callers own atomic publication/cancellation.

## Source mapping and sound behavior

Source roles retain the chosen kit's existing fallback semantics. For example,
FSA electronic toms and FSA SDB cymbal resolve to VCSL, as they did when choosing
those whole kits. `roleSources` records both the requested kit and actual source
manifest ID, path, SHA-256 and upstream commit. This is not a silent failure
fallback. Invalid or broken sources reject.

Definitions always appear in the five-instrument order above. Their gains,
one-shot flags, choke groups, zone order, round-robin order, velocity bounds and
key ranges come from the existing selected definition. Pitched source zones are
materialized in ascending MIDI-key order exactly as before.

Custom sample slots are assigned by first occurrence in canonical instrument and
zone order. Exact identities share a slot: bundled WAV SHA-256, original sample
rate, original root note and materialized pitch (or unpitched). Similar-sounding
samples, PCM that merely happens to match, and distinct pitch/root identities
are not coalesced. Deduplication never drops zones or alters their RR order.

Custom `sampleOrigins[sampleIndex]` lists every contributing role, selected kit,
actual bank ID, manifest and manifest SHA-256, source commit, sample ID, file,
bundled WAV SHA-256, original sample rate and root note. `converted` retains
output Float32 SHA-256, frame count, source/target rates, pitch, ratio and peak.
The exact source manifest supplies full authorship, license and upstream file
provenance. Original documented Guigui hard-hit rail contacts remain unchanged.

## Memory and failure bounds

Only actual role-source manifests load, once each, in canonical first-use order.
At most five sources are needed. Each source is completely checked and decoded
sequentially, then only selected prepared PCM survives into the next source.

- Final prepared mono Float32 PCM: at most 32 sample slots and 16 MiB.
- At most 64 zones per instrument, 16 materialized pitches per original zone and
  10 seconds per prepared sample; reconstruction ratio remains 0.125 through 8.
- Encoded WAV bytes across distinct sources: at most 12 MiB.
- Per-source decoded PCM and JS mapped copies: at most 8 MiB each.
- Native custom `Budgets.decodedBytes` / `mappedBytes` tighten each source's
  bound; they are **not** aggregate counters for this sequential custom path.
  Their meaning for the unchanged original whole-kit path remains unchanged.
- Reports' `sourceDecodedBytes` and `sourceMappedBytes` are cumulative work,
  not simultaneous resident PCM. A valid mix can have a cumulative mapped sum
  above 16 MiB while staying under the per-source limits.

`memory` reports peak source decoded/mapped bytes, a conservative transient PCM
bound, an encoded-buffer bound including bounded manifest reads, and the extra
prepared PCM copy at publication. JS bounds include source decoded PCM plus
`SampleInstrument` mapped copies. Native does not make those mapped copies but
its immutable `Bank` constructor privately copies final prepared PCM once.
Bounds describe live sample buffers, not VM heap, object headers, crypto/browser
internals, garbage-collection timing or a hard whole-process RSS ceiling.

Preparation failures return no bank. There is no pool/service mutation, partial
publication, fallback to procedural, or arbitrary external asset selector.

## Verification

Run `sh tests/run-custom-drum-banks.sh` for the focused custom component checks.
They include all-nine-bank inherited/default PCM and report identity, canonical
selectors, invalid values before I/O, five-source combinations, actual source
attribution, fallback visibility, RR and velocity order, repeat replay, checksum
failure, 32-slot and 16-MiB malicious-manifest fixtures, Java immutable reports,
preflight budget failure and interruption. The custom Java oracle compares ten
actual combinations/rates, including 8 kHz and 192 kHz, against every prepared
Float32 frame, conversion and instrument/zone/source field.

The bundled current data has a conservative all-combination maximum of 14 sample
slots and 14,367,656 prepared bytes at 192 kHz. Per-role maxima cover every one
of the 9^5 resolved role selections, and ratio endpoints cover 8–192 kHz. Runtime
caps still reject malformed or expanded fixtures.

The original native bank suite is `sh tests/run-native-drum-banks.sh`.
These are host tests. No Android build, UI, service, worklet, physical audio,
audio-device latency or on-device memory qualification is claimed here.
