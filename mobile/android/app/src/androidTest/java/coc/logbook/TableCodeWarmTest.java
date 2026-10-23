package coc.logbook;

import android.os.StrictMode;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public final class TableCodeWarmTest {
    @Test public void completePublicInitializationPerformsNoDiskOrNetworkAccess(){
        StrictMode.ThreadPolicy previous=StrictMode.getThreadPolicy();List<Integer> completed=new ArrayList<>();
        try{
            // An I/O violation terminates this test process instead of being
            // swallowed by the optional warmup's ordinary failure handler.
            StrictMode.setThreadPolicy(new StrictMode.ThreadPolicy.Builder().detectDiskReads().detectDiskWrites().detectNetwork().penaltyDeath().build());
            new TableCodeWarm().runSteps(completed::add);
        }finally{StrictMode.setThreadPolicy(previous);}
        assertEquals(Arrays.asList(0,1,2,3,4,5,6,7),completed);
    }

    @Test public void cancellationBeforeStartingCannotRunAnyStep(){
        TableCodeWarm warm=new TableCodeWarm();AtomicInteger completed=new AtomicInteger();
        warm.cancel();warm.start(step->completed.incrementAndGet());warm.runSteps(step->completed.incrementAndGet());
        assertEquals(0,completed.get());
    }

    @Test public void activeCancellationReturnsWithoutWaitingAndStopsBeforeTheNextStep()throws Exception{
        TableCodeWarm warm=new TableCodeWarm();CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1),cancelReturned=new CountDownLatch(1);
        AtomicInteger completed=new AtomicInteger(),priority=new AtomicInteger();AtomicReference<Thread> worker=new AtomicReference<>();
        Thread cancelling=null;
        try{
            warm.start(step->{
                completed.incrementAndGet();worker.set(Thread.currentThread());priority.set(android.os.Process.getThreadPriority(android.os.Process.myTid()));entered.countDown();
                // Deliberately hold the current step after interruption. cancel
                // must return before this observer allows the worker to exit.
                boolean waiting=true;while(waiting)try{release.await();waiting=false;}catch(InterruptedException interrupted){}
            });
            assertTrue("The public initialization should start",entered.await(3,TimeUnit.SECONDS));
            assertEquals(Thread.MIN_PRIORITY,worker.get().getPriority());assertTrue(priority.get()>=android.os.Process.THREAD_PRIORITY_BACKGROUND);
            cancelling=new Thread(()->{warm.cancel();cancelReturned.countDown();});cancelling.start();
            assertTrue("Cancelling must not join the worker",cancelReturned.await(2,TimeUnit.SECONDS));
            assertTrue(worker.get().isAlive());assertEquals(1,completed.get());
        }finally{
            warm.cancel();release.countDown();if(worker.get()!=null)worker.get().join(3000);if(cancelling!=null)cancelling.join(3000);
        }
        assertNotNull(worker.get());assertFalse(worker.get().isAlive());assertEquals(1,completed.get());
    }

    @Test public void optionalFailureAndMemoryFailureNeverContinueOrPoisonLaterInitialization(){
        AtomicInteger failed=new AtomicInteger();new TableCodeWarm().runSteps(step->{failed.incrementAndGet();if(step==2)throw new IllegalStateException("public injected failure");});assertEquals(3,failed.get());
        AtomicInteger memoryFailed=new AtomicInteger();new TableCodeWarm().runSteps(step->{memoryFailed.incrementAndGet();if(step==1)throw new OutOfMemoryError("public injected allocation failure");});assertEquals(2,memoryFailed.get());
        List<Integer> later=new ArrayList<>();new TableCodeWarm().runSteps(later::add);assertEquals(Arrays.asList(0,1,2,3,4,5,6,7),later);
    }

    @Test public void fixedPublicInputCannotBeChangedThroughAParsedCopy()throws Exception{
        Field field=TableCodeWarm.class.getDeclaredField("PUBLIC_RECORD");field.setAccessible(true);
        assertTrue(Modifier.isPrivate(field.getModifiers()));assertTrue(Modifier.isStatic(field.getModifiers()));assertTrue(Modifier.isFinal(field.getModifiers()));
        String original=(String)field.get(null);JSONObject copy=new JSONObject(original);copy.put("name","mutated outside warmup");copy.put("manualContent",new JSONObject());
        try{BackupValidation.record(copy);fail("The mutated copy must fail the real record validator");}catch(IllegalArgumentException expected){}
        List<Integer> completed=new ArrayList<>();new TableCodeWarm().runSteps(completed::add);
        assertEquals(Arrays.asList(0,1,2,3,4,5,6,7),completed);assertEquals(original,field.get(null));
        JSONObject unchanged=new JSONObject((String)field.get(null));assertEquals("公开代码初始化😀",unchanged.getString("name"));assertEquals("公开常量\n完整文本\u0000",unchanged.getString("manualContent"));
    }

    @Test public void publicInitializationExercisesTheStrictParserWithCompleteEquivalentFields()throws Exception{
        Field field=TableCodeWarm.class.getDeclaredField("PUBLIC_RECORD");field.setAccessible(true);String source=(String)field.get(null);
        StrictBackupJson.validate(source);JSONObject original=new JSONObject(source),strict=StrictTableJson.parseObject(source);
        BackupValidation.record(original);BackupValidation.record(strict);
        assertTrue(BackupValidation.same(original,strict));assertEquals(original.toString(),strict.toString());
        assertEquals(original.getString("manualContent"),strict.getString("manualContent"));
        List<Integer> completed=new ArrayList<>();new TableCodeWarm().runSteps(completed::add);
        assertEquals(Arrays.asList(0,1,2,3,4,5,6,7),completed);
    }
}
