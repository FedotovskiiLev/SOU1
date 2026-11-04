// SPDX-License-Identifier: AGPL-3.0-only
package org.sou1;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/** Real worker threads + a manually drained owner thread, with no Android stubs. */
public final class DrumPreparationTest {
    private static final AtomicInteger checks = new AtomicInteger();
    private static void check(boolean value, String message) {
        checks.incrementAndGet();
        if (!value) throw new AssertionError(message);
    }
    private static void await(CountDownLatch latch) throws InterruptedException {
        if (!latch.await(5, TimeUnit.SECONDS)) throw new AssertionError("Worker did not reach test checkpoint");
    }
    private static final class Delivery implements Executor {
        final BlockingQueue<Runnable> tasks = new LinkedBlockingQueue<>();
        @Override public void execute(Runnable task) { tasks.add(task); }
        void next() throws InterruptedException {
            Runnable task = tasks.poll(5, TimeUnit.SECONDS);
            if (task == null) throw new AssertionError("Missing delivery");
            task.run();
        }
        void drain() { Runnable task; while ((task = tasks.poll()) != null) task.run(); }
    }

    private static void repeatedPlayAndControlUpdate() throws Exception {
        Delivery delivery = new Delivery();
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        AtomicInteger loads = new AtomicInteger();
        List<String> completed = new ArrayList<>();
        String owner = Thread.currentThread().getName();
        // Control state remains owned by the service, not captured in the loader.
        int[] latestControl = {1};
        try (DrumPreparation<String> preparation = new DrumPreparation<>(kit -> {
            check(!Thread.currentThread().getName().equals(owner), "loading runs off owner thread");
            loads.incrementAndGet(); entered.countDown(); await(release); return kit;
        }, delivery)) {
            check(preparation.prepare("brush", (value, failure) -> {
                check(failure == null, "successful preparation");
                check(Thread.currentThread().getName().equals(owner), "delivery uses owner thread");
                completed.add(value + latestControl[0]);
            }), "first PLAY accepted");
            await(entered);
            for (int i = 0; i < 100; i++)
                check(!preparation.prepare("another-kit", (value, failure) -> completed.add("duplicate")), "repeat coalesces");
            latestControl[0] = 7; // UPDATE during preparation, used by ready Session creation.
            check(preparation.isPreparing() && completed.isEmpty(), "no session while preparing");
            release.countDown(); delivery.next();
            check(!preparation.isPreparing(), "ready clears preparation");
            check(loads.get() == 1 && completed.equals(List.of("brush7")), "one kit, newest controls");
        }
    }

    private static void stopDuringLoadAndRetry() throws Exception {
        Delivery delivery = new Delivery();
        CountDownLatch entered = new CountDownLatch(1), interrupted = new CountDownLatch(1);
        AtomicInteger loads = new AtomicInteger(), completions = new AtomicInteger();
        try (DrumPreparation<String> preparation = new DrumPreparation<>(kit -> {
            if (loads.incrementAndGet() == 1) {
                entered.countDown();
                try { new CountDownLatch(1).await(); }
                catch (InterruptedException expected) { interrupted.countDown(); throw expected; }
            }
            return kit;
        }, delivery)) {
            preparation.prepare("old", (value, failure) -> completions.incrementAndGet());
            await(entered); preparation.cancel(); await(interrupted);
            check(!preparation.isPreparing(), "STOP immediately clears preparing");
            check(preparation.prepare("retry", (value, failure) -> {
                check(failure == null && value.equals("retry"), "retry succeeds");
                completions.incrementAndGet();
            }), "retry accepted");
            delivery.next(); delivery.drain();
            check(completions.get() == 1 && loads.get() == 2, "cancelled load cannot complete");
        }
    }

    private static void queuedCompletionCannotRevive() throws Exception {
        Delivery delivery = new Delivery();
        AtomicInteger completions = new AtomicInteger();
        try (DrumPreparation<String> preparation = new DrumPreparation<>(kit -> kit, delivery)) {
            preparation.prepare("old", (value, failure) -> completions.incrementAndGet());
            Runnable stale = delivery.tasks.poll(5, TimeUnit.SECONDS);
            check(stale != null, "completed result awaits delivery");
            preparation.cancel();
            preparation.prepare("new", (value, failure) -> {
                check(value.equals("new"), "only latest identity publishes");
                completions.incrementAndGet();
            });
            stale.run(); check(completions.get() == 0, "STOP invalidates already queued completion");
            delivery.next();
            check(completions.get() == 1, "new session is not hidden by stale result");
        }
    }

    private static void failureAndRetry() throws Exception {
        Delivery delivery = new Delivery();
        AtomicInteger loads = new AtomicInteger(), failures = new AtomicInteger(), ready = new AtomicInteger();
        try (DrumPreparation<String> preparation = new DrumPreparation<>(kit -> {
            if (loads.incrementAndGet() == 1) throw new IOException("verified asset mismatch");
            return kit;
        }, delivery)) {
            preparation.prepare("brush", (value, failure) -> {
                check(value == null && failure instanceof IOException, "failure propagates without fallback");
                failures.incrementAndGet();
            });
            delivery.next();
            check(!preparation.isPreparing() && ready.get() == 0, "failed bank is never published");
            preparation.prepare("brush", (value, failure) -> ready.incrementAndGet());
            delivery.next();
            check(loads.get() == 2 && failures.get() == 1 && ready.get() == 1, "explicit retry reloads");
        }
    }

    private static void destroyAndBoundedWorkerAcrossOwners() throws Exception {
        Delivery delivery = new Delivery();
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1), exited = new CountDownLatch(1);
        AtomicBoolean interrupted = new AtomicBoolean();
        AtomicInteger active = new AtomicInteger(), maxActive = new AtomicInteger(), callbacks = new AtomicInteger();
        DrumPreparation<String> old = new DrumPreparation<>(kit -> {
            int count = active.incrementAndGet(); maxActive.accumulateAndGet(count, Math::max);
            entered.countDown();
            // A deliberately uncooperative finite operation must still not publish.
            while (true) {
                try { await(release); break; }
                catch (InterruptedException ignored) { interrupted.set(true); }
            }
            active.decrementAndGet(); exited.countDown(); return "late";
        }, delivery);
        old.prepare("old", (value, failure) -> callbacks.incrementAndGet());
        await(entered); old.close();
        check(!old.isPreparing(), "destroy clears pending state");
        check(!old.prepare("forbidden", (value, failure) -> callbacks.incrementAndGet()), "closed owner cannot restart");
        try (DrumPreparation<String> replacement = new DrumPreparation<>(kit -> {
            int count = active.incrementAndGet(); maxActive.accumulateAndGet(count, Math::max);
            active.decrementAndGet(); return kit;
        }, delivery)) {
            // Churn removes queued jobs: one running load and at most one pending.
            for (int i = 0; i < 100; i++) {
                check(replacement.prepare("queued-" + i, (value, failure) -> callbacks.incrementAndGet()), "queued retry accepted");
                replacement.cancel();
            }
            replacement.prepare("latest", (value, failure) -> {
                check(failure == null && value.equals("latest"), "latest queued work survives cancellation churn");
                callbacks.incrementAndGet();
            });
            release.countDown(); await(exited); delivery.next(); delivery.drain();
            check(interrupted.get(), "destroy interrupts worker");
            check(maxActive.get() == 1, "one process-wide worker across old and new service owners");
            check(callbacks.get() == 1, "late completion cannot revive destroyed session");
        }
    }

    private static void destroyBeforeDelivery() throws Exception {
        Delivery delivery = new Delivery();
        AtomicInteger callbacks = new AtomicInteger();
        DrumPreparation<String> preparation = new DrumPreparation<>(kit -> kit, delivery);
        preparation.prepare("ready", (value, failure) -> callbacks.incrementAndGet());
        Runnable queued = delivery.tasks.poll(5, TimeUnit.SECONDS);
        check(queued != null, "result queued before destroy");
        preparation.close(); queued.run();
        check(callbacks.get() == 0, "destroy invalidates ready result");
    }

    public static void main(String[] args) throws Exception {
        repeatedPlayAndControlUpdate(); stopDuringLoadAndRetry(); queuedCompletionCannotRevive();
        failureAndRetry(); destroyAndBoundedWorkerAcrossOwners(); destroyBeforeDelivery();
        System.out.println("PASS DrumPreparation: " + checks.get() + " assertions; stop, late delivery, retry, duplicate PLAY, UPDATE, failure, destroy and bounded worker");
    }
}
