package coc.logbook;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Public data in isolated owners only. Preparation and serial import must
 * produce the same complete content and retain all failure boundaries. */
@RunWith(AndroidJUnit4.class)
public final class TablePreparedSeedTest {
    private static final long FREE=32L*1024*1024*1024;
    private final Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
    private JSONObject fixture()throws Exception{
        JSONObject value;try(InputStream input=InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("public-capacity.json")){
            ByteArrayOutputStream output=new ByteArrayOutputStream();byte[] buffer=new byte[65536];int n;while((n=input.read(buffer))!=-1)output.write(buffer,0,n);value=new JSONObject(output.toString("UTF-8"));
        }
        JSONArray records=value.getJSONArray("records");value.put("records",new JSONArray().put(records.getJSONObject(0)).put(records.getJSONObject(1)));return value;
    }
    private static JSONObject row(String module,String name,String link,String body)throws Exception{
        JSONObject value=new JSONObject().put("sheet","公开预备表").put("moduleName",module).put("sessionName",name).put("link",link).put("kps",new JSONArray().put("预备公开KP")).put("pairs",new JSONArray());if(body!=null)value.put("manualContent",body);return value;
    }
    private static String candidate(JSONObject original)throws Exception{
        String module=original.getJSONArray("modules").getJSONObject(0).getString("name"),link="https://log.weizaima.com/?key=public-prepared-seed";
        String body=String.join("",Collections.nCopies(40000,"完整公开😀"))+"\r\n\u0000末尾";
        JSONObject[] rows={row(module,"预备公开在线",link,null),row(module,"预备公开手动","","初始完整正文"),row(module,"重复公开来源",link,null),row(module,"预备公开手动","",body)};
        rows[2].put("kps",new JSONArray().put("重复来源后到KP"));StringBuilder out=new StringBuilder();
        for(int i=0;i<rows.length;i++)out.append('T').append(new JSONObject().put("sheetOrder",0).put("rowOrder",i).put("value",rows[i])).append('\n');return out.toString();
    }
    private static BackupSession.Proof send(TableSession stage,String text)throws Exception{
        byte[] bytes=text.getBytes(StandardCharsets.UTF_8);long index=0;for(int at=0;at<bytes.length;at+=LogbookLimits.TRANSFER_CHUNK_BYTES)stage.append("candidate",index++,Arrays.copyOfRange(bytes,at,Math.min(bytes.length,at+LogbookLimits.TRANSFER_CHUNK_BYTES)));
        StringBuilder hash=new StringBuilder();for(byte value:MessageDigest.getInstance("SHA-256").digest(bytes))hash.append(String.format(Locale.ROOT,"%02x",value&255));return new BackupSession.Proof(bytes.length,hash.toString());
    }
    private static void capture(TableSession stage)throws Exception{stage.capture(new ByteArrayInputStream("模组名,场次名\n公开,预备流水线\n".getBytes(StandardCharsets.UTF_8)));}
    private static void remove(File root)throws Exception{if(!root.exists())return;for(File file:Objects.requireNonNull(root.listFiles())){if(file.isDirectory())remove(file);else assertTrue(file.delete());}assertTrue(root.delete());}
    private static long stagedRows(TableSession stage)throws Exception{
        try(SQLiteDatabase db=SQLiteDatabase.openDatabase(new File(stage.directory,"stage.sqlite").getPath(),null,SQLiteDatabase.OPEN_READONLY);Cursor row=db.rawQuery("SELECT (SELECT COUNT(*) FROM modules)+(SELECT COUNT(*) FROM characters)+(SELECT COUNT(*) FROM records)",null)){assertTrue(row.moveToFirst());return row.getLong(0);}
    }
    private static void assertSticky(TableSession stage,LogbookDatabase db,JSONObject original)throws Exception{
        try{stage.require(stage.id);fail("preparation failure must remain sticky");}catch(IOException expected){}
        try{stage.append("candidate",0,new byte[]{65,10});fail("append must not retry a failed preparation");}catch(IOException expected){}
        try{stage.preview(db,new BackupSession.Proof(0,""),original.getJSONObject("settings"));fail("finish must not retry a failed preparation");}catch(IOException expected){}
        try{stage.prepareSeed(db,original.getJSONObject("settings"),()->fail("failed owner must not be authorized again"),false);fail("failed seed must not retry");}catch(IOException expected){}
    }
    private static JSONObject comparable(JSONObject saved,int oldRecords)throws Exception{
        JSONObject copy=new JSONObject(saved.toString());copy.remove("exportedAt");JSONArray records=copy.getJSONArray("records");
        for(int i=oldRecords;i<records.length();i++){JSONObject row=records.getJSONObject(i);row.remove("id");row.remove("createdAt");row.remove("updatedAt");}return copy;
    }

    @Test public void serialAndPreparedPreviewAndCommitKeepTheSameCompleteContent()throws Exception{
        String name="public-seed-equivalence-"+UUID.randomUUID()+".sqlite";File root=new File(context.getCacheDir(),"public-seed-equivalence-"+UUID.randomUUID());assertTrue(root.mkdir());
        try(LogbookDatabase db=new LogbookDatabase(context,name,true,()->FREE)){
            JSONObject original=fixture(),serial=null,serialPreview=null;String input=candidate(original);int oldCount=original.getJSONArray("records").length();
            for(boolean prepared:new boolean[]{false,true}){
                db.replace(original.toString(),db.revision());String before=db.snapshot();long revision=db.revision();
                try(TableSession stage=new TableSession(root,"public",revision,"record-table","public.csv",()->FREE,prepared)){
                    if(prepared)assertFalse(new File(stage.directory,"stage.sqlite").exists());capture(stage);
                    int[] authorizations={0};if(prepared){stage.prepareSeed(db,original.getJSONObject("settings"),()->{authorizations[0]++;assertEquals(revision,db.revision());},true);assertEquals(2,authorizations[0]);assertEquals(before,db.snapshot());assertEquals(original.getJSONArray("modules").length()+original.getJSONArray("characters").length()+oldCount,stagedRows(stage));try{stage.page("names",0,100);fail("prepared seed must not expose an incomplete preview");}catch(IOException expected){}}
                    JSONObject preview=stage.preview(db,send(stage,input),original.getJSONObject("settings"),true);assertEquals(prepared,preview.getJSONObject("timing").getBoolean("preparedSeed"));assertEquals(2,preview.getInt("added"));assertEquals(1,preview.getInt("updated"));assertEquals(1,preview.getInt("skipped"));assertEquals(before,db.snapshot());
                    preview.remove("id");preview.remove("revision");preview.remove("timing");if(serialPreview==null)serialPreview=preview;else assertTrue("Complete preview equality",BackupValidation.same(serialPreview,preview));
                    stage.prepareCommit();db.edit(revision,stage::apply);JSONObject saved=new JSONObject(db.snapshot());
                    for(int i=0;i<oldCount;i++)assertTrue("Unchanged complete old record "+i,BackupValidation.same(new JSONObject(before).getJSONArray("records").getJSONObject(i),saved.getJSONArray("records").getJSONObject(i)));
                    String body=saved.getJSONArray("records").getJSONObject(oldCount+1).getString("manualContent");assertEquals(String.join("",Collections.nCopies(40000,"完整公开😀"))+"\r\n\u0000末尾",body);
                    JSONObject normalized=comparable(saved,oldCount);if(serial==null)serial=normalized;else assertTrue("Complete serial/prepared content equality",BackupValidation.same(serial,normalized));
                }
            }
        }finally{context.deleteDatabase(name);remove(root);}
    }

    @Test public void preparedSeedStillRejectsChangedRevisionSourceAndMalformedCandidate()throws Exception{
        String name="public-seed-proof-"+UUID.randomUUID()+".sqlite";File root=new File(context.getCacheDir(),"public-seed-proof-"+UUID.randomUUID());assertTrue(root.mkdir());
        try(LogbookDatabase db=new LogbookDatabase(context,name,true,()->FREE)){
            JSONObject original=fixture();
            for(int scenario=0;scenario<3;scenario++){
                db.replace(original.toString(),db.revision());long revision=db.revision();String before=db.snapshot();
                try(TableSession stage=new TableSession(root,"public",revision,"record-table","public.csv",()->FREE,true)){
                    capture(stage);stage.prepareSeed(db,original.getJSONObject("settings"),()->{},false);
                    BackupSession.Proof proof=send(stage,scenario==2?"T{\"sheetOrder\":0,\"rowOrder\":0,\"value\":{}}\n":candidate(original));
                    if(scenario==0)db.edit(revision,store->{});
                    if(scenario==1)try(RandomAccessFile changed=new RandomAccessFile(stage.source,"rw")){changed.seek(0);changed.write(65);}
                    try{stage.preview(db,proof,original.getJSONObject("settings"));fail("prepared seed bypassed a complete check "+scenario);}catch(IOException|IllegalArgumentException|JSONException expected){}
                    assertEquals(before,db.snapshot());assertEquals(revision+(scenario==0?1:0),db.revision());
                    try{stage.prepareCommit();fail("failed preview must not become committable");}catch(IOException expected){}
                }
            }
        }finally{context.deleteDatabase(name);remove(root);}
    }

    @Test public void capacityFailureInsideSeedRollsBackAndCannotBeRetriedOnTheOwner()throws Exception{
        String name="public-seed-space-"+UUID.randomUUID()+".sqlite";File root=new File(context.getCacheDir(),"public-seed-space-"+UUID.randomUUID());assertTrue(root.mkdir());
        try(LogbookDatabase db=new LogbookDatabase(context,name,true,()->FREE)){
            JSONObject original=fixture();db.replace(original.toString(),0);String before=db.snapshot();boolean[] failDuringSeed={false},sawStagedRecord={false};TableSession[] current={null};Field stageField=TableSession.class.getDeclaredField("stage");stageField.setAccessible(true);
            StorageBudget.Available available=()->{
                if(failDuringSeed[0]&&current[0]!=null){SQLiteDatabase index=(SQLiteDatabase)stageField.get(current[0]);if(index!=null)try(Cursor records=index.rawQuery("SELECT COUNT(*) FROM records",null)){if(records.moveToFirst()&&records.getLong(0)>0){sawStagedRecord[0]=true;return StorageBudget.MINIMUM_RESERVE;}}}return FREE;
            };
            try(TableSession stage=new TableSession(root,"public",1,"record-table","public.csv",available,true)){
                current[0]=stage;capture(stage);failDuringSeed[0]=true;
                try{stage.prepareSeed(db,original.getJSONObject("settings"),()->{},false);fail("accepted exhausted volume during seed");}catch(IOException expected){}
                failDuringSeed[0]=false;assertTrue("Failure must happen after an actual old record was staged",sawStagedRecord[0]);assertEquals(0,stagedRows(stage));assertEquals(before,db.snapshot());assertEquals(1,db.revision());assertSticky(stage,db,original);
            }
            try(TableSession stage=new TableSession(root,"public",1,"record-table","public.csv",()->FREE,true)){
                capture(stage);stage.prepareSeed(db,original.getJSONObject("settings"),()->{},false);assertEquals(2,stage.preview(db,send(stage,candidate(original)),original.getJSONObject("settings")).getInt("added"));stage.prepareCommit();assertEquals(2,db.edit(1,stage::apply));
            }
        }finally{context.deleteDatabase(name);remove(root);}
    }

    @Test public void authorizationAndRevisionChangesDuringPreparationAreStickyAndCancellationClosesTheOwner()throws Exception{
        String name="public-seed-authority-"+UUID.randomUUID()+".sqlite";File root=new File(context.getCacheDir(),"public-seed-authority-"+UUID.randomUUID());assertTrue(root.mkdir());
        try(LogbookDatabase db=new LogbookDatabase(context,name,true,()->FREE)){
            JSONObject original=fixture();
            for(int scenario=0;scenario<3;scenario++){
                db.replace(original.toString(),db.revision());long revision=db.revision();String before=db.snapshot();int mode=scenario;int[] calls={0};
                try(TableSession stage=new TableSession(root,"public",revision,"record-table","public.csv",()->FREE,true)){
                    capture(stage);
                    try{stage.prepareSeed(db,original.getJSONObject("settings"),()->{calls[0]++;if(mode==0&&calls[0]==1||mode==1&&calls[0]==2)throw new IOException("public revoked authorization");if(mode==2&&calls[0]==2)db.edit(revision,store->{});},false);fail("accepted changed preparation authority");}catch(IOException expected){}
                    if(new File(stage.directory,"stage.sqlite").exists())assertEquals(0,stagedRows(stage));assertEquals(before,db.snapshot());assertEquals(revision+(mode==2?1:0),db.revision());assertSticky(stage,db,original);
                }
            }
            String before=db.snapshot();TableSession cancelled=new TableSession(root,"public",db.revision(),"record-table","public.csv",()->FREE,true);capture(cancelled);cancelled.prepareSeed(db,original.getJSONObject("settings"),()->{},false);File owned=cancelled.directory;cancelled.close();assertFalse(owned.exists());assertEquals(before,db.snapshot());
            try{cancelled.require(cancelled.id);fail("cancelled preparation was reused");}catch(IOException expected){}
        }finally{context.deleteDatabase(name);remove(root);}
    }
}
