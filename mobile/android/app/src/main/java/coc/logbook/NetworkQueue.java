package coc.logbook;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/** Network-only bounded pool. Database/CAS work stays on Capacitor's original serial queue. */
final class NetworkQueue implements AutoCloseable {
    private final ThreadPoolExecutor executor;

    NetworkQueue() {
        this(4);
    }

    /** Fixed network-only concurrency; pending work remains bounded independently of body size. */
    NetworkQueue(int parallelism) {
        this(parallelism,4);
    }

    /** Queued URL jobs are separate from physical connections and the two expanded-body workers. */
    NetworkQueue(int parallelism,int pending) {
        if(parallelism<1||parallelism>6||pending<1||pending>6)throw new IllegalArgumentException("Invalid network parallelism or pending window");
        AtomicInteger names = new AtomicInteger();
        executor = new ThreadPoolExecutor(parallelism, parallelism, 30, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(pending), runnable -> {
                Thread thread = new Thread(runnable, "COC-log-network-" + names.incrementAndGet());
                thread.setPriority(Thread.NORM_PRIORITY - 1);
                return thread;
            });
        executor.allowCoreThreadTimeOut(true);
    }

    /** Enqueue network work only; fail explicitly on overload or shutdown instead of blocking the bridge. */
    void execute(Runnable work, Runnable rejected) {
        try { executor.execute(work); }
        catch (RejectedExecutionException error) { rejected.run(); }
    }

    @Override public void close() { executor.shutdownNow(); }
}
