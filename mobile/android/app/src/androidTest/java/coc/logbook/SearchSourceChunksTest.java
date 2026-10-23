package coc.logbook;

import android.database.sqlite.SQLiteDatabase;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.*;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Only public invented records; all event files are independently read and hashed. */
@RunWith(AndroidJUnit4.class)
public final class SearchSourceChunksTest {
    private static final long BUDGET=32L*1024*1024;
    private static final String PREFIX="{\"snapshot\":";
    private File directory(){return new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir(),"public-search-chunks-"+UUID.randomUUID());}
    private String hash(byte[] bytes)throws Exception{return BackupSession.digestHex(MessageDigest.getInstance("SHA-256").digest(bytes));}
    private BackupSession owner(File directory,boolean searching)throws Exception{return new BackupSession(directory,"",7,false,false,searching,()->1024L*1024*1024);}
    private Set<String> fill(SQLiteDatabase db,int count,int large)throws Exception{
        IndexedSnapshot.create(db);JSONArray records=new JSONArray();Set<String> ids=new LinkedHashSet<>();
        for(int i=0;i<count;i++){
            String id="public-"+i;ids.add(id);
            String text=(large>0&&i==0?String.join("",Collections.nCopies(large,"x")):"完整😀")+"BODY_END_"+i;
            JSONObject message=new JSONObject().put("id","message-"+i).put("order",i).put("displayName","Public reader").put("text",text).put("type","text").put("isDiceCommand",false).put("isOffTopic",false).put("images",new JSONArray()).put("raw",new JSONObject().put("tail","RAW_END_"+i));
            records.put(new JSONObject().put("id",id).put("moduleId","public-module").put("rawContent",new JSONObject().put("parserVersion",1).put("messages",new JSONArray().put(message))).put("manualContent","完整手动😀MANUAL_END_"+i));
        }
        new IndexedSnapshot(db,false,()->Long.MAX_VALUE).replace(new StringReader(new JSONObject().put("schemaVersion",2).put("records",records).toString()));return ids;
    }
    private String full(SQLiteDatabase db,Set<String> ids)throws Exception{StringWriter out=new StringWriter();new IndexedSnapshot(db).write(out,ids);return PREFIX+out+"}";}
    private void cleaned(File directory){assertEquals(0,Objects.requireNonNull(directory.list()).length);assertTrue(directory.delete());}
    private void compareStream(int count,int large)throws Exception{
        File directory=directory();
        try(SQLiteDatabase db=SQLiteDatabase.create(null);BackupSession owner=owner(directory,true)){
            Set<String> ids=fill(db,count,large);String original=full(db,ids);
            ByteArrayOutputStream ordinary=new ByteArrayOutputStream();SearchSnapshot.write(db,ordinary,ids,BUDGET,PREFIX);
            ByteArrayOutputStream joined=new ByteArrayOutputStream();List<String> kinds=new ArrayList<>();List<byte[]> parts=new ArrayList<>();
            SearchSourceChunks[] stream={null};BackupSession.Proof[] ledger={null};
            BackupSession.Proof source=owner.captureBytes(output->{
                stream[0]=new SearchSourceChunks(owner,output,BUDGET,(index,kind,key)->{
                    assertEquals(kinds.size(),index);byte[] bytes=Files.readAllBytes(owner.file(key).toPath());
                    owner.proof(key).matches(bytes.length,hash(bytes));joined.write(bytes);kinds.add(kind);parts.add(bytes);
                });
                ledger[0]=SearchSnapshot.write(db,stream[0],ids,BUDGET,PREFIX,null,stream[0]);
            });
            assertArrayEquals(ordinary.toByteArray(),joined.toByteArray());
            assertArrayEquals(joined.toByteArray(),Files.readAllBytes(owner.file("source").toPath()));
            source.matches(joined.size(),hash(joined.toByteArray()));
            byte[] originalBytes=original.getBytes(StandardCharsets.UTF_8);ledger[0].matches(originalBytes.length,hash(originalBytes));
            assertEquals(original,full(db,ids));assertEquals(kinds.size(),stream[0].count());
            assertEquals("root",kinds.get(0));assertEquals("tail",kinds.get(kinds.size()-1));
            assertEquals("]}}",new String(parts.get(parts.size()-1),StandardCharsets.UTF_8));
            assertTrue(new String(parts.get(0),StandardCharsets.UTF_8).endsWith("\"records\":["));
            int read=0;
            for(int index=1;index<parts.size()-1;index++){
                assertEquals("records",kinds.get(index));String body=new String(parts.get(index),StandardCharsets.UTF_8);
                if(index==1)assertFalse(body.startsWith(","));else{assertTrue(body.startsWith(","));body=body.substring(1);}
                JSONArray records=new JSONArray("["+body+"]");assertTrue(records.length()>=1&&records.length()<=4);
                for(int j=0;j<records.length();j++)assertEquals("public-"+read++,records.getJSONObject(j).getString("id"));
            }
            assertEquals(count,read);
            if(large==0)assertEquals(2+(count+3)/4,parts.size());else assertTrue(parts.get(1).length>256*1024);
        }finally{cleaned(directory);}
    }
    @Test public void completeRecordGroupsConcatenateToExactSourceProofAndKeepDatabaseUntouched()throws Exception{compareStream(9,0);}
    @Test public void singleLargeRecordRemainsCompleteAcrossTransportGroupingThreshold()throws Exception{compareStream(5,300000);}
    @Test public void lateMalformedDiscardedTailCannotCompleteManifestOrFullSource()throws Exception{
        File directory=directory();
        try(SQLiteDatabase db=SQLiteDatabase.create(null);BackupSession owner=owner(directory,true)){
            Set<String> ids=fill(db,9,0);
            String bad="{\"parserVersion\":1,\"messages\":[],\"unknown\":{\"tail\":1,\"\\u0074ail\":2}}";
            db.execSQL("UPDATE indexed_bodies SET data=?,bytes=? WHERE record_key=(SELECT row_key FROM indexed_records WHERE id='public-8') AND kind='rawContent'",new Object[]{bad,bad.getBytes(StandardCharsets.UTF_8).length});
            String before=full(db,ids);List<String> kinds=new ArrayList<>();SearchSourceChunks[] stream={null};
            try{owner.captureBytes(output->{stream[0]=new SearchSourceChunks(owner,output,BUDGET,(i,kind,key)->kinds.add(kind));SearchSnapshot.write(db,stream[0],ids,BUDGET,PREFIX,null,stream[0]);});fail("Invalid late raw tail completed");}catch(SearchSnapshot.Unavailable expected){}
            assertTrue(kinds.contains("root"));assertTrue(kinds.contains("records"));assertFalse(kinds.contains("tail"));
            try{stream[0].count();fail("Incomplete manifest became publishable");}catch(IOException expected){}
            try{owner.proof("source");fail("Incomplete full source obtained a proof");}catch(IOException expected){}
            assertEquals(before,full(db,ids));
        }finally{cleaned(directory);}
    }
    @Test public void runtimeBudgetFallbackDiscardsEarlySlicesAndCapturesTheCompleteLegacySource()throws Exception{
        File directory=directory();
        try(SQLiteDatabase db=SQLiteDatabase.create(null)){
            Set<String> ids=fill(db,5,10000);String original=full(db,ids);String failedLease;List<String> events=new ArrayList<>();
            try(BackupSession owner=owner(directory,true)){
                failedLease=owner.id;SearchSourceChunks[] stream={null};
                try{owner.captureBytes(output->{stream[0]=new SearchSourceChunks(owner,output,512,(i,kind,key)->events.add(kind));SearchSnapshot.write(db,stream[0],ids,BUDGET,PREFIX,null,stream[0]);});fail("Acceleration budget was ignored");}catch(SearchSnapshot.Unavailable expected){}
                assertEquals(Collections.singletonList("root"),events);
                try{stream[0].count();fail("Fallback stream obtained a complete manifest");}catch(IOException expected){}
            }
            assertEquals(0,Objects.requireNonNull(directory.list()).length);
            try(BackupSession fallback=owner(directory,true)){
                assertNotEquals(failedLease,fallback.id);BackupSession.Proof proof=fallback.captureJson(writer->writer.write(original));
                byte[] expected=original.getBytes(StandardCharsets.UTF_8);proof.matches(expected.length,hash(expected));assertArrayEquals(expected,Files.readAllBytes(fallback.file("source").toPath()));
            }
            assertEquals(original,full(db,ids));
        }finally{cleaned(directory);}
    }
    @Test public void fragmentsRequireReadOnlySearchLeaseExactOrderAndSealedProof()throws Exception{
        File ordinary=directory(),search=directory();
        try(BackupSession owner=owner(ordinary,false)){
            try{owner.beginSearchPart(0);fail("Non-search lease created a slice");}catch(IOException expected){}
        }finally{cleaned(ordinary);}
        try(BackupSession owner=owner(search,true)){
            try{owner.beginSearchPart(1);fail("Out-of-order slice accepted");}catch(IOException expected){}
            OutputStream output=owner.beginSearchPart(0);byte[] text="完整😀END".getBytes(StandardCharsets.UTF_8);output.write(text);
            try{owner.file("search:0");fail("Unsealed slice exposed");}catch(IOException expected){}
            try{owner.proof("search:0");fail("Unsealed slice received proof");}catch(IOException expected){}
            String key=owner.finishSearchPart(0);owner.proof(key).matches(text.length,hash(text));assertArrayEquals(text,Files.readAllBytes(owner.file(key).toPath()));
            try{owner.finishSearchPart(0);fail("Duplicate seal accepted");}catch(IOException expected){}
            try{owner.beginOutput();fail("Search slice granted publication authority");}catch(IOException expected){}
        }finally{cleaned(search);}
    }
    @Test public void duplicatedTransportBudgetRequestsCompleteSingleCopyFallback()throws Exception{
        File directory=directory();byte[] complete=new byte[400];Arrays.fill(complete,(byte)'x');
        StorageBudget.Available available=()->StorageBudget.MINIMUM_RESERVE+1024;
        try{
            try(BackupSession owner=new BackupSession(directory,"",7,false,false,true,available)){
                try{owner.captureBytes(output->{output.write(complete);OutputStream part=owner.beginSearchPart(0);part.write(complete);owner.finishSearchPart(0);});fail("Internal duplicate-copy budget rejected no fallback");}
                catch(SearchSnapshot.Unavailable expectedFallback){}
                try{owner.proof("source");fail("Unfinished duplicated source obtained proof");}catch(IOException expected){}
            }
            assertEquals(0,Objects.requireNonNull(directory.list()).length);
            try(BackupSession fallback=new BackupSession(directory,"",7,false,false,true,available)){
                BackupSession.Proof proof=fallback.captureBytes(output->output.write(complete));
                proof.matches(complete.length,hash(complete));assertArrayEquals(complete,Files.readAllBytes(fallback.file("source").toPath()));
            }
        }finally{cleaned(directory);}
    }
    @Test public void coarseTransportGroupsKeepExactBytesWithoutPerRecordDurabilityOverhead()throws Exception{
        File directory=directory();
        try(SQLiteDatabase db=SQLiteDatabase.create(null);BackupSession owner=owner(directory,true)){
            Set<String> ids=fill(db,9,0);ByteArrayOutputStream expected=new ByteArrayOutputStream();SearchSnapshot.write(db,expected,ids,BUDGET,PREFIX);
            ByteArrayOutputStream joined=new ByteArrayOutputStream();List<String> kinds=new ArrayList<>();
            owner.captureBytes(output->{SearchSourceChunks chunks=new SearchSourceChunks(owner,output,BUDGET,(index,kind,key)->{kinds.add(kind);joined.write(Files.readAllBytes(owner.file(key).toPath()));},1024*1024);SearchSnapshot.write(db,chunks,ids,BUDGET,PREFIX,null,chunks);assertEquals(3,chunks.count());});
            assertEquals(Arrays.asList("root","records","tail"),kinds);assertArrayEquals(expected.toByteArray(),joined.toByteArray());owner.proof("source").matches(joined.size(),hash(joined.toByteArray()));
        }finally{cleaned(directory);}
    }
    @Test public void kernelSealedMemorySourceMatchesAllBytesCannotBeModifiedAndReleasesEveryDescriptor()throws Exception{
        File directory=directory();List<File> paths=new ArrayList<>();
        try(SQLiteDatabase db=SQLiteDatabase.create(null)){
            Set<String> ids=fill(db,9,0);String before=full(db,ids);ByteArrayOutputStream expected=new ByteArrayOutputStream();SearchSnapshot.write(db,expected,ids,BUDGET,PREFIX);
            try(BackupSession owner=owner(directory,true)){
                ByteArrayOutputStream joined=new ByteArrayOutputStream();SearchSourceChunks[] chunks={null};
                BackupSession.Proof proof=owner.captureSearchMemory(output->{chunks[0]=new SearchSourceChunks(owner,output,BUDGET,(index,kind,key)->{
                    File path=owner.file(key);paths.add(path);byte[] bytes=Files.readAllBytes(path.toPath());owner.proof(key).matches(bytes.length,hash(bytes));joined.write(bytes);
                    try(FileOutputStream write=new FileOutputStream(path)){write.write('x');fail("Kernel-sealed source remained writable");}catch(IOException expectedReadonly){}
                });SearchSnapshot.write(db,chunks[0],ids,BUDGET,PREFIX,null,chunks[0]);},BUDGET);
                paths.add(owner.file("source"));assertArrayEquals(expected.toByteArray(),joined.toByteArray());assertArrayEquals(joined.toByteArray(),Files.readAllBytes(owner.file("source").toPath()));proof.matches(joined.size(),hash(joined.toByteArray()));assertEquals(before,full(db,ids));assertEquals(0,Objects.requireNonNull(directory.list()).length);
                try{owner.beginOutput();fail("Memory search source gained write authority");}catch(IOException expectedReadonly){}
            }
            for(File path:paths)assertFalse("Closed descriptor retained a source",path.exists());
            try(BackupSession owner=owner(directory,true)){
                try{owner.captureSearchMemory(output->output.write(new byte[1025]),1024);fail("Runtime memory budget ignored");}catch(SearchSnapshot.Unavailable expectedFallback){}
            }
            try(BackupSession fallback=owner(directory,true)){byte[] bytes=before.getBytes(StandardCharsets.UTF_8);fallback.captureBytes(output->output.write(bytes)).matches(bytes.length,hash(bytes));}
        }finally{cleaned(directory);}
    }
}
