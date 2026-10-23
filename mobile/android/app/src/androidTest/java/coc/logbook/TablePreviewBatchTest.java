package coc.logbook;

import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Public inputs, isolated native databases. Tests private-preview reuse against
 * observable ordering, complete content, validation, capacity and rollback. */
@RunWith(AndroidJUnit4.class)
public final class TablePreviewBatchTest {
    private final Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
    private static final long FREE=32L*1024*1024*1024;
    private JSONObject fixture()throws Exception {
        try(InputStream in=InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("public-capacity.json")) {
            ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[65536];int count;
            while((count=in.read(buffer))!=-1)out.write(buffer,0,count);return new JSONObject(out.toString("UTF-8"));
        }
    }
    private static JSONObject row(String module,String name,String link,String body)throws Exception {
        JSONObject value=new JSONObject().put("sheet","公开表").put("moduleName",module).put("sessionName",name).put("link",link).put("kps",new JSONArray().put("公开KP")).put("pairs",new JSONArray());
        if(body!=null)value.put("manualContent",body);return value;
    }
    private static void frame(StringBuilder out,int index,JSONObject row)throws Exception {
        out.append('T').append(new JSONObject().put("sheetOrder",0).put("rowOrder",index).put("value",row)).append('\n');
    }
    private static BackupSession.Proof send(TableSession stage,String text)throws Exception {
        byte[] bytes=text.getBytes(StandardCharsets.UTF_8);long index=0;
        for(int at=0;at<bytes.length;at+=LogbookLimits.TRANSFER_CHUNK_BYTES)stage.append("candidate",index++,Arrays.copyOfRange(bytes,at,Math.min(bytes.length,at+LogbookLimits.TRANSFER_CHUNK_BYTES)));
        StringBuilder hash=new StringBuilder();for(byte value:MessageDigest.getInstance("SHA-256").digest(bytes))hash.append(String.format(Locale.ROOT,"%02x",value&255));return new BackupSession.Proof(bytes.length,hash.toString());
    }
    private static void remove(File root)throws Exception {
        if(!root.exists())return;for(File item:Objects.requireNonNull(root.listFiles())){if(item.isDirectory())remove(item);else assertTrue(item.delete());}assertTrue(root.delete());
    }
    @Test public void repeatedAndRevisitedModulesKeepEveryRowAndLateParticipants()throws Exception {
        String name="public-preview-batch-"+UUID.randomUUID()+".sqlite";File root=new File(context.getCacheDir(),"public-preview-batch-"+UUID.randomUUID());assertTrue(root.mkdir());
        try(LogbookDatabase db=new LogbookDatabase(context,name,true,()->FREE)) {
            JSONObject original=fixture();db.replace(original.toString(),0);String before=db.snapshot();JSONArray originals=new JSONObject(before).getJSONArray("records");
            try(TableSession stage=new TableSession(root,"public",1,"record-table","public.csv",()->FREE)) {
                stage.capture(new ByteArrayInputStream("public independent source".getBytes(StandardCharsets.UTF_8)));
                StringBuilder candidate=new StringBuilder();
                for(int i=0;i<114;i++)frame(candidate,i,row(i==57?"公开B":"公开A","公开场"+i,"https://log.weizaima.com/?key=batch-"+i,null));
                frame(candidate,114,row("公开A","完整手动","","首份完整正文😀\r\n\u0000尾"));
                JSONObject duplicate=row("公开A","重复来源","https://log.weizaima.com/?key=batch-0",null);
                duplicate.put("kps",new JSONArray().put("后到KP"));duplicate.put("pairs",new JSONArray().put(new JSONObject().put("pc","后到PC").put("pl","后到PL")));frame(candidate,115,duplicate);
                String body="最终完整正文😀\r\n\u0000末尾";frame(candidate,116,row("公开A","完整手动","",body));
                JSONObject preview=stage.preview(db,send(stage,candidate.toString()),original.getJSONObject("settings"));
                assertEquals(115,preview.getInt("added"));assertEquals(1,preview.getInt("updated"));assertEquals(1,preview.getInt("skipped"));assertEquals(116,preview.getInt("namesCount"));assertEquals(16,stage.page("names",100,100).getJSONArray("values").length());assertEquals(before,db.snapshot());
                try(SQLiteDatabase proof=SQLiteDatabase.openDatabase(new File(stage.directory,"stage.sqlite").getPath(),null,SQLiteDatabase.OPEN_READONLY);android.database.Cursor counts=proof.rawQuery("SELECT count,(SELECT COUNT(*) FROM records WHERE module_id=modules.id) FROM modules",null)){while(counts.moveToNext())assertEquals(counts.getLong(1),counts.getLong(0));}
                stage.prepareCommit();assertEquals(2,db.edit(1,stage::apply));
                JSONObject saved=new JSONObject(db.snapshot());JSONArray records=saved.getJSONArray("records");assertEquals(originals.length()+115,records.length());
                for(int i=0;i<originals.length();i++)assertEquals(originals.getJSONObject(i).toString(),records.getJSONObject(i).toString());
                for(int i=0;i<114;i++){JSONObject value=records.getJSONObject(originals.length()+i);assertEquals("公开场"+i,value.getString("name"));assertEquals("https://log.weizaima.com/?key=batch-"+i,value.getString("link"));assertEquals(i==57?1:i<57?i+1:i,value.getInt("sequenceNo"));}
                JSONObject manual=records.getJSONObject(records.length()-1);assertEquals(body,manual.getString("manualContent"));assertEquals(114,manual.getInt("sequenceNo"));
                JSONObject module=null;JSONArray modules=saved.getJSONArray("modules");for(int i=0;i<modules.length();i++)if(modules.getJSONObject(i).getString("name").equals("公开A"))module=modules.getJSONObject(i);
                assertNotNull(module);assertEquals(new JSONArray().put("公开KP").put("后到KP").toString(),module.getJSONArray("kps").toString());assertEquals("后到PC",module.getJSONArray("pairs").getJSONObject(0).getString("pc"));
            }
        }finally{context.deleteDatabase(name);remove(root);}
    }
    @Test public void repeatedModuleStillValidatesDuplicateRowsAndRejectsFallingCapacity()throws Exception {
        String name="public-preview-errors-"+UUID.randomUUID()+".sqlite";File root=new File(context.getCacheDir(),"public-preview-errors-"+UUID.randomUUID());assertTrue(root.mkdir());
        try(LogbookDatabase db=new LogbookDatabase(context,name,true,()->FREE)) {
            JSONObject original=fixture();db.replace(original.toString(),0);String before=db.snapshot();
            for(boolean lowSpace:new boolean[]{false,true}) {
                long[] free={FREE};try(TableSession stage=new TableSession(root,"public",1,"record-table","public.csv",()->free[0])) {
                    stage.capture(new ByteArrayInputStream("public".getBytes(StandardCharsets.UTF_8)));StringBuilder candidate=new StringBuilder();
                    for(int i=0;i<115;i++)frame(candidate,i,row("公开连续","场"+i,"https://log.weizaima.com/?key=validation-"+i,null));
                    JSONObject invalid=row("公开连续","已重复来源","https://log.weizaima.com/?key=validation-0",null);if(!lowSpace)invalid.put("kps",new JSONArray().put(5));frame(candidate,115,invalid);
                    BackupSession.Proof proof=send(stage,candidate.toString());if(lowSpace)free[0]=StorageBudget.MINIMUM_RESERVE;
                    try{stage.preview(db,proof,original.getJSONObject("settings"));fail("accepted invalid duplicate row or exhausted capacity");}catch(IOException expected){}finally{free[0]=FREE;}
                    assertEquals(before,db.snapshot());assertEquals(1,db.revision());
                }
            }
        }finally{context.deleteDatabase(name);remove(root);}
    }
    private static String privateContent(TableSession stage,long ref)throws Exception {
        java.lang.reflect.Method method=TableSession.class.getDeclaredMethod("contentText",long.class);method.setAccessible(true);
        try{return (String)method.invoke(stage,ref);}catch(java.lang.reflect.InvocationTargetException error){throw (Exception)error.getCause();}
    }
    private static void chunks(SQLiteDatabase db,long ref,byte[] bytes)throws Exception {
        db.execSQL("DELETE FROM blob_chunks WHERE owner=?",new Object[]{ref});db.execSQL("INSERT OR REPLACE INTO blobs(id,bytes) VALUES(?,?)",new Object[]{ref,bytes.length});
        int at=0,position=0;while(at<bytes.length){int count=Math.min(bytes.length-at,position==0?1:LogbookLimits.TRANSFER_CHUNK_BYTES);db.execSQL("INSERT INTO blob_chunks VALUES(?,?,?,?)",new Object[]{ref,position++,at,Arrays.copyOfRange(bytes,at,at+count)});at+=count;}
    }
    @Test public void joinedContentValidatesEveryChunkEmptyValueAndSplitUtf8()throws Exception {
        File root=new File(context.getCacheDir(),"public-content-join-"+UUID.randomUUID());assertTrue(root.mkdir());
        try(TableSession stage=new TableSession(root,"public",0,"record-table","public.csv",()->FREE)) {
            String text=String.join("",Collections.nCopies(100000,"中😀"))+"\u0000完整末尾";byte[] bytes=text.getBytes(StandardCharsets.UTF_8);File path=new File(stage.directory,"stage.sqlite");
            try(SQLiteDatabase db=SQLiteDatabase.openDatabase(path.getPath(),null,SQLiteDatabase.OPEN_READWRITE)){chunks(db,9001,bytes);chunks(db,9002,new byte[0]);}
            assertEquals(text,privateContent(stage,9001));assertEquals("",privateContent(stage,9002));
            try{privateContent(stage,9003);fail("accepted missing manifest");}catch(IOException expected){}
            for(int error=0;error<5;error++) {
                try(SQLiteDatabase db=SQLiteDatabase.openDatabase(path.getPath(),null,SQLiteDatabase.OPEN_READWRITE)) {
                    chunks(db,9001,bytes);
                    if(error==0)db.execSQL("DELETE FROM blob_chunks WHERE owner=9001 AND position=1");
                    if(error==1)db.execSQL("UPDATE blob_chunks SET offset=offset+1 WHERE owner=9001 AND position=1");
                    if(error==2)db.execSQL("UPDATE blobs SET bytes=bytes+1 WHERE id=9001");
                    if(error==3)chunks(db,9001,new byte[]{(byte)0xc3,0x28});
                    if(error==4){chunks(db,9001,new byte[0]);db.execSQL("INSERT INTO blob_chunks VALUES(9001,0,0,?)",new Object[]{new byte[]{65}});}
                }
                try{privateContent(stage,9001);fail("accepted corrupt joined content "+error);}catch(IOException expected){}
            }
        }finally{remove(root);}
    }
    @Test public void joinedPagesKeepMultiChunkNamesAndRejectMissingRowsOrChunks()throws Exception {
        String name="public-page-join-"+UUID.randomUUID()+".sqlite";File root=new File(context.getCacheDir(),"public-page-join-"+UUID.randomUUID());assertTrue(root.mkdir());
        try(LogbookDatabase db=new LogbookDatabase(context,name,true,()->FREE)) {
            JSONObject original=fixture();String large=String.join("",Collections.nCopies(100000,"中😀"))+"完整尾";
            // Seed's first metadata chunk carries its full length. Values above
            // one transfer chunk must still preserve every subsequent byte.
            original.getJSONArray("records").getJSONObject(0).put("name",large);db.replace(original.toString(),0);String before=db.snapshot();
            try(TableSession stage=new TableSession(root,"public",1,"record-table","public.csv",()->FREE)) {
                stage.capture(new ByteArrayInputStream("public".getBytes(StandardCharsets.UTF_8)));StringBuilder candidate=new StringBuilder();
                for(int i=0;i<102;i++)frame(candidate,i,row("分页公开",i==0?large:"场"+i,"https://log.weizaima.com/?key=joined-"+i,null));
                JSONObject preview=stage.preview(db,send(stage,candidate.toString()),original.getJSONObject("settings"));
                assertEquals("分页公开 / "+large,preview.getJSONArray("names").getString(0));assertEquals(100,preview.getJSONArray("names").length());
                JSONArray boundary=stage.page("names",99,2).getJSONArray("values");assertEquals(new JSONArray().put("分页公开 / 场99").put("分页公开 / 场100").toString(),boundary.toString());
                assertEquals(2,stage.page("names",100,100).getJSONArray("values").length());assertEquals(0,stage.page("names",102,100).getJSONArray("values").length());assertEquals(0,stage.page("warnings",0,100).getJSONArray("values").length());assertEquals(before,db.snapshot());
                File path=new File(stage.directory,"stage.sqlite");
                try(SQLiteDatabase changed=SQLiteDatabase.openDatabase(path.getPath(),null,SQLiteDatabase.OPEN_READWRITE)){changed.execSQL("DELETE FROM blob_chunks WHERE owner=(SELECT value FROM preview WHERE kind='names' AND position=0) AND position=1");}
                try{stage.page("names",0,1);fail("accepted missing multi-chunk preview bytes");}catch(IOException expected){}
                try(SQLiteDatabase changed=SQLiteDatabase.openDatabase(path.getPath(),null,SQLiteDatabase.OPEN_READWRITE)){changed.execSQL("DELETE FROM preview WHERE kind='names' AND position=100");}
                try{stage.page("names",100,100);fail("accepted missing preview name");}catch(IOException expected){}
                try{stage.prepareCommit();fail("accepted altered private index");}catch(IOException expected){}
                assertEquals(before,db.snapshot());assertEquals(1,db.revision());
            }
        }finally{context.deleteDatabase(name);remove(root);}
    }
    private static String coordinateFrame(int sheet,int position,JSONObject value)throws Exception {
        return "T"+new JSONObject().put("sheetOrder",sheet).put("rowOrder",position).put("value",value)+"\n";
    }
    private static String padCandidate(String value,int bytes) {
        int padding=bytes-value.getBytes(StandardCharsets.UTF_8).length;if(padding<0)throw new IllegalArgumentException("public test padding");
        char[] spaces=new char[padding];Arrays.fill(spaces,' ');return value.substring(0,value.length()-1)+new String(spaces)+"\n";
    }
    @Test public void residentCandidateBoundaryKeepsFullOrderingAndDiskFallback()throws Exception {
        String expectedBody="最终完整正文😀\r\n\u0000尾",comparison=null;
        for(int bytes:new int[]{2*1024*1024-1,2*1024*1024,2*1024*1024+1}) {
            String name="public-candidate-boundary-"+UUID.randomUUID()+".sqlite";File root=new File(context.getCacheDir(),"public-candidate-boundary-"+UUID.randomUUID());assertTrue(root.mkdir());
            try(LogbookDatabase db=new LogbookDatabase(context,name,true,()->FREE)) {
                JSONObject original=fixture();db.replace(original.toString(),0);String before=db.snapshot();JSONArray old=new JSONObject(before).getJSONArray("records");
                try(TableSession stage=new TableSession(root,"public",1,"record-table","public.csv",()->FREE)) {
                    stage.capture(new ByteArrayInputStream("public sealed source".getBytes(StandardCharsets.UTF_8)));
                    String candidate=coordinateFrame(4,1,row("排序公开","手动复用","",expectedBody))+
                        coordinateFrame(0,9,row("排序公开","第九行","https://log.weizaima.com/?key=ordered-9",null))+
                        coordinateFrame(0,1,row("排序公开","手动复用","","早期完整正文😀"))+
                        coordinateFrame(2,0,row("排序公开","第二表","https://log.weizaima.com/?key=ordered-20",null));
                    candidate=padCandidate(candidate,bytes);BackupSession.Proof proof=send(stage,candidate);assertEquals(bytes,proof.bytes);
                    JSONObject preview=stage.preview(db,proof,original.getJSONObject("settings"),true);
                    assertEquals(bytes<=2*1024*1024?1:0,preview.getJSONObject("timing").getInt("residentCandidate"));
                    assertEquals(3,preview.getInt("added"));assertEquals(1,preview.getInt("updated"));assertEquals(0,preview.getInt("skipped"));assertEquals(before,db.snapshot());
                    stage.prepareCommit();assertEquals(2,db.edit(1,stage::apply));JSONArray records=new JSONObject(db.snapshot()).getJSONArray("records");
                    for(int i=0;i<old.length();i++)assertEquals(old.getJSONObject(i).toString(),records.getJSONObject(i).toString());
                    assertEquals(old.length()+3,records.length());JSONObject manual=records.getJSONObject(old.length());assertEquals("手动复用",manual.getString("name"));assertEquals(expectedBody,manual.getString("manualContent"));
                    JSONArray complete=new JSONArray();for(int i=old.length();i<records.length();i++){JSONObject value=records.getJSONObject(i);complete.put(new JSONArray().put(value.getString("name")).put(value.optString("link")).put(value.optString("manualContent")).put(value.getInt("sequenceNo")).put(value.getString("sourceType")));}
                    String text=complete.toString();if(comparison==null)comparison=text;else assertEquals(comparison,text);
                    assertEquals("https://log.weizaima.com/?key=ordered-9",records.getJSONObject(old.length()+1).getString("link"));assertEquals("https://log.weizaima.com/?key=ordered-20",records.getJSONObject(old.length()+2).getString("link"));
                }
            }finally{context.deleteDatabase(name);remove(root);}
        }
    }
    @Test public void residentCandidateRejectsDuplicateCoordinatesInvalidTailAndWarningType()throws Exception {
        String name="public-resident-rejection-"+UUID.randomUUID()+".sqlite";File root=new File(context.getCacheDir(),"public-resident-rejection-"+UUID.randomUUID());assertTrue(root.mkdir());
        try(LogbookDatabase db=new LogbookDatabase(context,name,true,()->FREE)) {
            JSONObject original=fixture();db.replace(original.toString(),0);String before=db.snapshot();
            for(int scenario=0;scenario<5;scenario++)try(TableSession stage=new TableSession(root,"public",1,scenario==4?"character-table":"record-table","public.csv",()->FREE)) {
                stage.capture(new ByteArrayInputStream("public".getBytes(StandardCharsets.UTF_8)));
                String candidate=coordinateFrame(3,7,row("重复坐标公开","第一场","","完整正文"));
                if(scenario==0)candidate+=coordinateFrame(0,0,row("重复坐标公开","中间场","","正文"))+coordinateFrame(3,7,row("重复坐标公开","重复坐标","","正文"));
                if(scenario==1)candidate+="T{\"sheetOrder\":0,\"rowOrder\":0,\"value\":{},}\n";
                if(scenario==2)candidate=candidate.substring(0,candidate.length()-1);
                if(scenario==3)candidate+=coordinateFrame(-1,0,row("重复坐标公开","错误坐标","","正文"));
                if(scenario==4){JSONObject card=new JSONObject(original.getJSONArray("characters").getJSONObject(0).toString());card.put("id","public-resident-warning-type");candidate="C"+new JSONObject().put("sheetOrder",0).put("rowOrder",0).put("value",card).put("warnings",new JSONArray().put(7))+"\n";}
                try{stage.preview(db,send(stage,candidate),original.getJSONObject("settings"));fail("accepted invalid resident candidate "+scenario);}catch(Exception expected){if(scenario==0)assertTrue(expected.getMessage().contains("坐标重复"));if(scenario==4)assertTrue(expected.getMessage().contains("提醒类型"));}
                assertEquals(before,db.snapshot());assertEquals(1,db.revision());
            }
        }finally{context.deleteDatabase(name);remove(root);}
    }
    @Test public void retainedRawBodyStillCountsAgainstManualUpdateCapacity()throws Exception {
        String name="public-retained-raw-capacity-"+UUID.randomUUID()+".sqlite";File root=new File(context.getCacheDir(),"public-retained-raw-capacity-"+UUID.randomUUID());assertTrue(root.mkdir());
        try(LogbookDatabase db=new LogbookDatabase(context,name,true,()->FREE)) {
            JSONObject original=fixture(),record=original.getJSONArray("records").getJSONObject(0);
            record.put("sourceType","manual").put("status","manual").put("manualContent","原手动正文");
            JSONObject raw=record.getJSONObject("rawContent");raw.getJSONArray("messages").getJSONObject(0).put("text",String.join("",Collections.nCopies(2*1024*1024,"X"))+"完整原缓存😀");
            db.replace(original.toString(),0);String before=db.snapshot(),rawBefore=raw.toString();String moduleName=null;
            JSONArray modules=original.getJSONArray("modules");for(int i=0;i<modules.length();i++)if(modules.getJSONObject(i).getString("id").equals(record.getString("moduleId")))moduleName=modules.getJSONObject(i).getString("name");assertNotNull(moduleName);
            String manual="更新的完整手动正文😀\r\n\u0000尾",candidate=coordinateFrame(0,0,row(moduleName,record.getString("name"),"",manual));
            for(boolean lowSpace:new boolean[]{true,false}) {
                long[] available={FREE};try(TableSession stage=new TableSession(root,"public",1,"record-table","public.csv",()->available[0])) {
                    stage.capture(new ByteArrayInputStream("public".getBytes(StandardCharsets.UTF_8)));BackupSession.Proof proof=send(stage,candidate);
                    if(lowSpace){available[0]=StorageBudget.MINIMUM_RESERVE+6L*1024*1024;try{stage.preview(db,proof,original.getJSONObject("settings"));fail("ignored retained raw body in combined capacity");}catch(IOException expected){}finally{available[0]=FREE;}assertEquals(before,db.snapshot());assertEquals(1,db.revision());}
                    else{JSONObject preview=stage.preview(db,proof,original.getJSONObject("settings"));assertEquals(0,preview.getInt("added"));assertEquals(1,preview.getInt("updated"));stage.prepareCommit();assertEquals(2,db.edit(1,stage::apply));JSONObject saved=new JSONObject(db.snapshot()).getJSONArray("records").getJSONObject(0);assertEquals(manual,saved.getString("manualContent"));assertEquals(rawBefore,saved.getJSONObject("rawContent").toString());}
                }
            }
        }finally{context.deleteDatabase(name);remove(root);}
    }
    @Test public void finalModuleCountFlushFailureRollsBackEntirePreview()throws Exception {
        String name="public-count-flush-failure-"+UUID.randomUUID()+".sqlite";File root=new File(context.getCacheDir(),"public-count-flush-failure-"+UUID.randomUUID());assertTrue(root.mkdir());
        try(LogbookDatabase db=new LogbookDatabase(context,name,true,()->FREE)) {
            JSONObject original=fixture();db.replace(original.toString(),0);String before=db.snapshot();
            try(TableSession stage=new TableSession(root,"public",1,"record-table","public.csv",()->FREE)) {
                File path=new File(stage.directory,"stage.sqlite");
                try(SQLiteDatabase privateIndex=SQLiteDatabase.openDatabase(path.getPath(),null,SQLiteDatabase.OPEN_READWRITE)){privateIndex.execSQL("CREATE TRIGGER public_final_count_failure BEFORE UPDATE OF count ON modules WHEN NEW.name='公开延迟计数' AND NEW.count=115 BEGIN SELECT RAISE(ABORT,'public final module count flush'); END");}
                stage.capture(new ByteArrayInputStream("public".getBytes(StandardCharsets.UTF_8)));StringBuilder candidate=new StringBuilder();for(int i=0;i<115;i++)frame(candidate,i,row("公开延迟计数","场"+i,"https://log.weizaima.com/?key=count-flush-"+i,null));
                try{stage.preview(db,send(stage,candidate.toString()),original.getJSONObject("settings"));fail("accepted failed final count flush");}catch(android.database.SQLException expected){assertTrue(expected.getMessage().contains("public final module count flush"));}
                try(SQLiteDatabase privateIndex=SQLiteDatabase.openDatabase(path.getPath(),null,SQLiteDatabase.OPEN_READONLY);android.database.Cursor rows=privateIndex.rawQuery("SELECT COUNT(*) FROM records",null)){assertTrue(rows.moveToFirst());assertEquals(0,rows.getInt(0));}
                assertEquals(before,db.snapshot());assertEquals(1,db.revision());
            }
        }finally{context.deleteDatabase(name);remove(root);}
    }
}
