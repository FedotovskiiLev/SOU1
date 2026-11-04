// SPDX-License-Identifier: AGPL-3.0-only
package org.sou1;

import java.io.IOException;
import java.io.InterruptedIOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.sou1.audio.DevelopmentConfig;
import org.sou1.audio.NativeDrumBankLoader;

/** Executes the production frozen selection and paired loader/coordinator, not Android APIs. */
public final class NativeAudioSelectionTest {
    private static final AtomicInteger checks = new AtomicInteger();
    private static void check(boolean value, String message) {
        checks.incrementAndGet();
        if (!value) throw new AssertionError(message);
    }
    private static void reject(Runnable work, String message) {
        try { work.run(); } catch (IllegalArgumentException expected) { checks.incrementAndGet(); return; }
        throw new AssertionError("Accepted invalid " + message);
    }
    private static final class Delivery implements Executor {
        final BlockingQueue<Runnable> tasks = new LinkedBlockingQueue<>();
        @Override public void execute(Runnable task) { tasks.add(task); }
        Runnable take() throws InterruptedException {
            Runnable task = tasks.poll(15, TimeUnit.SECONDS);
            if (task == null) throw new AssertionError("No preparation delivery");
            return task;
        }
        void drain() { Runnable task; while ((task = tasks.poll()) != null) task.run(); }
    }
    private static void await(CountDownLatch latch) throws InterruptedException {
        if (!latch.await(15, TimeUnit.SECONDS)) throw new AssertionError("Preparation checkpoint timed out");
    }
    private static InputStream cancelledRead(CountDownLatch entered, CountDownLatch cancelled) throws IOException {
        entered.countDown();
        try { new CountDownLatch(1).await(); }
        catch (InterruptedException expected) {
            Thread.currentThread().interrupt(); cancelled.countDown();
            throw new InterruptedIOException("test cancelled read");
        }
        throw new AssertionError("Unreachable");
    }
    private static NativeAudioSelection recorded(String palette) {
        String custom = NativeDrumBankLoader.customSelectionKey("vcsl", Map.of("snare", "guigui-soft", "hihat", "fsa-x0xproc1"));
        return new NativeAudioSelection(custom, "developing",
                DevelopmentConfig.fromMap(Map.of("tonic", 11, "mode", 5, "meter", 4,
                        "rhythmFamily", 7, "arpStrategy", 6, "drumPattern", 3,
                        "harmony", "fixed", "drumVariation", 0.375)), palette);
    }
    private static void strictSelection() throws Exception {
        NativeAudioSelection value = NativeAudioSelection.DEFAULT;
        check(!value.needsPreparation(), "original procedural default needs no worker");
        check(value.scoreConfig.equals(DevelopmentConfig.DEFAULT), "score config defaults remain automatic");
        AtomicInteger reads = new AtomicInteger();
        NativeAudioSelection.Banks defaults = NativeAudioSelection.prepare(value.preparationKey(), 48000,
                path -> { reads.incrementAndGet(); throw new IOException("unexpected drums"); },
                path -> { reads.incrementAndGet(); throw new IOException("unexpected melodies"); });
        check(defaults.drums == null && defaults.melodies == null && reads.get() == 0, "procedural path has no assets");
        List<String> kits = new ArrayList<>(NativeDrumBankLoader.supportedKits()); kits.add("procedural"); kits.add(recorded("chamber").drumKit);
        for (String kit : kits) for (String score : new String[]{"original", "developing"})
            for (String palette : new String[]{"procedural", "chamber", "piano-room", "chamber-flute"}) {
                NativeAudioSelection selection = new NativeAudioSelection(kit, score, recorded(palette).scoreConfig, palette);
                NativeAudioSelection decoded = NativeAudioSelection.parseKey(selection.preparationKey());
                check(decoded.drumKit.equals(kit) && decoded.scoreMode.equals(score) && decoded.melodicPreset.equals(palette)
                        && decoded.scoreConfig.equals(selection.scoreConfig), "exact frozen round trip");
            }
        for (String bad : new String[]{null, "", "unknown", "../vcsl", "procedural\nchamber", "custom-v1|procedural|inherit|inherit|inherit|inherit|inherit",
                "custom-v1|vcsl|inherit|inherit|inherit|inherit|inherit", "custom-v1|vcsl|vcsl|guigui-soft|inherit|inherit|inherit",
                "custom-v1|vcsl|inherit|bad|inherit|inherit|inherit", "custom-v1|vcsl|inherit|guigui-soft|inherit|inherit|inherit|extra"}) {
            check(!NativeAudioSelection.isSupportedDrumKit(bad), "reject noncanonical or unknown drum selection");
            reject(() -> new NativeAudioSelection(bad, "original", DevelopmentConfig.DEFAULT, "procedural"), "drum key");
        }
        for (String bad : new String[]{null, "", "piano", "chamber\n", "../chamber", "CHAMBER"})
            reject(() -> new NativeAudioSelection("procedural", "original", DevelopmentConfig.DEFAULT, bad), "palette");
        reject(() -> new NativeAudioSelection("procedural", "improvised", DevelopmentConfig.DEFAULT, "chamber"), "mode");
        reject(() -> new NativeAudioSelection("procedural", "original", null, "chamber"), "null config");
        for (String bad : new String[]{null, "", value.preparationKey()+"\n", value.preparationKey().replace("s1", "s2"), "x".repeat(513)})
            reject(() -> NativeAudioSelection.parseKey(bad), "compound key");
        reject(() -> DevelopmentConfig.fromMap(Map.of("tonic", "0")), "numeric-string tonic");
        reject(() -> DevelopmentConfig.fromMap(Map.of("mode", true)), "boolean mode");
        reject(() -> DevelopmentConfig.fromMap(Map.of("meter", 6)), "meter bound");
        reject(() -> DevelopmentConfig.fromMap(Map.of("harmony", "random")), "harmony enum");
        reject(() -> DevelopmentConfig.fromMap(Map.of("extra", 1)), "unknown nested config field");
        reject(() -> DevelopmentConfig.fromMap(Map.of("drumVariation", Double.NaN)), "nonfinite variation");
        reject(() -> DevelopmentConfig.parseKey(value.scoreConfig.key.replace("d1|", "d2|")), "config version");
        Thread.currentThread().interrupt();
        try {
            NativeAudioSelection.prepare(recorded("chamber").preparationKey(), 48000,
                    path -> { reads.incrementAndGet(); throw new IOException("unexpected"); },
                    path -> { reads.incrementAndGet(); throw new IOException("unexpected"); });
            throw new AssertionError("Pre-interrupted load accepted");
        } catch (InterruptedIOException expected) { check(reads.get() == 0, "interruption checked before asset reads"); }
        finally { Thread.interrupted(); }
    }
    private static void successfulPairAndQueuedStop(Path assets) throws Exception {
        NativeAudioSelection selected = recorded("chamber");
        Delivery delivery = new Delivery();
        String owner = Thread.currentThread().getName();
        AtomicInteger phase = new AtomicInteger(), drumReads = new AtomicInteger(), melodicReads = new AtomicInteger();
        CountDownLatch entered = new CountDownLatch(1), proceed = new CountDownLatch(1);
        int[] latestKnobs = {1}, latestTimer = {0}; long[] latestSeed = {12};
        try (DrumPreparation<NativeAudioSelection.Banks> preparation = new DrumPreparation<>(key -> {
            check(!Thread.currentThread().getName().equals(owner), "large preparation is off owner thread");
            entered.countDown(); await(proceed); phase.set(0);
            return NativeAudioSelection.prepare(key, 48000, path -> {
                check(phase.get() == 0, "all drum reads precede melodic reads"); drumReads.incrementAndGet();
                return Files.newInputStream(assets.resolve(path));
            }, path -> {
                phase.set(1); melodicReads.incrementAndGet(); return Files.newInputStream(assets.resolve(path));
            });
        }, delivery)) {
            AtomicInteger completions = new AtomicInteger();
            preparation.prepare(selected.preparationKey(), (ready, failure) -> {
                check(failure == null && ready != null && ready.drums != null && ready.melodies != null, "paired banks arrive together");
                check(ready.drums.sampleRate == 48000 && ready.melodies.sampleRate == 48000, "both immutable banks target device rate");
                check(latestKnobs[0] == 8 && latestSeed[0] == 99 && latestTimer[0] == 23, "delivery consumes latest owner knobs, reseed and timer");
                completions.incrementAndGet();
            });
            await(entered);
            for (int i=0;i<30;i++) check(!preparation.prepare(NativeAudioSelection.DEFAULT.preparationKey(), (r,f) -> {
                throw new AssertionError("Repeated PLAY cannot replace frozen pair");
            }), "repeated PLAY coalesces");
            latestKnobs[0]=8; latestSeed[0]=99; latestTimer[0]=23; proceed.countDown();
            delivery.take().run();
            check(completions.get()==1 && drumReads.get()>0 && melodicReads.get()>0, "verified drum and melodic assets loaded once");
            // Run the real pair again, then stop after its ready result entered the owner queue.
            preparation.prepare(selected.preparationKey(), (r,f) -> completions.incrementAndGet());
            Runnable stale = delivery.take();
            preparation.cancel();
            stale.run();
            check(completions.get()==1, "queued paired result cannot revive stopped session");
        }
    }
    private static void melodicFailureIsAtomic(Path assets) throws Exception {
        Delivery delivery = new Delivery(); AtomicInteger drumReads = new AtomicInteger(), melodyReads = new AtomicInteger();
        try (DrumPreparation<NativeAudioSelection.Banks> preparation = new DrumPreparation<>(key ->
                NativeAudioSelection.prepare(key, 48000, path -> {
                    drumReads.incrementAndGet(); return Files.newInputStream(assets.resolve(path));
                }, path -> { melodyReads.incrementAndGet(); throw new IOException("corrupt melodic metadata"); }), delivery)) {
            preparation.prepare(recorded("piano-room").preparationKey(), (ready, failure) -> {
                check(ready == null && failure instanceof IOException, "melody failure never publishes already prepared drums");
            });
            delivery.take().run();
            check(drumReads.get()>0 && melodyReads.get()==1 && !preparation.isPreparing(), "failure clears combined job without fallback");
        }
    }
    private static void cancellationDuringEitherLoad(Path assets, boolean duringMelody) throws Exception {
        Delivery delivery = new Delivery(); CountDownLatch entered = new CountDownLatch(1), interrupted = new CountDownLatch(1);
        AtomicInteger melodicReads = new AtomicInteger(), callbacks = new AtomicInteger();
        try (DrumPreparation<NativeAudioSelection.Banks> preparation = new DrumPreparation<>(key ->
                NativeAudioSelection.prepare(key, 48000, path -> duringMelody
                        ? Files.newInputStream(assets.resolve(path)) : cancelledRead(entered, interrupted),
                        path -> { melodicReads.incrementAndGet(); return cancelledRead(entered, interrupted); }), delivery)) {
            preparation.prepare(recorded("chamber-flute").preparationKey(), (r,f) -> callbacks.incrementAndGet());
            await(entered); preparation.cancel(); await(interrupted);
            preparation.prepare(NativeAudioSelection.DEFAULT.preparationKey(), (ready, failure) -> {
                check(failure == null && ready.drums == null && ready.melodies == null, "cancelled pair permits explicit clean retry");
                callbacks.incrementAndGet();
            });
            delivery.take().run(); delivery.drain();
            check(callbacks.get()==1 && !preparation.isPreparing(), "cancelled pair never activates or reports stale failure");
            check(melodicReads.get()==(duringMelody?1:0), "drum cancellation does not start a melodic load");
        }
    }
    public static void main(String[] args) throws Exception {
        Path assets=Path.of(args[0]); strictSelection(); successfulPairAndQueuedStop(assets);
        melodicFailureIsAtomic(assets); cancellationDuringEitherLoad(assets,false); cancellationDuringEitherLoad(assets,true);
        System.out.println("PASS NativeAudioSelection: "+checks.get()+" assertions; closed selection/config, real sequential banks, coalescing, atomic failure and paired cancellation (JVM only)");
    }
}
