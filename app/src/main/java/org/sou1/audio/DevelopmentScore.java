// SPDX-License-Identifier: AGPL-3.0-only
package org.sou1.audio;

import java.util.Arrays;
import org.sou1.audio.AmbientEngine.NoteSink;
import org.sou1.audio.AmbientEngine.Parameters;

/**
 * Original continuously developing, sample-clock score. Kept in event-for-event
 * parity with docs/development-score.js. No recordings or finite MIDI clips.
 * One rendering thread owns this score. Its fixed arrays are allocated once;
 * reset, reseed and scheduling allocate nothing on the successful path.
 * beatNext may be shifted by the engine during stop fades without advancing
 * score time. The engine must then refresh next = Math.round(beatNext).
 */
public final class DevelopmentScore {
    private static final long MAX_SAFE_FRAME = 9007199254740991L;
    private static final int[] SCALE = {
        0,2,4,5,7,9,11, 0,2,3,5,7,9,10, 0,2,3,5,7,8,10,
        0,2,4,5,7,9,10, 0,2,4,6,7,9,11, 0,1,3,5,7,8,10, 0,2,3,5,7,8,11
    };
    private static final int[] METERS = {48,36,60,42,54,72};
    private static final int[] PHRASES = {4,6,8,10,12}, LENGTHS = {6,7,8,9,10,12};
    private static final int[] MOVES = {3,4,2,5,1,3,4,6, 4,1,3,2,5,4,6,2,
        2,3,5,1,4,2,6,3, 5,2,4,3,1,6,2,4};
    private static final int[] MASKS = {
        (1<<0)|(1<<6)|(1<<12)|(1<<18), (1<<0)|(1<<8)|(1<<12)|(1<<20),
        (1<<0)|(1<<9)|(1<<15)|(1<<18), (1<<0)|(1<<6)|(1<<15),
        (1<<0)|(1<<4)|(1<<12)|(1<<16)|(1<<20),
        (1<<0)|(1<<3)|(1<<12)|(1<<18)|(1<<21),
        (1<<3)|(1<<6)|(1<<12)|(1<<21), (1<<0)|(1<<9)|(1<<18)
    };
    public final int rate;
    public final DevelopmentConfig config;
    public long seed, next, tick, step, bar, phrase, chordChanges, eventCount, suppressedEvents;
    public double beatNext, elapsedFrames;
    public int root, mode, meterTicks, phraseBars, motifLength, family, harmonicFamily, arpStrategy;
    public int barTick, phraseBar, chord, anchorRoot, seedFamily, drumFamily;
    public long modulationPhrase, modulationChanges;
    private long variant, plan, harmonyTick, harmonicStep;
    private int state, eventsThisTick, melodicLimit, ambientChord;
    private double harmonyAt, padAt, textureAt, ambientAt, phraseEnergy, norm;
    private long ambientCursor, counterCursor, replyCursor, grooveCursor, arpCursor;
    private int rotation, inversion, retrograde, transpose, restBar, rhythmFamily, arpKind;
    private int lastTop, lastLower, lastBass;
    private final int[] motif = new int[12], leadGrid = new int[72], replyGrid = new int[72];
    private final int[] grooveGrid = new int[72], arpGrid = new int[72], voicing = new int[4];
    private final double[] busyUntil = new double[44];

    public DevelopmentScore(int rate, long seed) { this(rate, seed, DevelopmentConfig.DEFAULT); }
    public DevelopmentScore(int rate, long seed, DevelopmentConfig config) {
        if (rate < 8000 || rate > 192000)
            throw new IllegalArgumentException("sampleRate must be 8000..192000");
        if (config == null) throw new IllegalArgumentException("config must not be null");
        this.rate = rate;
        this.config = config;
        this.seed = seed & 0xffffffffL;
        reset();
    }
    private static long hash(int n) {
        n = (n ^ (n >>> 16)) * 0x7feb352d;
        n = (n ^ (n >>> 15)) * 0x846ca68b;
        return (n ^ (n >>> 16)) & 0xffffffffL;
    }
    private static int mod(long n, int d) { return (int) (((n % d) + d) % d); }
    private long randomInt() { state = state * 1664525 + 1013904223; return state & 0xffffffffL; }
    public void reseed(long seed) { this.seed = seed & 0xffffffffL; reset(); }
    public void reset() {
        variant = hash((int) seed ^ 0x9e3779b9); state = (int) hash((int) seed ^ 0x243f6a88);
        root = 48 + (config.tonic == DevelopmentConfig.SEED ? (int) (variant % 12) : config.tonic);
        anchorRoot = root; mode = config.mode == DevelopmentConfig.SEED ? (int) (variant / 16 % 7) : config.mode;
        meterTicks = METERS[config.meter == DevelopmentConfig.SEED ? (int) (variant / 128 % 6) : config.meter];
        phraseBars = PHRASES[(int) (variant / 1024 % 5)];
        motifLength = LENGTHS[(int) (variant / 8192 % 6)]; seedFamily = (int) (variant / 65536 % 8);
        family = config.rhythmFamily == DevelopmentConfig.SEED ? seedFamily : config.rhythmFamily;
        harmonicFamily = (int) (variant / 524288 % 4);
        arpStrategy = config.arpStrategy == DevelopmentConfig.SEED ? (int) (variant / 2097152 % 8) : config.arpStrategy;
        drumFamily = config.drumPattern == DevelopmentConfig.SEED ? seedFamily : config.drumPattern;
        modulationPhrase = modulationChanges = 0;
        beatNext = elapsedFrames = 0; next = tick = step = bar = phrase = 0; barTick = phraseBar = 0;
        chord = ambientChord = 0; chordChanges = 0; harmonyAt = 0; harmonyTick = harmonicStep = 0;
        eventCount = suppressedEvents = 0; eventsThisTick = 0; melodicLimit = 16;
        padAt = textureAt = 0; ambientAt = rate * (3 + variant % 6);
        ambientCursor = counterCursor = replyCursor = grooveCursor = arpCursor = 0;
        rotation = retrograde = transpose = 0; inversion = 1; plan = 0;
        phraseEnergy = 1; restBar = -1; rhythmFamily = family; arpKind = arpStrategy;
        norm = 1; lastTop = 72; lastLower = 60; lastBass = 40;
        voicing[0] = 48; voicing[1] = 55; voicing[2] = 60; voicing[3] = 64;
        Arrays.fill(busyUntil, 0); Arrays.fill(leadGrid, 0); Arrays.fill(replyGrid, 0);
        Arrays.fill(grooveGrid, 0); Arrays.fill(arpGrid, 0);
        int d = 0;
        for (int i = 0; i < motifLength; i++) {
            long h = randomInt();
            if (i == 0) d = (int) (h % 3) * 2;
            else { d += (int) (h % 7) - 3; if (d > 7) d = 7 - (d - 7); if (d < -3) d = -3 + (-3 - d); }
            motif[i] = d;
        }
        for (int i = motifLength; i < 12; i++) motif[i] = 0;
    }
    private int degree(int d) { return SCALE[mode * 7 + mod(d, 7)] + 12 * (int) Math.floor(d / 7.0); }
    private int pitch(int d, int octave, int low, int high, int previous) {
        int p = root + degree(d) + 12 * octave;
        while (p < low) p += 12; while (p > high) p -= 12;
        if (previous >= low && previous <= high) {
            if (p - previous > 7 && p - 12 >= low) p -= 12;
            else if (previous - p > 7 && p + 12 <= high) p += 12;
        }
        return p;
    }
    private int motifDegree(long cursor, double complexity, boolean reply) {
        int i = mod(cursor + rotation, motifLength);
        if (retrograde != 0) i = motifLength - 1 - i;
        int d = motif[i];
        if (complexity < .25) d = 2 * (int) Math.round(d / 2.0);
        d *= reply ? -inversion : inversion;
        return d + (complexity > .35 ? transpose : 0);
    }
    private void planPhrase(double complexity, double evolution) {
        long epoch = phrase / (1 + (int) Math.floor((1 - evolution) * 3));
        plan = hash((int) variant ^ ((int) (epoch + 1) * 0x45d9f3b));
        rotation = complexity > .25 ? (int) (plan % motifLength) : 0;
        inversion = complexity > .5 && ((plan >>> 4) & 1) != 0 ? -1 : 1;
        retrograde = complexity > .65 ? (int) ((plan >>> 5) & 1) : 0;
        transpose = complexity > .35 ? (int) ((plan >>> 6) % 5) - 2 : 0;
        rhythmFamily = config.rhythmFamily == DevelopmentConfig.SEED && complexity > .35 ? (family + (int) ((plan >>> 9) % 3)) % 8 : family;
        double variation = config.drumVariation == DevelopmentConfig.AUTO_VARIATION ? 1 : config.drumVariation;
        drumFamily = config.drumPattern == DevelopmentConfig.SEED
                ? (complexity * variation > .35 ? (seedFamily + (int) ((plan >>> 9) % 3)) % 8 : seedFamily) : config.drumPattern;
        arpKind = config.arpStrategy == DevelopmentConfig.SEED && complexity > .4 ? (arpStrategy + (int) ((plan >>> 12) % 4)) % 8 : arpStrategy;
        int modulationSpan = 4 + (int) Math.floor((1 - evolution) * 12);
        if (DevelopmentConfig.MODULATING.equals(config.harmony) && phrase - modulationPhrase >= modulationSpan) {
            root = root == anchorRoot ? 48 + mod(anchorRoot - 48 + (((plan >>> 3) & 1) != 0 ? 5 : 7), 12) : anchorRoot;
            modulationPhrase = phrase; modulationChanges++; chordChanges++;
            padAt = textureAt = elapsedFrames;
        }
        phraseEnergy = .72 + ((plan >>> 16) % 25) / 100.0;
        restBar = phrase > 0 && (plan >>> 21) % 3 == 0 ? phraseBars - 1 : -1;
        int mutationSpan = 4 + (int) Math.floor((1 - evolution) * 8);
        if (phrase > 0 && phrase % mutationSpan == 0 && complexity > .2) {
            int i = (int) ((plan >>> 23) % motifLength);
            motif[i] = Math.max(-4, Math.min(8, motif[i] + (((plan >>> 28) & 1) != 0 ? 1 : -1)));
        }
    }
    private void planBar(double complexity) {
        int n = meterTicks, mask = MASKS[rhythmFamily], groove = MASKS[(rhythmFamily + 2) % 8];
        boolean call = phraseBar % 4 < 2, rest = phraseBar == restBar;
        int shift = complexity > .55 ? 3 * (int) ((plan >>> 14) % 3) : 0;
        int arpStep = arpKind == 6 ? 4 : (complexity > .75 && arpKind == 7 ? 3 : 6);
        for (int t = 0; t < n; t++) {
            int x = mod(t - shift, 24), y = mod(n - 1 - t + 6, 24);
            int rank = t == 0 ? 100 : (t % 12 == 0 ? 88 : (t % 6 == 0 ? 72 : 58));
            leadGrid[t] = !rest && ((mask >>> x) & 1) != 0 ? (call ? rank : Math.max(30, rank - 26)) : 0;
            replyGrid[t] = !rest && t % 3 == 0 && ((mask >>> mod(y + 1, 24)) & 1) != 0 ? (!call ? rank : Math.max(25, rank - 35)) : 0;
            grooveGrid[t] = !rest && ((groove >>> x) & 1) != 0 ? rank : 0;
            arpGrid[t] = !rest && t % arpStep == 0 ? (t == 0 ? 100 : (t % (arpStep * 2) == 0 ? 86 : 64)) : 0;
            if (!rest && complexity > .65 && phraseBar % 3 == 2 && t == n - 3) replyGrid[t] = 68;
            if (!rest && complexity > .8 && phraseBar % 4 == 3 && t == n - 3) grooveGrid[t] = 62;
        }
    }
    private void changeHarmony(boolean stableAmbient) {
        long h = hash((int) variant ^ ((int) ++harmonicStep * 0x27d4eb2d));
        if (stableAmbient) {
            // The zero-evolution endpoint retains three distinct related fields.
            ambientChord = (ambientChord + 1) % 3;
            int nextChord = ambientChord == 0 ? 0 : (ambientChord == 1 ? 2 : 3);
            if (nextChord == chord) {
                ambientChord = (ambientChord + 1) % 3;
                nextChord = ambientChord == 0 ? 0 : (ambientChord == 1 ? 2 : 3);
            }
            chord = nextChord;
        } else {
            int move = MOVES[harmonicFamily * 8 + (int) ((h >>> 8) % 8)];
            chord = (chord + move) % 7;
        }
        chordChanges++;
        harmonyAt = elapsedFrames; harmonyTick = tick; padAt = elapsedFrames;
    }
    private boolean emit(NoteSink sink, long at, int layer, int pitch, double seconds, double velocity, double pan) {
        if (!(velocity > 0) || eventsThisTick >= 12) return false;
        int slot = -1, begin = layer < 5 ? 0 : 32, end = layer < 5 ? melodicLimit : 44;
        for (int i = begin; i < end; i++) if (busyUntil[i] <= at) { slot = i; break; }
        if (slot < 0) { suppressedEvents++; return false; }
        long duration = Math.max(1, Math.round(rate * Math.max(.04, Math.min(32, seconds))));
        double tail = rate * (layer == 0 ? 4 : (layer == 3 ? 2 : (layer >= 5 ? .08 : .3)));
        busyUntil[slot] = (double) at + duration + Math.round(tail);
        eventCount++; eventsThisTick++;
        sink.noteOn(at, layer, Math.max(24, Math.min(96, pitch)), duration,
                Math.max(.005, Math.min(1, velocity / norm)), Math.max(.15, Math.min(.85, pan)));
        return true;
    }
    private static boolean allowed(int rank, double density) { return rank > 0 && density >= (100 - rank) / 100.0; }

    private void emitDrums(NoteSink sink, long at, int t, double density, double complexity, double energy) {
        double variation = config.drumVariation == DevelopmentConfig.AUTO_VARIATION ? 1 : config.drumVariation;
        double drumEnergy = variation == 1 ? energy : (variation == 0 ? 1 : 1 + variation * (energy - 1));
        int family = drumFamily, half = meterTicks / 2 / 3 * 3;
        if (config.drumPattern == DevelopmentConfig.SEED) {
            if (t == 0 || (t == half && (family % 3 != 1 || density > .6)) || (complexity * variation > .6 && density > .6 && t == meterTicks - 9))
                emit(sink, at, 5, 36, .22, (t == 0 ? .79 : .57) * drumEnergy, .48);
            if (t == (meterTicks >= 48 ? 12 : half) || (meterTicks >= 48 && t == meterTicks - 12))
                emit(sink, at, 6, 38, .19, .61 * drumEnergy, .53);
            int hatStep = family == 1 || family == 4 ? 4 : (density > .8 && complexity > .7 ? 3 : 6);
            if (t % hatStep == 0 && (t % 12 == 0 || density > .3) && !(variation > 0 && phraseBar == restBar && t % 12 != 0))
                emit(sink, at, 7, 42, .075, (t % 12 == 0 ? .36 : .2) * drumEnergy, .64);
        } else {
            int x = t % 48; boolean kick, snare;
            if (family == 0) { kick = t % 12 == 0; snare = t % 24 == 12; }
            else if (family == 1) { kick = t == 0 || (density > .55 && t == half - 6); snare = t == half; }
            else if (family == 2) { kick = t % 24 == 0 || t % 24 == 9 || t % 24 == 18; snare = t == 12 || t == meterTicks - 6; }
            else if (family == 3) { kick = x == 0 || x == 18 || x == 36; snare = x == 9 || x == 30 || x == 42; }
            else if (family == 4) { kick = t % 24 == 0 || t % 24 == 16; snare = t % 24 == 12; }
            else if (family == 5) { kick = t == 0; snare = t == half; }
            else if (family == 6) { kick = t % 24 == 6 || t % 24 == 18; snare = t % 24 == 12; }
            else { kick = t == 0; snare = t == half; }
            if (variation > 0 && complexity * variation > .6 && density > .6 && t == meterTicks - 9) kick = true;
            if (kick) emit(sink, at, 5, 36, .22, (t == 0 ? .79 : .57) * drumEnergy, .48);
            if (snare) emit(sink, at, 6, 38, .19, .61 * drumEnergy, .53);
            int hatStep = family == 4 ? 4 : (family == 5 || family == 7 ? 12 : (density > .8 && complexity > .7 ? 3 : 6));
            int hatOffset = family == 6 ? 3 : 0;
            if (mod(t - hatOffset, hatStep) == 0 && (t % 12 == 0 || density > .3) && !(variation > 0 && phraseBar == restBar && t % 12 != 0))
                emit(sink, at, 7, 42, .075, (t % 12 == 0 ? .36 : .2) * drumEnergy, .64);
            if (family == 7 && t % 12 == 6) emit(sink, at, 8, 45 + 2 * ((t / 12) % 3), .25, .4 * drumEnergy, .35);
        }
        if (variation > 0 && complexity * variation > .55 && density > .45 && phraseBar == phraseBars - 1 && t >= meterTicks - 9 && t % 3 == 0)
            emit(sink, at, 8, 45 + 2 * ((meterTicks - t) / 3 % 3), .25, .4 * drumEnergy, .35 + (t % 3) * .1);
        if (variation > .25 && phraseBar == 0 && t == 0 && phrase % 2 == 0) emit(sink, at, 9, 49, 1.4, .32 * drumEnergy, .66);
    }

    /** Parameters is already normalized; BPM uses the same value as the engine snapshot. */
    public void advanceTo(long frame, Parameters p, NoteSink sink) {
        if (frame < -1 || frame > MAX_SAFE_FRAME) throw new IllegalArgumentException("safe nonnegative integer sample frame required");
        if (!Double.isFinite(beatNext) || beatNext < 0) throw new IllegalStateException("invalid score clock");
        next = Math.round(beatNext);
        if (next > frame) return;
        if (p == null || sink == null) throw new IllegalArgumentException("parameters and note sink required");
        double ambient = p.ambient, counter = p.counterpoint, rhythmic = p.rhythmic, arp = p.arpeggio;
        double density = p.density, complexity = p.complexity, swing = p.swing, evolution = p.evolution;
        double seconds = 60 / p.bpm, drive = Math.max(counter, Math.max(rhythmic, arp));
        double ratio = ambient / Math.max(.001, ambient + drive);
        int harmonicSpan = 1 + (int) Math.floor(3 * ratio);
        double ambientSpan = rate * 3600.0 * Math.exp(-5.41610040220442 * evolution);
        boolean melody = p.melodyEnabled, drums = p.drumsEnabled;
        norm = Math.sqrt(Math.max(1, ambient + counter + rhythmic + arp));
        melodicLimit = p.polyphony;
        while (Math.round(beatNext) <= frame) {
            long at = Math.round(beatNext); int t = barTick;
            eventsThisTick = 0;
            if (t == 0) { if (phraseBar == 0) planPhrase(complexity, evolution); planBar(complexity); }
            if (!DevelopmentConfig.FIXED.equals(config.harmony) && ((drive == 0 && elapsedFrames - harmonyAt >= ambientSpan) ||
                    (drive > 0 && t == 0 && tick - harmonyTick >= meterTicks * harmonicSpan))) changeHarmony(drive == 0 && evolution == 0);
            double strength = Math.max(ambient, drive * .55), energy = phraseEnergy * (phraseBar == restBar ? .72 : 1);
            if (elapsedFrames >= padAt) {
                double gate = drive == 0 ? 22 - 6 * evolution : (meterTicks / 12.0) * seconds * (.82 + ratio * 1.5);
                int voices = complexity > .72 ? 4 : 3;
                for (int j = 0; j < voices; j++) {
                    int d = chord + (j == 3 ? (plan % 2 == 0 ? 6 : 1) : j * 2);
                    int n = pitch(d, 0, 45, 74, voicing[j]); voicing[j] = n;
                    emit(sink, at, 0, n, gate, (.49 - j * .035) * strength * energy, .22 + j * .18);
                }
                padAt = elapsedFrames + rate * (drive == 0 ? 20 + 4 * (1 - density) : Math.max(2, (meterTicks / 12.0) * seconds * harmonicSpan));
            }
            if (elapsedFrames >= textureAt) {
                emit(sink, at, 3, pitch(chord + 4, 1, 62, 86, 0), drive == 0 ? 28 : Math.min(14, seconds * 10), .25 * Math.max(ambient, drive * .25) * energy, .64);
                textureAt = elapsedFrames + rate * (drive == 0 ? 29 + variant % 9 : Math.max(12, seconds * 16));
            }
            if (elapsedFrames >= ambientAt) {
                long cursor = ambientCursor++; boolean rest = (cursor + ((plan >>> 10) % 5)) % 7 == 6;
                if (melody && ambient > 0 && !rest && phraseBar != restBar) {
                    int d = chord + motifDegree(cursor, complexity, false);
                    int n = pitch(d, 1, 60, 86, lastTop); boolean bell = cursor % 5 == 3;
                    if (emit(sink, at, bell ? 2 : 1, n, bell ? 5.5 : 2.4, (bell ? .38 : .57) * ambient * energy, bell ? .72 : .35)) lastTop = n;
                }
                if (ambient > 0 && !rest && phraseBar != restBar && cursor % 5 == 1 && density > .6)
                    emit(sink, at, 4, pitch(chord, -1, 33, 52, lastBass), 1.3, .37 * ambient * energy, .47);
                ambientAt = elapsedFrames + rate * (6 + (1 - density) * 19) * (1 - .4 * evolution) * (ambientCursor % motifLength == 0 ? 1.6 : 1);
            }
            if (melody) {
                if (counter > 0 && allowed(leadGrid[t], density)) {
                    long c = counterCursor++; int d = chord + motifDegree(c, complexity, false);
                    int n = pitch(d, 1, 60, 86, lastTop); double gate = (t % 12 == 0 ? .78 : .42) * seconds;
                    if (emit(sink, at, 1, n, gate, (t % 12 == 0 ? .66 : .51) * counter * energy, .29)) lastTop = n;
                }
                if (counter > 0 && allowed(replyGrid[t], density)) {
                    long c = replyCursor++; int d = chord + 4 + motifDegree(c, complexity, true);
                    int n = pitch(d, 0, 48, 74, lastLower);
                    if (emit(sink, at, 2, n, seconds * (t % 12 == 0 ? 1.35 : .7), .42 * counter * energy, .73)) lastLower = n;
                }
                if (rhythmic > 0 && allowed(grooveGrid[t], density)) {
                    long c = grooveCursor++; int d = chord + motifDegree(c / 2 + (c % 2 == 0 ? 0 : 2), complexity, false);
                    int n = pitch(d, 1, 57, 83, lastTop);
                    if (emit(sink, at, 1, n, seconds * (t % 12 == 0 ? .36 : .19), .68 * rhythmic * energy, .4)) lastTop = n;
                    if (complexity > .55 && t % 12 != 0 && c % 4 == 3) emit(sink, at, 2, pitch(chord + 4, 1, 64, 88, 0), seconds * .48, .3 * rhythmic * energy, .74);
                }
                if (arp > 0 && allowed(arpGrid[t], density)) {
                    long c = arpCursor++; int kind = arpKind, span = complexity > .5 ? 4 : 3, index;
                    if (kind == 0) index = (int) (c % span);
                    else if (kind == 1) index = span - 1 - (int) (c % span);
                    else if (kind == 2) { int x = (int) (c % (2 * span - 2)); index = x < span ? x : 2 * span - 2 - x; }
                    else if (kind == 3) index = c % 2 == 0 ? (int) (c / 2 % span) : span - 1 - (int) (c / 2 % span);
                    else if (kind == 4) index = (int) ((c * 2 + c / span) % span);
                    else if (kind == 5) index = mod(motifDegree(c, complexity, false), span);
                    else if (kind == 6) index = (int) ((c + c / 3) % span);
                    else index = (int) ((c + c / 4 * 2) % span);
                    int d = chord + index * 2, octave = complexity > .55 && (c + plan) % 5 == 4 ? 2 : 1;
                    int n = pitch(d, octave, 57, 88, 0);
                    emit(sink, at, 1, n, seconds * (kind == 6 ? .42 : .57), (.48 + (c % span == 0 ? .16 : 0)) * arp * energy, .3 + (c % 3) * .17);
                    if (complexity > .5 && t == meterTicks / 2 / 3 * 3) emit(sink, at, 2, pitch(chord + motifDegree(c, complexity, false), 1, 62, 86, lastTop), seconds * 1.5, .32 * arp * energy, .7);
                }
            }
            if (drive > 0 && (t == 0 || (rhythmic > 0 && t == meterTicks / 2 / 3 * 3) ||
                    (rhythmic > .5 && complexity > .6 && t == meterTicks - 9 && density > .55))) {
                int d = chord + (t == 0 ? 0 : (plan % 3 == 0 ? 4 : 0));
                int n = pitch(d, -1, 33, 52, lastBass); lastBass = n;
                emit(sink, at, 4, n, seconds * (rhythmic > counter ? .45 : 1.25), .65 * drive * energy, .48);
            }
            if (drums) emitDrums(sink, at, t, density, complexity, energy);
            double delta = rate * seconds / 12 * (1 + (tick % 12 < 6 ? 1 : -1) * .44 * swing);
            beatNext += delta; elapsedFrames += delta; tick++; step = tick;
            if (++barTick == meterTicks) {
                barTick = 0; bar++;
                if (++phraseBar == phraseBars) { phraseBar = 0; phrase++; }
            }
        }
        next = Math.round(beatNext);
    }
}
