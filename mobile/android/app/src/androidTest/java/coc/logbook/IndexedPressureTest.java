package coc.logbook;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Generated public data only. No network, user files, production database, or shared directories. */
@RunWith(AndroidJUnit4.class)
public class IndexedPressureTest {
    private Context context(){return InstrumentationRegistry.getInstrumentation().getTargetContext();}
    private File fixture(int count,int bodySize,int start,String status)throws Exception{
        File file=File.createTempFile("public-pressure-",".json",context().getCacheDir());
        try(Writer out=new BufferedWriter(new OutputStreamWriter(new FileOutputStream(file),StandardCharsets.UTF_8))){
            out.write("{\"schemaVersion\":2,\"exportedAt\":\"before\",\"modules\":[");
            for(int i=0;i<50;i++){if(i>0)out.write(',');out.write("{\"id\":\"m"+i+"\"}");}
            out.write("],\"characters\":[],\"settings\":{\"privateUnchanged\":\"public\"},\"records\":[");
            char[] payload=new char[bodySize];Arrays.fill(payload,'a');
            for(int i=start;i<start+count;i++){
                if(i>start)out.write(',');out.write("{\"id\":\"r"+i+"\",\"moduleId\":\"m"+(i/20%50)+"\",\"sourceType\":\"online\",\"link\":\"https://log.weizaima.com/?key=public-"+i+"\",\"status\":\""+status+"\",\"order\":"+i);
                if(status.equals("valid")){
                    out.write(",\"cacheSourceUrl\":\"https://log.weizaima.com/?key=public-"+i+"\",\"fetchedAt\":\"public\",\"rawContent\":{\"messages\":[{\"text\":\"");out.write(payload);
                    out.write("中文😀\",\"raw\":900719925474099312345}]}");
                }else out.write(",\"lastError\":\"public injected failure\"");
                out.write('}');
            }out.write("]}");
        }return file;
    }
    private Set<String> ids(int start,int count){Set<String> result=new LinkedHashSet<>();for(int i=start;i<start+count;i++)result.add("r"+i);return result;}
    private long scalar(SQLiteDatabase db,String query){try(Cursor row=db.rawQuery(query,null)){assertTrue(row.moveToFirst());return row.getLong(0);}}
    private String hash(LogbookDatabase db,Set<String> selected)throws Exception{
        MessageDigest digest=MessageDigest.getInstance("SHA-256");
        try(Writer writer=new OutputStreamWriter(new DigestOutputStream(new OutputStream(){public void write(int value){}public void write(byte[] b,int o,int n){}},digest),StandardCharsets.UTF_8)){db.writeSnapshot(writer,selected);}
        return java.util.Base64.getEncoder().encodeToString(digest.digest());
    }
    private String bodyHash(SQLiteDatabase db,int id)throws Exception{
        MessageDigest digest=MessageDigest.getInstance("SHA-256");
        try(Cursor rows=db.rawQuery("SELECT data FROM indexed_bodies WHERE record_key=(SELECT row_key FROM indexed_records WHERE id=?) ORDER BY kind,position",new String[]{"r"+id})){while(rows.moveToNext())digest.update(rows.getString(0).getBytes(StandardCharsets.UTF_8));}
        return java.util.Base64.getEncoder().encodeToString(digest.digest());
    }
    @Test public void migratesFiftyCampaignsThousandBodiesAndWritesOnlySelected()throws Exception{
        String name="public-migration-"+UUID.randomUUID()+".sqlite";File fixture=fixture(1000,52000,0,"valid");
        assertTrue(fixture.length()>49L*1024*1024);assertTrue(fixture.length()<64L*1024*1024);
        File location=context().getDatabasePath(name);location.getParentFile().mkdirs();
        try{
            try(SQLiteDatabase legacy=SQLiteDatabase.openOrCreateDatabase(location,null)){
                legacy.execSQL("CREATE TABLE app_state(id INTEGER PRIMARY KEY,json TEXT,revision INTEGER NOT NULL)");legacy.execSQL("INSERT INTO app_state VALUES(1,'chunked-v1',7)");
                legacy.execSQL("CREATE TABLE snapshot_chunks(position INTEGER PRIMARY KEY,data TEXT NOT NULL)");legacy.execSQL("CREATE TABLE snapshot_fields(field TEXT,position INTEGER,data TEXT,PRIMARY KEY(field,position))");
                try(Reader input=new InputStreamReader(new FileInputStream(fixture),StandardCharsets.UTF_8)){
                    char[] chars=new char[65536];int count,position=0,length=0;
                    while((count=input.read(chars,length,chars.length-length))!=-1){length+=count;if(length==chars.length){int end=Character.isHighSurrogate(chars[length-1])?length-1:length;legacy.execSQL("INSERT INTO snapshot_chunks VALUES(?,?)",new Object[]{position++,new String(chars,0,end)});if(end<length)chars[0]=chars[end];length-=end;}}
                    if(length>0)legacy.execSQL("INSERT INTO snapshot_chunks VALUES(?,?)",new Object[]{position,new String(chars,0,length)});
                }
                legacy.execSQL("INSERT INTO snapshot_fields VALUES('exportedAt',0,'\"after metadata\"')");legacy.setVersion(3);
            }
            String unselected;
            try(LogbookDatabase db=new LogbookDatabase(context(),name)){
                assertEquals(7,db.revision());SQLiteDatabase sql=db.getWritableDatabase();
                assertEquals(1000,db.deferred().length());assertTrue(JsonFields.join(db.fields()).length()<500000);
                assertEquals(0,scalar(sql,"SELECT COUNT(*) FROM snapshot_chunks"));assertEquals(0,scalar(sql,"SELECT COUNT(*) FROM snapshot_fields"));
                assertEquals("\"after metadata\"",db.fields().get("exportedAt"));
                try(Cursor row=sql.rawQuery("PRAGMA integrity_check",null)){assertTrue(row.moveToFirst());assertEquals("ok",row.getString(0));}
                unselected=bodyHash(sql,999);
                sql.execSQL("CREATE TABLE touched(id INTEGER)");
                sql.execSQL("CREATE TRIGGER body_insert AFTER INSERT ON indexed_bodies BEGIN INSERT INTO touched VALUES(NEW.record_key); END");
                sql.execSQL("CREATE TRIGGER body_delete AFTER DELETE ON indexed_bodies BEGIN INSERT INTO touched VALUES(OLD.record_key); END");
                try(FetchBatch batch=new FetchBatch(new File(context().getCacheDir(),"public-batch-"+UUID.randomUUID()),"public-tree",7,ids(0,20),db.fields())){
                    for(int i=0;i<20;i++){File next=fixture(1,54000,i,i==19?"fetch_failed":"valid");try{batch.stage(next);}finally{assertTrue(next.delete());}}
                    assertEquals(7,db.revision());assertEquals(unselected,bodyHash(sql,999));
                    String failedBefore=bodyHash(sql,19);assertEquals(8,batch.finish(db,"committed"));
                    assertEquals(failedBefore,bodyHash(sql,19));assertEquals(unselected,bodyHash(sql,999));
                    assertEquals(0,scalar(sql,"SELECT COUNT(*) FROM touched WHERE id NOT IN (SELECT row_key FROM indexed_records WHERE id IN ('r0','r1','r2','r3','r4','r5','r6','r7','r8','r9','r10','r11','r12','r13','r14','r15','r16','r17','r18'))"));
                }
                // Ordinary heap quotas differ by device (S9: 256 MiB). Verify the actual contract.
                assertEquals(0, context().getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_LARGE_HEAP);
                System.out.println("Public pressure ordinary maxHeapMiB="+(Runtime.getRuntime().maxMemory()/1024/1024));
                assertNotNull(hash(db,ids(999,1)));
            }
            try(LogbookDatabase reopened=new LogbookDatabase(context(),name)){
                assertEquals(8,reopened.revision());assertEquals(1000,reopened.deferred().length());assertEquals(unselected,bodyHash(reopened.getReadableDatabase(),999));
            }
        }finally{assertTrue(fixture.delete());context().deleteDatabase(name);}
    }
    @Test public void thousandResultBatchRepeatedThreeTimesWithAtomicFailures()throws Exception{
        String name="public-repeat-"+UUID.randomUUID()+".sqlite";File initial=fixture(1000,8192,0,"valid");
        try(LogbookDatabase db=new LogbookDatabase(context(),name)){
            try(Reader reader=new InputStreamReader(new FileInputStream(initial),StandardCharsets.UTF_8)){db.replace(reader,0);}
            for(int cycle=0;cycle<3;cycle++){
                long before=db.revision();String last=bodyHash(db.getReadableDatabase(),999);
                try(FetchBatch batch=new FetchBatch(new File(context().getCacheDir(),"public-all-"+UUID.randomUUID()),"public-tree",before,ids(0,1000),db.fields())){
                    for(int i=0;i<1000;i++){File next=fixture(1,12288+cycle,i,i%17==0?"fetch_failed":"valid");try{batch.stage(next);}finally{assertTrue(next.delete());}}
                    assertEquals(before,db.revision());assertEquals(last,bodyHash(db.getReadableDatabase(),999));
                    assertEquals(before+1,batch.finish(db,"cycle"+cycle));assertEquals(1000,db.deferred().length());
                }
            }
            long before=db.revision();String stable=bodyHash(db.getReadableDatabase(),999);
            try(FetchBatch incomplete=new FetchBatch(new File(context().getCacheDir(),"public-incomplete-"+UUID.randomUUID()),"public-tree",before,ids(0,2),db.fields())){
                File next=fixture(1,100,0,"valid");try{incomplete.stage(next);}finally{next.delete();}
                try{incomplete.finish(db,"no");fail("Incomplete batch committed");}catch(IllegalStateException expected){}
            }
            try(FetchBatch conflict=new FetchBatch(new File(context().getCacheDir(),"public-conflict-"+UUID.randomUUID()),"public-tree",before,ids(999,1),db.fields())){
                File next=fixture(1,100,999,"valid");try{conflict.stage(next);}finally{next.delete();}
                Map<String,String> patch=new LinkedHashMap<>();patch.put("exportedAt","\"independent edit\"");db.replaceFields(patch,before);
                try{conflict.finish(db,"no");fail("Stale batch committed");}catch(IllegalStateException expected){}
                assertEquals(before+1,db.revision());assertEquals(stable,bodyHash(db.getReadableDatabase(),999));
            }
        }finally{assertTrue(initial.delete());context().deleteDatabase(name);}
    }
    @Test public void overLimitRollsBackOriginalBodiesAndRevision()throws Exception{
        String name="public-limit-"+UUID.randomUUID()+".sqlite";File initial=fixture(1,100,0,"valid"),large=fixture(1000,68000,0,"valid");
        try(LogbookDatabase db=new LogbookDatabase(context(),name)){
            try(Reader reader=new InputStreamReader(new FileInputStream(initial),StandardCharsets.UTF_8)){db.replace(reader,0);}
            String before=hash(db,null);assertTrue(large.length()>64L*1024*1024);
            try(Reader reader=new InputStreamReader(new FileInputStream(large),StandardCharsets.UTF_8)){
                try{db.replace(reader,1);fail("Oversized data committed");}catch(IllegalArgumentException expected){}
            }
            assertEquals(1,db.revision());assertEquals(before,hash(db,null));
        }finally{initial.delete();large.delete();context().deleteDatabase(name);}
    }
}
