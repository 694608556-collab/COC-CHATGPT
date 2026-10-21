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
    /** Hash exact stored metadata/body tokens; the root confirmation time is asserted separately. */
    private String storedRowsHash(SQLiteDatabase db,Set<String> selected)throws Exception{
        MessageDigest digest=MessageDigest.getInstance("SHA-256");int found=0;
        try(Cursor rows=db.rawQuery("SELECT row_key,id,ordinal,metadata,bytes,body_count FROM indexed_records ORDER BY ordinal,row_key",null)){
            while(rows.moveToNext()){
                if(!selected.contains(rows.getString(1)))continue;found++;
                for(int column=1;column<6;column++)digest.update(org.json.JSONObject.quote(rows.getString(column)).getBytes(StandardCharsets.UTF_8));
                try(Cursor bodies=db.rawQuery("SELECT kind,position,data,bytes FROM indexed_bodies WHERE record_key=? ORDER BY kind,position",new String[]{rows.getString(0)})){
                    while(bodies.moveToNext())for(int column=0;column<4;column++)digest.update(org.json.JSONObject.quote(bodies.getString(column)).getBytes(StandardCharsets.UTF_8));
                }
            }
        }
        assertEquals(selected.size(),found);return java.util.Base64.getEncoder().encodeToString(digest.digest());
    }
    /** Only public counts and native monotonic timings leave the test process. */
    private void reportTableTiming(String protocol,org.json.JSONObject timing)throws Exception{
        android.os.Bundle result=new android.os.Bundle();
        result.putString("stream","PUBLIC_TABLE_TIMING "+new org.json.JSONObject().put("protocol",protocol).put("recordsBefore",1000).put("recordsAfter",7000).put("timing",timing).toString()+"\n");
        InstrumentationRegistry.getInstrumentation().sendStatus(0,result);
    }
    @Test public void tableManualUpdateKeepsRawTokenAndEmptyLines()throws Exception {
        String name="public-manual-table-"+UUID.randomUUID()+".sqlite";
        File input=fixture(1,100,0,"valid");
        try(LogbookDatabase database=new LogbookDatabase(context(),name)){
            try(Reader reader=new InputStreamReader(new FileInputStream(input),StandardCharsets.UTF_8)){database.replace(reader,0);}
            org.json.JSONObject initial=new org.json.JSONObject(JsonFields.join(database.fields()));
            initial.getJSONArray("records").put(new org.json.JSONObject("{\"id\":\"manual\",\"moduleId\":\"m0\",\"sourceType\":\"manual\",\"manualContent\":\"old\",\"updatedAt\":\"before\"}"));
            database.edit(1,store->store.importTable(initial));
            // A legacy manual record can also own an opaque raw cache: explicit manual updates must retain it.
            database.getWritableDatabase().execSQL("INSERT INTO indexed_bodies VALUES((SELECT row_key FROM indexed_records WHERE id='manual'),'rawContent',0,?,?)",new Object[]{"{\"raw\":900719925474099312345}",JsonFields.bytes("{\"raw\":900719925474099312345}")});
            org.json.JSONObject changed=new org.json.JSONObject(JsonFields.join(database.fields()));
            changed.getJSONArray("records").getJSONObject(1).put("manualContent","public\n\n中文😀").put("updatedAt","after");
            assertEquals(3,database.edit(2,store->store.importTable(changed)));
            try(Cursor row=database.getReadableDatabase().rawQuery("SELECT data FROM indexed_bodies WHERE record_key=(SELECT row_key FROM indexed_records WHERE id='manual') AND kind='rawContent'",null)){assertTrue(row.moveToFirst());assertEquals("{\"raw\":900719925474099312345}",row.getString(0));}
            StringWriter output=new StringWriter();database.writeSnapshot(output,Collections.singleton("manual"));
            assertEquals("public\n\n中文😀",new org.json.JSONObject(output.toString()).getJSONArray("records").getJSONObject(0).getString("manualContent"));
        }finally{input.delete();context().deleteDatabase(name);}
    }
    @Test public void tableAppendPreservesNativeBodiesAndRollsBackEveryFailure()throws Exception {
        String name="public-table-"+UUID.randomUUID()+".sqlite";
        File input=fixture(1000,52000,0,"valid");
        try(LogbookDatabase database=new LogbookDatabase(context(),name)){
            try(Reader reader=new InputStreamReader(new FileInputStream(input),StandardCharsets.UTF_8)){database.replace(reader,0);}
            SQLiteDatabase db=database.getWritableDatabase();String untouched=hash(database,ids(0,1000));
            org.json.JSONObject candidate=new org.json.JSONObject(JsonFields.join(database.fields()));
            org.json.JSONArray records=candidate.getJSONArray("records");
            for(int i=1000;i<7000;i++)records.put(new org.json.JSONObject("{\"id\":\"r"+i+"\",\"moduleId\":\"m0\",\"sourceType\":\"online\",\"link\":\"https://log.weizaima.com/?key=public-new-"+i+"\",\"status\":\"pending\",\"order\":"+i+"}"));
            // Any attempt to touch pre-existing bodies fails this transaction, even a redundant rewrite.
            db.execSQL("CREATE TRIGGER guard_old_body BEFORE DELETE ON indexed_bodies BEGIN SELECT RAISE(ABORT,'old body touched'); END");
            TableTiming timing=new TableTiming();
            assertEquals(2,database.edit(1,store->store.importTable(candidate,timing),timing));
            org.json.JSONObject measured=timing.result(),phases=measured.getJSONObject("phasesMs");
            reportTableTiming("commitTable",measured);
            assertEquals(3,measured.length());assertEquals("native-monotonic",measured.getString("clock"));
            assertEquals(new HashSet<>(Arrays.asList("transactionBegin","transactionCAS","metadataRead","tableRules","recordIndex","recordCompareAndWrite","capacity","revisionWrite","transactionEnd")),new HashSet<>(JsonFields.split(phases.toString()).keySet()));
            double sum=0;java.util.Iterator<String> keys=phases.keys();while(keys.hasNext()){double ms=phases.getDouble(keys.next());assertTrue(Double.isFinite(ms)&&ms>=0);sum+=ms;}assertTrue(measured.getDouble("totalMs")>=sum);
            assertEquals(7000,scalar(db,"SELECT COUNT(*) FROM indexed_records"));assertEquals(untouched,hash(database,ids(0,1000)));
            try{TableTiming stale=new TableTiming();database.edit(1,store->store.importTable(candidate,stale),stale);fail("stale revision accepted");}catch(IllegalStateException expected){}
            org.json.JSONObject deleted=new org.json.JSONObject(candidate.toString());deleted.getJSONArray("records").remove(0);
            try{database.edit(2,store->store.importTable(deleted));fail("deletion accepted");}catch(IllegalArgumentException expected){}
            org.json.JSONObject source=new org.json.JSONObject(candidate.toString());source.getJSONArray("records").getJSONObject(0).put("link","changed");
            try{database.edit(2,store->store.importTable(source));fail("source change accepted");}catch(IllegalArgumentException expected){}
            db.execSQL("CREATE TRIGGER fail_table_root BEFORE UPDATE ON app_state BEGIN SELECT RAISE(ABORT,'injected'); END");
            org.json.JSONObject added=new org.json.JSONObject(candidate.toString());added.getJSONArray("records").put(new org.json.JSONObject("{\"id\":\"rollback\",\"moduleId\":\"m0\",\"sourceType\":\"manual\",\"manualContent\":\"public\"}"));
            try{TableTiming failed=new TableTiming();database.edit(2,store->store.importTable(added,failed),failed);fail("injected failure accepted");}catch(android.database.sqlite.SQLiteException expected){}
            db.execSQL("DROP TRIGGER fail_table_root");
            assertEquals(2,database.revision());assertEquals(7000,scalar(db,"SELECT COUNT(*) FROM indexed_records"));assertEquals(untouched,hash(database,ids(0,1000)));
            org.json.JSONObject oversized=new org.json.JSONObject(candidate.toString());char[] large=new char[14*1024*1024];Arrays.fill(large,'x');
            oversized.getJSONArray("records").put(new org.json.JSONObject().put("id","oversized").put("moduleId","m0").put("sourceType","manual").put("manualContent",new String(large)));
            try{TableTiming over=new TableTiming();database.edit(2,store->store.importTable(oversized,over),over);fail("capacity accepted");}catch(IllegalArgumentException expected){}
            assertEquals(2,database.revision());assertEquals(7000,scalar(db,"SELECT COUNT(*) FROM indexed_records"));
            db.execSQL("DROP TRIGGER guard_old_body");
        }finally{input.delete();context().deleteDatabase(name);}
    }
    private static org.json.JSONObject publicDelta(org.json.JSONObject candidate,int oldCount)throws Exception {
        org.json.JSONArray added=new org.json.JSONArray(),records=candidate.getJSONArray("records");for(int i=oldCount;i<records.length();i++)added.put(records.get(i));
        return new org.json.JSONObject().put("protocolVersion",1).put("initialSettings",candidate.get("settings")).put("modulesAdded",new org.json.JSONArray()).put("moduleParticipants",new org.json.JSONArray()).put("charactersAdded",new org.json.JSONArray()).put("recordsAdded",added).put("manualUpdates",new org.json.JSONArray());
    }
    @Test public void tableDeltaPreservesNativeBodiesAndRollsBackEveryFailure()throws Exception {
        String name="public-table-delta-"+UUID.randomUUID()+".sqlite";
        File input=fixture(1000,52000,0,"valid");
        try(LogbookDatabase database=new LogbookDatabase(context(),name)){
            try(Reader reader=new InputStreamReader(new FileInputStream(input),StandardCharsets.UTF_8)){database.replace(reader,0);}
            SQLiteDatabase db=database.getWritableDatabase();String untouched=storedRowsHash(db,ids(0,1000));
            org.json.JSONObject candidate=new org.json.JSONObject(JsonFields.join(database.fields()));
            org.json.JSONArray records=candidate.getJSONArray("records");
            for(int i=1000;i<7000;i++)records.put(new org.json.JSONObject("{\"id\":\"r"+i+"\",\"moduleId\":\"m0\",\"sourceType\":\"online\",\"link\":\"https://log.weizaima.com/?key=public-new-"+i+"\",\"status\":\"pending\",\"order\":"+i+"}"));
            // Any attempt to touch pre-existing bodies fails this transaction, even a redundant rewrite.
            db.execSQL("CREATE TRIGGER guard_old_body BEFORE DELETE ON indexed_bodies BEGIN SELECT RAISE(ABORT,'old body touched'); END");
            TableTiming timing=new TableTiming();
            assertEquals(2,database.edit(1,store->store.importTableDelta(publicDelta(candidate,1000),"confirmed",timing),timing));
            org.json.JSONObject measured=timing.result(),phases=measured.getJSONObject("phasesMs");
            reportTableTiming("commitTableDelta",measured);
            assertEquals(3,measured.length());assertEquals("native-monotonic",measured.getString("clock"));
            assertEquals(new HashSet<>(Arrays.asList("transactionBegin","transactionCAS","metadataRead","tableRules","mergedValidation","recordIndex","recordCompareAndWrite","capacity","revisionWrite","transactionEnd")),new HashSet<>(JsonFields.split(phases.toString()).keySet()));
            double sum=0;java.util.Iterator<String> keys=phases.keys();while(keys.hasNext()){double ms=phases.getDouble(keys.next());assertTrue(Double.isFinite(ms)&&ms>=0);sum+=ms;}assertTrue(measured.getDouble("totalMs")>=sum);
            org.json.JSONObject expectedMetadata=new org.json.JSONObject(candidate.toString()).put("exportedAt","confirmed");
            assertTrue(TableImport.equal(expectedMetadata,new org.json.JSONObject(JsonFields.join(database.fields()))));
            assertEquals(7000,scalar(db,"SELECT COUNT(*) FROM indexed_records"));assertEquals(untouched,storedRowsHash(db,ids(0,1000)));
            String stableSnapshot=hash(database,ids(0,1000));
            try{TableTiming stale=new TableTiming();database.edit(1,store->store.importTableDelta(publicDelta(candidate,1000),"confirmed",stale),stale);fail("stale revision accepted");}catch(IllegalStateException expected){}
            org.json.JSONObject deleted=new org.json.JSONObject(candidate.toString());deleted.getJSONArray("records").remove(0);
            try{database.edit(2,store->store.importTableDelta(new org.json.JSONObject(publicDelta(deleted,1000).toString()).put("delete",true),"confirmed",null));fail("deletion accepted");}catch(IllegalArgumentException expected){}
            org.json.JSONObject source=new org.json.JSONObject(candidate.toString());source.getJSONArray("records").getJSONObject(0).put("link","changed");
            try{database.edit(2,store->store.importTableDelta(new org.json.JSONObject(publicDelta(source,1000).toString()).put("manualUpdates",new org.json.JSONArray().put(source.getJSONArray("records").getJSONObject(0))),"confirmed",null));fail("source change accepted");}catch(IllegalArgumentException expected){}
            db.execSQL("CREATE TRIGGER fail_table_root BEFORE UPDATE ON app_state BEGIN SELECT RAISE(ABORT,'injected'); END");
            org.json.JSONObject added=new org.json.JSONObject(candidate.toString());added.getJSONArray("records").put(new org.json.JSONObject("{\"id\":\"rollback\",\"moduleId\":\"m0\",\"sourceType\":\"manual\",\"manualContent\":\"public\"}"));
            try{TableTiming failed=new TableTiming();database.edit(2,store->store.importTableDelta(publicDelta(added,7000),"confirmed",failed),failed);fail("injected failure accepted");}catch(android.database.sqlite.SQLiteException expected){}
            db.execSQL("DROP TRIGGER fail_table_root");
            assertEquals(2,database.revision());assertEquals(7000,scalar(db,"SELECT COUNT(*) FROM indexed_records"));assertEquals(untouched,storedRowsHash(db,ids(0,1000)));
            assertEquals(stableSnapshot,hash(database,ids(0,1000)));
            org.json.JSONObject oversized=new org.json.JSONObject(candidate.toString());char[] large=new char[14*1024*1024];Arrays.fill(large,'x');
            oversized.getJSONArray("records").put(new org.json.JSONObject().put("id","oversized").put("moduleId","m0").put("sourceType","manual").put("manualContent",new String(large)));
            try{TableTiming over=new TableTiming();database.edit(2,store->store.importTableDelta(publicDelta(oversized,7000),"confirmed",over),over);fail("capacity accepted");}catch(IllegalArgumentException expected){}
            assertEquals(2,database.revision());assertEquals(7000,scalar(db,"SELECT COUNT(*) FROM indexed_records"));
            assertEquals(untouched,storedRowsHash(db,ids(0,1000)));assertEquals(stableSnapshot,hash(database,ids(0,1000)));
            db.execSQL("DROP TRIGGER guard_old_body");
        }finally{input.delete();context().deleteDatabase(name);}
    }
    @Test public void tableDeltaRejectsNonStringAddedManualBodies()throws Exception {
        String name="public-delta-invalid-body-"+UUID.randomUUID()+".sqlite";
        File input=fixture(1,100,0,"valid");
        try(LogbookDatabase database=new LogbookDatabase(context(),name)){
            try(Reader reader=new InputStreamReader(new FileInputStream(input),StandardCharsets.UTF_8)){database.replace(reader,0);}
            String unchanged=database.snapshot();
            for(Object invalid:new Object[]{7,false,org.json.JSONObject.NULL,new org.json.JSONObject(),new org.json.JSONArray()}){
                org.json.JSONObject candidate=new org.json.JSONObject(JsonFields.join(database.fields()));
                candidate.getJSONArray("records").put(new org.json.JSONObject().put("id","invalid-manual").put("moduleId","m0").put("sourceType","manual").put("manualContent",invalid));
                try{database.edit(1,store->store.importTableDelta(publicDelta(candidate,1),"confirmed",null));fail("non-string manual body accepted: "+invalid);}catch(IllegalArgumentException expected){}
                assertEquals(1,database.revision());assertEquals(unchanged,database.snapshot());
            }
        }finally{input.delete();context().deleteDatabase(name);}
    }
    @Test public void tableDeltaRejectsDanglingParticipantCharacter()throws Exception {
        String name="public-delta-invalid-link-"+UUID.randomUUID()+".sqlite";
        File input=fixture(1,100,0,"valid");
        try(LogbookDatabase database=new LogbookDatabase(context(),name)){
            try(Reader reader=new InputStreamReader(new FileInputStream(input),StandardCharsets.UTF_8)){database.replace(reader,0);}
            String unchanged=database.snapshot();
            org.json.JSONObject candidate=new org.json.JSONObject(JsonFields.join(database.fields()));
            org.json.JSONObject module=candidate.getJSONArray("modules").getJSONObject(0);
            module.put("pairs",new org.json.JSONArray().put(new org.json.JSONObject().put("pc","public pc").put("pl","public pl").put("characterId","absent")));
            org.json.JSONObject delta=publicDelta(candidate,1).put("moduleParticipants",new org.json.JSONArray().put(module));
            try{database.edit(1,store->store.importTableDelta(delta,"confirmed",null));fail("dangling participant character accepted");}catch(IllegalArgumentException expected){}
            assertEquals(1,database.revision());assertEquals(unchanged,database.snapshot());
        }finally{input.delete();context().deleteDatabase(name);}
    }
    @Test public void tableDeltaCharactersMustReferenceMergedModules()throws Exception {
        String name="public-delta-character-link-"+UUID.randomUUID()+".sqlite";
        File input=fixture(1,100,0,"valid");
        try(LogbookDatabase database=new LogbookDatabase(context(),name)){
            try(Reader reader=new InputStreamReader(new FileInputStream(input),StandardCharsets.UTF_8)){database.replace(reader,0);}
            String unchanged=database.snapshot();
            org.json.JSONObject baseline=new org.json.JSONObject(JsonFields.join(database.fields()));
            for(org.json.JSONObject character:new org.json.JSONObject[]{
                new org.json.JSONObject("{\"id\":\"public-char\",\"moduleIds\":[\"absent\"]}"),
                new org.json.JSONObject("{\"id\":\"public-char\",\"moduleIds\":[\"m0\"],\"moduleId\":\"absent\"}"),
                new org.json.JSONObject("{\"id\":\"public-char\",\"moduleIds\":[\"m0\",\"m0\"]}"),
                new org.json.JSONObject("{\"id\":\"public-char\",\"moduleIds\":[7]}")}){
                org.json.JSONObject delta=publicDelta(baseline,1).put("charactersAdded",new org.json.JSONArray().put(character));
                try{database.edit(1,store->store.importTableDelta(delta,"confirmed",null));fail("invalid character module link accepted: "+character);}catch(IllegalArgumentException expected){}
                assertEquals(1,database.revision());assertEquals(unchanged,database.snapshot());
            }
            org.json.JSONObject addedModule=new org.json.JSONObject("{\"id\":\"new-module\",\"pairs\":[{\"pc\":\"public\",\"pl\":\"public\",\"characterId\":\"new-character\"}]}");
            org.json.JSONObject valid=publicDelta(baseline,1).put("modulesAdded",new org.json.JSONArray().put(addedModule)).put("charactersAdded",new org.json.JSONArray().put(new org.json.JSONObject("{\"id\":\"new-character\",\"moduleIds\":[\"new-module\"],\"moduleId\":\"new-module\"}")));
            assertEquals(2,database.edit(1,store->store.importTableDelta(valid,"confirmed",null)));
        }finally{input.delete();context().deleteDatabase(name);}
    }
    @Test public void tableDeltaManualUpdatePreservesRawTokenAndReopens()throws Exception {
        String name="public-delta-manual-"+UUID.randomUUID()+".sqlite";
        File input=fixture(1,100,0,"valid");String untouched;
        String text="public manual\n\n中文😀\0tail",raw="{\"raw\":900719925474099312345}";
        try{
            try(LogbookDatabase database=new LogbookDatabase(context(),name)){
                try(Reader reader=new InputStreamReader(new FileInputStream(input),StandardCharsets.UTF_8)){database.replace(reader,0);}
                untouched=storedRowsHash(database.getReadableDatabase(),ids(0,1));
                org.json.JSONObject initial=new org.json.JSONObject(JsonFields.join(database.fields()));
                initial.getJSONArray("records").put(new org.json.JSONObject("{\"id\":\"manual\",\"moduleId\":\"m0\",\"sourceType\":\"manual\",\"manualContent\":\"old\",\"updatedAt\":\"before\"}"));
                assertEquals(2,database.edit(1,store->store.importTableDelta(publicDelta(initial,1),"created",null)));
                database.getWritableDatabase().execSQL("INSERT INTO indexed_bodies VALUES((SELECT row_key FROM indexed_records WHERE id='manual'),'rawContent',0,?,?)",new Object[]{raw,JsonFields.bytes(raw)});
                String unchanged=hash(database,Collections.singleton("manual"));
                org.json.JSONObject candidate=new org.json.JSONObject(JsonFields.join(database.fields()));
                org.json.JSONObject manual=candidate.getJSONArray("records").getJSONObject(1).put("manualContent",text).put("updatedAt","after").put("playDate","2026-10-21").put("dateSource","manual");
                org.json.JSONObject delta=publicDelta(candidate,2).put("manualUpdates",new org.json.JSONArray().put(manual));
                database.getWritableDatabase().execSQL("CREATE TRIGGER fail_delta_manual BEFORE UPDATE ON app_state BEGIN SELECT RAISE(ABORT,'injected'); END");
                try{database.edit(2,store->store.importTableDelta(delta,"confirmed",null));fail("manual SQL failure accepted");}catch(android.database.sqlite.SQLiteException expected){}
                database.getWritableDatabase().execSQL("DROP TRIGGER fail_delta_manual");
                assertEquals(2,database.revision());assertEquals(unchanged,hash(database,Collections.singleton("manual")));
                assertEquals(3,database.edit(2,store->store.importTableDelta(delta,"confirmed",null)));
            }
            try(LogbookDatabase reopened=new LogbookDatabase(context(),name)){
                assertEquals(3,reopened.revision());assertEquals(untouched,storedRowsHash(reopened.getReadableDatabase(),ids(0,1)));
                StringWriter out=new StringWriter();reopened.writeSnapshot(out,Collections.singleton("manual"));
                org.json.JSONObject snapshot=new org.json.JSONObject(out.toString());
                assertEquals("confirmed",snapshot.getString("exportedAt"));assertEquals(text,snapshot.getJSONArray("records").getJSONObject(0).getString("manualContent"));
                try(Cursor row=reopened.getReadableDatabase().rawQuery("SELECT data FROM indexed_bodies WHERE record_key=(SELECT row_key FROM indexed_records WHERE id='manual') AND kind='rawContent'",null)){assertTrue(row.moveToFirst());assertEquals(raw,row.getString(0));}
                org.json.JSONObject candidate=new org.json.JSONObject(JsonFields.join(reopened.fields()));
                org.json.JSONObject manual=candidate.getJSONArray("records").getJSONObject(1).put("manualContent","");
                org.json.JSONObject delta=publicDelta(candidate,2).put("manualUpdates",new org.json.JSONArray().put(manual));
                assertEquals(4,reopened.edit(3,store->store.importTableDelta(delta,"empty-confirmed",null)));
            }
            try(LogbookDatabase reopened=new LogbookDatabase(context(),name)){
                StringWriter out=new StringWriter();reopened.writeSnapshot(out,Collections.singleton("manual"));
                assertEquals(4,reopened.revision());assertEquals("",new org.json.JSONObject(out.toString()).getJSONArray("records").getJSONObject(0).getString("manualContent"));
                assertEquals(untouched,storedRowsHash(reopened.getReadableDatabase(),ids(0,1)));
            }
        }finally{input.delete();context().deleteDatabase(name);}
    }
    @Test public void tableDeltaValidatesNewStoreAndRejectsConflicts()throws Exception {
        String name="public-delta-new-store-"+UUID.randomUUID()+".sqlite";File input=fixture(1,0,0,"pending");
        try(LogbookDatabase database=new LogbookDatabase(context(),name)){
            org.json.JSONObject initial=new org.json.JSONObject(new String(java.nio.file.Files.readAllBytes(input.toPath()),StandardCharsets.UTF_8));
            org.json.JSONObject first=publicDelta(initial,0).put("modulesAdded",initial.getJSONArray("modules"));
            assertEquals(1,database.edit(0,store->store.importTableDelta(first,"initial-confirmed",null)));
            String unchanged=database.snapshot();assertTrue(TableImport.equal(initial.getJSONObject("settings"),new org.json.JSONObject(unchanged).getJSONObject("settings")));
            org.json.JSONObject empty=publicDelta(new org.json.JSONObject(JsonFields.join(database.fields())),1);
            org.json.JSONObject added=new org.json.JSONObject("{\"id\":\"new-manual\",\"moduleId\":\"m0\",\"sourceType\":\"manual\",\"manualContent\":\"public\"}");
            for(org.json.JSONObject invalid:new org.json.JSONObject[]{
                new org.json.JSONObject(empty.toString()).put("unexpected",true),
                new org.json.JSONObject(empty.toString()).put("protocolVersion",true),
                new org.json.JSONObject(empty.toString()).put("initialSettings",new org.json.JSONObject()),
                new org.json.JSONObject(empty.toString()).put("recordsAdded",false),
                new org.json.JSONObject(empty.toString()).put("recordsAdded",new org.json.JSONArray().put(added).put(added)),
                new org.json.JSONObject(empty.toString()).put("recordsAdded",new org.json.JSONArray().put(initial.getJSONArray("records").getJSONObject(0))),
                new org.json.JSONObject(empty.toString()).put("modulesAdded",new org.json.JSONArray().put(initial.getJSONArray("modules").getJSONObject(0))),
                new org.json.JSONObject(empty.toString()).put("recordsAdded",new org.json.JSONArray().put(new org.json.JSONObject(added.toString()).put("moduleId","absent")))}){
                try{database.edit(1,store->store.importTableDelta(invalid,"rejected",null));fail("invalid delta accepted: "+invalid);}catch(IllegalArgumentException|org.json.JSONException expected){}
                assertEquals(1,database.revision());assertEquals(unchanged,database.snapshot());
            }
        }finally{input.delete();context().deleteDatabase(name);}
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
