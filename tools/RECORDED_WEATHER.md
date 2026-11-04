# Bundled weather

The default weather source is recorded CC0 weather; the existing controls still start at zero. Choose `Original procedural` while stopped to use the previous sample-free weather. Explicit saved choices survive reload, preset and seed changes. Older native bridges retain unsupported choices while using procedural playback.

Only processed derivatives are bundled: rain/wind12-second cyclic excerpts and one finite16-second thunder event,1,920,132bytes total. The sources are public lossy MP3 previews, not original WAV recordings. Individual CC0 attribution, source/derivative hashes and processing are in `docs/weather-assets/manifest.json` and NOTICE. SOU1 code remains AGPL-3.0-only and root LICENSE remains packaged as LICENSE.txt by syncWebAssets.

Preparation and16-tap resampling run in a dedicated browser Worker or native preparation worker. Worklet/audio rendering receives owned prepared PCM and performs no decoding or network access. Rain/wind wrap their preprocessed cyclic buffers. Seeded thunder starts after6–12seconds and subsequent events are separated by a finite tail and a25–60second or longer waiting interval. Controls/type/Stop are smoothed; procedural selection retains the old PCM path.

Verified locally: asset integrity/headroom/wrap metrics,180-second recorded-weather render with rare thunder, deterministic reset/reseed/Stop, zero-source procedural compatibility, UI ownership/transfer/reload/capability fallback and race contracts. Actual browser listening and Android/native compilation are separate release gates. `tests/run-recorded-weather.sh` runs actual JVM/JS PCM parity when a JDK is available; this laptop currently has a JRE without jdk.compiler.
