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

/** Public fixtures only. The independent oracle below retains the original
 * complete-list merge, including its order, whitespace and first-wins rules. */
@RunWith(AndroidJUnit4.class)
public final class TableParticipantCacheTest {
    private static final long FREE=32L*1024*1024*1024;
    private final Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
    private static JSONObject pair(String pc,String pl,String character)throws Exception{
        JSONObject value=new JSONObject().put("pc",pc).put("pl",pl);if(character!=null)value.put("characterId",character);return value;
    }
    private static JSONObject module(String id,String name)throws Exception{
        return new JSONObject().put("id",id).put("name",name).put("playStatus","not_started").put("kps",new JSONArray()).put("pairs",new JSONArray()).put("order",0).put("collapsed",false).put("createdAt","2000-01-01T00:00:00Z").put("updatedAt","2000-01-01T00:00:00Z");
    }
    private JSONObject fixture()throws Exception{
        JSONObject value;try(InputStream input=InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("public-capacity.json")){
            ByteArrayOutputStream output=new ByteArrayOutputStream();byte[] buffer=new byte[65536];int n;while((n=input.read(buffer))!=-1)output.write(buffer,0,n);value=new JSONObject(output.toString("UTF-8"));
        }
        JSONObject c1=new JSONObject(value.getJSONArray("characters").getJSONObject(0).toString()),c2=new JSONObject(c1.toString());
        c1.put("id","public-c1").put("moduleIds",new JSONArray());c1.remove("moduleId");c2.put("id","public-c2").put("moduleIds",new JSONArray());c2.remove("moduleId");
        JSONObject a=module("public-a","公开A"),b=module("public-b","公开B");
        a.put("kps",new JSONArray().put("\u3000公开KP\u00a0").put("公开KP").put("").put("\u0000保留\u0000").put("\ufeff"));
        a.put("pairs",new JSONArray().put(pair("","","public-c1")).put(pair("  PC  "," PL ","public-c1")).put(pair("  PC  "," PL ","public-c2")).put(pair("a\u0000b","c","public-c1")).put(pair("a","b\u0000c","public-c2")).put(pair("","PL",null)));
        b.put("kps",new JSONArray().put("B旧KP"));
        value.put("records",new JSONArray()).put("modules",new JSONArray().put(a).put(b)).put("characters",new JSONArray().put(c1).put(c2));return value;
    }
    private static JSONObject row(String module,int source,JSONArray names,JSONArray pairs)throws Exception{
        return new JSONObject().put("sheet","公开表").put("moduleName",module).put("sessionName","公开场"+source).put("link","https://log.weizaima.com/?key=public-participants-"+source).put("kps",names).put("pairs",pairs);
    }
    private static List<JSONObject> rows()throws Exception{
        List<JSONObject> rows=new ArrayList<>();
        rows.add(row("公开A",0,new JSONArray(),new JSONArray()));
        rows.add(row("公开A",1,new JSONArray().put(" 公开KP ").put("\t新增KP\n").put(""),new JSONArray().put(pair("  PC  "," PL ","public-c2")).put(pair("新增PC","新增PL","public-c2"))));
        rows.add(row("公开A",2,new JSONArray().put("新增KP").put("公开KP"),new JSONArray().put(pair("新增PC","新增PL","public-c1"))));
        rows.add(row("公开A",0,new JSONArray().put("重复来源的新KP"),new JSONArray().put(pair("重复来源PC","",null))));
        rows.add(row("公开B",4,new JSONArray().put("B旧KP"),new JSONArray()));
        rows.add(row("公开A",0,new JSONArray().put("重访KP"),new JSONArray().put(pair("  PC  "," PL ","public-c2"))));
        rows.add(row("公开A",6,new JSONArray(),new JSONArray().put(pair("a","b\u0000c","public-c2"))));
        rows.add(row("公开B",7,new JSONArray().put("\u0000B\u0000"),new JSONArray().put(pair(" ","\t","public-c1"))));
        rows.add(row("公开A",8,new JSONArray().put("完整😀尾"),new JSONArray().put(pair("😀\u0000尾","完整PL","public-c2"))));return rows;
    }
    private static boolean legacySpace(char value){return value>=9&&value<=13||value==' '||value=='\u00a0'||value=='\u1680'||value>='\u2000'&&value<='\u200a'||value=='\u2028'||value=='\u2029'||value=='\u202f'||value=='\u205f'||value=='\u3000'||value=='\ufeff';}
    private static String legacyTrim(String value){int start=0,end=value.length();while(start<end&&legacySpace(value.charAt(start)))start++;while(end>start&&legacySpace(value.charAt(end-1)))end--;return value.substring(start,end);}
    private static JSONArray legacyNames(JSONArray before,JSONArray incoming)throws Exception{
        LinkedHashSet<String> names=new LinkedHashSet<>();for(JSONArray group:new JSONArray[]{before,incoming})for(int i=0;i<group.length();i++){
            Object raw=group.get(i);if(!(raw instanceof String))throw new IOException("Invalid public KP");String name=legacyTrim((String)raw);if(!name.isEmpty())names.add(name);
        }return new JSONArray(names);
    }
    private static JSONArray legacyPairs(JSONArray before,JSONArray incoming)throws Exception{
        LinkedHashMap<String,JSONObject> pairs=new LinkedHashMap<>();for(JSONArray group:new JSONArray[]{before,incoming})for(int i=0;i<group.length();i++){
            JSONObject pair=group.getJSONObject(i);BackupValidation.shape(pair,"pc,pl","characterId");Object pc=pair.get("pc"),pl=pair.get("pl");if(!(pc instanceof String)||!(pl instanceof String))throw new IOException("Invalid public pair");
            if(pair.has("characterId")){Object id=pair.get("characterId");if(!(id instanceof String)||!Arrays.asList("","public-c1","public-c2").contains(id))throw new IOException("Invalid public association");}
            if(!((String)pc).isEmpty()||!((String)pl).isEmpty())pairs.putIfAbsent((String)pc+'\0'+pl,pair);
        }return new JSONArray(pairs.values());
    }
    private static Map<String,JSONObject> modules(JSONObject root)throws Exception{
        Map<String,JSONObject> result=new LinkedHashMap<>();JSONArray values=root.getJSONArray("modules");for(int i=0;i<values.length();i++){JSONObject value=values.getJSONObject(i);result.put(value.getString("name"),new JSONObject(value.toString()));}return result;
    }
    private static BackupSession.Proof send(TableSession owner,List<JSONObject> rows,int count)throws Exception{
        StringBuilder text=new StringBuilder();for(int i=0;i<count;i++)text.append('T').append(new JSONObject().put("sheetOrder",0).put("rowOrder",i).put("value",rows.get(i))).append('\n');
        byte[] bytes=text.toString().getBytes(StandardCharsets.UTF_8);long index=0;for(int at=0;at<bytes.length;at+=LogbookLimits.TRANSFER_CHUNK_BYTES)owner.append("candidate",index++,Arrays.copyOfRange(bytes,at,Math.min(bytes.length,at+LogbookLimits.TRANSFER_CHUNK_BYTES)));
        StringBuilder hash=new StringBuilder();for(byte value:MessageDigest.getInstance("SHA-256").digest(bytes))hash.append(String.format(Locale.ROOT,"%02x",value&255));return new BackupSession.Proof(bytes.length,hash.toString());
    }
    private static void remove(File root)throws Exception{if(!root.exists())return;for(File file:Objects.requireNonNull(root.listFiles())){if(file.isDirectory())remove(file);else assertTrue(file.delete());}assertTrue(root.delete());}
    private static SQLiteDatabase privateIndex(TableSession owner,int flags){return SQLiteDatabase.openDatabase(new File(owner.directory,"stage.sqlite").getPath(),null,flags);}

    @Test public void everyPrefixMatchesOriginalMergeAndWritesOnlyChangedCompleteLists()throws Exception{
        String name="public-participant-oracle-"+UUID.randomUUID()+".sqlite";File root=new File(context.getCacheDir(),"public-participant-oracle-"+UUID.randomUUID());assertTrue(root.mkdir());
        try(LogbookDatabase db=new LogbookDatabase(context,name,true,()->FREE)){
            JSONObject original=fixture();List<JSONObject> rows=rows();
            for(int count=1;count<=rows.size();count++){
                db.replace(original.toString(),db.revision());String before=db.snapshot();long revision=db.revision();Map<String,JSONObject> expected=modules(original);Map<String,Integer> writes=new HashMap<>();
                Set<String> sourceKeys=new HashSet<>();int skipped=0;
                for(int i=0;i<count;i++){
                    JSONObject row=rows.get(i),module=expected.get(row.getString("moduleName"));String prior=module.getJSONArray("kps").toString()+"\n"+module.getJSONArray("pairs").toString();
                    module.put("kps",legacyNames(module.getJSONArray("kps"),row.getJSONArray("kps")));module.put("pairs",legacyPairs(module.getJSONArray("pairs"),row.getJSONArray("pairs")));
                    if(!prior.equals(module.getJSONArray("kps").toString()+"\n"+module.getJSONArray("pairs").toString()))writes.put(module.getString("id"),writes.getOrDefault(module.getString("id"),0)+1);
                    if(!sourceKeys.add(row.getString("moduleName")+"\n"+row.getString("link")))skipped++;
                }
                try(TableSession stage=new TableSession(root,"public",revision,"record-table","public.csv",()->FREE)){
                    stage.capture(new ByteArrayInputStream("public participant source".getBytes(StandardCharsets.UTF_8)));
                    try(SQLiteDatabase index=privateIndex(stage,SQLiteDatabase.OPEN_READWRITE)){index.execSQL("CREATE TABLE participant_writes(module_id TEXT NOT NULL)");index.execSQL("CREATE TRIGGER public_participant_writes AFTER UPDATE OF value ON modules BEGIN INSERT INTO participant_writes VALUES(NEW.id); END");}
                    JSONObject preview=stage.preview(db,send(stage,rows,count),original.getJSONObject("settings"));assertEquals(count-skipped,preview.getInt("added"));assertEquals(skipped,preview.getInt("skipped"));assertEquals(before,db.snapshot());
                    try(SQLiteDatabase index=privateIndex(stage,SQLiteDatabase.OPEN_READONLY);Cursor values=index.rawQuery("SELECT id,(SELECT COUNT(*) FROM participant_writes WHERE module_id=modules.id) FROM modules",null)){
                        while(values.moveToNext())assertEquals("prefix "+count+" module "+values.getString(0),(long)writes.getOrDefault(values.getString(0),0),values.getLong(1));
                    }
                    stage.prepareCommit();db.edit(revision,stage::apply);Map<String,JSONObject> saved=modules(new JSONObject(db.snapshot()));
                    for(String moduleName:expected.keySet()){
                        assertEquals("names after prefix "+count,expected.get(moduleName).getJSONArray("kps").toString(),saved.get(moduleName).getJSONArray("kps").toString());
                        assertEquals("pairs after prefix "+count,expected.get(moduleName).getJSONArray("pairs").toString(),saved.get(moduleName).getJSONArray("pairs").toString());
                    }
                }
            }
        }finally{context.deleteDatabase(name);remove(root);}
    }

    @Test public void invalidDiscardedParticipantsOnDuplicateSourcesRejectTheWholePreview()throws Exception{
        String name="public-participant-reject-"+UUID.randomUUID()+".sqlite";File root=new File(context.getCacheDir(),"public-participant-reject-"+UUID.randomUUID());assertTrue(root.mkdir());
        try(LogbookDatabase db=new LogbookDatabase(context,name,true,()->FREE)){
            JSONObject original=fixture();db.replace(original.toString(),0);String before=db.snapshot();
            for(int scenario=0;scenario<6;scenario++){
                JSONObject first=row("公开A",0,new JSONArray(),new JSONArray().put(pair("公开PC","公开PL","public-c1"))),invalid=row("公开A",0,new JSONArray(),new JSONArray());
                JSONObject bad=pair("公开PC","公开PL","public-c1");
                if(scenario==0)invalid.put("kps",new JSONArray().put(5));
                if(scenario==1)bad.put("pc",5);
                if(scenario==2)bad.put("unexpected","forbidden");
                if(scenario==3)bad.put("characterId",5);
                if(scenario==4)bad.put("characterId","missing-public-character");
                if(scenario==5)bad=pair("","","missing-public-character");
                invalid.put("pairs",new JSONArray().put(bad));
                try(TableSession stage=new TableSession(root,"public",1,"record-table","public.csv",()->FREE)){
                    stage.capture(new ByteArrayInputStream("public participant rejection".getBytes(StandardCharsets.UTF_8)));
                    try{stage.preview(db,send(stage,Arrays.asList(first,invalid),2),original.getJSONObject("settings"));fail("accepted invalid discarded participant scenario "+scenario);}catch(IOException|IllegalArgumentException|JSONException expected){}
                    assertEquals(before,db.snapshot());assertEquals(1,db.revision());
                    try(SQLiteDatabase index=privateIndex(stage,SQLiteDatabase.OPEN_READONLY);Cursor records=index.rawQuery("SELECT (SELECT COUNT(*) FROM modules)+(SELECT COUNT(*) FROM records)+(SELECT COUNT(*) FROM characters)",null)){assertTrue(records.moveToFirst());assertEquals(0,records.getLong(0));}
                }
            }
        }finally{context.deleteDatabase(name);remove(root);}
    }

    @Test public void participantRewriteFailureRollsBackAndFreshLeaseKeepsNormalization()throws Exception{
        String name="public-participant-rollback-"+UUID.randomUUID()+".sqlite";File root=new File(context.getCacheDir(),"public-participant-rollback-"+UUID.randomUUID());assertTrue(root.mkdir());
        try(LogbookDatabase db=new LogbookDatabase(context,name,true,()->FREE)){
            JSONObject original=fixture();db.replace(original.toString(),0);String before=db.snapshot();List<JSONObject> rows=rows();
            try(TableSession stage=new TableSession(root,"public",1,"record-table","public.csv",()->FREE)){
                stage.capture(new ByteArrayInputStream("public participant rollback".getBytes(StandardCharsets.UTF_8)));
                try(SQLiteDatabase index=privateIndex(stage,SQLiteDatabase.OPEN_READWRITE)){index.execSQL("CREATE TRIGGER public_participant_failure BEFORE UPDATE OF value ON modules BEGIN SELECT RAISE(ABORT,'public participant write failure'); END");}
                try{stage.preview(db,send(stage,rows,2),original.getJSONObject("settings"));fail("accepted a failed participant write");}catch(android.database.SQLException expected){assertTrue(expected.getMessage().contains("public participant write failure"));}
                assertEquals(before,db.snapshot());assertEquals(1,db.revision());
            }
            try(TableSession stage=new TableSession(root,"public",1,"record-table","public.csv",()->FREE)){
                stage.capture(new ByteArrayInputStream("public participant fresh lease".getBytes(StandardCharsets.UTF_8)));assertEquals(1,stage.preview(db,send(stage,rows,1),original.getJSONObject("settings")).getInt("added"));stage.prepareCommit();db.edit(1,stage::apply);
                JSONObject saved=modules(new JSONObject(db.snapshot())).get("公开A");assertEquals(legacyNames(original.getJSONArray("modules").getJSONObject(0).getJSONArray("kps"),new JSONArray()).toString(),saved.getJSONArray("kps").toString());assertEquals(legacyPairs(original.getJSONArray("modules").getJSONObject(0).getJSONArray("pairs"),new JSONArray()).toString(),saved.getJSONArray("pairs").toString());
            }
        }finally{context.deleteDatabase(name);remove(root);}
    }
}
