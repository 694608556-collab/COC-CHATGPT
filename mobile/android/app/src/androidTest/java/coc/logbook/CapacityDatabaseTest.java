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
    private JSONObject fixture()throws Exception{
        try(InputStream input=InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("public-capacity.json")){
            ByteArrayOutputStream output=new ByteArrayOutputStream();input.transferTo(output);return new JSONObject(output.toString("UTF-8"));
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
        try(InputStream input=new FileInputStream(candidate)){return db.restoreCandidate(input,preview,expected,true,"{}");}
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
                String hash=recordHash(db,"capacity-0");
                SQLiteAssertions.assertBodyUntouched(db,()->{Map<String,String> patch=new LinkedHashMap<>();patch.put("exportedAt",JSONObject.quote("2026-10-22T00:00:00Z"));db.replaceFields(patch,1);});
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
