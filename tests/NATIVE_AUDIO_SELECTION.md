# Native 0.3 selection integration verification

This is a source/JVM integration report, not an Android SDK, APK, device or
listening acceptance report. Run `sh tests/run-native-selection.sh` in the
combined candidate containing the frozen drum/config/melodic dependencies and
bundled assets.

## Production changes

- `MainActivity` validates supplied `drumKit`, `scoreMode`, nested `scoreConfig`
  and `melodicPreset` before dispatch. The nested object uses
  `DevelopmentConfig.fromMap`: unknown fields, numeric strings, null, arrays,
  invalid enums and out-of-range values are not coerced. Intent transport uses
  its exact canonical native key.
- For stopped bridge PLAY, absent `scoreMode`, `scoreConfig` and
  `melodicPreset` explicitly use original, automatic defaults and procedural.
  A previous new-client preference cannot silently change an old client's
  sound. MediaSession Play instead reuses the restored saved selection.
- Capabilities retain `sou1.native-audio.v1`, old drum IDs and score modes, and
  add `scoreConfigSchema: sou1.development-config.v1`,
  `customDrums: custom-v1`, and exactly procedural/chamber/piano-room/chamber-flute.
- `NativeAudioSelection` freezes all four selections in one immutable value.
  `PlaybackService` validates the complete next value before one assignment,
  and only when a new PLAY starts from stopped. UPDATE, STOP and repeated PLAY
  do not replace it. Status and preferences carry all eight score fields as
  an actual nested object, the actual palette, and the original current fields.
- The unchanged bounded `DrumPreparation` worker loads the selected drum bank
  first, then the melodic bank. Its process-wide single worker and queue of one
  remain unchanged. Explicit checks preserve interruption between loads. Only
  the final pair is published; a failed melodic load cannot start drums alone.
  A late pair cannot activate after stop/destroy, and prepared bank references
  are cleared by the existing cancellation coordinator.
- Engine construction receives both banks, the frozen score mode/config, and
  the latest pending seed and parameters. Timer starts after preparation and
  retains the latest pending TIMER update. AudioTrack teardown, Android
  permissions, local-WebView security, media focus and lifecycle policy remain
  unchanged.

## Executed checks

- Production helper plus frozen loaders compiled with Java 17,
  `-Xlint:all,-options -Werror`; no Android stubs or mocked SDK were used.
- 261 assertions in `NativeAudioSelectionTest`: canonical whole/custom
  selections and strict config grammar; all four palettes; actual custom drum
  + chamber assets prepared sequentially on the existing worker; duplicate
  requests coalesce; latest owner control/seed/timer state is used at delivery;
  either load can be cancelled; failed melody never publishes partial drums;
  queued ready pairs cannot revive a stopped session; explicit clean retry.
- 226 existing `DrumPreparationTest` assertions still pass, covering bounded
  cross-owner jobs, cancellation churn, interruption, stale ready delivery,
  failure, repeated PLAY and destroy.
- Parse-only Java checks cover bridge/service/coordinator/selection syntax.
  Source guards cover atomic frozen selection, restore/status, capability and
  Intent contracts, legacy bridge defaults, timers/reseed, foreground-before-
  preparation ordering, and unchanged manifest/WebView/AudioTrack guards.

The source guards do not execute Android Service/Handler/SharedPreferences or
JSON APIs. The latest owner-state test is a JVM lifecycle harness, not a claim
of executing Android UI controls. Required release gates remain actual Android
SDK compilation/lint, install and startup, background/lockscreen/focus tests,
physical-device heap/underruns, and audible balance/switching acceptance. Total
heap during paired loading is not limited to either individual bank's PCM cap.

## Merge scope

Merge only these owned files from this isolated directory:

- `app/src/main/java/org/sou1/MainActivity.java`
- `app/src/main/java/org/sou1/PlaybackService.java`
- `app/src/main/java/org/sou1/NativeAudioSelection.java`
- `tests/NativeAudioSelectionTest.java`
- `tests/run-native-selection.sh`
- `tests/run-native-drum-service.sh`
- `tests/native-drum-service-contract.test.mjs`
- `tests/NATIVE_AUDIO_SELECTION.md`

Other new loader/config sources and melodic assets in this isolated copy are
verbatim validation dependencies from their frozen owners, not this worker's
changes. The matching AmbientEngine constructor must come from its separate
integration owner. Add `tests/run-native-selection.sh` to the final aggregate
CI checks when merging. No GitHub operations were performed.
