// SPDX-License-Identifier: AGPL-3.0-only
package org.sou1.audio;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.TreeSet;

/**
 * Bounded recorded-drum voices, before the engine's shared effects and limiter.
 * Decode, resample and pitch materialization must finish before creating a Bank.
 * Java 17's always-strict floating-point semantics apply; PCM is float and the
 * envelope, pan and stereo mix are double. No normalization or limiting occurs.
 *
 * A single rendering thread owns every mutable pool operation and reads its
 * output/counters. Controls must be dispatched on that thread before events.
 * Immutable Banks may be shared, but pools never share voices or RR cursors.
 * Construction allocates; trigger/next/control/reset operations do not.
 */
public final class LiveDrumPool {
    public static final int MAX_SAMPLES = 32;
    public static final int MAX_ZONES = 64;
    public static final int MAX_POLYPHONY = 16;
    public static final int MAX_DECODED_BYTES = 16 * 1024 * 1024;
    private static final char NO_GROUP = 65535;

    /** Inclusive key and velocity bounds; all values are validated at creation. */
    public static final class Zone {
        public final int sampleIndex, keyLow, keyHigh;
        public final double velocityLow, velocityHigh;

        public Zone(int sampleIndex, int keyLow, int keyHigh,
                    double velocityLow, double velocityHigh) {
            if (sampleIndex < 0 || sampleIndex >= MAX_SAMPLES || keyLow < 0 ||
                    keyHigh > 127 || keyLow > keyHigh || !unit(velocityLow) ||
                    !unit(velocityHigh) || velocityLow > velocityHigh) {
                throw new IllegalArgumentException("Invalid live drum zone");
            }
            this.sampleIndex = sampleIndex;
            this.keyLow = keyLow;
            this.keyHigh = keyHigh;
            // Java's Double keys distinguish signed zero; JS Set does not.
            this.velocityLow = velocityLow == 0 ? 0 : velocityLow;
            this.velocityHigh = velocityHigh == 0 ? 0 : velocityHigh;
        }
    }

    /** An immutable one-shot instrument. The supplied zone array is copied. */
    public static final class Instrument {
        public final String id, chokeGroup;
        public final double gain;
        public final boolean oneShot;
        private final Zone[] zones;

        public Instrument(String id, double gain, boolean oneShot,
                          String chokeGroup, Zone[] zones) {
            if (instrumentIndex(id) < 0 || !unit(gain) || !oneShot ||
                    (chokeGroup != null && (chokeGroup.isEmpty() || chokeGroup.length() > 32)) ||
                    zones == null || zones.length < 1 || zones.length > MAX_ZONES) {
                throw new IllegalArgumentException("Invalid live drum instrument");
            }
            this.zones = zones.clone();
            for (Zone zone : this.zones) {
                if (zone == null) throw new IllegalArgumentException("Invalid live drum zone");
            }
            this.id = id;
            this.gain = gain;
            this.oneShot = true;
            this.chokeGroup = chokeGroup;
        }

        public int getZoneCount() { return zones.length; }
        public Zone getZone(int index) { return zones[index]; }
    }

    /**
     * Immutable prepared mono PCM at its exact target rate. Every input sample
     * is privately copied once, after ALL frame lengths and the aggregate budget
     * are checked. Unreferenced samples count toward the budget too. No mutable
     * sample or metadata array is exposed. Callers must not mutate input arrays
     * concurrently with construction; after construction they remain their own.
     */
    public static final class Bank {
        public final int sampleRate;
        private final float[][] samples;
        private final Instrument[] instruments;

        public Bank(int sampleRate, float[][] samples, Instrument[] instruments) {
            validateRate(sampleRate);
            if (samples == null || samples.length < 1 || samples.length > MAX_SAMPLES ||
                    instruments == null || instruments.length != 5) {
                throw new IllegalArgumentException("Invalid live drum bank");
            }
            // Snapshot array membership before validation; no PCM copy yet.
            float[][] sources = samples.clone();
            Instrument[] definitions = instruments.clone();
            long decodedBytes = 0;
            for (float[] pcm : sources) {
                if (pcm == null || pcm.length < 2 || pcm.length > sampleRate * 10) {
                    throw new IllegalArgumentException("Invalid live drum PCM frames/type");
                }
                decodedBytes += (long) pcm.length * Float.BYTES;
                if (decodedBytes > MAX_DECODED_BYTES) {
                    throw new IllegalArgumentException("Live drum decoded budget exceeded");
                }
            }
            boolean[] seen = new boolean[5];
            for (Instrument definition : definitions) {
                if (definition == null) throw new IllegalArgumentException("Invalid live drum instrument");
                int index = instrumentIndex(definition.id);
                if (seen[index]) throw new IllegalArgumentException("Duplicate live drum instrument");
                seen[index] = true;
                for (Zone zone : definition.zones) {
                    if (zone.sampleIndex >= sources.length) {
                        throw new IllegalArgumentException("Invalid live drum zone sample index");
                    }
                }
            }
            for (int i = 0; i < sources.length; i++) {
                float[] copy = sources[i].clone();
                for (float value : copy) {
                    // Sinc reconstruction may overshoot unity, without clipping.
                    if (!Float.isFinite(value) || Math.abs(value) > 2) {
                        throw new IllegalArgumentException("Invalid live drum PCM range");
                    }
                }
                sources[i] = copy;
            }
            this.sampleRate = sampleRate;
            this.samples = sources;
            this.instruments = definitions;
        }

        public int getSampleCount() { return samples.length; }
        public int getSampleFrames(int index) { return samples[index].length; }
        public int getInstrumentCount() { return instruments.length; }
        public Instrument getInstrument(int index) { return instruments[index]; }
    }

    /** Read-only live counters, owned by the pool's rendering thread. */
    public static final class Stats {
        private long accepted, dropped, unmapped, choked;
        private Stats() { }
        public long getAccepted() { return accepted; }
        public long getDropped() { return dropped; }
        public long getUnmapped() { return unmapped; }
        public long getChoked() { return choked; }
    }

    private static final class Group {
        final int[] zones;
        int cursor;
        Group(long mask) {
            zones = new int[Long.bitCount(mask)];
            int next = 0;
            for (int i = 0; i < MAX_ZONES; i++) {
                if ((mask & (1L << i)) != 0) zones[next++] = i;
            }
        }
    }

    private static final class CompiledInstrument {
        final Instrument definition;
        final double[] boundaries;
        final int bands;
        final char[] lookup;
        final Group[] groups;

        CompiledInstrument(Instrument definition) {
            this.definition = definition;
            TreeSet<Double> edges = new TreeSet<>();
            edges.add(0.0); edges.add(1.0);
            for (Zone zone : definition.zones) {
                edges.add(zone.velocityLow); edges.add(zone.velocityHigh);
            }
            boundaries = new double[edges.size()];
            int at = 0;
            for (double edge : edges) boundaries[at++] = edge;
            bands = boundaries.length * 2 - 1;
            lookup = new char[128 * bands];
            Arrays.fill(lookup, NO_GROUP);
            ArrayList<Group> compiledGroups = new ArrayList<>();
            Map<Long, Integer> groupIds = new HashMap<>();
            for (int pitch = 0; pitch < 128; pitch++) {
                for (int band = 0; band < bands; band++) {
                    int edge = band >> 1;
                    double low = boundaries[edge], high = boundaries[edge + (band & 1)];
                    long matches = 0;
                    for (int i = 0; i < definition.zones.length; i++) {
                        Zone zone = definition.zones[i];
                        // Endpoints, never a rounded midpoint, define open bands.
                        if (pitch >= zone.keyLow && pitch <= zone.keyHigh &&
                                ((band & 1) != 0 ? zone.velocityLow < high && zone.velocityHigh > low :
                                    zone.velocityLow <= low && zone.velocityHigh >= low)) {
                            matches |= 1L << i;
                        }
                    }
                    if (matches == 0) continue;
                    Integer id = groupIds.get(matches);
                    if (id == null) {
                        id = compiledGroups.size();
                        groupIds.put(matches, id);
                        compiledGroups.add(new Group(matches));
                    }
                    lookup[pitch * bands + band] = (char) id.intValue();
                }
            }
            groups = compiledGroups.toArray(new Group[0]);
        }
    }

    private static final class Voice {
        boolean active;
        float[] sample;
        CompiledInstrument instrument;
        int layer, age, releaseLeft;
        double level, panL, panR, releaseLevel = 1, releaseStep;
    }

    private final int sampleRate, polyphony, attackFrames, endFrames, releaseFrames, chokeFrames;
    private final float[][] samples;
    private final CompiledInstrument[] instruments;
    private final Voice[] voices;
    private final Stats stats = new Stats();
    private int active;
    private boolean enabled = true;
    private double outputL, outputR;

    public LiveDrumPool(int sampleRate, Bank bank) { this(sampleRate, bank, MAX_POLYPHONY); }

    public LiveDrumPool(int sampleRate, Bank bank, int polyphony) {
        validateRate(sampleRate);
        if (polyphony < 1 || polyphony > MAX_POLYPHONY) {
            throw new IllegalArgumentException("Live drum polyphony limits");
        }
        if (bank == null || bank.sampleRate != sampleRate) {
            throw new IllegalArgumentException("Invalid live drum bank sample rate");
        }
        this.sampleRate = sampleRate;
        this.polyphony = polyphony;
        samples = bank.samples; // Bank owns immutable PCM; do not copy it again.
        instruments = new CompiledInstrument[5];
        for (Instrument definition : bank.instruments) {
            instruments[instrumentIndex(definition.id)] = new CompiledInstrument(definition);
        }
        voices = new Voice[polyphony];
        for (int i = 0; i < polyphony; i++) voices[i] = new Voice();
        attackFrames = Math.max(1, (int) Math.round(sampleRate * .001));
        endFrames = Math.max(1, (int) Math.round(sampleRate * .002));
        releaseFrames = Math.max(2, (int) Math.round(sampleRate * .05));
        chokeFrames = Math.max(2, (int) Math.round(sampleRate * .005));
    }

    private static void validateRate(int sampleRate) {
        if (sampleRate < 8000 || sampleRate > 192000) {
            throw new IllegalArgumentException("Live drum sample rate limits");
        }
    }

    private static int instrumentIndex(String id) {
        if (id == null) return -1;
        switch (id) {
            case "kick": return 0;
            case "snare": return 1;
            case "closed-hat": return 2;
            case "toms": return 3;
            case "short-clash": return 4;
            default: return -1;
        }
    }

    private static boolean unit(double value) {
        return Double.isFinite(value) && value >= 0 && value <= 1;
    }

    private static double gain(double value) {
        return Double.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    }

    public int getSampleRate() { return sampleRate; }
    public int getPolyphony() { return polyphony; }
    public int getActiveVoices() { return active; }
    public boolean isEnabled() { return enabled; }
    public double getOutputL() { return outputL; }
    public double getOutputR() { return outputR; }
    public Stats getStats() { return stats; }

    /** Apply before score dispatch. Re-enable never cancels an existing fade. */
    public void setEnabled(boolean enabled) {
        if (this.enabled && !enabled) stop();
        this.enabled = enabled;
    }

    /**
     * Layers 5..9 are kick/snare/closed-hat/toms/short-clash, in that exact order.
     * Invalid/disabled/full hits are dropped; a valid unmatched event is unmapped.
     * Rejections never advance RR or choke a tail. Velocity zero is a valid hit.
     */
    public boolean trigger(int layer, int pitch, double velocity, double pan) {
        if (layer < 5 || layer > 9 || pitch < 0 || pitch > 127 ||
                !unit(velocity) || !unit(pan) || !enabled) {
            stats.dropped++; return false;
        }
        CompiledInstrument instrument = instruments[layer - 5];
        double[] boundaries = instrument.boundaries;
        int low = 0, high = boundaries.length - 1;
        while (low < high) {
            int mid = (low + high) >> 1;
            if (boundaries[mid] < velocity) low = mid + 1;
            else high = mid;
        }
        int band = boundaries[low] == velocity ? low * 2 : low * 2 - 1;
        int groupId = instrument.lookup[pitch * instrument.bands + band];
        if (groupId == NO_GROUP) { stats.unmapped++; return false; }
        Voice voice = null;
        for (int i = 0; i < polyphony; i++) {
            if (!voices[i].active) { voice = voices[i]; break; }
        }
        if (voice == null) { stats.dropped++; return false; }
        String chokeGroup = instrument.definition.chokeGroup;
        if (chokeGroup != null) {
            for (int i = 0; i < polyphony; i++) {
                Voice current = voices[i];
                if (current.active && chokeGroup.equals(current.instrument.definition.chokeGroup) &&
                        fade(current, chokeFrames)) stats.choked++;
            }
        }
        Group group = instrument.groups[groupId];
        Zone zone = instrument.definition.zones[group.zones[group.cursor]];
        group.cursor = (group.cursor + 1) % group.zones.length;
        voice.active = true;
        voice.sample = samples[zone.sampleIndex];
        voice.instrument = instrument;
        voice.layer = layer - 5;
        voice.age = 0;
        voice.level = velocity * instrument.definition.gain;
        voice.panL = Math.sqrt(1 - pan); voice.panR = Math.sqrt(pan);
        voice.releaseLeft = 0; voice.releaseLevel = 1; voice.releaseStep = 0;
        active++; stats.accepted++;
        return true;
    }

    private static boolean fade(Voice voice, int frames) {
        // Repeated stop/mute/choke never extends or raises an existing release.
        if (voice.releaseLeft > 0 && voice.releaseLeft <= frames) return false;
        voice.releaseLeft = frames;
        voice.releaseStep = voice.releaseLevel / (frames - 1);
        return true;
    }

    /** Start a 50 ms release; one-shots may naturally finish sooner. */
    public void stop() {
        for (int i = 0; i < polyphony; i++) {
            if (voices[i].active) fade(voices[i], releaseFrames);
        }
    }

    public void release() { stop(); }

    /**
     * Render one stereo frame with five current layer gains, including tails.
     * Caller owns gain smoothing. Null/wrong-length gains silence the mix;
     * non-finite gains become zero, finite gains clamp to [0,1]. Voices continue
     * advancing while silent. The mix is not independently limited; the input
     * and voice limits bound each output channel to at most |32|.
     */
    public void next(double[] gains) {
        boolean validGains = gains != null && gains.length == 5;
        double left = 0, right = 0;
        for (int i = 0; i < polyphony; i++) {
            Voice voice = voices[i];
            if (!voice.active) continue;
            double env = Math.min(1, (double) voice.age / attackFrames) *
                    Math.min(1, (double) (voice.sample.length - voice.age - 1) / endFrames);
            if (voice.releaseLeft > 0) env *= voice.releaseLeft == 1 ? 0 : voice.releaseLevel;
            double value = voice.sample[voice.age] * voice.level * env *
                    (validGains ? gain(gains[voice.layer]) : 0);
            left += value * voice.panL; right += value * voice.panR;
            voice.age++;
            if (voice.releaseLeft > 0) {
                voice.releaseLeft--;
                voice.releaseLevel = Math.max(0, voice.releaseLevel - voice.releaseStep);
                if (voice.releaseLeft == 0) { voice.active = false; active--; }
            }
            if (voice.active && voice.age >= voice.sample.length) { voice.active = false; active--; }
        }
        outputL = left; outputR = right;
    }

    /** Immediate transport reset, clearing counters/RR and preserving enable. */
    public void reset() {
        for (int i = 0; i < polyphony; i++) {
            Voice voice = voices[i];
            voice.active = false; voice.sample = null; voice.instrument = null;
            voice.layer = 0; voice.age = 0; voice.level = 0;
            voice.panL = 0; voice.panR = 0;
            voice.releaseLeft = 0; voice.releaseLevel = 1; voice.releaseStep = 0;
        }
        for (int i = 0; i < instruments.length; i++) {
            Group[] groups = instruments[i].groups;
            for (int j = 0; j < groups.length; j++) groups[j].cursor = 0;
        }
        active = 0; outputL = 0; outputR = 0;
        stats.accepted = 0; stats.dropped = 0; stats.unmapped = 0; stats.choked = 0;
    }
}
