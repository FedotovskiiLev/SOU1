// SPDX-License-Identifier: AGPL-3.0-only
// Standalone numerical/API checks, not Android integration or device latency QA.
import org.sou1.audio.LiveDrumPool;
import org.sou1.audio.LiveDrumPool.Bank;
import org.sou1.audio.LiveDrumPool.Instrument;
import org.sou1.audio.LiveDrumPool.Zone;

import java.lang.management.ManagementFactory;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

public final class LiveDrumPoolTest {
    private static final int RATE = 8000;
    private static final String[] IDS = {"kick", "snare", "closed-hat", "toms", "short-clash"};
    private static final double[] GAINS = {1, 1, 1, 1, 1};
    private static int passed;

    private static void check(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }
    private static void equal(long actual, long expected) {
        check(actual == expected, actual + " != " + expected);
    }
    private static void close(double actual, double expected) {
        check(Math.abs(actual - expected) < 1e-12, actual + " != " + expected);
    }
    private static void rejects(Runnable work) {
        try { work.run(); }
        catch (IllegalArgumentException expected) { return; }
        throw new AssertionError("Expected invalid definition to be rejected");
    }
    private static void test(String name, Runnable work) {
        work.run(); passed++; System.out.println("PASS " + name);
    }
    private static float[] pcm(double value) { return pcm(value, RATE); }
    private static float[] pcm(double value, int frames) {
        float[] result = new float[frames]; Arrays.fill(result, (float) value); return result;
    }
    private static Zone zone(int sample) { return zone(sample, 0, 127, 0, 1); }
    private static Zone zone(int sample, int low, int high, double soft, double hard) {
        return new Zone(sample, low, high, soft, hard);
    }
    private static Instrument instrument(int index, double gain, String choke, Zone... zones) {
        return new Instrument(IDS[index], gain, true, choke, zones);
    }
    private static Instrument[] definitions() {
        Instrument[] result = new Instrument[5];
        for (int i = 0; i < result.length; i++) result[i] = instrument(i, 1, null, zone(0));
        return result;
    }
    private static Bank bank() { return bank(new float[][] {pcm(.25)}); }
    private static Bank bank(float[][] samples) { return new Bank(RATE, samples, definitions()); }
    private static double advance(LiveDrumPool pool, int frames) { return advance(pool, frames, GAINS); }
    private static double advance(LiveDrumPool pool, int frames, double[] gains) {
        for (int i = 0; i < frames; i++) pool.next(gains);
        return pool.getOutputL();
    }
    private static double hit(LiveDrumPool pool) { return hit(pool, 5); }
    private static double hit(LiveDrumPool pool, int layer) {
        check(pool.trigger(layer, 36, 1, 0), "hit rejected"); return advance(pool, 9);
    }
    private static double sampleAndFinish(LiveDrumPool pool, int layer, int pitch, double velocity) {
        check(pool.trigger(layer, pitch, velocity, 0), "hit rejected");
        double value = advance(pool, 9); advance(pool, 71);
        equal(pool.getActiveVoices(), 0); return value;
    }
    private static void stats(LiveDrumPool pool, long accepted, long dropped, long unmapped, long choked) {
        equal(pool.getStats().getAccepted(), accepted); equal(pool.getStats().getDropped(), dropped);
        equal(pool.getStats().getUnmapped(), unmapped); equal(pool.getStats().getChoked(), choked);
    }

    public static void main(String[] args) throws Exception {
        test("five layers route by exact ID, independent of bank order", () -> {
            float[][] samples = new float[5][]; Instrument[] instruments = new Instrument[5];
            for (int i = 0; i < 5; i++) {
                samples[i] = pcm((i + 1) * .125);
                instruments[4 - i] = instrument(i, 1, null, zone(i));
            }
            LiveDrumPool pool = new LiveDrumPool(RATE, new Bank(RATE, samples, instruments));
            equal(pool.getSampleRate(), RATE); equal(pool.getPolyphony(), 16);
            for (int i = 0; i < 5; i++) { pool.reset(); close(hit(pool, i + 5), (i + 1) * .125); }
        });
        test("immutable bank owns PCM and metadata array copies", () -> {
            float[][] samples = {pcm(.25)}; Zone[] zones = {zone(0)};
            Instrument[] instruments = definitions();
            instruments[0] = new Instrument("kick", 1, true, null, zones);
            zones[0] = zone(31);
            Bank bank = new Bank(RATE, samples, instruments);
            Arrays.fill(samples[0], 2); samples[0] = pcm(-2);
            Arrays.fill(instruments, null);
            equal(bank.getSampleCount(), 1); equal(bank.getSampleFrames(0), RATE);
            equal(bank.getInstrumentCount(), 5); equal(bank.getInstrument(0).getZoneCount(), 1);
            equal(bank.getInstrument(0).getZone(0).sampleIndex, 0);
            LiveDrumPool pool = new LiveDrumPool(RATE, bank); close(hit(pool), .25);
            close(hit(new LiveDrumPool(RATE, bank)), .25);
        });
        test("one-shot exact silent endpoints and bounded 1/2 ms envelope", () -> {
            LiveDrumPool pool = new LiveDrumPool(RATE, bank(new float[][] {pcm(.5, 80)}));
            check(pool.trigger(5, 36, 1, 0), "hit");
            for (int age = 0; age < 80; age++) {
                pool.next(GAINS);
                close(pool.getOutputL(), .5 * Math.min(1, age / 8.0) * Math.min(1, (79 - age) / 16.0));
                close(pool.getOutputR(), 0); equal(pool.getActiveVoices(), age == 79 ? 0 : 1);
            }
            close(advance(pool, 10), 0);
            pool = new LiveDrumPool(RATE, bank(new float[][] {pcm(2, 2)}));
            check(pool.trigger(5, 36, 1, 0), "short hit");
            close(advance(pool, 1), 0); close(advance(pool, 1), 0); equal(pool.getActiveVoices(), 0);
        });
        test("velocity, instrument/layer gain and equal-power pan multiply", () -> {
            Instrument[] instruments = definitions(); instruments[3] = instrument(3, .4, null, zone(0));
            LiveDrumPool pool = new LiveDrumPool(RATE, new Bank(RATE, new float[][] {pcm(.5)}, instruments));
            check(pool.trigger(8, 45, .8, .25), "hit");
            double[] gains = {1, 1, 1, .3, 1}; advance(pool, 9, gains);
            close(pool.getOutputL(), .5 * .4 * .8 * .3 * Math.sqrt(.75));
            close(pool.getOutputR(), .5 * .4 * .8 * .3 * .5);
            gains[3] = .6; pool.next(gains); close(pool.getOutputL(), .5 * .4 * .8 * .6 * Math.sqrt(.75));
            gains[3] = 0; pool.next(gains); close(pool.getOutputL(), 0);
            gains[3] = 1; pool.next(gains); check(pool.getOutputL() > 0, "tails use current gain");
        });
        test("soft/hard matching cohorts have independent round robin", () -> {
            Instrument[] instruments = definitions();
            instruments[1] = instrument(1, 1, null, zone(0, 38, 38, 0, .49), zone(1, 38, 38, 0, .49),
                    zone(2, 38, 38, .5, 1), zone(3, 38, 38, .5, 1));
            LiveDrumPool pool = new LiveDrumPool(RATE, new Bank(RATE,
                    new float[][] {pcm(.125, 80), pcm(.25, 80), pcm(.5, 80), pcm(.75, 80)}, instruments));
            close(sampleAndFinish(pool, 6, 38, .4), .125 * .4);
            close(sampleAndFinish(pool, 6, 38, .8), .5 * .8);
            close(sampleAndFinish(pool, 6, 38, .4), .25 * .4);
            close(sampleAndFinish(pool, 6, 38, .8), .75 * .8);
            close(sampleAndFinish(pool, 6, 38, .4), .125 * .4);
            check(!pool.trigger(6, 38, .495, 0), "gap must be unmapped");
            check(!pool.trigger(6, 37, .4, 0), "key must be unmapped");
            close(sampleAndFinish(pool, 6, 38, .4), .25 * .4);
            stats(pool, 6, 0, 2, 0);
        });
        test("inclusive boundary overlaps select only exact matches", () -> {
            Instrument[] instruments = definitions();
            instruments[3] = instrument(3, 1, null, zone(0, 41, 43, 0, .5), zone(1, 43, 45, .5, 1), zone(2, 48, 48, 0, 1));
            LiveDrumPool pool = new LiveDrumPool(RATE, new Bank(RATE,
                    new float[][] {pcm(.125, 80), pcm(.25, 80), pcm(.5, 80)}, instruments));
            close(sampleAndFinish(pool, 8, 43, .5), .125 * .5);
            close(sampleAndFinish(pool, 8, 43, .5), .25 * .5);
            close(sampleAndFinish(pool, 8, 41, .5), .125 * .5);
            close(sampleAndFinish(pool, 8, 45, .5), .25 * .5);
            close(sampleAndFinish(pool, 8, 48, 1), .5);
            check(!pool.trigger(8, 47, 1, 0), "unmapped");
        });
        test("adjacent doubles and signed zero preserve exact velocity bands", () -> {
            Instrument[] instruments = definitions();
            instruments[0] = instrument(0, 1, null, zone(0, 36, 36, -0.0, .5), zone(1, 36, 36, Math.nextUp(.5), 1));
            LiveDrumPool pool = new LiveDrumPool(RATE, new Bank(RATE,
                    new float[][] {pcm(.125, 80), pcm(.5, 80)}, instruments));
            close(sampleAndFinish(pool, 5, 36, .5), .125 * .5);
            close(sampleAndFinish(pool, 5, 36, Math.nextUp(.5)), .5 * Math.nextUp(.5));
            close(sampleAndFinish(pool, 5, 36, -0.0), 0);
            close(sampleAndFinish(pool, 5, 36, 0), 0);
        });
        test("invalid/full/disabled hits cannot consume alternates", () -> {
            Instrument[] instruments = definitions(); instruments[0] = instrument(0, 1, null, zone(0), zone(1));
            LiveDrumPool pool = new LiveDrumPool(RATE, new Bank(RATE,
                    new float[][] {pcm(.125, 80), pcm(.5, 80)}, instruments), 1);
            check(pool.trigger(5, 36, 1, 0), "first");
            check(!pool.trigger(5, 36, 1, 0), "full");
            check(!pool.trigger(5, 36, Double.NaN, 0), "invalid"); advance(pool, 80);
            pool.setEnabled(false); check(!pool.trigger(5, 36, 1, 0), "disabled");
            pool.setEnabled(true); close(sampleAndFinish(pool, 5, 36, 1), .5); stats(pool, 2, 3, 0, 0);
        });
        test("sixteen voices drop overflow without stealing tails", () -> {
            LiveDrumPool pool = new LiveDrumPool(RATE, bank());
            for (int i = 0; i < 16; i++) check(pool.trigger(5, 36, 1, 0), "accepted");
            for (int i = 0; i < 3000; i++) check(!pool.trigger(6, 38, 1, 0), "full");
            equal(pool.getActiveVoices(), 16); close(advance(pool, 9), 4); stats(pool, 16, 3000, 0, 0);
            advance(pool, RATE); equal(pool.getActiveVoices(), 0); check(pool.trigger(6, 38, 1, 0), "slot reusable");
        });
        test("5 ms choke uses equal group values and preserves unrelated tails", () -> {
            Instrument[] instruments = definitions();
            instruments[2] = instrument(2, 1, new String("metal"), zone(0));
            instruments[4] = instrument(4, 1, new String("metal"), zone(0));
            LiveDrumPool pool = new LiveDrumPool(RATE, new Bank(RATE, new float[][] {pcm(.25)}, instruments));
            hit(pool, 7); hit(pool, 5); check(pool.trigger(9, 49, 1, 1), "choke hit");
            equal(pool.getStats().getChoked(), 1); equal(pool.getActiveVoices(), 3);
            pool.next(GAINS); close(pool.getOutputL(), .5); close(pool.getOutputR(), 0);
            advance(pool, 39); close(pool.getOutputL(), .25); close(pool.getOutputR(), .25);
            equal(pool.getActiveVoices(), 2);
        });
        test("a rejected choke event never silences an active voice", () -> {
            Instrument[] instruments = definitions(); instruments[2] = instrument(2, 1, "hat", zone(0));
            LiveDrumPool pool = new LiveDrumPool(RATE, new Bank(RATE, new float[][] {pcm(.25)}, instruments), 1);
            hit(pool, 7); check(!pool.trigger(7, 42, 1, 0), "full");
            close(advance(pool, 80), .25); equal(pool.getStats().getChoked(), 0); equal(pool.getActiveVoices(), 1);
        });
        test("50 ms stop/release are monotone, exact and idempotent", () -> {
            for (boolean alias : new boolean[] {false, true}) {
                LiveDrumPool pool = new LiveDrumPool(RATE, bank()); hit(pool);
                if (alias) pool.release(); else pool.stop();
                double previous = .25;
                for (int i = 0; i < 400; i++) {
                    if (alias) pool.release(); else pool.stop(); pool.next(GAINS);
                    check(pool.getOutputL() <= previous + 1e-14, "release rose"); previous = pool.getOutputL();
                    if (i == 0) close(pool.getOutputL(), .25);
                    if (i == 398) equal(pool.getActiveVoices(), 1);
                }
                close(pool.getOutputL(), 0); equal(pool.getActiveVoices(), 0);
                check(pool.trigger(5, 36, 1, 0), "stop does not disable");
            }
        });
        test("shorter choke preserves release level and never extends it", () -> {
            Instrument[] instruments = definitions(); instruments[2] = instrument(2, 1, "hat", zone(0));
            LiveDrumPool pool = new LiveDrumPool(RATE, new Bank(RATE, new float[][] {pcm(.25)}, instruments));
            hit(pool, 7); pool.stop(); advance(pool, 100); double prior = pool.getOutputL();
            check(pool.trigger(7, 42, 1, 1), "hit"); pool.next(GAINS);
            check(pool.getOutputL() <= prior && pool.getOutputL() > 0, "release level");
            equal(pool.getStats().getChoked(), 1); advance(pool, 20); check(pool.trigger(7, 42, 1, 1), "hit");
            equal(pool.getStats().getChoked(), 2); advance(pool, 19); close(pool.getOutputL(), 0);
        });
        test("disable/re-enable never queues, retriggers or revives old hits", () -> {
            LiveDrumPool pool = new LiveDrumPool(RATE, bank()); hit(pool);
            pool.setEnabled(false); pool.next(GAINS); check(!pool.isEnabled(), "disabled");
            for (int i = 0; i < 20; i++) check(!pool.trigger(5, 36, 1, 0), "disabled hit");
            advance(pool, 100); pool.setEnabled(true); advance(pool, 299);
            equal(pool.getActiveVoices(), 0); close(pool.getOutputL(), 0); close(advance(pool, 100), 0);
            stats(pool, 1, 20, 0, 0); check(pool.trigger(5, 36, 1, 0), "fresh hit");
        });
        test("enable is effective before first-frame dispatch", () -> {
            LiveDrumPool pool = new LiveDrumPool(RATE, bank()); pool.setEnabled(false);
            check(!pool.trigger(5, 36, 1, 0), "disabled"); pool.setEnabled(true);
            check(pool.trigger(5, 36, 1, 0), "enabled before next"); close(advance(pool, 9), .25);
        });
        test("reset clears voices, stats and RR but preserves enable target", () -> {
            Instrument[] instruments = definitions(); instruments[0] = instrument(0, 1, null, zone(0), zone(1));
            LiveDrumPool pool = new LiveDrumPool(RATE, new Bank(RATE,
                    new float[][] {pcm(.125), pcm(.5)}, instruments));
            LiveDrumPool.Stats counters = pool.getStats(); hit(pool); pool.setEnabled(false); pool.reset();
            check(counters == pool.getStats(), "counters object must not be replaced");
            check(!pool.isEnabled(), "reset changed enable"); equal(pool.getActiveVoices(), 0);
            close(pool.getOutputL(), 0); close(pool.getOutputR(), 0); stats(pool, 0, 0, 0, 0);
            check(!pool.trigger(5, 36, 1, 0), "still disabled"); pool.setEnabled(true); close(hit(pool), .125);
            pool.reset(); check(pool.isEnabled(), "reset changed enable"); close(hit(pool), .125);
        });
        test("pools sharing an immutable bank have separate round robin", () -> {
            Instrument[] instruments = definitions(); instruments[0] = instrument(0, 1, null, zone(0), zone(1));
            Bank bank = new Bank(RATE, new float[][] {pcm(.125, 80), pcm(.5, 80)}, instruments);
            LiveDrumPool a = new LiveDrumPool(RATE, bank), b = new LiveDrumPool(RATE, bank);
            close(sampleAndFinish(a, 5, 36, 1), .125); close(sampleAndFinish(a, 5, 36, 1), .5);
            close(sampleAndFinish(b, 5, 36, 1), .125); b.reset();
            close(sampleAndFinish(a, 5, 36, 1), .125); close(sampleAndFinish(b, 5, 36, 1), .125);
        });
        test("invalid current gains are silent and events reject without throwing", () -> {
            LiveDrumPool pool = new LiveDrumPool(RATE, bank()); hit(pool);
            double[][] invalid = {null, {}, new double[4], {Double.NaN, 1, 1, 1, 1},
                    {Double.POSITIVE_INFINITY, 1, 1, 1, 1}, {-1, 1, 1, 1, 1}};
            for (double[] gains : invalid) { pool.next(gains); close(pool.getOutputL(), 0); }
            pool.next(new double[] {3, 1, 1, 1, 1}); close(pool.getOutputL(), .25);
            for (int layer : new int[] {4, 10, Integer.MIN_VALUE, Integer.MAX_VALUE}) check(!pool.trigger(layer, 36, 1, 0), "layer");
            for (int pitch : new int[] {-1, 128, Integer.MIN_VALUE, Integer.MAX_VALUE}) check(!pool.trigger(5, pitch, 1, 0), "pitch");
            for (double value : new double[] {Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY, -.1, 1.1}) {
                check(!pool.trigger(5, 36, value, 0), "velocity"); check(!pool.trigger(5, 36, 1, value), "pan");
            }
            check(pool.trigger(5, 0, 0, 1), "zero velocity valid");
            equal(pool.getStats().getDropped(), 18);
        });
        test("block partitions preserve deterministic samples and counters", () -> {
            double[] reference = render(5000);
            for (int size : new int[] {1, 7, 128, 257}) check(Arrays.equals(render(size), reference), "partition " + size);
        });
        test("finite sinc overshoot survives without clipping or normalization", () -> {
            for (double value : new double[] {-2, -1.25, 1.25, 2}) {
                LiveDrumPool pool = new LiveDrumPool(RATE, bank(new float[][] {pcm(value)})); close(hit(pool), value);
            }
            LiveDrumPool pool = new LiveDrumPool(RATE, bank(new float[][] {pcm(2)}));
            for (int i = 0; i < 16; i++) check(pool.trigger(5, 36, 1, 0), "headroom hit");
            close(advance(pool, 9), 32);
        });
        test("engine rates preserve rounded 1 ms attack and exact 50 ms stop", () -> {
            for (int rate : new int[] {8000, 44100, 48000, 96000, 192000}) {
                LiveDrumPool pool = new LiveDrumPool(rate, new Bank(rate, new float[][] {pcm(.25, rate)}, definitions()));
                check(pool.trigger(5, 36, 1, 0), "hit"); advance(pool, (int) Math.round(rate * .001) + 1);
                close(pool.getOutputL(), .25); pool.stop(); advance(pool, (int) Math.round(rate * .05) - 1);
                equal(pool.getActiveVoices(), 1); pool.next(GAINS); equal(pool.getActiveVoices(), 0); close(pool.getOutputL(), 0);
            }
        });
        test("malformed bank, instrument and zone definitions fail atomically", LiveDrumPoolTest::invalidDefinitions);
        test("16 MiB budget includes unreferenced and repeated input samples", () -> {
            int rate = 192000; float[] sample = new float[rate * 10];
            rejects(() -> new Bank(rate, new float[][] {sample, sample, sample}, definitions()));
            int framesLeft = LiveDrumPool.MAX_DECODED_BYTES / 4 - 2 * sample.length;
            Bank bank = new Bank(rate, new float[][] {sample, sample, new float[framesLeft]}, definitions());
            equal(bank.getSampleFrames(2), framesLeft); equal(new LiveDrumPool(rate, bank).getActiveVoices(), 0);
            rejects(() -> new Bank(rate, new float[][] {sample, sample, new float[framesLeft + 1]}, definitions()));
        });
        test("all 64 zones and 32 samples remain addressable", () -> {
            float[][] samples = new float[32][]; Zone[] zones = new Zone[64];
            for (int i = 0; i < 32; i++) samples[i] = pcm((i + 1) / 64.0, 80);
            for (int i = 0; i < 64; i++) zones[i] = zone(i % 32, i, i, 0, 1);
            Instrument[] instruments = definitions(); instruments[3] = instrument(3, 1, null, zones);
            LiveDrumPool pool = new LiveDrumPool(RATE, new Bank(RATE, samples, instruments));
            for (int i = 0; i < 64; i++) close(sampleAndFinish(pool, 8, i, 1), ((i % 32) + 1) / 64.0);
            check(!pool.trigger(8, 64, 1, 0), "key outside all zones");
            for (int i = 0; i < 64; i++) zones[i] = zone(i % 32);
            instruments[3] = instrument(3, 1, null, zones); pool = new LiveDrumPool(RATE, new Bank(RATE, samples, instruments));
            for (int i = 0; i < 129; i++) close(sampleAndFinish(pool, 8, 60, 1), ((i % 32) + 1) / 64.0);
        });
        test("compiled lookup/RR agrees with 3000 direct sparse-overlap selections", LiveDrumPoolTest::sparseSelection);
        test("one million hot-path iterations allocate zero measured bytes", LiveDrumPoolTest::hotPaths);
        if (args.length > 0) {
            verifyJavaScriptVectors(Path.of(args[0])); passed++;
            System.out.println("PASS 18000 JS/native stereo frames and per-frame voice/counter parity at 3 rates");
        }
        System.out.println("PASS " + passed + " native live drum pool checks");
    }

    private static double[] render(int blockSize) {
        Instrument[] instruments = definitions(); instruments[1] = instrument(1, 1, null, zone(0), zone(1));
        instruments[2] = instrument(2, 1, "hat", zone(0));
        LiveDrumPool pool = new LiveDrumPool(RATE, new Bank(RATE,
                new float[][] {pcm(.25, 800), pcm(-.125, 800)}, instruments));
        double[] result = new double[10005], gains = GAINS.clone();
        for (int block = 0; block < 5000; block += blockSize) {
            for (int frame = block; frame < Math.min(5000, block + blockSize); frame++) {
                if (frame % 83 == 0) pool.trigger(5 + frame % 5, frame % 128, .7, (frame % 3) / 2.0);
                if (frame == 1500) pool.setEnabled(false);
                if (frame == 1800) pool.setEnabled(true);
                if (frame == 2500) gains[1] = .2;
                if (frame == 3500) pool.stop();
                pool.setEnabled(!(frame >= 1500 && frame < 1800)); pool.next(gains);
                result[frame * 2] = pool.getOutputL(); result[frame * 2 + 1] = pool.getOutputR();
                check(Double.isFinite(pool.getOutputL()) && Double.isFinite(pool.getOutputR()), "nonfinite mix");
                check(pool.getActiveVoices() <= 16, "polyphony bound");
            }
        }
        result[10000] = pool.getStats().getAccepted(); result[10001] = pool.getStats().getDropped();
        result[10002] = pool.getStats().getUnmapped(); result[10003] = pool.getStats().getChoked();
        result[10004] = pool.getActiveVoices(); return result;
    }

    private static void invalidDefinitions() {
        for (int rate : new int[] {Integer.MIN_VALUE, 7999, 192001, Integer.MAX_VALUE}) {
            rejects(() -> new Bank(rate, new float[][] {pcm(0, 2)}, definitions()));
            rejects(() -> new LiveDrumPool(rate, bank()));
        }
        for (int polyphony : new int[] {0, 17, Integer.MAX_VALUE}) rejects(() -> new LiveDrumPool(RATE, bank(), polyphony));
        rejects(() -> new LiveDrumPool(RATE, null)); rejects(() -> new LiveDrumPool(RATE + 1, bank()));
        rejects(() -> new Bank(RATE, null, definitions())); rejects(() -> new Bank(RATE, new float[0][], definitions()));
        rejects(() -> new Bank(RATE, new float[][] {null}, definitions()));
        rejects(() -> new Bank(RATE, new float[][] {new float[1]}, definitions()));
        rejects(() -> new Bank(RATE, new float[][] {new float[RATE * 10 + 1]}, definitions()));
        rejects(() -> new Bank(RATE, new float[33][], definitions()));
        for (float value : new float[] {Float.NaN, Float.POSITIVE_INFINITY, Float.NEGATIVE_INFINITY, 2.01f, -2.01f}) {
            rejects(() -> new Bank(RATE, new float[][] {{0, value}}, definitions()));
        }
        rejects(() -> new Bank(RATE, new float[][] {pcm(0, 2)}, null));
        rejects(() -> new Bank(RATE, new float[][] {pcm(0, 2)}, new Instrument[4]));
        rejects(() -> new Bank(RATE, new float[][] {pcm(0, 2)}, new Instrument[6]));
        rejects(() -> new Bank(RATE, new float[][] {pcm(0, 2)}, new Instrument[5]));
        Instrument[] duplicate = definitions(); duplicate[4] = duplicate[0];
        rejects(() -> new Bank(RATE, new float[][] {pcm(0, 2)}, duplicate));
        Instrument[] missingSample = definitions(); missingSample[0] = instrument(0, 1, null, zone(1));
        rejects(() -> new Bank(RATE, new float[][] {pcm(0, 2)}, missingSample));
        for (String id : new String[] {null, "pad", "Kick", ""}) rejects(() -> new Instrument(id, 1, true, null, new Zone[] {zone(0)}));
        for (double gain : new double[] {Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY, -.1, 1.1}) {
            rejects(() -> instrument(0, gain, null, zone(0)));
        }
        rejects(() -> new Instrument("kick", 1, false, null, new Zone[] {zone(0)}));
        for (String choke : new String[] {"", "x".repeat(33)}) rejects(() -> instrument(0, 1, choke, zone(0)));
        rejects(() -> new Instrument("kick", 1, true, null, null));
        rejects(() -> instrument(0, 1, null)); rejects(() -> instrument(0, 1, null, new Zone[65]));
        rejects(() -> instrument(0, 1, null, new Zone[] {null}));
        rejects(() -> zone(-1)); rejects(() -> zone(32));
        rejects(() -> zone(0, -1, 127, 0, 1)); rejects(() -> zone(0, 0, 128, 0, 1));
        rejects(() -> zone(0, 80, 79, 0, 1)); rejects(() -> zone(0, 0, 127, .9, .8));
        for (double value : new double[] {Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY, -.1, 1.1}) {
            rejects(() -> zone(0, 0, 127, value, 1)); rejects(() -> zone(0, 0, 127, 0, value));
        }
        // Both endpoint gains and the maximum-length choke name are valid.
        Instrument[] valid = definitions(); valid[0] = instrument(0, 0, "x".repeat(32), zone(0));
        close(hit(new LiveDrumPool(RATE, new Bank(RATE, new float[][] {pcm(.25)}, valid))), 0);
    }

    private static final class RandomSequence {
        int state = 291297;
        double next() { state = state * 1664525 + 1013904223; return (state & 0xffffffffL) / 4294967296.0; }
    }
    private static void sparseSelection() {
        RandomSequence random = new RandomSequence(); float[][] samples = new float[32][]; Zone[] zones = new Zone[64];
        for (int i = 0; i < 32; i++) samples[i] = pcm((i + 1) / 64.0, 80);
        for (int i = 0; i < 64; i++) {
            int low = (int) (random.next() * 128); double soft = (int) (random.next() * 8) / 8.0;
            zones[i] = zone(i % 32, low, Math.min(127, low + (int) (random.next() * 40)),
                    soft, Math.min(1, soft + (int) (random.next() * 4) / 8.0));
        }
        Instrument[] instruments = definitions(); instruments[0] = instrument(0, 1, null, zones);
        LiveDrumPool pool = new LiveDrumPool(RATE, new Bank(RATE, samples, instruments));
        Map<Long, Integer> counters = new HashMap<>(); int accepted = 0, unmapped = 0;
        for (int trial = 0; trial < 3000; trial++) {
            int pitch = (int) (random.next() * 128);
            double velocity = trial % 2 != 0 ? (int) (random.next() * 9) / 8.0 : random.next();
            long matches = 0;
            for (int i = 0; i < zones.length; i++) {
                Zone z = zones[i];
                if (pitch >= z.keyLow && pitch <= z.keyHigh && velocity >= z.velocityLow && velocity <= z.velocityHigh) matches |= 1L << i;
            }
            if (matches == 0) { check(!pool.trigger(5, pitch, velocity, 0), "unmapped"); unmapped++; continue; }
            int cursor = counters.getOrDefault(matches, 0), seen = 0, selected = -1;
            for (int i = 0; i < zones.length; i++) if ((matches & (1L << i)) != 0 && seen++ == cursor) { selected = i; break; }
            counters.put(matches, (cursor + 1) % Long.bitCount(matches));
            close(sampleAndFinish(pool, 5, pitch, velocity), samples[zones[selected].sampleIndex][8] * velocity); accepted++;
        }
        stats(pool, accepted, 0, unmapped, 0);
    }

    private static void hotLoop(LiveDrumPool pool, int frames) {
        for (int frame = 0; frame < frames; frame++) {
            if (frame % 10 == 0) pool.trigger(5 + frame % 5, 36, .5, .5);
            if (frame % 111 == 0) pool.setEnabled(false);
            if (frame % 137 == 0) pool.setEnabled(true);
            pool.next(GAINS);
            if (frame % 1000 == 0) { pool.stop(); pool.release(); pool.reset(); }
        }
    }
    @SuppressWarnings("deprecation") // Thread.getId is supported on Java 17.
    private static void hotPaths() {
        Instrument[] instruments = definitions(); instruments[0] = instrument(0, 1, "hat", zone(0));
        LiveDrumPool pool = new LiveDrumPool(RATE, new Bank(RATE, new float[][] {pcm(.25, 80)}, instruments));
        hotLoop(pool, 200000);
        java.lang.management.ThreadMXBean base = ManagementFactory.getThreadMXBean();
        if (!(base instanceof com.sun.management.ThreadMXBean)) throw new AssertionError("JDK allocation counter unavailable");
        com.sun.management.ThreadMXBean bean = (com.sun.management.ThreadMXBean) base;
        check(bean.isThreadAllocatedMemorySupported(), "allocation counter unsupported");
        if (!bean.isThreadAllocatedMemoryEnabled()) bean.setThreadAllocatedMemoryEnabled(true);
        long thread = Thread.currentThread().getId(); bean.getThreadAllocatedBytes(thread);
        long before = bean.getThreadAllocatedBytes(thread);
        hotLoop(pool, 1000000);
        equal(bean.getThreadAllocatedBytes(thread) - before, 0);
    }

    private static Bank vectorBank(int rate) {
        float[][] samples = new float[4][rate / 2];
        for (int j = 0; j < samples.length; j++) {
            for (int i = 0; i < samples[j].length; i++) samples[j][i] = (float) ((((i * 13 + j * 11) % 97) - 48) / 31.0);
        }
        Instrument[] instruments = definitions();
        instruments[0] = instrument(0, .72, null, zone(0, 35, 38, 0, .5), zone(1, 36, 40, .5, 1));
        instruments[1] = instrument(1, 1, null, zone(2), zone(3));
        instruments[2] = instrument(2, .6, "metal", zone(1), zone(3));
        instruments[3] = instrument(3, .9, null, zone(2, 41, 64, 0, 1));
        instruments[4] = instrument(4, .8, "metal", zone(0));
        return new Bank(rate, samples, instruments);
    }
    private static void verifyJavaScriptVectors(Path path) throws Exception {
        int currentRate = 0, count = 0; LiveDrumPool pool = null; double[] gains = null;
        for (String line : Files.readAllLines(path)) {
            String[] fields = line.split("\\t"); int rate = Integer.parseInt(fields[0]), frame = Integer.parseInt(fields[1]);
            if (rate != currentRate) { currentRate = rate; pool = new LiveDrumPool(rate, vectorBank(rate)); gains = GAINS.clone(); }
            if (frame == 1900) pool.setEnabled(false);
            if (frame == 2200) pool.setEnabled(true);
            if (frame == 2500) gains[1] = .2;
            if (frame == 3000) pool.stop();
            if (frame == 3050) pool.release();
            if (frame == 4100) { pool.setEnabled(false); pool.reset(); }
            if (frame == 4120) pool.setEnabled(true);
            if (frame == 4500) gains[2] = Double.NaN;
            if (frame == 4800) gains[2] = 3;
            if (frame % 83 == 0) pool.trigger(5 + frame % 5, 35 + frame % 32, (frame % 9) / 8.0, (frame % 5) / 4.0);
            if (frame % 251 == 0) pool.trigger(5, 36, Double.NaN, 0);
            if (frame == 1000) for (int i = 0; i < 30; i++) pool.trigger(6, 38, .8, .25);
            pool.next(gains);
            close(pool.getOutputL(), Double.parseDouble(fields[2])); close(pool.getOutputR(), Double.parseDouble(fields[3]));
            equal(pool.getActiveVoices(), Long.parseLong(fields[4]));
            stats(pool, Long.parseLong(fields[5]), Long.parseLong(fields[6]), Long.parseLong(fields[7]), Long.parseLong(fields[8]));
            check(pool.isEnabled() == Boolean.parseBoolean(fields[9]), "enable parity"); count++;
        }
        equal(count, 18000);
    }
}
