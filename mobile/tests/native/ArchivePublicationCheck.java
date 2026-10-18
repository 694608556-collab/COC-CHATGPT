package coc.logbook;

import java.io.*;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.*;
import org.json.*;

/** Real file proof lifetimes across recreated journal owners; SAF/SQLite are separately device tested. */
public final class ArchivePublicationCheck {
    static final class Memory implements ArchivePublication.Store, ArchivePublication.Documents {
        final Map<String, JSONObject> pending = new java.util.concurrent.ConcurrentHashMap<>();
        final Map<String, byte[]> files = new java.util.concurrent.ConcurrentHashMap<>();
        final Set<String> registered = java.util.concurrent.ConcurrentHashMap.newKeySet();
        volatile java.util.concurrent.CountDownLatch captured, resume;
        boolean denyDelete, denyForget;
        ArchivePublication recoverDuringPut;
        public JSONArray pending() throws Exception { JSONArray snapshot=new JSONArray(pending.values());if(Thread.currentThread().getName().equals("publication-gc")&&captured!=null){captured.countDown();resume.await();}return snapshot; }
        public void put(JSONObject value) throws Exception { pending.put(value.getString("id"),new JSONObject(value.toString()));if(recoverDuringPut!=null){ArchivePublication other=recoverDuringPut;recoverDuringPut=null;other.recover();} }
        public void remove(String id) throws Exception { if(denyForget)throw new IOException("Injected journal cleanup failure");pending.remove(id); }
        public boolean registered(String uri) { return registered.contains(uri); }
        public boolean exists(JSONObject value) throws Exception { return files.containsKey(value.getString("uri")); }
        public InputStream open(String uri) { return new ByteArrayInputStream(files.get(uri)); }
        public boolean delete(String uri) { if (denyDelete) return false; return files.remove(uri)!=null; }
    }
    public static void main(String[] args) throws Exception {
        File root=Files.createTempDirectory("coc-publication-").toFile(), directory=new File(root,"proofs"), source=new File(root,"sealed.part");
        byte[] bytes="完整中文正文😀 and exact end".getBytes("UTF-8"); Files.write(source.toPath(),bytes);
        StringBuilder hash=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))hash.append(String.format("%02x",b&255));
        Memory store=new Memory(); ArchivePublication journal=new ArchivePublication(directory,store,store);
        store.files.put("partial",Arrays.copyOf(bytes,13));JSONObject partial=journal.begin(source,"partial","tree",bytes.length,hash.toString());
        journal.recover();if(!store.files.containsKey("partial"))throw new AssertionError("Active publication deleted");
        new ArchivePublication(directory,store,store).recover();if(store.files.containsKey("partial")||!store.pending.isEmpty())throw new AssertionError("Interrupted partial not recovered");
        store.files.put("complete",bytes);JSONObject complete=journal.begin(source,"complete","tree",bytes.length,hash.toString());store.registered.add("complete");
        new ArchivePublication(directory,store,store).recover();if(!store.files.containsKey("complete")||!store.pending.isEmpty())throw new AssertionError("Registered archive deleted");
        store.files.put("changed",new byte[]{99});JSONObject changed=journal.begin(source,"changed","tree",bytes.length,hash.toString());
        try{journal.abort(changed);throw new AssertionError("Changed archive deleted");}catch(IOException expected){}
        if(!store.files.containsKey("changed")||store.pending.isEmpty())throw new AssertionError("Changed file/proof not retained");
        store.files.remove("changed");journal.recover();
        store.files.put("denied",Arrays.copyOf(bytes,9));JSONObject denied=journal.begin(source,"denied","tree",bytes.length,hash.toString());store.denyDelete=true;
        try{journal.abort(denied);throw new AssertionError("Delete failure hidden");}catch(IOException expected){}
        Files.delete(source.toPath());if(store.pending.isEmpty())throw new AssertionError("Delete failure lost recovery record");
        store.denyDelete=false;new ArchivePublication(directory,store,store).recover();if(store.files.containsKey("denied")||!store.pending.isEmpty())throw new AssertionError("Retry after source cleanup failed");
        File unrelated=new File(directory,"keep.txt");Files.write(unrelated.toPath(),new byte[]{7});new ArchivePublication(directory,store,store).recover();
        if(!unrelated.exists())throw new AssertionError("Unrelated private file deleted");
        Files.write(source.toPath(),new byte[0]);StringBuilder emptyHash=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(new byte[0]))emptyHash.append(String.format("%02x",b&255));
        store.files.put("empty",new byte[0]);journal.begin(source,"empty","tree",0,emptyHash.toString());new ArchivePublication(directory,store,store).recover();
        if(store.files.containsKey("empty"))throw new AssertionError("Empty text archive recovery rejected");
        Files.write(source.toPath(),bytes);store.files.put("other-tree",Arrays.copyOf(bytes,2));journal.begin(source,"other-tree","old-tree",bytes.length,hash.toString());
        new ArchivePublication(directory,store,store).recoverFor("new-tree");if(!store.files.containsKey("other-tree")||store.pending.isEmpty())throw new AssertionError("Different location recovery touched old file");
        new ArchivePublication(directory,store,store).recover();
        store.files.put("registered-cleanup-failed",bytes);JSONObject retained=journal.begin(source,"registered-cleanup-failed","tree",bytes.length,hash.toString());store.registered.add("registered-cleanup-failed");store.denyForget=true;
        try{journal.committed(retained);throw new AssertionError("Journal cleanup failure hidden");}catch(IOException expected){}
        store.denyForget=false;journal.recover();if(!store.files.containsKey("registered-cleanup-failed")||!store.pending.isEmpty())throw new AssertionError("Registered cleanup retry remained active or deleted file");
        Set<String> processActive=new HashSet<>();ArchivePublication owner=new ArchivePublication(directory,store,store,processActive);
        store.files.put("other-activity",Arrays.copyOf(bytes,4));JSONObject running=owner.begin(source,"other-activity","tree",bytes.length,hash.toString());
        new ArchivePublication(directory,store,store,processActive).recover();if(!store.files.containsKey("other-activity"))throw new AssertionError("New Activity deleted running publication");
        owner.abort(running);
        store.files.put("during-record",Arrays.copyOf(bytes,4));store.recoverDuringPut=new ArchivePublication(directory,store,store,processActive);
        JSONObject preparing=owner.begin(source,"during-record","tree",bytes.length,hash.toString());
        if(!store.files.containsKey("during-record"))throw new AssertionError("Another Activity recovered a ticket before begin returned");owner.abort(preparing);
        store.files.put("gc-race",Arrays.copyOf(bytes,4));store.denyDelete=true;store.captured=new java.util.concurrent.CountDownLatch(1);store.resume=new java.util.concurrent.CountDownLatch(1);
        ArchivePublication collector=new ArchivePublication(directory,store,store,processActive);java.util.concurrent.CountDownLatch produced=new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.atomic.AtomicReference<Throwable> failure=new java.util.concurrent.atomic.AtomicReference<>();
        Thread gc=new Thread(()->{try{collector.recover();}catch(Throwable e){failure.set(e);}},"publication-gc");gc.start();store.captured.await();
        Thread producer=new Thread(()->{try{JSONObject value=owner.begin(source,"gc-race","tree",bytes.length,hash.toString());try{owner.abort(value);throw new AssertionError("Expected denied cleanup");}catch(IOException expected){}}catch(Throwable e){failure.set(e);}finally{produced.countDown();}},"publication-producer");producer.start();
        produced.await(200,java.util.concurrent.TimeUnit.MILLISECONDS);store.resume.countDown();gc.join(3000);producer.join(3000);
        if(gc.isAlive()||producer.isAlive()||failure.get()!=null)throw new AssertionError("Publication recovery deadlock or failure",failure.get());
        JSONObject retainedRace=store.pending.values().iterator().next();
        if(!new File(directory,"coc-publication-"+retainedRace.getString("id")+".part").exists())throw new AssertionError("Garbage cleanup removed a newly retained publication proof");
        store.captured=null;store.denyDelete=false;owner.recover();
        System.out.println("Archive publication: interrupted prefix, active exclusion, registered/changed preservation, denied deletion retry and private scope passed");
    }
}
