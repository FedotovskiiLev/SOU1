// SPDX-License-Identifier: AGPL-3.0-only
package org.sou1;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Executor;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/**
 * Single-flight, bounded off-thread preparation. The process has one worker and
 * at most one waiting job, even across Service destruction/recreation. Cancelling
 * interrupts running I/O and removes queued work; identity is checked again on
 * the delivery thread, so a late result cannot revive a stopped session.
 *
 * This class has no Android dependencies. Delivery must use the owner's event
 * thread (Android's main Handler), never the audio/render thread.
 */
final class DrumPreparation<T> implements AutoCloseable {
    @FunctionalInterface interface Loader<T> { T load(String kit) throws Exception; }
    @FunctionalInterface interface Completion<T> { void complete(T ready, Throwable failure); }
    private static final ThreadPoolExecutor WORKER = new ThreadPoolExecutor(
            1, 1, 30, TimeUnit.SECONDS, new ArrayBlockingQueue<>(1), runnable -> {
                Thread thread = new Thread(runnable, "SOU1-drum-preparation");
                thread.setDaemon(true);
                return thread;
            });
    static { WORKER.allowCoreThreadTimeOut(true); }

    private final Loader<T> loader;
    private final Executor delivery;
    private Job current;
    private boolean closed;

    DrumPreparation(Loader<T> loader, Executor delivery) {
        this.loader = java.util.Objects.requireNonNull(loader);
        this.delivery = java.util.Objects.requireNonNull(delivery);
    }

    /** Repeated PLAY joins the existing work; it never queues a duplicate. */
    synchronized boolean prepare(String kit, Completion<T> completion) {
        if (closed || current != null) return false;
        Job job = new Job(kit, completion);
        current = job;
        try { WORKER.execute(job); }
        catch (RuntimeException unavailable) { job.finished(null, unavailable); }
        return true;
    }

    synchronized boolean isPreparing() { return current != null; }

    synchronized void cancel() {
        Job old = current;
        current = null; // Invalidate before interrupting or allowing delivery.
        if (old != null) {
            old.ready = null;
            old.error = null;
            if (old.runner != null) old.runner.interrupt();
            WORKER.remove(old);
        }
    }

    @Override public synchronized void close() {
        closed = true;
        cancel();
    }

    private final class Job implements Runnable {
        private final String kit;
        private final Completion<T> completion;
        // Accessed only while holding the owner's monitor, including cancellation.
        private Thread runner;
        private T ready;
        private Throwable error;
        Job(String kit, Completion<T> completion) {
            this.kit = kit;
            this.completion = java.util.Objects.requireNonNull(completion);
        }
        @Override public void run() {
            synchronized (DrumPreparation.this) {
                if (closed || current != this) return;
                runner = Thread.currentThread();
            }
            T result = null;
            Throwable failure = null;
            try { result = loader.load(kit); }
            catch (Throwable failed) { failure = failed; }
            finally {
                synchronized (DrumPreparation.this) { runner = null; }
            }
            finished(result, failure);
        }
        void finished(T result, Throwable failure) {
            synchronized (DrumPreparation.this) {
                if (closed || current != this) return;
                ready = result;
                error = failure;
                // Capture only the Job: cancel clears its large ready bank even
                // when this small delivery Runnable is still in the main queue.
                delivery.execute(this::deliver);
            }
        }
        void deliver() {
            synchronized (DrumPreparation.this) {
                if (closed || current != this) return;
                current = null;
                T result = ready;
                Throwable failure = error;
                ready = null;
                error = null;
                // Holding the lock also makes cancel/close a completion barrier.
                completion.complete(result, failure);
            }
        }
    }
}
