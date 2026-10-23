package coc.logbook;

import android.content.Context;
import android.database.Cursor;
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

/** Public isolated databases: complete old metadata and reused SQL bindings. */
@RunWith(AndroidJUnit4.class)
public final class TableSeedMetadataTest {
    private static final long FREE=32L*1024*1024*1024;
    private final Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();

    private JSONObject fixture()throws Exception {
        try(InputStream input=InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("public-capacity.json");ByteArrayOutputStream output=new ByteArrayOutputStream()) {
            byte[] buffer=new byte[65536];int count;while((count=input.read(buffer))!=-1)output.write(buffer,0,count);
            return new JSONObject(output.toString("UTF-8"));
        }
    }
    private static JSONObject row(String module,String name,String link,String manual)throws Exception {
        JSONObject value=new JSONObject().put("sheet","公开表").put("moduleName",module).put("sessionName",name).put("link",link).put("kps",new JSONArray()).put("pairs",new JSONArray());
        if(manual!=null)value.put("manualContent",manual);return value;
    }
    private static BackupSession.Proof send(TableSession owner,JSONObject... rows)throws Exception {
        StringBuilder text=new StringBuilder();for(int i=0;i<rows.length;i++)text.append('T').append(new JSONObject().put("sheetOrder",0).put("rowOrder",i).put("value",rows[i])).append('\n');
        byte[] bytes=text.toString().getBytes(StandardCharsets.UTF_8);long index=0;
        for(int at=0;at<bytes.length;at+=LogbookLimits.TRANSFER_CHUNK_BYTES)owner.append("candidate",index++,Arrays.copyOfRange(bytes,at,Math.min(bytes.length,at+LogbookLimits.TRANSFER_CHUNK_BYTES)));
        return new BackupSession.Proof(bytes.length,hex(MessageDigest.getInstance("SHA-256").digest(bytes)));
    }
    private static String hex(byte[] bytes) {
        StringBuilder value=new StringBuilder();for(byte item:bytes)value.append(String.format(Locale.ROOT,"%02x",item&255));return value.toString();
    }
    private static String rawHash(LogbookDatabase database,String id)throws Exception {
        MessageDigest hash=MessageDigest.getInstance("SHA-256");
        try(Cursor rows=database.getReadableDatabase().rawQuery("SELECT b.data FROM indexed_bodies b JOIN indexed_records r ON b.record_key=r.row_key WHERE r.id=? AND b.kind='rawContent' ORDER BY b.position",new String[]{id})) {
            int count=0;while(rows.moveToNext()){hash.update(rows.getString(0).getBytes(StandardCharsets.UTF_8));count++;}assertTrue(count>0);
        }
        return hex(hash.digest());
    }
    private static JSONObject byID(JSONArray rows,String id)throws Exception {
        for(int i=0;i<rows.length();i++)if(rows.getJSONObject(i).getString("id").equals(id))return rows.getJSONObject(i);
        throw new AssertionError("Missing public test record: "+id);
    }
    private static JSONObject byName(JSONArray rows,String name)throws Exception {
        JSONObject found=null;for(int i=0;i<rows.length();i++)if(rows.getJSONObject(i).getString("name").equals(name)){assertNull("Duplicate public test name",found);found=rows.getJSONObject(i);}
        assertNotNull(found);return found;
    }
    private static void remove(File root)throws Exception {
        if(!root.exists())return;for(File entry:Objects.requireNonNull(root.listFiles())){if(entry.isDirectory())remove(entry);else assertTrue(entry.delete());}assertTrue(root.delete());
    }
    private void completeOldName(boolean missingTail)throws Exception {
        String databaseName="public-seed-name-"+UUID.randomUUID()+".sqlite";
        File root=new File(context.getCacheDir(),"public-seed-name-"+UUID.randomUUID());assertTrue(root.mkdir());
        String prefix=String.join("",Collections.nCopies(40000,"中😀"));
        assertTrue(prefix.getBytes(StandardCharsets.UTF_8).length>LogbookLimits.TRANSFER_CHUNK_BYTES);
        String firstName=prefix+"完整尾甲",secondName=prefix+"完整尾乙",requested=missingTail?prefix+"完整尾丙":secondName;
        String replacement="完整更新😀\r\n\u0000末尾",firstID=null,secondID=null,firstRaw=null,secondRaw=null,expectedSnapshot=null;
        try {
            try(LogbookDatabase database=new LogbookDatabase(context,databaseName,true,()->FREE)) {
                JSONObject initial=fixture();JSONArray records=initial.getJSONArray("records");JSONObject first=records.getJSONObject(0);
                firstID=first.getString("id");first.put("name",firstName).put("sourceType","manual").put("status","manual").put("manualContent","原甲😀\r\n\u0000尾");
                JSONObject second=new JSONObject(first.toString());secondID="public-old-tail-"+UUID.randomUUID();second.put("id",secondID).put("name",secondName).put("manualContent","原乙😀\r\n\u0000尾").put("order",records.length()).put("sequenceNo",records.length()+1);records.put(second);
                String moduleName=null;JSONArray modules=initial.getJSONArray("modules");for(int i=0;i<modules.length();i++)if(modules.getJSONObject(i).getString("id").equals(first.getString("moduleId")))moduleName=modules.getJSONObject(i).getString("name");assertNotNull(moduleName);
                assertEquals(1,database.replace(initial.toString(),0));String before=database.snapshot();JSONArray old=new JSONObject(before).getJSONArray("records");
                firstRaw=rawHash(database,firstID);secondRaw=rawHash(database,secondID);
                try(Cursor sizes=database.getReadableDatabase().rawQuery("SELECT length(CAST(metadata AS BLOB)) FROM indexed_records WHERE id IN (?,?)",new String[]{firstID,secondID})) {
                    int count=0;while(sizes.moveToNext()){assertTrue(sizes.getLong(0)>LogbookLimits.TRANSFER_CHUNK_BYTES);count++;}assertEquals(2,count);
                }
                try(TableSession owner=new TableSession(root,"public",1,"record-table","public.csv",()->FREE)) {
                    owner.capture(new ByteArrayInputStream("public independent source".getBytes(StandardCharsets.UTF_8)));
                    JSONObject preview=owner.preview(database,send(owner,row(moduleName,requested,"",replacement)),initial.getJSONObject("settings"));
                    assertEquals(missingTail?1:0,preview.getInt("added"));assertEquals(missingTail?0:1,preview.getInt("updated"));assertEquals(0,preview.getInt("skipped"));assertEquals(1,preview.getInt("namesCount"));
                    assertEquals(moduleName+" / "+requested,preview.getJSONArray("names").getString(0));assertEquals(before,database.snapshot());
                    owner.prepareCommit();assertEquals(2,database.edit(1,owner::apply));
                    JSONArray saved=new JSONObject(database.snapshot()).getJSONArray("records");assertEquals(old.length()+(missingTail?1:0),saved.length());
                    for(int i=0;i<old.length();i++){JSONObject value=old.getJSONObject(i);if(missingTail||!value.getString("id").equals(secondID))assertEquals(value.toString(),byID(saved,value.getString("id")).toString());}
                    JSONObject changed=byName(saved,requested);assertEquals(replacement,changed.getString("manualContent"));
                    if(missingTail){assertNotEquals(firstID,changed.getString("id"));assertNotEquals(secondID,changed.getString("id"));assertFalse(changed.has("rawContent"));}
                    else{assertEquals(secondID,changed.getString("id"));assertEquals(second.getJSONObject("rawContent").toString(),changed.getJSONObject("rawContent").toString());}
                    assertEquals(firstRaw,rawHash(database,firstID));assertEquals(secondRaw,rawHash(database,secondID));expectedSnapshot=database.snapshot();
                }
                assertEquals(0,Objects.requireNonNull(root.listFiles()).length);
            }
            try(LogbookDatabase reopened=new LogbookDatabase(context,databaseName,true,()->FREE)) {
                assertEquals(2,reopened.revision());assertEquals(expectedSnapshot,reopened.snapshot());assertEquals(firstRaw,rawHash(reopened,firstID));assertEquals(secondRaw,rawHash(reopened,secondID));
                JSONArray saved=new JSONObject(reopened.snapshot()).getJSONArray("records");assertEquals(firstName,byID(saved,firstID).getString("name"));assertEquals(secondName,byID(saved,secondID).getString("name"));assertEquals(replacement,byName(saved,requested).getString("manualContent"));
            }
        }finally{context.deleteDatabase(databaseName);remove(root);}
    }
    @Test public void oldNameBeyondFirstMetadataChunkUpdatesOnlyTheCompleteMatch()throws Exception {completeOldName(false);}
    @Test public void nameSharingTheFirstMetadataChunkButDifferentTailAddsWithoutPrefixCollision()throws Exception {completeOldName(true);}

    @Test public void alternatingManualNullEmptyAndOnlineRowsDoNotReusePreviousBindings()throws Exception {
        String databaseName="public-table-bindings-"+UUID.randomUUID()+".sqlite";
        File root=new File(context.getCacheDir(),"public-table-bindings-"+UUID.randomUUID());assertTrue(root.mkdir());
        String a="绑定公开A",b="绑定公开B",shared="https://log.weizaima.com/?key=public-shared",other="https://log.weizaima.com/?key=public-other";
        String first="首份😀\r\n\u0000完整尾",last="最终😀\r\n\u0000完整尾",bodyB="乙😀\n\u0000\r\n尾",tail="末尾😀\u0000\r\n";
        JSONObject[] candidate={row(a,"绑定手动A","",first),row(b,"绑定在线B",shared,null),row(a,"绑定空A","",""),row(b,"绑定手动B","",bodyB),row(a,"绑定在线A",shared,null),row(b,"绑定空B","",""),row(a,"绑定手动A","",last),row(b,"绑定重复B",shared,null),row(b,"绑定新在线B",other,null),row(a,"绑定末尾A","",tail)};
        String expectedSnapshot=null;JSONArray old=null;
        try {
            try(LogbookDatabase database=new LogbookDatabase(context,databaseName,true,()->FREE)) {
                JSONObject initial=fixture();assertEquals(1,database.replace(initial.toString(),0));String before=database.snapshot();old=new JSONObject(before).getJSONArray("records");
                try(TableSession owner=new TableSession(root,"public",1,"record-table","public.csv",()->FREE)) {
                    owner.capture(new ByteArrayInputStream("public independent source".getBytes(StandardCharsets.UTF_8)));
                    JSONObject preview=owner.preview(database,send(owner,candidate),initial.getJSONObject("settings"));
                    assertEquals(8,preview.getInt("added"));assertEquals(1,preview.getInt("updated"));assertEquals(1,preview.getInt("skipped"));assertEquals(9,preview.getInt("namesCount"));assertEquals(before,database.snapshot());
                    owner.prepareCommit();assertEquals(2,database.edit(1,owner::apply));expectedSnapshot=database.snapshot();
                }
                assertEquals(0,Objects.requireNonNull(root.listFiles()).length);
            }
            try(LogbookDatabase reopened=new LogbookDatabase(context,databaseName,true,()->FREE)) {
                assertEquals(2,reopened.revision());assertEquals(expectedSnapshot,reopened.snapshot());JSONArray saved=new JSONObject(reopened.snapshot()).getJSONArray("records");assertEquals(old.length()+8,saved.length());
                for(int i=0;i<old.length();i++)assertEquals(old.getJSONObject(i).toString(),byID(saved,old.getJSONObject(i).getString("id")).toString());
                String[] names={"绑定手动A","绑定在线B","绑定空A","绑定手动B","绑定在线A","绑定空B","绑定新在线B","绑定末尾A"};
                String[] bodies={last,null,"",bodyB,null,"",null,tail};String[] links={null,shared,null,null,shared,null,other,null};int[] sequences={1,1,2,2,3,3,4,4};
                String moduleA=byName(saved,names[0]).getString("moduleId"),moduleB=byName(saved,names[1]).getString("moduleId");assertNotEquals(moduleA,moduleB);
                for(int i=0;i<names.length;i++) {
                    JSONObject value=byName(saved,names[i]);assertEquals(sequences[i],value.getInt("sequenceNo"));assertEquals(sequences[i]-1,value.getInt("order"));assertEquals(i==0||i==2||i==4||i==7?moduleA:moduleB,value.getString("moduleId"));assertFalse(value.has("rawContent"));
                    assertEquals(links[i]!=null,value.has("link"));if(links[i]!=null)assertEquals(links[i],value.getString("link"));
                    assertEquals(bodies[i]!=null,value.has("manualContent"));if(bodies[i]!=null)assertEquals(bodies[i],value.getString("manualContent"));
                    assertEquals(bodies[i]==null?"online":"manual",value.getString("sourceType"));assertEquals(bodies[i]==null?"pending":"manual",value.getString("status"));
                }
            }
        }finally{context.deleteDatabase(databaseName);remove(root);}
    }
}
