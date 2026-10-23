package coc.logbook;

import java.net.URI;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;

/** Optional code initialization using one small public literal. This class has
 * no context, database, file, content resolver, source or authorization input.
 * It never produces a candidate or any state consumed by a real import. */
final class TableCodeWarm {
    private static final String PUBLIC_RECORD="{\"id\":\"public-code-warm-record\",\"moduleId\":\"public-code-warm-module\",\"name\":\"公开代码初始化😀\",\"sequenceNo\":1,\"sourceType\":\"manual\",\"status\":\"manual\",\"dateSource\":\"none\",\"order\":0,\"createdAt\":\"2000-01-01T00:00:00Z\",\"updatedAt\":\"2000-01-01T00:00:00Z\",\"manualContent\":\"公开常量\\n完整文本\\u0000\"}";
    private static final String PUBLIC_URI="https://example.invalid/public-code-warm?key=public";
    private static final String PUBLIC_UUID="00000000-0000-4000-8000-000000000001";
    private final AtomicBoolean started=new AtomicBoolean(),cancelled=new AtomicBoolean();
    private volatile Thread worker;

    // Test observation can interrupt/fail the same control flow, but cannot
    // substitute an input. Production never supplies an observer.
    interface Observer { void completed(int step)throws Exception; }
    void start(){start(null);}
    void start(Observer observer){
        if(!started.compareAndSet(false,true)||cancelled.get())return;
        try{
            Thread thread=new Thread(()->{
                try{android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND);runSteps(observer);}
                catch(Exception|LinkageError|OutOfMemoryError unavailable){}
                finally{worker=null;}
            },"coc-table-java-code-warm");
            thread.setDaemon(true);thread.setPriority(Thread.MIN_PRIORITY);worker=thread;
            if(cancelled.get()){worker=null;return;}thread.start();
        }catch(Exception|LinkageError|OutOfMemoryError unavailable){worker=null;}
    }
    void cancel(){cancelled.set(true);Thread thread=worker;if(thread!=null)thread.interrupt();}
    void runSteps(Observer observer){
        JSONObject record=null;String encoded=null;byte[] bytes=null;
        try{
            for(int step=0;step<8;step++){
                if(cancelled.get()||Thread.currentThread().isInterrupted())return;
                switch(step){
                    case 0:StrictBackupJson.validate(PUBLIC_RECORD);break;
                    case 1:record=StrictTableJson.parseObject(PUBLIC_RECORD);break;
                    case 2:BackupValidation.record(record);break;
                    case 3:
                        encoded=record.toString();bytes=encoded.getBytes(StandardCharsets.UTF_8);
                        String decoded=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
                        if(!encoded.equals(decoded))return;break;
                    case 4:if(JsonFields.bytes(encoded)!=bytes.length)return;break;
                    case 5:if(MessageDigest.getInstance("SHA-256").digest(bytes).length!=32)return;break;
                    case 6:if(!"example.invalid".equals(new URI(PUBLIC_URI).getHost()))return;break;
                    case 7:if(!PUBLIC_UUID.equals(UUID.fromString(PUBLIC_UUID).toString()))return;break;
                    default:return;
                }
                if(observer!=null)observer.completed(step);
            }
        }catch(Exception|LinkageError|OutOfMemoryError unavailable){
            // Real imports always execute their normal complete path. A failed
            // optional initialization has no result or authority to reuse.
        }
    }
}
