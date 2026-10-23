package coc.logbook;

import android.database.sqlite.SQLiteDatabase;
import android.database.Cursor;
import java.io.*;
import java.util.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.*;
import org.json.JSONObject;

/** Disposable, fully validated search source; never a restore/commit candidate. */
final class SearchSnapshot {
    static final class Unavailable extends IOException {}
    interface Boundaries {void boundary(String kind)throws Exception;}
    private final OutputStream out;
    private final MessageDigest hash;
    private long originalBytes;
    private final Map<String,Long> timing;
    private final Boundaries boundaries;
    private final ExecutorService kernels=Executors.newFixedThreadPool(2);
    private final ArrayDeque<Pending> pending=new ArrayDeque<>();
    private int pendingBodies;
    private static final class Pending {
        final byte[] bytes;final Future<byte[]> future;final String boundary;
        Pending(byte[] bytes,Future<byte[]> future){this(bytes,future,null);}
        Pending(byte[] bytes,Future<byte[]> future,String boundary){this.bytes=bytes;this.future=future;this.boundary=boundary;}
    }
    private SearchSnapshot(OutputStream out,Map<String,Long> timing,Boundaries boundaries)throws Exception{this.out=out;this.timing=timing;this.boundaries=boundaries;hash=MessageDigest.getInstance("SHA-256");}
    private long start(){return timing==null?0:System.nanoTime();}
    private void elapsed(String key,long start){if(timing!=null)synchronized(timing){timing.put(key,timing.getOrDefault(key,0L)+System.nanoTime()-start);}}
    private void emit(byte[] original,byte[] projected)throws Exception{
        long started=start();
        originalBytes=Math.addExact(originalBytes,original.length);hash.update(original);
        if(pending.isEmpty())out.write(projected);else pending.add(new Pending(projected,null));
        elapsed("proofAndWriteNs",started);
    }
    private void same(byte[] bytes)throws Exception{emit(bytes,bytes);}
    private void text(String text)throws Exception{same(text.getBytes(StandardCharsets.UTF_8));}
    private void boundary(String kind)throws Exception{
        if(boundaries==null)return;
        if(pending.isEmpty())boundaries.boundary(kind);else pending.add(new Pending(null,null,kind));
    }
    private static byte[] checked(String text,long budget,boolean metadata)throws Exception{
        if(text.length()>budget/6)throw new Unavailable();
        byte[] bytes=text.getBytes(StandardCharsets.UTF_8);
        if(!NativeSearchKernel.valid(bytes,budget,metadata))throw new Unavailable();return bytes;
    }
    private void body(String kind,ByteArrayOutputStream parts,long budget)throws Exception{
        byte[] original=parts.toByteArray();
        if(!kind.equals("rawContent")&&!kind.equals("manualContent"))throw new Unavailable();
        text(","+JSONObject.quote(kind)+":");
        long proofStarted=start();originalBytes=Math.addExact(originalBytes,original.length);hash.update(original);elapsed("proofAndWriteNs",proofStarted);
        // At most two immutable bodies overlap the serial SQLite reader.
        // Each kernel gets one third of the runtime budget; the remainder
        // covers the Java byte arrays and the bounded source writer.
        pending.add(new Pending(null,kernels.submit(()->{
            long started=start();try{
                byte[] projection=kind.equals("rawContent")?NativeSearchKernel.searchableProjection(original,budget/3):NativeSearchKernel.valid(original,budget/3,false)?original:null;
                if(projection==null)throw new Unavailable();return projection;
            }finally{elapsed("kernelNs",started);}
        })));
        if(++pendingBodies>=2)drain(false);
    }
    private void drain(boolean all)throws Exception{
        while(!pending.isEmpty()){
            Pending next=pending.remove();byte[] bytes=next.bytes;
            if(next.boundary!=null){boundaries.boundary(next.boundary);continue;}
            if(next.future!=null){
                try{bytes=next.future.get();}catch(ExecutionException error){if(error.getCause() instanceof Unavailable)throw new Unavailable();if(error.getCause() instanceof OutOfMemoryError)throw (OutOfMemoryError)error.getCause();throw new IOException("搜索来源校验未完成。",error.getCause());}
                pendingBodies--;
            }
            long started=start();out.write(bytes);elapsed("proofAndWriteNs",started);
            if(!all&&next.future!=null)return;
        }
    }
    private void close(){
        kernels.shutdown();boolean interrupted=false;
        for(;;)try{if(kernels.awaitTermination(100,TimeUnit.MILLISECONDS))break;}catch(InterruptedException failure){interrupted=true;kernels.shutdownNow();}
        if(interrupted)Thread.currentThread().interrupt();
    }
    static BackupSession.Proof write(SQLiteDatabase db,OutputStream out,Set<String> ids,long budget,String prefix)throws Exception{
        return write(db,out,ids,budget,prefix,null);
    }
    static BackupSession.Proof write(SQLiteDatabase db,OutputStream out,Set<String> ids,long budget,String prefix,Map<String,Long> timing)throws Exception{
        return write(db,out,ids,budget,prefix,timing,null);
    }
    static BackupSession.Proof write(SQLiteDatabase db,OutputStream out,Set<String> ids,long budget,String prefix,Map<String,Long> timing,Boundaries boundaries)throws Exception{
        SearchSnapshot writer=new SearchSnapshot(out,timing,boundaries);try{writer.text(prefix);writer.text("{");boolean comma=false;
        for(Map.Entry<String,String> field:new IndexedSnapshot(db).rootFields().entrySet()){
            if(field.getKey().equals("records"))throw new Unavailable();
            byte[] bytes=checked(field.getValue(),budget,false);
            writer.text((comma?",":"")+JSONObject.quote(field.getKey())+":");writer.same(bytes);comma=true;
        }
        writer.text((comma?",":"")+"\"records\":[");writer.boundary("root");Set<String> found=new HashSet<>();comma=false;
        try(Cursor rows=db.rawQuery("SELECT row_key,id,CAST(metadata AS BLOB) FROM indexed_records ORDER BY ordinal,row_key",null)){
            while(rows.moveToNext()){
                String id=rows.getString(1);if(!ids.contains(id))continue;if(!found.add(id))throw new Unavailable();
                byte[] metadata=rows.getBlob(2);
                if(!NativeSearchKernel.valid(metadata,budget,true)||metadata[metadata.length-1]!='}')throw new Unavailable();
                if(comma)writer.text(",");comma=true;writer.same(Arrays.copyOf(metadata,metadata.length-1));
                try(Cursor parts=db.rawQuery("SELECT kind,position,CAST(data AS BLOB),bytes FROM indexed_bodies WHERE record_key=? ORDER BY kind,position",new String[]{Long.toString(rows.getLong(0))})){
                    String kind=null;int position=0;ByteArrayOutputStream bytes=new ByteArrayOutputStream();
                    while(parts.moveToNext()){
                        String next=parts.getString(0);
                        if(!next.equals(kind)){if(kind!=null)writer.body(kind,bytes,budget);kind=next;position=0;bytes.reset();}
                        if(parts.getInt(1)!=position++)throw new Unavailable();byte[] part=parts.getBlob(2);
                        if(part.length!=parts.getLong(3)||bytes.size()+((long)part.length)>budget/4)throw new Unavailable();
                        bytes.write(part);
                    }
                    if(kind!=null)writer.body(kind,bytes,budget);
                }writer.text("}");writer.boundary("record");
            }
        }
        if(!found.equals(ids))throw new Unavailable();writer.boundary("recordsEnd");writer.text("]}}");writer.boundary("tail");
        writer.drain(true);return new BackupSession.Proof(writer.originalBytes,BackupSession.digestHex(writer.hash.digest()));
        }finally{writer.close();}
    }
}
