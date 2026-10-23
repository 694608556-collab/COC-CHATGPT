package coc.logbook;

import android.content.Context;
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

/** Public preview/commit fixtures exercise complete metadata, never private inputs. */
@RunWith(AndroidJUnit4.class)
public final class TableRecordMetadataTest {
    private static final long FREE=32L*1024*1024*1024;
    private final Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
    private static final String UNICODE="公开中😀\r\n\u0000\"\\完整尾";

    private static JSONObject fixture()throws Exception {
        try(InputStream input=InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("public-capacity.json");ByteArrayOutputStream output=new ByteArrayOutputStream()) {
            byte[] buffer=new byte[65536];int count;while((count=input.read(buffer))!=-1)output.write(buffer,0,count);
            return new JSONObject(output.toString("UTF-8"));
        }
    }
    private static JSONObject row(String module,String name,String link,String body)throws Exception {
        JSONObject value=new JSONObject().put("sheet","公开编码表").put("moduleName",module).put("sessionName",name).put("link",link).put("kps",new JSONArray()).put("pairs",new JSONArray());
        if(body!=null)value.put("manualContent",body);return value;
    }
    private static BackupSession.Proof send(TableSession owner,JSONObject... rows)throws Exception {
        StringBuilder text=new StringBuilder();for(int i=0;i<rows.length;i++)text.append('T').append(new JSONObject().put("sheetOrder",0).put("rowOrder",i).put("value",rows[i])).append('\n');
        byte[] bytes=text.toString().getBytes(StandardCharsets.UTF_8);long index=0;
        for(int at=0;at<bytes.length;at+=LogbookLimits.TRANSFER_CHUNK_BYTES)owner.append("candidate",index++,Arrays.copyOfRange(bytes,at,Math.min(bytes.length,at+LogbookLimits.TRANSFER_CHUNK_BYTES)));
        StringBuilder hash=new StringBuilder();for(byte value:MessageDigest.getInstance("SHA-256").digest(bytes))hash.append(String.format(Locale.ROOT,"%02x",value&255));
        return new BackupSession.Proof(bytes.length,hash.toString());
    }
    private static void capture(TableSession owner)throws Exception {owner.capture(new ByteArrayInputStream("public metadata source".getBytes(StandardCharsets.UTF_8)));}
    private static JSONObject byName(JSONArray records,String name)throws Exception {
        JSONObject result=null;for(int i=0;i<records.length();i++)if(records.getJSONObject(i).getString("name").equals(name)){assertNull("Duplicate public name",result);result=records.getJSONObject(i);}assertNotNull(result);return result;
    }
    private static JSONObject withoutBodies(JSONObject record)throws Exception {
        JSONObject result=new JSONObject(record.toString());result.remove("rawContent");result.remove("manualContent");return result;
    }
    private static String moduleName(JSONObject initial,String id)throws Exception {
        JSONArray modules=initial.getJSONArray("modules");for(int i=0;i<modules.length();i++)if(modules.getJSONObject(i).getString("id").equals(id))return modules.getJSONObject(i).getString("name");throw new AssertionError("Missing public module");
    }
    private static void remove(File root)throws Exception {
        if(!root.exists())return;for(File file:Objects.requireNonNull(root.listFiles())){if(file.isDirectory())remove(file);else assertTrue(file.delete());}assertTrue(root.delete());
    }
    private static void assertOldRows(JSONArray before,JSONArray after)throws Exception {
        for(int i=0;i<before.length();i++){JSONObject expected=before.getJSONObject(i);assertTrue("Complete old record",BackupValidation.same(expected,byName(after,expected.getString("name"))));}
    }

    @Test public void unicodeAndBothMetadataBoundariesSurviveOldRecordUpdateAndReopen()throws Exception {
        String databaseName="public-metadata-boundaries-"+UUID.randomUUID()+".sqlite";File root=new File(context.getCacheDir(),"public-metadata-boundaries-"+UUID.randomUUID());assertTrue(root.mkdir());
        String expectedSnapshot=null;
        try {
            try(LogbookDatabase database=new LogbookDatabase(context,databaseName,true,()->FREE)) {
                JSONObject initial=fixture(),base=initial.getJSONArray("records").getJSONObject(0);JSONArray records=new JSONArray();JSONObject[] candidates=new JSONObject[5];
                int[] sizes={700,21845,21846,65536,65537};
                for(int i=0;i<sizes.length;i++) {
                    JSONObject record=new JSONObject(base.toString());record.put("id","public-metadata-boundary-"+i).put("sourceType","manual").put("status","manual").put("sequenceNo",i+1).put("order",i).put("manualContent","原始正文"+UNICODE).put("name",UNICODE+i);record.remove("link");
                    String metadata=withoutBodies(record).toString();int existing=i<3?metadata.length():metadata.getBytes(StandardCharsets.UTF_8).length;
                    record.put("name",record.getString("name")+String.join("",Collections.nCopies(sizes[i]-existing,"A")));metadata=withoutBodies(record).toString();
                    assertEquals("Exact independent encoding boundary",sizes[i],i<3?metadata.length():metadata.getBytes(StandardCharsets.UTF_8).length);records.put(record);
                    candidates[i]=row(moduleName(initial,record.getString("moduleId")),record.getString("name"),"","替换正文"+i+UNICODE);
                }
                initial.put("records",records);database.replace(initial.toString(),0);String before=database.snapshot();JSONArray old=new JSONObject(before).getJSONArray("records");
                try(TableSession owner=new TableSession(root,"public",1,"record-table","public.csv",()->FREE)) {
                    capture(owner);JSONObject preview=owner.preview(database,send(owner,candidates),initial.getJSONObject("settings"));assertEquals(0,preview.getInt("added"));assertEquals(5,preview.getInt("updated"));assertEquals(0,preview.getInt("skipped"));assertEquals(before,database.snapshot());
                    for(int i=0;i<candidates.length;i++)assertEquals(candidates[i].getString("moduleName")+" / "+candidates[i].getString("sessionName"),preview.getJSONArray("names").getString(i));
                    owner.prepareCommit();assertEquals(2,database.edit(1,owner::apply));JSONArray saved=new JSONObject(database.snapshot()).getJSONArray("records");assertEquals(5,saved.length());
                    for(int i=0;i<old.length();i++) {
                        JSONObject expected=new JSONObject(old.getJSONObject(i).toString()),actual=new JSONObject(byName(saved,expected.getString("name")).toString());
                        expected.put("manualContent","替换正文"+i+UNICODE);expected.remove("updatedAt");actual.remove("updatedAt");assertTrue("Complete metadata and retained raw body",BackupValidation.same(expected,actual));
                    }
                    expectedSnapshot=database.snapshot();
                }
            }
            try(LogbookDatabase reopened=new LogbookDatabase(context,databaseName,true,()->FREE)){assertEquals(2,reopened.revision());assertEquals(expectedSnapshot,reopened.snapshot());}
        }finally{context.deleteDatabase(databaseName);remove(root);}
    }

    @Test public void alternatingSmallLargeMetadataAndManualKindsRemainIndependentAcrossOwners()throws Exception {
        String databaseName="public-metadata-alternating-"+UUID.randomUUID()+".sqlite";File root=new File(context.getCacheDir(),"public-metadata-alternating-"+UUID.randomUUID());assertTrue(root.mkdir());
        try(LogbookDatabase database=new LogbookDatabase(context,databaseName,true,()->FREE)) {
            JSONObject initial=fixture();database.replace(initial.toString(),0);String large=String.join("",Collections.nCopies(30000,"中😀"))+UNICODE,largeBody=String.join("",Collections.nCopies(35000,"正文😀"))+UNICODE;
            for(int lease=0;lease<2;lease++) {
                String before=database.snapshot(),prefix="独立租约"+lease,module="公开metadata"+lease;JSONArray old=new JSONObject(before).getJSONArray("records");long revision=database.revision();
                String[] names={prefix+UNICODE,prefix+large,prefix+"空正文"+UNICODE,prefix+"尾"+UNICODE};
                String[] links={"https://log.weizaima.com/?key=public-metadata-"+lease,"","",""};String[] bodies={null,largeBody,"",UNICODE};JSONObject[] candidates=new JSONObject[names.length];
                for(int i=0;i<names.length;i++)candidates[i]=row(module,names[i],links[i],bodies[i]);
                try(TableSession owner=new TableSession(root,"public",revision,"record-table","public.csv",()->FREE)) {
                    capture(owner);JSONObject preview=owner.preview(database,send(owner,candidates),initial.getJSONObject("settings"));assertEquals(4,preview.getInt("added"));assertEquals(0,preview.getInt("updated"));assertEquals(0,preview.getInt("skipped"));assertEquals(before,database.snapshot());
                    for(int i=0;i<names.length;i++)assertEquals(module+" / "+names[i],preview.getJSONArray("names").getString(i));
                    owner.prepareCommit();assertEquals(revision+1,database.edit(revision,owner::apply));JSONArray saved=new JSONObject(database.snapshot()).getJSONArray("records");assertEquals(old.length()+4,saved.length());assertOldRows(old,saved);
                    for(int i=0;i<names.length;i++){JSONObject record=byName(saved,names[i]);assertEquals(links[i],record.optString("link"));if(bodies[i]==null)assertFalse(record.has("manualContent"));else assertEquals(bodies[i],record.getString("manualContent"));}
                }
            }
        }finally{context.deleteDatabase(databaseName);remove(root);}
    }

    @Test public void combinedAndBothMetadataStorageChecksStillRejectFallingCapacity()throws Exception {
        for(int failAt:new int[]{2,3,4,0}) {
            String databaseName="public-metadata-space-"+UUID.randomUUID()+".sqlite";File root=new File(context.getCacheDir(),"public-metadata-space-"+UUID.randomUUID());assertTrue(root.mkdir());
            try(LogbookDatabase database=new LogbookDatabase(context,databaseName,true,()->FREE)) {
                JSONObject initial=fixture(),module=initial.getJSONArray("modules").getJSONObject(0);module.put("kps",new JSONArray()).put("pairs",new JSONArray());database.replace(initial.toString(),0);String before=database.snapshot();int[] checks={0};boolean[] checking={false};
                try(TableSession owner=new TableSession(root,"public",1,"record-table","public.csv",()->checking[0]&&++checks[0]==failAt?StorageBudget.MINIMUM_RESERVE:FREE,true)) {
                    capture(owner);owner.prepareSeed(database,initial.getJSONObject("settings"),()->{},false);BackupSession.Proof proof=send(owner,row(module.getString("name"),UNICODE,"https://log.weizaima.com/?key=public-metadata-space",null));checking[0]=true;
                    try {
                        JSONObject preview=owner.preview(database,proof,initial.getJSONObject("settings"));assertEquals("Only the control may complete",0,failAt);assertEquals(1,preview.getInt("added"));assertEquals("Candidate, combined, two metadata and two notice checks",6,checks[0]);
                    }catch(IOException expected){if(failAt==0)throw expected;assertEquals("Live capacity failure occurs at the original check",failAt,checks[0]);}
                    finally{checking[0]=false;}
                    assertEquals(before,database.snapshot());assertEquals(1,database.revision());
                    if(failAt==0){owner.prepareCommit();assertEquals(2,database.edit(1,owner::apply));assertEquals(UNICODE,byName(new JSONObject(database.snapshot()).getJSONArray("records"),UNICODE).getString("name"));}
                    else try{owner.prepareCommit();fail("Partial metadata preview became committable");}catch(IOException expected){}
                }
            }finally{context.deleteDatabase(databaseName);remove(root);}
        }
    }

    @Test public void exactSmallAsciiBudgetIsNotRejectedByACharacterUpperBound()throws Exception {
        String databaseName="public-metadata-exact-space-"+UUID.randomUUID()+".sqlite";File root=new File(context.getCacheDir(),"public-metadata-exact-space-"+UUID.randomUUID());assertTrue(root.mkdir());
        try(LogbookDatabase database=new LogbookDatabase(context,databaseName,true,()->FREE)) {
            JSONObject initial=fixture(),module=initial.getJSONArray("modules").getJSONObject(0);module.put("kps",new JSONArray()).put("pairs",new JSONArray());database.replace(initial.toString(),0);String before=database.snapshot(),name=String.join("",Collections.nCopies(10000,"A"));boolean[] constrained={false};
            try(TableSession owner=new TableSession(root,"public",1,"record-table","public.csv",()->constrained[0]?StorageBudget.MINIMUM_RESERVE+4L*1024*1024+60000:FREE,true)) {
                capture(owner);owner.prepareSeed(database,initial.getJSONObject("settings"),()->{},false);BackupSession.Proof proof=send(owner,row(module.getString("name"),name,"https://log.weizaima.com/?key=public-metadata-exact-space",null));constrained[0]=true;
                JSONObject preview;try{preview=owner.preview(database,proof,initial.getJSONObject("settings"));}finally{constrained[0]=false;}
                assertEquals(1,preview.getInt("added"));assertEquals(before,database.snapshot());owner.prepareCommit();assertEquals(2,database.edit(1,owner::apply));assertEquals(name,byName(new JSONObject(database.snapshot()).getJSONArray("records"),name).getString("name"));
            }
        }finally{context.deleteDatabase(databaseName);remove(root);}
    }
}
