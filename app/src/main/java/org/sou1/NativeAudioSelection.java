// SPDX-License-Identifier: AGPL-3.0-only
package org.sou1;

import java.io.IOException;
import java.io.InterruptedIOException;
import org.sou1.audio.DevelopmentConfig;
import org.sou1.audio.LiveDrumPool;
import org.sou1.audio.LiveMelodicPool;
import org.sou1.audio.RecordedWeather;
import org.sou1.audio.NativeWeatherBankLoader;
import org.sou1.audio.NativeDrumBankLoader;
import org.sou1.audio.NativeMelodicBankLoader;

/** Immutable stopped-PLAY selection, shared with one bounded preparation job. */
final class NativeAudioSelection {
    static final String PROCEDURAL = "procedural";
    static final NativeAudioSelection DEFAULT = new NativeAudioSelection(PROCEDURAL, "original",
            DevelopmentConfig.DEFAULT, PROCEDURAL);
    final String drumKit, scoreMode, melodicPreset, weatherMode;
    final DevelopmentConfig scoreConfig;
    private final String key;

    NativeAudioSelection(String drumKit, String scoreMode, DevelopmentConfig scoreConfig, String melodicPreset) {
        this(drumKit, scoreMode, scoreConfig, melodicPreset, PROCEDURAL);
    }
    NativeAudioSelection(String drumKit, String scoreMode, DevelopmentConfig scoreConfig, String melodicPreset, String weatherMode) {
        if (!PROCEDURAL.equals(weatherMode) && !"recorded".equals(weatherMode)) throw new IllegalArgumentException("Unsupported weather");
        this.weatherMode = weatherMode;
        if (!isSupportedDrumKit(drumKit)) throw new IllegalArgumentException("Unsupported drum kit");
        if (!isSupportedScoreMode(scoreMode)) throw new IllegalArgumentException("Unsupported score mode");
        if (scoreConfig == null) throw new IllegalArgumentException("Missing development config");
        if (!isSupportedMelodicPreset(melodicPreset)) throw new IllegalArgumentException("Unsupported melodic preset");
        this.drumKit = drumKit; this.scoreMode = scoreMode;
        this.scoreConfig = scoreConfig; this.melodicPreset = melodicPreset;
        // Every component comes from a closed grammar which excludes newlines.
        key = "s1\n" + drumKit + '\n' + scoreMode + '\n' + scoreConfig.canonicalKey() + '\n' + melodicPreset + (PROCEDURAL.equals(weatherMode) ? "" : "\n" + weatherMode);
    }

    static boolean isSupportedDrumKit(String key) {
        if (PROCEDURAL.equals(key)) return true;
        try { NativeDrumBankLoader.parseCustomSelection(key); return true; }
        catch (IllegalArgumentException invalid) { return false; }
    }
    static boolean isSupportedScoreMode(String mode) {
        return "original".equals(mode) || "developing".equals(mode);
    }
    static boolean isSupportedMelodicPreset(String preset) {
        return PROCEDURAL.equals(preset) || NativeMelodicBankLoader.PRESETS.contains(melodicBankPreset(preset));
    }
    static String melodicBankPreset(String preset) {
        return preset != null && preset.endsWith("-ambient") ? preset.substring(0, preset.length() - 8) : preset;
    }
    boolean usesSynthesizedBed() { return melodicPreset.endsWith("-ambient"); }
    boolean needsPreparation() {
        return !PROCEDURAL.equals(drumKit) || !PROCEDURAL.equals(melodicPreset) || !PROCEDURAL.equals(weatherMode);
    }
    String preparationKey() { return key; }
    static NativeAudioSelection parseKey(String key) {
        if (key == null || key.length() > 512) throw new IllegalArgumentException("Invalid audio selection key");
        String[] fields = key.split("\n", -1);
        if ((fields.length != 5 && fields.length != 6) || !"s1".equals(fields[0])) throw new IllegalArgumentException("Invalid audio selection version");
        NativeAudioSelection selected = new NativeAudioSelection(fields[1], fields[2], DevelopmentConfig.parseKey(fields[3]), fields[4], fields.length == 6 ? fields[5] : PROCEDURAL);
        if (!selected.key.equals(key)) throw new IllegalArgumentException("Noncanonical audio selection key");
        return selected;
    }

    /** Carries only prepared immutable banks, never decoder/report/source buffers. */
    static final class Banks {
        static final Banks PROCEDURAL = new Banks(null, null, null);
        final LiveDrumPool.Bank drums;
        final LiveMelodicPool.Bank melodies;
        final RecordedWeather.Bank weather;
        private Banks(LiveDrumPool.Bank drums, LiveMelodicPool.Bank melodies, RecordedWeather.Bank weather) {
            this.drums = drums; this.melodies = melodies; this.weather = weather;
        }
    }
    private static void checkInterrupted() throws InterruptedIOException {
        if (Thread.currentThread().isInterrupted()) throw new InterruptedIOException("Audio preparation cancelled");
    }
    /** One job prepares both banks sequentially. Invoke only on DrumPreparation's worker. */
    static Banks prepare(String key, int rate, NativeDrumBankLoader.AssetReader drumAssets,
            NativeMelodicBankLoader.AssetReader melodicAssets) throws IOException {
        NativeAudioSelection selected = parseKey(key);
        checkInterrupted();
        LiveDrumPool.Bank drums = PROCEDURAL.equals(selected.drumKit) ? null
                : NativeDrumBankLoader.prepareSelection(selected.drumKit, rate, drumAssets).bank;
        // STOP between the two loads must not begin the second large allocation.
        checkInterrupted();
        LiveMelodicPool.Bank melodies = PROCEDURAL.equals(selected.melodicPreset) ? null
                : NativeMelodicBankLoader.prepare(melodicBankPreset(selected.melodicPreset), rate, melodicAssets).bank;
        checkInterrupted();
        RecordedWeather.Bank weather = PROCEDURAL.equals(selected.weatherMode) ? null : NativeWeatherBankLoader.prepare(rate, melodicAssets);
        checkInterrupted();
        return new Banks(drums, melodies, weather);
    }
}
