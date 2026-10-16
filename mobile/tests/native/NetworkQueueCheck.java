package coc.logbook;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/** Checks the production network queue's public dispatch boundary without Android or real HTTP. */
public final class NetworkQueueCheck {
    public static void main(String[] args) throws Exception {
        NetworkQueue queue = new NetworkQueue();
        CountDownLatch started = new CountDownLatch(4);
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch completed = new CountDownLatch(8);
        AtomicInteger active = new AtomicInteger();
        AtomicInteger peak = new AtomicInteger();
        AtomicInteger rejected = new AtomicInteger();
        Runnable work = () -> {
            int count = active.incrementAndGet(); peak.accumulateAndGet(count, Math::max);
            started.countDown();
            try { release.await(5, TimeUnit.SECONDS); } catch (InterruptedException error) { Thread.currentThread().interrupt(); }
            finally { active.decrementAndGet(); completed.countDown(); }
        };
        try {
            for (int i=0;i<4;i++) queue.execute(work, rejected::incrementAndGet);
            if (!started.await(2, TimeUnit.SECONDS)) throw new AssertionError("Network requests still serialized.");
            for (int i=0;i<4;i++) queue.execute(work, rejected::incrementAndGet);
            queue.execute(work, rejected::incrementAndGet);
            if (rejected.get()!=1 || peak.get()!=4) throw new AssertionError("Network queue exceeded its bounds.");
            release.countDown();
            if (!completed.await(2, TimeUnit.SECONDS)) throw new AssertionError("Queued requests did not finish.");
        } finally { release.countDown(); queue.close(); }
        queue.execute(() -> { throw new AssertionError("Closed queue ran work."); }, rejected::incrementAndGet);
        if (rejected.get()!=2) throw new AssertionError("Closed queue did not reject cleanly.");
        System.out.println("Native network queue: four checks passed (parallel, bounded, drain, closed rejection); HTTP/Android not exercised.");
    }
}
