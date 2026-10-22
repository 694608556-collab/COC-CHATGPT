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
            JSONObject root;
            try(InputStream input=InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("public-capacity.json")){
                ByteArrayOutputStream output=new ByteArrayOutputStream();input.transferTo(output);root=new JSONObject(output.toString("UTF-8"));
            }
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
