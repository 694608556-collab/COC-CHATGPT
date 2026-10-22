package coc.logbook;

import android.content.Context;
import android.database.Cursor;
import android.util.Base64;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/** Generated public tables only. Every database/cache directory is uniquely test-owned. */
@RunWith(AndroidJUnit4.class)
public final class TableStreamTest {
    private final Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
    private static final long FREE=32L*1024*1024*1024;
    private JSONObject fixture()throws Exception{
        try(InputStream input=InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("public-capacity.json")){
            ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] bytes=new byte[65536];int n;while((n=input.read(bytes))!=-1)out.write(bytes,0,n);return new JSONObject(out.toString("UTF-8"));
        }
    }
    private static String hex(byte[] bytes){StringBuilder result=new StringBuilder();for(byte value:bytes)result.append(String.format("%02x",value&255));return result.toString();}
    private static JSONObject row(String module,String name,String link,String body)throws Exception{
        JSONObject value=new JSONObject().put("sheet","公开表").put("moduleName",module).put("sessionName",name).put("link",link).put("kps",new JSONArray().put("公开KP")).put("pairs",new JSONArray().put(new JSONObject().put("pc","公开PC").put("pl","公开PL")));
        if(body!=null)value.put("manualContent",body);return value;
    }
    private static final class Send {
        final TableSession owner;final String key;final MessageDigest digest;long index,bytes;
        Send(TableSession owner,String key)throws Exception{this.owner=owner;this.key=key;digest=MessageDigest.getInstance("SHA-256");}
        void text(String value)throws Exception{byte[] encoded=value.getBytes(StandardCharsets.UTF_8);digest.update(encoded);bytes+=encoded.length;for(int at=0;at<encoded.length;at+=LogbookLimits.TRANSFER_CHUNK_BYTES)owner.append(key,index++,Arrays.copyOfRange(encoded,at,Math.min(encoded.length,at+LogbookLimits.TRANSFER_CHUNK_BYTES)));}
        void record(long sheet,long row,JSONObject value)throws Exception{text("T"+new JSONObject().put("sheetOrder",sheet).put("rowOrder",row).put("value",value)+"\n");}
        BackupSession.Proof proof(){return new BackupSession.Proof(bytes,hex(digest.digest()));}
    }
    private TableSession session(File root,LogbookDatabase db)throws Exception{
        TableSession value=new TableSession(root,"public",db.revision(),"record-table","public.csv",()->FREE);value.capture(new ByteArrayInputStream("模组名,场次名\n公开,公开\n".getBytes(StandardCharsets.UTF_8)));return value;
    }
    private String bodyHash(LogbookDatabase db,String id)throws Exception{
        MessageDigest hash=MessageDigest.getInstance("SHA-256");try(Cursor rows=db.getReadableDatabase().rawQuery("SELECT b.kind,b.data FROM indexed_bodies b JOIN indexed_records r ON b.record_key=r.row_key WHERE r.id=? ORDER BY b.kind,b.position",new String[]{id})){while(rows.moveToNext()){hash.update(rows.getString(0).getBytes(StandardCharsets.UTF_8));hash.update(rows.getString(1).getBytes(StandardCharsets.UTF_8));}}return hex(hash.digest());
    }
    private static void remove(File root)throws Exception{
        if(!root.exists())return;for(File child:Objects.requireNonNull(root.listFiles())){if(child.isDirectory())remove(child);else assertTrue(child.delete());}assertTrue(root.delete());
    }
    @Test public void largeSourceAndCandidateCommitWithoutOldBodyWrites()throws Exception{
        String name="public-table-large-"+UUID.randomUUID()+".sqlite";File root=new File(context.getCacheDir(),"public-table-"+UUID.randomUUID());assertTrue(root.mkdir());
        try(LogbookDatabase db=new LogbookDatabase(context,name,true,()->FREE)){
            JSONObject initial=fixture();db.replace(initial.toString(),0);JSONObject old=initial.getJSONArray("records").getJSONObject(0);String oldHash=bodyHash(db,old.getString("id"));
            db.getWritableDatabase().execSQL("CREATE TRIGGER old_body_delete BEFORE DELETE ON indexed_bodies WHEN OLD.record_key IN (SELECT row_key FROM indexed_records WHERE id="+JSONObject.quote(old.getString("id"))+ ") BEGIN SELECT RAISE(ABORT,'old body rewrite'); END");
            try(TableSession stage=new TableSession(root,"public",1,"record-table","large.csv",()->FREE)){
                final long total=65L*1024*1024;stage.capture(new InputStream(){long remaining=total;public int read(){if(remaining==0)return -1;remaining--;return 65;}public int read(byte[] b,int o,int n){if(remaining==0)return -1;int count=(int)Math.min(n,remaining);Arrays.fill(b,o,o+count,(byte)65);remaining-=count;return count;}});
                assertEquals(total,stage.sourceProof().bytes);Send candidate=new Send(stage,"candidate");String body="公开完整正文😀\u0000\r\n"+String.join("",Collections.nCopies(1024*1024,"A"));
                for(int i=0;i<66;i++)candidate.record(0,i,row("公开大表","场次"+i,"",body));
                assertTrue(candidate.bytes>64L*1024*1024);JSONObject preview=stage.preview(db,candidate.proof(),initial.getJSONObject("settings"));assertEquals(66,preview.getInt("added"));assertEquals(1,db.revision());
                stage.prepareCommit();assertFalse(stage.directory.exists());assertEquals(2,db.edit(1,stage::apply));assertEquals(oldHash,bodyHash(db,old.getString("id")));assertTrue(db.logicalBytes()>66L*1024*1024);
                try(Cursor rows=db.getReadableDatabase().rawQuery("SELECT id FROM indexed_records ORDER BY ordinal DESC LIMIT 1",null)){assertTrue(rows.moveToFirst());Set<String> selected=Collections.singleton(rows.getString(0));StringWriter output=new StringWriter();db.writeSnapshot(output,selected);JSONObject saved=new JSONObject(output.toString()).getJSONArray("records").getJSONObject(0);assertEquals("场次65",saved.getString("name"));assertEquals(body,saved.getString("manualContent"));}
            }
            System.out.println("PUBLIC_ANDROID_TABLE_STREAM sourceMiB=65 candidateMiB>64 records=66 fullBody=true oldBodiesUntouched=true nativeSQLite=true physicalPhone=false");
        }finally{context.deleteDatabase(name);remove(root);}
    }
    @Test public void orderingManualCoalescingPagesAndUtf8Strings()throws Exception{
        String name="public-table-order-"+UUID.randomUUID()+".sqlite";File root=new File(context.getCacheDir(),"public-table-"+UUID.randomUUID());assertTrue(root.mkdir());
        try(LogbookDatabase db=new LogbookDatabase(context,name,true,()->FREE)){
            JSONObject initial=fixture();
            try(TableSession stage=session(root,db)){
                Send strings=new Send(stage,"strings");String value=String.join("",Collections.nCopies(100000,"中😀"));strings.text(new JSONArray().put(0).put(value)+"\n");ByteArrayOutputStream output=new ByteArrayOutputStream();boolean done=false;while(!done){JSONObject part=stage.string(0,output.size());output.write(Base64.decode(part.getString("base64"),Base64.DEFAULT));done=part.getBoolean("done");assertEquals(value.getBytes(StandardCharsets.UTF_8).length,part.getLong("bytes"));}assertEquals(value,output.toString("UTF-8"));
                Send candidate=new Send(stage,"candidate");candidate.record(1,0,row("公开","同名","","最终正文"));JSONObject first=row("公开","同名","","最初正文");first.put("playDate","2026/10/22（公开）");first.put("kps",new JSONArray().put("\u3000公开KP\u00a0").put("\u0000保留\u0000"));candidate.record(0,0,first);
                candidate.record(0,1,row("公开","在线","https://log.weizaima.com/?key=public",null));candidate.record(1,1,row("公开","重复","https://log.weizaima.com/?key=public",null));
                for(int i=0;i<110;i++)candidate.record(2,i,row("公开","分页"+i,"",null));
                JSONObject preview=stage.preview(db,candidate.proof(),initial.getJSONObject("settings"));assertEquals(112,preview.getInt("added"));assertEquals(1,preview.getInt("updated"));assertEquals(1,preview.getInt("skipped"));assertEquals(100,preview.getJSONArray("names").length());assertEquals(13,stage.page("names",100,999).getJSONArray("values").length());
                stage.prepareCommit();assertEquals(1,db.edit(0,stage::apply));JSONObject saved=new JSONObject(db.snapshot());BackupValidation.metadata(new JSONObject(JsonFields.join(db.fields())));JSONArray records=saved.getJSONArray("records");assertEquals("最终正文",records.getJSONObject(0).getString("manualContent"));assertEquals("2026/10/22（公开）",records.getJSONObject(0).getString("playDate"));assertEquals("\u0000保留\u0000",saved.getJSONArray("modules").getJSONObject(0).getJSONArray("kps").getString(1));assertEquals("在线",records.getJSONObject(1).getString("name"));assertEquals(112,records.length());
            }
        }finally{context.deleteDatabase(name);remove(root);}
    }
    @Test public void rollbackStaleProofMalformedRowsAndCancellation()throws Exception{
        String name="public-table-fail-"+UUID.randomUUID()+".sqlite";File root=new File(context.getCacheDir(),"public-table-"+UUID.randomUUID());assertTrue(root.mkdir());
        try(LogbookDatabase db=new LogbookDatabase(context,name,true,()->FREE)){
            JSONObject initial=fixture();db.replace(initial.toString(),0);String before=db.snapshot();
            try(TableSession stage=session(root,db)){
                Send sender=new Send(stage,"candidate");sender.record(0,0,row("公开","回滚","","正文"));stage.preview(db,sender.proof(),initial.getJSONObject("settings"));stage.prepareCommit();
                db.getWritableDatabase().execSQL("CREATE TRIGGER table_reject BEFORE UPDATE ON app_state BEGIN SELECT RAISE(ABORT,'public rollback'); END");
                try{db.edit(1,stage::apply);fail("accepted failed transaction");}catch(android.database.SQLException expected){}db.getWritableDatabase().execSQL("DROP TRIGGER table_reject");assertEquals(before,db.snapshot());assertEquals(1,db.revision());
                final boolean[] applied={false};try{db.edit(1,store->{stage.apply(store);applied[0]=true;throw new SecurityException("public permission revoked after apply");});fail("accepted revoked permission after writes");}catch(SecurityException expected){}assertTrue(applied[0]);assertEquals(before,db.snapshot());assertEquals(1,db.revision());
            }
            try(TableSession stage=session(root,db)){
                Send sender=new Send(stage,"candidate");sender.record(0,0,row("公开","过期","","正文"));stage.preview(db,sender.proof(),initial.getJSONObject("settings"));db.edit(1,store->{});stage.prepareCommit();try{db.edit(1,stage::apply);fail("accepted stale CAS");}catch(IllegalStateException expected){}assertEquals(before,db.snapshot());
            }
            for(int scenario=0;scenario<4;scenario++)try(TableSession stage=session(root,db)){
                Send sender=new Send(stage,"candidate");JSONObject value=row("公开","无效","",null);if(scenario==0)value.put("link","https://example.com/?key=no");sender.record(0,0,value);if(scenario==1)sender.record(0,0,value);BackupSession.Proof proof=sender.proof();if(scenario==2)proof=new BackupSession.Proof(proof.bytes,String.join("",Collections.nCopies(64,"0")));if(scenario==3)stage.append("strings",0,new byte[]{'[','0',',','"',(byte)0xc3,10});
                try{stage.preview(db,proof,initial.getJSONObject("settings"));fail("accepted invalid scenario "+scenario);}catch(Exception expected){}assertEquals(before,db.snapshot());
            }catch(java.nio.charset.CharacterCodingException expected){assertEquals(before,db.snapshot());}
            try(TableSession stage=session(root,db)){
                Send sender=new Send(stage,"candidate");sender.record(0,0,row("公开","篡改","","正文"));stage.preview(db,sender.proof(),initial.getJSONObject("settings"));
                try(android.database.sqlite.SQLiteDatabase changed=android.database.sqlite.SQLiteDatabase.openDatabase(new File(stage.directory,"stage.sqlite").getPath(),null,android.database.sqlite.SQLiteDatabase.OPEN_READWRITE)){changed.execSQL("UPDATE preview SET value='tampered'");}
                try{stage.prepareCommit();fail("accepted changed preview database");}catch(IOException expected){}assertEquals(before,db.snapshot());
            }
            try(TableSession stage=session(root,db)){
                Send sender=new Send(stage,"candidate");sender.record(0,0,row("公开","所有权","","正文"));stage.preview(db,sender.proof(),initial.getJSONObject("settings"));File marker=new File(stage.directory,"owner");assertTrue(marker.delete());
                try{stage.prepareCommit();fail("accepted missing owner marker");}catch(IOException expected){}assertTrue(stage.directory.exists());assertEquals(before,db.snapshot());
                try(FileOutputStream output=new FileOutputStream(marker)){output.write(stage.id.getBytes(StandardCharsets.UTF_8));output.getFD().sync();}
            }
            TableSession cancel=session(root,db);File owned=cancel.directory;new Send(cancel,"candidate").record(0,0,row("公开","取消","","正文"));cancel.close();assertFalse(owned.exists());assertEquals(before,db.snapshot());assertEquals(0,Objects.requireNonNull(root.listFiles()).length);
        }finally{context.deleteDatabase(name);remove(root);}
    }
    @Test public void moreThan50000RowsAndLowSpaceRollback()throws Exception{
        String name="public-table-count-"+UUID.randomUUID()+".sqlite";File root=new File(context.getCacheDir(),"public-table-"+UUID.randomUUID());assertTrue(root.mkdir());long[] free={FREE};
        try(LogbookDatabase db=new LogbookDatabase(context,name,true,()->free[0])){
            JSONObject defaults=fixture().getJSONObject("settings");
            try(TableSession stage=session(root,db)){
                Send sender=new Send(stage,"candidate");for(int i=0;i<50001;i++)sender.record(0,i,row("公开数量","场"+i,"https://log.weizaima.com/?key=public-"+i,null));
                JSONObject preview=stage.preview(db,sender.proof(),defaults);assertEquals(50001,preview.getLong("added"));assertEquals(1,stage.page("names",50000,100).getJSONArray("values").length());stage.prepareCommit();assertEquals(1,db.edit(0,stage::apply));assertEquals(50001,db.recordCount());
            }
            try(TableSession stage=session(root,db)){
                Send sender=new Send(stage,"candidate");sender.record(0,0,row("公开数量","低空间","","未保存"));stage.preview(db,sender.proof(),defaults);stage.prepareCommit();free[0]=StorageBudget.MINIMUM_RESERVE;
                try{db.edit(1,stage::apply);fail("accepted low-space commit");}catch(IOException expected){}finally{free[0]=FREE;}assertEquals(1,db.revision());assertEquals(50001,db.recordCount());
            }
            System.out.println("PUBLIC_ANDROID_TABLE_STREAM rows=50001 countCapRemoved=true lowSpaceRollback=true nativeSQLite=true physicalPhone=false");
        }finally{context.deleteDatabase(name);remove(root);}
    }
    @Test public void characterWarningsAndAssociationValidation()throws Exception{
        String name="public-table-character-"+UUID.randomUUID()+".sqlite";File root=new File(context.getCacheDir(),"public-table-"+UUID.randomUUID());assertTrue(root.mkdir());
        try(LogbookDatabase db=new LogbookDatabase(context,name,true,()->FREE)){
            JSONObject initial=fixture();db.replace(initial.toString(),0);JSONObject card=new JSONObject(initial.getJSONArray("characters").getJSONObject(0).toString());card.put("id","public-added-character");card.put("moduleIds",new JSONArray().put(initial.getJSONArray("modules").getJSONObject(0).getString("id")));
            try(TableSession stage=new TableSession(root,"public",1,"character-table","public.csv",()->FREE)){
                stage.capture(new ByteArrayInputStream("public".getBytes(StandardCharsets.UTF_8)));Send sender=new Send(stage,"candidate");sender.text("C"+new JSONObject().put("sheetOrder",0).put("rowOrder",0).put("value",card).put("warnings",new JSONArray().put("公开识别提醒"))+"\n");JSONObject preview=stage.preview(db,sender.proof(),initial.getJSONObject("settings"));assertEquals(1,preview.getInt("added"));assertEquals("公开识别提醒",preview.getJSONArray("warnings").getString(0));stage.prepareCommit();db.edit(1,stage::apply);assertEquals(2,new JSONArray(db.fields().get("characters")).length());
            }
            try(TableSession stage=new TableSession(root,"public",2,"character-table","public.csv",()->FREE)){
                stage.capture(new ByteArrayInputStream("public".getBytes(StandardCharsets.UTF_8)));card.put("id","public-invalid-character");card.put("moduleIds",new JSONArray().put("missing-public-module"));Send sender=new Send(stage,"candidate");sender.text("C"+new JSONObject().put("sheetOrder",0).put("rowOrder",0).put("value",card)+"\n");try{stage.preview(db,sender.proof(),initial.getJSONObject("settings"));fail("accepted invalid character association");}catch(IllegalArgumentException expected){}assertEquals(2,db.revision());
            }
        }finally{context.deleteDatabase(name);remove(root);}
    }
}
