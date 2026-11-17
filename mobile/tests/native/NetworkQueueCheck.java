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
        try(NetworkQueue batchQueue=new NetworkQueue(6)) {
            CountDownLatch batchStarted=new CountDownLatch(6),batchRelease=new CountDownLatch(1),batchDone=new CountDownLatch(10);
            AtomicInteger batchActive=new AtomicInteger(),batchPeak=new AtomicInteger(),batchRejected=new AtomicInteger();
            Runnable batchWork=()->{
                int count=batchActive.incrementAndGet();batchPeak.accumulateAndGet(count,Math::max);batchStarted.countDown();
                try{batchRelease.await(5,TimeUnit.SECONDS);}catch(InterruptedException error){Thread.currentThread().interrupt();}
                finally{batchActive.decrementAndGet();batchDone.countDown();}
            };
            try {
                for(int i=0;i<6;i++)batchQueue.execute(batchWork,batchRejected::incrementAndGet);
                if(!batchStarted.await(2,TimeUnit.SECONDS))throw new AssertionError("Configured batch network slots did not run concurrently.");
                for(int i=0;i<4;i++)batchQueue.execute(batchWork,batchRejected::incrementAndGet);
                batchQueue.execute(batchWork,batchRejected::incrementAndGet);
                if(batchPeak.get()!=6||batchRejected.get()!=1)throw new AssertionError("Configured batch queue exceeded its explicit bounds.");
                batchRelease.countDown();if(!batchDone.await(2,TimeUnit.SECONDS))throw new AssertionError("Configured batch queue did not drain.");
            }finally{batchRelease.countDown();}
        }
        try(NetworkQueue prefetched=new NetworkQueue(6,6)) {
            CountDownLatch startedSix=new CountDownLatch(6),releaseSix=new CountDownLatch(1),doneTwelve=new CountDownLatch(12);
            AtomicInteger running=new AtomicInteger(),maximum=new AtomicInteger(),denied=new AtomicInteger();
            Runnable task=()->{int activeNow=running.incrementAndGet();maximum.accumulateAndGet(activeNow,Math::max);startedSix.countDown();try{releaseSix.await(5,TimeUnit.SECONDS);}catch(InterruptedException error){Thread.currentThread().interrupt();}finally{running.decrementAndGet();doneTwelve.countDown();}};
            try {
                for(int i=0;i<6;i++)prefetched.execute(task,denied::incrementAndGet);
                if(!startedSix.await(2,TimeUnit.SECONDS))throw new AssertionError("Six network workers did not start.");
                for(int i=0;i<6;i++)prefetched.execute(task,denied::incrementAndGet);
                prefetched.execute(task,denied::incrementAndGet);
                if(maximum.get()!=6||denied.get()!=1)throw new AssertionError("Prefetch changed the physical concurrency or queue bound.");
                releaseSix.countDown();if(!doneTwelve.await(2,TimeUnit.SECONDS))throw new AssertionError("Prefetch did not drain all twelve jobs.");
            }finally{releaseSix.countDown();}
        }
        System.out.println("Native network queue: default and both explicit bounded configurations, drain and closed rejection passed; HTTP/Android not exercised.");
    }
}
