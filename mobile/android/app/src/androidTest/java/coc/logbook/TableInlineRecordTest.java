package coc.logbook;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Isolated public fixtures exercise both complete metadata storage forms. */
@RunWith(AndroidJUnit4.class)
public final class TableInlineRecordTest {
    private static final long FREE=32L*1024*1024*1024;
    private final Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
    private static JSONObject fixture()throws Exception {
        try(InputStream input=InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("public-capacity.json");ByteArrayOutputStream output=new ByteArrayOutputStream()) {
            byte[] buffer=new byte[65536];int count;while((count=input.read(buffer))!=-1)output.write(buffer,0,count);
            JSONObject value=new JSONObject(output.toString("UTF-8"));JSONArray modules=value.getJSONArray("modules");for(int i=0;i<modules.length();i++)modules.getJSONObject(i).put("kps",new JSONArray()).put("pairs",new JSONArray());return value;
        }
    }
    private static JSONObject row(String module,String name,String link,String manual)throws Exception {
        JSONObject value=new JSONObject().put("sheet","公开内联表").put("moduleName",module).put("sessionName",name).put("link",link).put("kps",new JSONArray()).put("pairs",new JSONArray());if(manual!=null)value.put("manualContent",manual);return value;
    }
    private static BackupSession.Proof send(TableSession owner,JSONObject... rows)throws Exception {
        StringBuilder text=new StringBuilder();for(int i=0;i<rows.length;i++)text.append('T').append(new JSONObject().put("sheetOrder",0).put("rowOrder",i).put("value",rows[i])).append('\n');
        byte[] bytes=text.toString().getBytes(StandardCharsets.UTF_8);long index=0;for(int at=0;at<bytes.length;at+=LogbookLimits.TRANSFER_CHUNK_BYTES)owner.append("candidate",index++,Arrays.copyOfRange(bytes,at,Math.min(bytes.length,at+LogbookLimits.TRANSFER_CHUNK_BYTES)));
        StringBuilder hash=new StringBuilder();for(byte value:MessageDigest.getInstance("SHA-256").digest(bytes))hash.append(String.format(Locale.ROOT,"%02x",value&255));return new BackupSession.Proof(bytes.length,hash.toString());
    }
    private static void capture(TableSession owner)throws Exception {owner.capture(new ByteArrayInputStream("public inline record source".getBytes(StandardCharsets.UTF_8)));}
    private static SQLiteDatabase index(TableSession owner,int flags){return SQLiteDatabase.openDatabase(new File(owner.directory,"stage.sqlite").getPath(),null,flags);}
    private static long count(SQLiteDatabase db,String table){try(Cursor rows=db.rawQuery("SELECT COUNT(*) FROM "+table,null)){assertTrue(rows.moveToFirst());return rows.getLong(0);}}
    private static void remove(File root)throws Exception {if(!root.exists())return;for(File file:Objects.requireNonNull(root.listFiles())){if(file.isDirectory())remove(file);else assertTrue(file.delete());}assertTrue(root.delete());}
    private static JSONObject byName(JSONArray records,String name)throws Exception {JSONObject found=null;for(int i=0;i<records.length();i++)if(records.getJSONObject(i).getString("name").equals(name)){assertNull(found);found=records.getJSONObject(i);}assertNotNull(found);return found;}
    private static String moduleName(JSONObject value,String id)throws Exception {JSONArray modules=value.getJSONArray("modules");for(int i=0;i<modules.length();i++)if(modules.getJSONObject(i).getString("id").equals(id))return modules.getJSONObject(i).getString("name");throw new AssertionError("Missing public module");}

    @Test public void smallOnlineRecordsAvoidSeparateMetadataBlobInsertsAndKeepCompleteCommit()throws Exception {
        String name="public-inline-record-writes-"+UUID.randomUUID()+".sqlite";File root=new File(context.getCacheDir(),"public-inline-record-writes-"+UUID.randomUUID());assertTrue(root.mkdir());
        try(LogbookDatabase db=new LogbookDatabase(context,name,true,()->FREE)) {
            JSONObject original=fixture();db.replace(original.toString(),0);String before=db.snapshot(),module=original.getJSONArray("modules").getJSONObject(0).getString("name");
            try(TableSession owner=new TableSession(root,"public",1,"record-table","public.csv",()->FREE,true)) {
                capture(owner);owner.prepareSeed(db,original.getJSONObject("settings"),()->{},false);
                try(SQLiteDatabase stage=index(owner,SQLiteDatabase.OPEN_READWRITE)){stage.execSQL("CREATE TABLE public_blob_insert_audit(value INTEGER)");stage.execSQL("CREATE TRIGGER public_record_blob_audit AFTER INSERT ON blobs BEGIN INSERT INTO public_blob_insert_audit VALUES(1); END");}
                JSONObject[] candidate=new JSONObject[3];for(int i=0;i<candidate.length;i++)candidate[i]=row(module,"内联完整中😀场"+i,"https://log.weizaima.com/?key=public-inline-record-"+i,null);
                JSONObject preview=owner.preview(db,send(owner,candidate),original.getJSONObject("settings"));assertEquals(3,preview.getInt("added"));assertEquals(before,db.snapshot());
                try(SQLiteDatabase stage=index(owner,SQLiteDatabase.OPEN_READONLY)){assertEquals("Small online record metadata must not need a separate blob INSERT",0,count(stage,"public_blob_insert_audit"));}
                owner.prepareCommit();assertEquals(2,db.edit(1,owner::apply));JSONArray saved=new JSONObject(db.snapshot()).getJSONArray("records"),old=new JSONObject(before).getJSONArray("records");assertEquals(old.length()+3,saved.length());
                for(int i=0;i<old.length();i++)assertTrue(BackupValidation.same(old.getJSONObject(i),saved.getJSONObject(i)));
                for(JSONObject expected:candidate){JSONObject actual=byName(saved,expected.getString("sessionName"));assertEquals(expected.getString("link"),actual.getString("link"));assertFalse(actual.has("manualContent"));}
            }
        }finally{context.deleteDatabase(name);remove(root);}
    }

    private static void assertRejected(TableSession owner,LogbookDatabase db,String before)throws Exception {
        assertEquals(before,db.snapshot());assertEquals(1,db.revision());try{owner.prepareCommit();fail("Failed preview became committable");}catch(IOException expected){}
    }
    private static JSONObject manualRecord(JSONObject original)throws Exception {
        JSONObject record=original.getJSONArray("records").getJSONObject(0);record.put("sourceType","manual").put("status","manual").put("manualContent","原始完整正文中😀\r\n\u0000尾");return record;
    }
    private static String metadata(JSONObject record)throws Exception {JSONObject copy=new JSONObject(record.toString());copy.remove("rawContent");copy.remove("manualContent");return copy.toString();}
    private static void assertStoredText(SQLiteDatabase stage,long ref,String expected)throws Exception {
        byte[] complete=expected.getBytes(StandardCharsets.UTF_8);byte[] resident;
        try(Cursor manifest=stage.rawQuery("SELECT bytes,resident FROM blobs WHERE id=?",new String[]{Long.toString(ref)})){assertTrue(manifest.moveToFirst());assertEquals(complete.length,manifest.getLong(0));resident=manifest.isNull(1)?null:manifest.getBlob(1);assertFalse(manifest.moveToNext());}
        try(Cursor chunks=stage.rawQuery("SELECT position,offset,data FROM blob_chunks WHERE owner=? ORDER BY position",new String[]{Long.toString(ref)})) {
            if(resident!=null){assertArrayEquals(complete,resident);assertFalse("Resident text cannot retain any old chunks",chunks.moveToNext());}
            else{ByteArrayOutputStream collected=new ByteArrayOutputStream();long position=0;while(chunks.moveToNext()){assertEquals(position++,chunks.getLong(0));assertEquals(collected.size(),chunks.getLong(1));byte[] part=chunks.getBlob(2);assertTrue(part.length>0&&part.length<=LogbookLimits.TRANSFER_CHUNK_BYTES);collected.write(part);}assertArrayEquals("Every current manual byte, with no old tail",complete,collected.toByteArray());}
        }
    }

    @Test public void exactByteBoundaryAndFallbackAreCompleteDuringSeedUpdateAndCommit()throws Exception {
        String name="public-inline-record-boundary-"+UUID.randomUUID()+".sqlite";File root=new File(context.getCacheDir(),"public-inline-record-boundary-"+UUID.randomUUID());assertTrue(root.mkdir());
        try(LogbookDatabase db=new LogbookDatabase(context,name,true,()->FREE)) {
            JSONObject original=fixture(),base=manualRecord(original);JSONArray records=new JSONArray();JSONObject[] candidate=new JSONObject[2];
            for(int i=0;i<2;i++) {
                JSONObject record=new JSONObject(base.toString());record.put("id","public-inline-boundary-"+i).put("name","边界中😀\r\n\u0000尾"+i).put("sequenceNo",i+1).put("order",i);
                int fill=65536+i-metadata(record).getBytes(StandardCharsets.UTF_8).length;record.put("name",record.getString("name")+String.join("",Collections.nCopies(fill,"A")));assertEquals(65536+i,metadata(record).getBytes(StandardCharsets.UTF_8).length);records.put(record);
                candidate[i]=row(moduleName(original,record.getString("moduleId")),record.getString("name"),"","更新完整正文"+i+"中😀\r\n\u0000尾");
            }
            original.put("records",records);db.replace(original.toString(),0);String before=db.snapshot();
            try(TableSession owner=new TableSession(root,"public",1,"record-table","public.csv",()->FREE,true)) {
                capture(owner);owner.prepareSeed(db,original.getJSONObject("settings"),()->{},false);
                try(SQLiteDatabase stage=index(owner,SQLiteDatabase.OPEN_READONLY);Cursor stored=stage.rawQuery("SELECT value,bytes,resident FROM records ORDER BY ordinal",null)) {
                    assertTrue(stored.moveToFirst());assertTrue(stored.isNull(0));assertEquals(65536,stored.getLong(1));assertEquals(65536,stored.getBlob(2).length);
                    assertTrue(stored.moveToNext());assertFalse(stored.isNull(0));assertTrue(stored.isNull(1));assertTrue(stored.isNull(2));assertFalse(stored.moveToNext());
                }
                JSONObject preview=owner.preview(db,send(owner,candidate),original.getJSONObject("settings"));assertEquals(2,preview.getInt("updated"));assertEquals(before,db.snapshot());
                owner.prepareCommit();assertEquals(2,db.edit(1,owner::apply));JSONArray saved=new JSONObject(db.snapshot()).getJSONArray("records");
                for(int i=0;i<2;i++){JSONObject actual=byName(saved,candidate[i].getString("sessionName"));assertEquals(candidate[i].getString("manualContent"),actual.getString("manualContent"));assertTrue(BackupValidation.same(records.getJSONObject(i).getJSONObject("rawContent"),actual.getJSONObject("rawContent")));}
            }
        }finally{context.deleteDatabase(name);remove(root);}
    }

    @Test public void oldManualUpdatesCrossBothStorageFormsWithoutLosingRawOrLeavingOldMetadata()throws Exception {
        String name="public-inline-record-transition-"+UUID.randomUUID()+".sqlite";File root=new File(context.getCacheDir(),"public-inline-record-transition-"+UUID.randomUUID());assertTrue(root.mkdir());
        try(LogbookDatabase db=new LogbookDatabase(context,name,true,()->FREE)) {
            JSONObject original=fixture(),record=manualRecord(original);String id=record.getString("id"),module=moduleName(original,record.getString("moduleId")),raw=record.getJSONObject("rawContent").toString();db.replace(original.toString(),0);
            String[] dates={String.join("",Collections.nCopies(80000,"中😀"))+"大尾甲","小日期中😀",String.join("",Collections.nCopies(90000,"乙"))+"大尾乙","2026/10/23"};
            for(int iteration=0;iteration<dates.length;iteration++) {
                long revision=db.revision();String before=db.snapshot(),body=(iteration==1?String.join("",Collections.nCopies(35000,"完整正文😀")):"完整更新正文")+iteration+"中😀\r\n\u0000尾";
                try(TableSession owner=new TableSession(root,"public",revision,"record-table","public.csv",()->FREE,true)) {
                    capture(owner);owner.prepareSeed(db,original.getJSONObject("settings"),()->{},false);Long previous=null;
                    try(SQLiteDatabase stage=index(owner,SQLiteDatabase.OPEN_READONLY);Cursor stored=stage.rawQuery("SELECT value FROM records WHERE id=?",new String[]{id})){assertTrue(stored.moveToFirst());if(!stored.isNull(0))previous=stored.getLong(0);}
                    JSONObject preview=owner.preview(db,send(owner,row(module,record.getString("name"),"",body).put("playDate",dates[iteration])),original.getJSONObject("settings"));assertEquals(1,preview.getInt("updated"));assertEquals(before,db.snapshot());
                    try(SQLiteDatabase stage=index(owner,SQLiteDatabase.OPEN_READONLY);Cursor stored=stage.rawQuery("SELECT value,bytes,resident FROM records WHERE id=?",new String[]{id})) {
                        assertTrue(stored.moveToFirst());assertEquals(iteration%2==1,stored.isNull(0));assertEquals(iteration%2==0,stored.isNull(1));assertEquals(iteration%2==0,stored.isNull(2));
                        if(previous!=null)try(Cursor obsolete=stage.rawQuery("SELECT (SELECT COUNT(*) FROM blobs WHERE id=?),(SELECT COUNT(*) FROM blob_chunks WHERE owner=?),(SELECT manual FROM records WHERE id=?)",new String[]{previous.toString(),previous.toString(),id})) {
                            assertTrue(obsolete.moveToFirst());
                            // SQLite may reuse a deleted non-AUTOINCREMENT ID
                            // for the following manual INSERT. Prove its new
                            // owner and complete representation, not ID novelty.
                            if(obsolete.getLong(0)==0)assertEquals(0,obsolete.getLong(1));
                            else{assertEquals(1,obsolete.getLong(0));assertFalse(obsolete.isNull(2));assertEquals(previous.longValue(),obsolete.getLong(2));assertStoredText(stage,previous,JSONObject.quote(body));}
                        }
                    }
                    owner.prepareCommit();assertEquals(revision+1,db.edit(revision,owner::apply));JSONObject saved=byName(new JSONObject(db.snapshot()).getJSONArray("records"),record.getString("name"));assertEquals(id,saved.getString("id"));assertEquals(dates[iteration],saved.getString("playDate"));assertEquals(body,saved.getString("manualContent"));assertEquals(raw,saved.getJSONObject("rawContent").toString());
                }
            }
        }finally{context.deleteDatabase(name);remove(root);}
    }

    private static final String[] CORRUPT={"value=123456", "bytes=NULL", "bytes=bytes+1", "bytes=0,resident=X''", "bytes=65537,resident=zeroblob(65537)", "bytes=2,resident=X'C328'", "bytes=3,resident=X'F09F98'", "value=NULL,bytes=NULL,resident=NULL", "value=999999999,bytes=NULL,resident=NULL", "value=999999999,bytes=1,resident=NULL", "bytes=2.5,resident=X'7B7D'", "bytes=2,resident='{}'"};
    private static void assertMetadataFailure(IOException error) {assertTrue("The complete metadata reader must reject the corruption",error instanceof java.nio.charset.CharacterCodingException||error.getMessage().contains("元数据")||error.getMessage().contains("分段"));}

    @Test public void oldRecordReaderRejectsMixedMissingTruncatedAndInvalidUtf8BeforeFreeze()throws Exception {
        for(String corrupt:CORRUPT) {
            String name="public-inline-record-read-corrupt-"+UUID.randomUUID()+".sqlite";File root=new File(context.getCacheDir(),"public-inline-record-read-corrupt-"+UUID.randomUUID());assertTrue(root.mkdir());
            try(LogbookDatabase db=new LogbookDatabase(context,name,true,()->FREE)) {
                JSONObject original=fixture(),record=manualRecord(original);db.replace(original.toString(),0);String before=db.snapshot();
                try(TableSession owner=new TableSession(root,"public",1,"record-table","public.csv",()->FREE,true)) {
                    capture(owner);owner.prepareSeed(db,original.getJSONObject("settings"),()->{},false);
                    try(SQLiteDatabase stage=index(owner,SQLiteDatabase.OPEN_READWRITE)){stage.execSQL("UPDATE records SET "+corrupt+" WHERE id=?",new Object[]{record.getString("id")});}
                    try{owner.preview(db,send(owner,row(moduleName(original,record.getString("moduleId")),record.getString("name"),"","完整新正文")),original.getJSONObject("settings"));fail("Accepted corrupt old metadata");}catch(IOException expected){assertMetadataFailure(expected);}assertRejected(owner,db,before);
                }
            }finally{context.deleteDatabase(name);remove(root);}
        }
    }

    @Test public void commitReaderRejectsCorruptionAlreadyInsideTheValidFrozenFileProof()throws Exception {
        for(String corrupt:CORRUPT) {
            String name="public-inline-record-commit-corrupt-"+UUID.randomUUID()+".sqlite";File root=new File(context.getCacheDir(),"public-inline-record-commit-corrupt-"+UUID.randomUUID());assertTrue(root.mkdir());
            try(LogbookDatabase db=new LogbookDatabase(context,name,true,()->FREE)) {
                JSONObject original=fixture();db.replace(original.toString(),0);String before=db.snapshot(),module=original.getJSONArray("modules").getJSONObject(0).getString("name");
                try(TableSession owner=new TableSession(root,"public",1,"record-table","public.csv",()->FREE,true)) {
                    capture(owner);owner.prepareSeed(db,original.getJSONObject("settings"),()->{},false);
                    // Corrupt during INSERT, before preview seals its database.
                    // Nothing touches the frozen file: rejection must come from
                    // the reader, not from the existing whole-file hash guard.
                    try(SQLiteDatabase stage=index(owner,SQLiteDatabase.OPEN_READWRITE)){stage.execSQL("CREATE TRIGGER public_inline_corrupt AFTER INSERT ON records WHEN NEW.name='公开冻结坏metadata' BEGIN UPDATE records SET "+corrupt+" WHERE id=NEW.id; END");}
                    JSONObject preview=owner.preview(db,send(owner,row(module,"公开冻结坏metadata","https://log.weizaima.com/?key=public-inline-corrupt",null)),original.getJSONObject("settings"));assertEquals(1,preview.getInt("added"));
                    try{owner.prepareCommit();fail("Accepted corrupt metadata inside the frozen proof");}catch(IOException expected){assertMetadataFailure(expected);}assertEquals(before,db.snapshot());assertEquals(1,db.revision());
                }
            }finally{context.deleteDatabase(name);remove(root);}
        }
    }

    @Test public void bothMetadataReadersKeepCompleteFallbackChunkValidation()throws Exception {
        for(boolean oldRead:new boolean[]{true,false})for(boolean extraTail:new boolean[]{false,true}) {
            String name="public-inline-record-fallback-corrupt-"+UUID.randomUUID()+".sqlite";File root=new File(context.getCacheDir(),"public-inline-record-fallback-corrupt-"+UUID.randomUUID());assertTrue(root.mkdir());
            try(LogbookDatabase db=new LogbookDatabase(context,name,true,()->FREE)) {
                JSONObject original=fixture(),record=manualRecord(original);String large=String.join("",Collections.nCopies(80000,"中😀"))+"完整大尾";if(oldRead)record.put("playDate",large);db.replace(original.toString(),0);String before=db.snapshot();
                try(TableSession owner=new TableSession(root,"public",1,"record-table","public.csv",()->FREE,true)) {
                    capture(owner);owner.prepareSeed(db,original.getJSONObject("settings"),()->{},false);
                    String ref=oldRead?"(SELECT value FROM records WHERE id="+JSONObject.quote(record.getString("id"))+")":"NEW.value";
                    String change=extraTail?"INSERT INTO blob_chunks(owner,position,offset,data) SELECT "+ref+",(SELECT MAX(position)+1 FROM blob_chunks WHERE owner="+ref+"),bytes,X'41' FROM blobs WHERE id="+ref:"DELETE FROM blob_chunks WHERE owner="+ref+" AND position=(SELECT MAX(position) FROM blob_chunks WHERE owner="+ref+")";
                    try(SQLiteDatabase stage=index(owner,SQLiteDatabase.OPEN_READWRITE)){if(oldRead)stage.execSQL(change);else stage.execSQL("CREATE TRIGGER public_fallback_corrupt AFTER INSERT ON records WHEN NEW.name='公开损坏大metadata' BEGIN "+change+"; END");}
                    JSONObject candidate=row(moduleName(original,record.getString("moduleId")),oldRead?record.getString("name"):"公开损坏大metadata",oldRead?"":"https://log.weizaima.com/?key=public-fallback-corrupt",oldRead?"完整更新正文":null).put("playDate",large);
                    if(oldRead){try{owner.preview(db,send(owner,candidate),original.getJSONObject("settings"));fail("Accepted corrupt fallback old metadata");}catch(IOException expected){assertMetadataFailure(expected);}assertRejected(owner,db,before);}
                    else{owner.preview(db,send(owner,candidate),original.getJSONObject("settings"));try{owner.prepareCommit();fail("Accepted corrupt fallback commit metadata");}catch(IOException expected){assertMetadataFailure(expected);}assertEquals(before,db.snapshot());assertEquals(1,db.revision());}
                }
            }finally{context.deleteDatabase(name);remove(root);}
        }
    }

    @Test public void manualCapacityAndRecordInsertFailuresRollbackEveryStagedWrite()throws Exception {
        for(int failAt:new int[]{5,6,7,0}) {
            String name="public-inline-record-rollback-"+UUID.randomUUID()+".sqlite";File root=new File(context.getCacheDir(),"public-inline-record-rollback-"+UUID.randomUUID());assertTrue(root.mkdir());
            try(LogbookDatabase db=new LogbookDatabase(context,name,true,()->FREE)) {
                JSONObject original=fixture();db.replace(original.toString(),0);String before=db.snapshot(),module=original.getJSONArray("modules").getJSONObject(0).getString("name");int[] checks={0};boolean[] checking={false};
                try(TableSession owner=new TableSession(root,"public",1,"record-table","public.csv",()->checking[0]&&++checks[0]==failAt?StorageBudget.MINIMUM_RESERVE:FREE,true)) {
                    capture(owner);owner.prepareSeed(db,original.getJSONObject("settings"),()->{},false);long[] counts=new long[3];
                    try(SQLiteDatabase stage=index(owner,SQLiteDatabase.OPEN_READWRITE)){counts[0]=count(stage,"records");counts[1]=count(stage,"blobs");counts[2]=count(stage,"blob_chunks");if(failAt==0)stage.execSQL("CREATE TRIGGER public_inline_insert_failure BEFORE INSERT ON records WHEN NEW.name='公开写入回滚' AND NEW.manual IS NOT NULL AND (SELECT bytes FROM blobs WHERE id=NEW.manual)>0 BEGIN SELECT RAISE(ABORT,'public record insert after complete manual'); END");}
                    BackupSession.Proof proof=send(owner,row(module,"公开写入回滚","","完整手动正文中😀\r\n\u0000尾"));checking[0]=true;
                    try{owner.preview(db,proof,original.getJSONObject("settings"));fail("Accepted failed manual staging or record insertion");}
                    catch(IOException expected){assertNotEquals(0,failAt);assertEquals(failAt,checks[0]);}
                    catch(android.database.SQLException expected){assertEquals(0,failAt);assertEquals(6,checks[0]);assertTrue(expected.getMessage().contains("public record insert after complete manual"));}
                    finally{checking[0]=false;}
                    try(SQLiteDatabase stage=index(owner,SQLiteDatabase.OPEN_READONLY)){assertEquals(counts[0],count(stage,"records"));assertEquals(counts[1],count(stage,"blobs"));assertEquals(counts[2],count(stage,"blob_chunks"));}assertRejected(owner,db,before);
                }
            }finally{context.deleteDatabase(name);remove(root);}
        }
    }
}
