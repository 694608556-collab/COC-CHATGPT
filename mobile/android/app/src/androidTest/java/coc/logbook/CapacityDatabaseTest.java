package coc.logbook;

import android.content.Context;
import android.database.Cursor;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import static org.junit.Assert.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;

/** Real Android SQLite, generated public data, private uniquely named databases only. */
@RunWith(AndroidJUnit4.class)
public final class CapacityDatabaseTest {
    private final Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
    @Test public void complete96MiB()throws Exception{check(96);}
    @Test public void complete192MiB()throws Exception{check(192);}
    @Test public void complete512MiB()throws Exception{check(512);}
    /** Complete single body travels through actual indexed SQLite chunks; the
     * separate JVM test covers full semantic candidate validation at a stated heap. */
    @Test public void single68MiBBodySaveReopenAndSnapshotRoundtrip()throws Exception{
        String name="public-single-body-"+UUID.randomUUID()+".sqlite",other=name+"-restored";
        File directory=new File(context.getCacheDir(),"public-single-body-"+UUID.randomUUID());assertTrue(directory.mkdirs());
        File source=new File(directory,"source.json"),backup=new File(directory,"backup.json");long[] free={32L*1024*1024*1024};
        String id=null,bodyHash=null,snapshotHash=null;
        try{
            JSONObject root=fixture(),manual=null;JSONArray records=root.getJSONArray("records");
            for(int i=0;i<records.length();i++)if("manual".equals(records.getJSONObject(i).getString("sourceType"))){manual=BackupValidation.metadataOf(records.getJSONObject(i));break;}
            assertNotNull(manual);id=manual.getString("id");root.remove("records");String fields=root.toString(),row=manual.toString();
            try(Writer output=new BufferedWriter(new OutputStreamWriter(new FileOutputStream(source),StandardCharsets.UTF_8),65536)){
                output.write(fields.substring(0,fields.length()-1)+",\"records\":["+row.substring(0,row.length()-1)+",\"manualContent\":\"公开😀\\n\\u0000");
                String block=String.join("",Collections.nCopies(65536,"x"));for(int i=0;i<1088;i++)output.write(block);output.write("完整末尾😀\"}]}");
            }
            assertTrue(source.length()>68L*1024*1024);
            try(Reader input=new InputStreamReader(new FileInputStream(source),StandardCharsets.UTF_8)){SnapshotStream.validate(input);}
            try(LogbookDatabase db=new LogbookDatabase(context,name,true,()->free[0])){
                try(Reader input=new InputStreamReader(new FileInputStream(source),StandardCharsets.UTF_8)){assertEquals(1,db.replace(input,0));}
                assertEquals(1,db.recordCount());assertTrue(db.logicalBytes()>68L*1024*1024);bodyHash=recordHash(db,id);
                SQLiteAssertions.assertBodyUntouched(db,()->db.replaceFields(Collections.singletonMap("exportedAt","\"single-body-save\""),1));
                assertEquals(bodyHash,recordHash(db,id));assertEquals(2,db.revision());
                try(Reader input=new InputStreamReader(new FileInputStream(source),StandardCharsets.UTF_8)){
                    try{db.edit(2,store->{store.replace(input);free[0]=StorageBudget.MINIMUM_RESERVE;});fail("late low space accepted");}
                    catch(IOException|IllegalStateException expected){}finally{free[0]=32L*1024*1024*1024;}
                }
                assertEquals(2,db.revision());assertEquals(bodyHash,recordHash(db,id));
                db.getWritableDatabase().execSQL("CREATE TRIGGER reject_single_commit BEFORE UPDATE ON app_state BEGIN SELECT RAISE(ABORT,'injected'); END");
                try(Reader input=new InputStreamReader(new FileInputStream(source),StandardCharsets.UTF_8)){
                    try{db.replace(input,2);fail("injected write failure accepted");}catch(android.database.sqlite.SQLiteException expected){}
                }finally{db.getWritableDatabase().execSQL("DROP TRIGGER reject_single_commit");}
                assertEquals(2,db.revision());assertEquals(bodyHash,recordHash(db,id));
            }
            try(LogbookDatabase reopened=new LogbookDatabase(context,name,true,()->free[0])){
                assertEquals(2,reopened.revision());assertEquals(bodyHash,recordHash(reopened,id));
                try(Writer output=new BufferedWriter(new OutputStreamWriter(new FileOutputStream(backup),StandardCharsets.UTF_8),65536)){reopened.writeSnapshot(output,null);}
                snapshotHash=BackupSession.fileProof(backup,backup.length()).sha256;
                assertEquals(0,context.getApplicationInfo().flags&android.content.pm.ApplicationInfo.FLAG_LARGE_HEAP);
            }
            try(LogbookDatabase restored=new LogbookDatabase(context,other,true,()->free[0])){
                try(Reader input=new InputStreamReader(new FileInputStream(backup),StandardCharsets.UTF_8)){assertEquals(1,restored.replace(input,0));}
                assertEquals(bodyHash,recordHash(restored,id));
                try(Writer output=new BufferedWriter(new OutputStreamWriter(new FileOutputStream(source),StandardCharsets.UTF_8),65536)){restored.writeSnapshot(output,null);}
                assertEquals(snapshotHash,BackupSession.fileProof(source,source.length()).sha256);
            }
            System.out.println("PUBLIC_ANDROID_SINGLE_BODY bodyMiB=68 SQLiteSnapshotRoundtrip=true lowSpaceAndSqlRollback=true ordinaryMaxHeapMiB="+(Runtime.getRuntime().maxMemory()/1048576)+" fullRestoreCandidateValidation=false physicalPhone=false");
        }finally{context.deleteDatabase(name);context.deleteDatabase(other);for(File file:Objects.requireNonNull(directory.listFiles()))assertTrue(file.delete());assertTrue(directory.delete());}
    }
    private JSONObject fixture()throws Exception{
        try(InputStream input=InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("public-capacity.json")){
            ByteArrayOutputStream output=new ByteArrayOutputStream();byte[] chunk=new byte[65536];int count;
            while((count=input.read(chunk))!=-1)output.write(chunk,0,count);return new JSONObject(output.toString("UTF-8"));
        }
    }
    @Test public void completeBatchAbove64MiBAndV4Migration()throws Exception{
        String name="public-batch-capacity-"+UUID.randomUUID()+".sqlite";
        File directory=new File(context.getCacheDir(),"public-batch-capacity-"+UUID.randomUUID());assertTrue(directory.mkdirs());
        long[] free={32L*1024*1024*1024};String hash;
        try{
            JSONObject root=fixture(),sample=null;JSONArray original=root.getJSONArray("records"),rows=new JSONArray();Set<String> ids=new LinkedHashSet<>();
            for(int i=0;i<original.length();i++)if(original.getJSONObject(i).has("rawContent")){sample=original.getJSONObject(i);break;}
            assertNotNull(sample);JSONObject raw=sample.getJSONObject("rawContent"),message=raw.getJSONArray("messages").getJSONObject(0);
            message.put("text","公开批量😀\u0000"+String.join("",Collections.nCopies(1024*1024,"A")));message.put("raw",new JSONObject().put("publicOpaque","REPLACE_PUBLIC_LONG_INTEGER"));raw.put("messages",new JSONArray().put(message));
            for(int index=0;index<96;index++){
                JSONObject row=new JSONObject(sample.toString());row.put("id","fetch-capacity-"+index);row.put("order",index);row.put("status","pending");
                for(String key:new String[]{"rawContent","manualContent","cacheSourceUrl","fetchedAt"})row.remove(key);rows.put(row);ids.add(row.getString("id"));
            }
            root.put("records",rows);
            try(LogbookDatabase db=new LogbookDatabase(context,name,true,()->free[0])){
                db.replace(root.toString(),0);
                for(int round=0;round<2;round++)try(FetchBatch batch=new FetchBatch(new File(directory,"stage-"+round),"public",round==0?1:2,ids,db.fields(),true,()->free[0])){
                    for(int index=0;index<96;index++){
                        JSONObject row=new JSONObject(rows.getJSONObject(index).toString());row.put("status","valid");row.put("rawContent",raw);row.put("cacheSourceUrl",row.getString("link"));
                        JSONObject single=new JSONObject(root.toString());single.put("records",new JSONArray().put(row));File upload=new File(directory,"upload");
                        try(Writer output=new OutputStreamWriter(new FileOutputStream(upload),StandardCharsets.UTF_8)){output.write(single.toString().replace("\"REPLACE_PUBLIC_LONG_INTEGER\"","900719925474099312345"));}
                        try{batch.stage(upload);}finally{assertTrue(upload.delete());}
                    }
                    if(round==0){assertEquals(1,db.revision());assertEquals(0,db.deferred().length());assertEquals(2,batch.finish(db,"2026-10-22T00:00:00Z"));assertTrue(db.logicalBytes()>96L*1024*1024);}
                    else{
                        String before=recordHash(db,"fetch-capacity-0");free[0]=StorageBudget.MINIMUM_RESERVE;
                        try{batch.finish(db,"no");fail("low-space batch accepted");}catch(IOException expected){}finally{free[0]=32L*1024*1024*1024;}
                        assertEquals(2,db.revision());assertEquals(before,recordHash(db,"fetch-capacity-0"));
                    }
                }
                hash=recordHash(db,"fetch-capacity-0");db.getWritableDatabase().setVersion(4);
                final boolean[] longToken={false};
                try(Writer output=new Writer(){String tail="";public void write(char[] c,int start,int count){String text=tail+new String(c,start,count);if(text.contains("900719925474099312345"))longToken[0]=true;tail=text.substring(Math.max(0,text.length()-32));}public void flush(){}public void close(){}}){db.writeSnapshot(output,Collections.singleton("fetch-capacity-0"));}
                assertTrue(longToken[0]);
            }
            try(LogbookDatabase migrated=new LogbookDatabase(context,name,true,()->free[0])){assertEquals(2,migrated.revision());assertEquals(hash,recordHash(migrated,"fetch-capacity-0"));assertEquals(96,migrated.deferred().length());assertEquals(5,migrated.getReadableDatabase().getVersion());}
            System.out.println("PUBLIC_ANDROID_CAPACITY_FETCH records=96 nativeSQLite=true opaqueTokens=true lowSpaceRollback=true migrationV4=true physicalPhone=false");
        }finally{
            context.deleteDatabase(name);
            for(File file:Objects.requireNonNull(directory.listFiles())){if(file.isDirectory())for(File child:Objects.requireNonNull(file.listFiles()))assertTrue(child.delete());assertTrue(file.delete());}assertTrue(directory.delete());
        }
    }
    private String recordHash(LogbookDatabase db,String id)throws Exception{
        MessageDigest hash=MessageDigest.getInstance("SHA-256");
        try(Cursor row=db.getReadableDatabase().rawQuery("SELECT b.kind,b.data FROM indexed_bodies b JOIN indexed_records r ON b.record_key=r.row_key WHERE r.id=? ORDER BY b.kind,b.position",new String[]{id})){
            while(row.moveToNext()){hash.update(row.getString(0).getBytes(StandardCharsets.UTF_8));hash.update(row.getString(1).getBytes(StandardCharsets.UTF_8));}
        }
        return hex(hash.digest());
    }
    private static String hex(byte[] bytes){StringBuilder result=new StringBuilder();for(byte value:bytes)result.append(String.format("%02x",value&255));return result.toString();}
    private long restore(LogbookDatabase db,File candidate,RestoreCandidate.Preview preview,long expected)throws Exception{
        try(InputStream input=new FileInputStream(candidate)){return db.restoreCandidate(input,preview,expected,true,"{}",()->{});}
    }
    @Test public void restoreLateAuthorizationFailureRollsBackBodiesAndRevision()throws Exception{
        String name="public-restore-auth-"+UUID.randomUUID()+".sqlite";File candidate=File.createTempFile("public-restore-auth-",".part",context.getCacheDir());
        try(LogbookDatabase db=new LogbookDatabase(context,name,true,()->32L*1024*1024*1024)){
            JSONObject root=fixture();assertEquals(1,db.replace(root.toString(),0));String before=db.snapshot();
            JSONObject changed=new JSONObject(root.toString());JSONArray records=changed.getJSONArray("records"),metadata=new JSONArray();String altered=null;
            try(Writer output=new BufferedWriter(new OutputStreamWriter(new FileOutputStream(candidate),StandardCharsets.UTF_8),65536)){
                for(int i=0;i<records.length();i++){JSONObject record=records.getJSONObject(i);if(altered==null&&"manual".equals(record.getString("sourceType"))){altered=record.getString("id");record.put("manualContent","公开授权回滚😀\u0000"+String.join("",Collections.nCopies(1024*1024,"x")));}metadata.put(BackupValidation.metadataOf(record));output.write("R"+record+"\n");}
                changed.put("records",metadata);output.write("M"+changed+"\n");
            }
            assertNotNull(altered);final String id=altered,beforeBody=recordHash(db,id);BackupSession.Proof proof=BackupSession.fileProof(candidate,candidate.length());RestoreCandidate.Preview preview;
            try(InputStream input=new FileInputStream(candidate)){preview=RestoreCandidate.inspect(input,proof.bytes,proof.sha256,null);}
            int[] checks={0};try(InputStream input=new FileInputStream(candidate)){
                try{db.restoreCandidate(input,preview,1,true,"{}",()->{
                    assertEquals(1,db.revision());if(++checks[0]==1)assertEquals(beforeBody,recordHash(db,id));
                    else{assertNotEquals(beforeBody,recordHash(db,id));throw new SecurityException("public late authorization revoked");}
                });fail("late authorization revocation committed");}catch(SecurityException expected){}
            }
            assertEquals(2,checks[0]);assertEquals(1,db.revision());assertEquals(beforeBody,recordHash(db,id));assertEquals(before,db.snapshot());
            int[] successChecks={0};try(InputStream input=new FileInputStream(candidate)){assertEquals(2,db.restoreCandidate(input,preview,1,true,"{}",()->{successChecks[0]++;assertEquals(1,db.revision());}));}
            assertEquals(2,successChecks[0]);assertNotEquals(beforeBody,recordHash(db,id));
        }finally{assertTrue(candidate.delete());context.deleteDatabase(name);}
    }
    private void check(int count)throws Exception{
        String name="public-capacity-"+UUID.randomUUID()+".sqlite";
        File directory=new File(context.getCacheDir(),"public-capacity-"+UUID.randomUUID());assertTrue(directory.mkdirs());
        File candidate=new File(directory,"candidate"),backup=new File(directory,"backup.json");
        long[] free={32L*1024*1024*1024};
        try{
            JSONObject root=fixture();
            JSONObject sample=null;JSONArray original=root.getJSONArray("records");
            for(int i=0;i<original.length();i++)if(original.getJSONObject(i).getString("sourceType").equals("manual")){sample=original.getJSONObject(i);break;}
            assertNotNull(sample);JSONArray metadata=new JSONArray();String body="公开正文😀\u0000\r\n"+String.join("",Collections.nCopies(1024*1024,"A"));
            try(Writer output=new BufferedWriter(new OutputStreamWriter(new FileOutputStream(candidate),StandardCharsets.UTF_8),65536)){
                for(int index=0;index<count;index++){
                    JSONObject row=new JSONObject(sample.toString());row.put("id","capacity-"+index);row.put("name","公开场次"+index);row.put("order",index);row.remove("rawContent");row.put("manualContent",body);
                    output.write('R');output.write(row.toString());output.write('\n');row.remove("manualContent");metadata.put(row);
                }
                root.put("records",metadata);output.write('M');output.write(root.toString());output.write('\n');
            }
            BackupSession.Proof proof=BackupSession.fileProof(candidate,candidate.length());RestoreCandidate.Preview preview;
            try(InputStream input=new FileInputStream(candidate)){preview=RestoreCandidate.inspect(input,proof.bytes,proof.sha256,null);}
            try(LogbookDatabase db=new LogbookDatabase(context,name,true,()->free[0])){
                assertEquals(1,restore(db,candidate,preview,0));assertTrue(db.logicalBytes()>count*1024L*1024);assertEquals(count,db.deferred().length());
                StringWriter selected=new StringWriter();db.writeSnapshot(selected,Collections.singleton("capacity-0"));
                assertEquals(body,new JSONObject(selected.toString()).getJSONArray("records").getJSONObject(0).getString("manualContent"));
                String hash=recordHash(db,"capacity-0");
                SQLiteAssertions.assertBodyUntouched(db,()->{
                    if(count==96){
                        JSONObject delta=new JSONObject().put("protocolVersion",1).put("initialSettings",root.get("settings"));
                        for(String key:new String[]{"modulesAdded","moduleParticipants","charactersAdded","recordsAdded","manualUpdates"})delta.put(key,new JSONArray());
                        db.edit(1,index->index.importTableDelta(delta,"2026-10-22T00:00:00Z",null));
                    }else{Map<String,String> patch=new LinkedHashMap<>();patch.put("exportedAt",JSONObject.quote("2026-10-22T00:00:00Z"));db.replaceFields(patch,1);}
                });
                assertEquals(hash,recordHash(db,"capacity-0"));
                free[0]=StorageBudget.MINIMUM_RESERVE;
                try{db.replaceFields(Collections.singletonMap("exportedAt","\"denied\""),2);fail("low space accepted");}catch(IllegalStateException|IOException expected){}
                free[0]=32L*1024*1024*1024;
                db.getWritableDatabase().execSQL("CREATE TRIGGER reject_commit BEFORE UPDATE ON app_state BEGIN SELECT RAISE(ABORT,'public injected failure'); END");
                try{restore(db,candidate,preview,2);fail("injected SQL failure accepted");}catch(Exception expected){}
                db.getWritableDatabase().execSQL("DROP TRIGGER reject_commit");assertEquals(2,db.revision());assertEquals(count,db.deferred().length());assertEquals(hash,recordHash(db,"capacity-0"));
                try(Writer writer=new BufferedWriter(new OutputStreamWriter(new FileOutputStream(backup),StandardCharsets.UTF_8),65536)){
                    writer.write("{\"format\":\"coc.logbook.android\",\"formatVersion\":1,\"exportedAt\":\"2026-10-22T00:00:00Z\",\"restoreScope\":[\"modules\",\"records\",\"characters\"],\"snapshot\":");db.writeSnapshot(writer,null);writer.write('}');
                }
                assertEquals(count,SnapshotBackupStream.validate(backup));assertTrue(backup.length()>count*1024L*1024);
            }
            try(LogbookDatabase reopened=new LogbookDatabase(context,name,true,()->free[0])){
                assertEquals(2,reopened.revision());assertEquals(count,reopened.deferred().length());
                try(Cursor row=reopened.getReadableDatabase().rawQuery("PRAGMA integrity_check",null)){assertTrue(row.moveToFirst());assertEquals("ok",row.getString(0));}
            }
            System.out.println("PUBLIC_ANDROID_CAPACITY records="+count+" candidateBytes="+candidate.length()+" backupBytes="+backup.length()+" sha256="+BackupSession.fileProof(backup,backup.length()).sha256+" nativeSQLite=true physicalPhone=false");
        }finally{context.deleteDatabase(name);for(File file:Objects.requireNonNull(directory.listFiles()))assertTrue(file.delete());assertTrue(directory.delete());}
    }
    private static final class SQLiteAssertions {
        interface Action {void run()throws Exception;}
        static void assertBodyUntouched(LogbookDatabase db,Action action)throws Exception{
            db.getWritableDatabase().execSQL("CREATE TRIGGER protect_bodies BEFORE INSERT ON indexed_bodies BEGIN SELECT RAISE(ABORT,'unchanged body write'); END");
            db.getWritableDatabase().execSQL("CREATE TRIGGER protect_deletes BEFORE DELETE ON indexed_bodies BEGIN SELECT RAISE(ABORT,'unchanged body delete'); END");
            try{action.run();}finally{db.getWritableDatabase().execSQL("DROP TRIGGER protect_bodies");db.getWritableDatabase().execSQL("DROP TRIGGER protect_deletes");}
        }
    }
}
