# Native recorded-drum service integration

Development integration only. The original procedural kit remains the default.
The Android service can opt into the closed registry exposed by
`NativeDrumBankLoader.supportedKits()`. This uses bundled verified assets, with
no new network, storage, microphone or other permissions.

## Bridge contract

`AndroidBridge.audioCapabilities()` returns JSON with schema
`sou1.native-audio.v1` and `drumKits: ["procedural", ...recordedKitIds]`.
Old callers do not need to query capabilities or supply a request ID.

`play(JSON)` accepts:

- Existing synthesis controls and `seed`, unchanged.
- Optional `drumKit`, a string in the closed registry. Only a stopped new PLAY
  selects a kit. Repeated PLAY while loading/playing retains the existing kit
  and seed, but applies ordinary controls and reports the accepted request ID.
- Optional `requestId`, a numeric, finite, nonnegative integer no larger than
  `9007199254740991`. Strings, fractions, negatives and out-of-range values are
  rejected by the bridge. A supplied valid ID is preserved exactly. Legacy PLAY
  and a fresh MediaSession Play receive `max(previous + 1, clockMillis * 1024)`
  within the safe range. Exhaustion fails explicitly rather than wrapping.
- Optional `timerMinutes`, an integer from 0 through 180, default 0. The timer
  starts when a ready Session begins, not when preparation begins. A TIMER
  command during preparation changes the pending duration. Timer operation does
  not depend on WebView remaining visible or alive.

`play()` returning true means the command was submitted, not that playback has
started. Poll `status()` and match `requestId`. Status includes `preparing`,
`playing`, `drumKit` and `audioError`. During preparation `playing` is false and
no audio Session exists. Successful ready publication creates the engine using
that prepared bank and the latest controls/seed. Stop and failure preserve the
request ID; it also survives Service destruction within the process. New
accepted playback clears a previous error. Failed loading reports an error and
releases foreground/focus resources without falling back to another kit.

UPDATE cannot change a bank. UPDATE, TIMER, RESEED and CLEAR_SCORE do not stop the
service merely because its Session has not been created yet. RESEED during
preparation updates the pending seed. Explicit STOP, focus loss, headphone
disconnection and Service destruction cancel pending preparation. Existing
Session AudioTrack stop/write/flush/release policy remains unchanged.

Kit preferences are saved only from valid new PLAY selection. Restored values
are used only when present in the closed registry; unknown saved values retain
the procedural default.

## Preparation ownership and bounds

`DrumPreparation<T>` has one process-wide background worker and a queue of at
most one job. It accepts one pending job per owner and coalesces repeated PLAY.
STOP/destroy invalidate the job identity before interrupting it, remove queued
work and guard completion again on the main delivery thread. A completed result
waiting in the main queue cannot revive a stopped or destroyed Session. Cancel
also clears the ready bank reference immediately, so obsolete queued delivery
callbacks do not retain PCM banks.

The global worker prevents overlap even if an old cancelled read completes late
while a replacement Service queues a new load. It times out after 30 idle
seconds. An uncooperative operation cannot cause more workers to be created;
the verified loader checks interruption and has fixed byte/frame budgets.
There is no network, uncapped queue, retry loop, decoding or resampling in the
render thread. Engine construction occurs on the main thread from an already
verified immutable bank. Rendering sees only the fully constructed engine.

MainActivity additionally serves `.mjs` as `text/javascript` and `.wav` as
`audio/wav` with no text encoding for binary data. Existing origin, port,
traversal, file/content-access and mixed-content restrictions are unchanged.

## Verification

Run `sh tests/run-native-drum-service.sh` with Java 17+ and Node. It runs:

1. A real single-worker, manually dispatched main-thread lifecycle harness:
   stop during load, interruption, completion queued before stop, retry,
   duplicate PLAY, latest control publication, failed load, destroy, and late
   completion across replacement owners. Cancellation churn verifies bounded
   work and no stale Session revival.
2. Java 17 parse-only syntax checks for the service, bridge and coordinator.
3. Source wiring checks for capabilities, request correlation, closed registry,
   timers, deferred controls, foreground cleanup and local asset security.
   Hash guards verify the existing native cancel/AudioTrack block and manifest
   remain byte-identical to this task's integration baseline.

The lifecycle harness tests the actual coordinator; wiring checks are source
checks, not execution of Android Service/Handler/AudioTrack. The Android SDK is
unavailable in this workspace. APK compilation, Android lint, installation,
actual notification/focus/background behavior and physical-device listening
have **not** been qualified by these tests. Run the project's supported Android
build/lint and device checks before calling this integration release-ready.

## Continuous development score (candidate integration)

An additional closed `scoreMode` selection (`original` or `developing`) travels
with PLAY. The latter uses the live `DevelopmentScore`, not a rendered clip.
The existing original constructors and default remain unchanged. Mode selection
is accepted only for a stopped, new PLAY, preserved through foreground-service
recreation, and acknowledged in status. Repeated PLAY and UPDATE cannot change
an active or preparing session's score mode. The browser validates the matching
acknowledgement, and old native bridges without explicit `scoreModes` capability
continue using the original score. Sound controls, weather, reseed fade, timer,
note history and retained MIDI export use their existing paths.
