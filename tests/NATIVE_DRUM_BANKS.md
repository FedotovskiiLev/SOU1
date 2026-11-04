# Native recorded-drum preparation

`NativeDrumBankLoader` is a pure Java, synchronous preparation building block.
It does not change `AmbientEngine`, `LiveDrumPool`, `PlaybackService`, controls,
the melodic generator, weather, shared effects, or the SOU1 concept. It adds no
network requests, dependencies, asset normalization, or Android permission.

## Contract

- `supportedKits()` returns the closed immutable nine-kit registry: `vcsl`,
  `fsa-electronic`, the five full FSA kits, `guigui-soft`, `guigui-dynamic`.
  `procedural`, unknown IDs, URLs and constructed paths are rejected before I/O.
- `prepare(kit, rate, reader)` returns `Prepared.bank`, an immutable
  `LiveDrumPool.Bank`, and immutable `Prepared.report` provenance/budget/hash
  evidence. The optional `Budgets` argument can lower, never raise, hard caps.
- `AssetReader.open(relativePath)` supplies a fresh stream rooted at the existing
  Android web-assets root. An eventual Android adapter can pass
  `assetManager::open`; the loader requests `audio-kit/SOURCE_LOCK.json`, the
  selected fixed manifests, and their fixed WAV filenames. Every stream closes
  on success, failure or interruption.
- Run preparation on a dedicated non-render worker. It is intentionally not
  integrated with the Android service in this change. Cancellation checks retain
  the Java interruption flag. The caller must still reject stale results using
  its own request/generation token before atomically publishing the bank.
- Target rates are integer 8,000–192,000 Hz, subject to ratio/length/memory caps.
  48 kHz is the Android target. `LiveDrumPool` must receive the same target rate.
- It loads and validates every source sample, including unused articulations,
  before returning. VCSL supplies absent FSA instruments. The final bank contains
  exactly kick, snare, closed hat, toms, and short clash in canonical order.
- The existing 16-tap Hann-windowed sinc and Float32 storage match
  `docs/drum-bank.js`: rate conversion, root-note transposition, pitched zone
  expansion, same-sample caching within an instrument, inclusive velocity
  boundaries, gains and choke groups are preserved. Guigui's `.6` /
  `.6000000000000001` split remains exact. There is no deduplication across
  instrument identities.
- Source PCM16/24 is decoded exactly. Original PCM/files are never altered.
  Prepared sinc reconstruction can exceed the source peak, including unity;
  values up to magnitude 2 are allowed. No clipping, normalization, filtering,
  repair, or mastering claim is introduced. Existing source transformations and
  hard-hit rail contacts remain documented in the original bundled manifests.

## Closed catalog, not another JSON implementation on Android

`tools/generate-native-drum-catalog.mjs` derives the Java registry and descriptions
from the existing registry and manifests, not a second hand-maintained mapping.
It checks all 118 locked package files against their sizes, SHA-256 hashes and
original repository-local source bytes, then validates manifests/WAVs with the
canonical JS loader. Before that loader, a bounded JSON validation pass rejects
ambiguous duplicate keys, invalid UTF-8, excessive depth/node count and non-finite
numeric literals. Symbolic links, non-regular files, traversal, oversize files,
and mismatched source copies are rejected.

Run after intentionally updating/repackaging the source assets:

    node tools/generate-native-drum-catalog.mjs

Check reproducibility without writing:

    node tools/generate-native-drum-catalog.mjs --check

`NativeDrumCatalog.java` is generated and committed with exact manifest size,
SHA-256 and source commit plus the package-lock size/SHA. At runtime the loader
checks the complete exact lock and selected manifest bytes before reading any
WAV. A changed manifest fails closed, even if it is otherwise valid JSON. Every
WAV is independently checked for exact byte length/SHA and strict RIFF, chunk,
PCM, mono, sample-rate, frame-count and decoded-shape consistency. The runtime
therefore needs no JSON dependency or permission to accept arbitrary manifests.
The existing Gradle web-assets sync already bundles these exact files; this
building block does not alter Gradle or automatic service activation.

## Bounds and allocation

All selected catalog metadata, source/mapped totals, expanded zones, conversion
ratios, prepared frame counts and final aggregate budget are checked before any
asset I/O. Hard caps match or tighten the JS preparer:

- Manifest/package lock: 128 KiB each; one base and at most one overlay bank.
- Source WAV: 4 MiB each; 12 MiB encoded total.
- Source mono Float32: 8 MiB per bank, 16 MiB total.
- Mapped logical source PCM: 8 MiB per bank, 16 MiB total. Counts include all
  declared instruments, just as the canonical JS report does, even when native
  immutable arrays can safely share storage.
- Prepared bank: 32 samples, 64 expanded zones per instrument, 16 pitched keys
  per source zone, ratio 0.125–8, 10 seconds per sample, 16 MiB total Float32.
- Bank construction takes a defensive PCM copy. Preparation may simultaneously
  hold up to 16 MiB source PCM, 16 MiB prepared PCM, its 16 MiB immutable-bank
  copy, and one bounded 4 MiB encoded buffer, plus ordinary metadata/VM overhead.
  These are live-payload bounds, not a promise of a particular process RSS or
  garbage collector behavior. Preparation is never an audio-thread operation.

Production Java uses Android-26-available library APIs, ordinary classes and
collections, without Java records or Java-9 collection factories. Host Java 17
compilation is checked; this is not proof of an APK build or on-device behavior.

## Verification

Run the complete focused suite (local files only):

    tests/run-native-drum-banks.sh

It includes catalog reproducibility and mutation tests, strict Java compilation
with warnings as errors, stream/path/corruption/budget/cancellation tests, PCM16
and PCM24 edge cases, and complete binary Float32 comparison with canonical JS.
No fixture approximations or mock sample banks are used for the parity gate.

Verified on the host JDK/Node:

- All nine actual banks at both 44.1 and 48 kHz, plus VCSL at 8 and 192 kHz.
- 20 bank preparations, 156 prepared samples, 9,997,004 frames compared.
- All 156 PCM SHA-256 hashes and all frames bit-identical on this host, with
  maximum absolute error zero. The portable gate permits at most 2e-7 absolute
  Float32 error for possible cross-runtime transcendental differences and still
  requires exact sample counts, zones, metadata and native report hashes.
- Every bank drives the unchanged native voice pool with all seven current drum
  note routes mapped, preserving round-robin and velocity definitions.
- Corrupted lock, manifest, unused sample and selected sample fail atomically;
  truncation, trailing bytes, stream failure, interruption and zero-length reads
  are handled without leaking streams or silently substituting another bank.

Not run/claimed: APK compilation, Android service wiring, install/device test,
Bluetooth/background audio behavior, perceptual listening approval, or release.
