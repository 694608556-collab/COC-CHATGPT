package coc.logbook;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import android.content.Context;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.UUID;

/** Only random test databases in the separate debug package; never the user's database. */
@RunWith(AndroidJUnit4.class)
public class SnapshotStreamTest {
    private String indexed(String json){java.util.Map<String,String> fields=JsonFields.split(json);String records=fields.remove("records");java.util.Map<String,String> canonical=new java.util.LinkedHashMap<>(new java.util.TreeMap<>(fields));canonical.put("records",records);return JsonFields.join(canonical);}
    private static final String SAMPLE="{\"schemaVersion\":2,\"exportedAt\":\"date\",\"modules\":[{\"id\":\"m\"}],\"records\":[{\"id\":\"r\",\"moduleId\":\"m\",\"rawContent\":{\"messages\":[{\"text\":\"public😀\",\"raw\":900719925474099312345}]}}],\"characters\":[],\"settings\":{}}";
    private void refuses(String text) throws Exception {
        try { SnapshotStream.validate(new StringReader(text)); fail("Invalid snapshot accepted"); } catch (Exception expected) { }
    }
    @Test public void validatesStructureWithoutDecodingBodies() throws Exception {
        SnapshotStream.validate(new StringReader(SAMPLE));
        refuses(SAMPLE.replace("\"schemaVersion\":2","\"schemaVersion\":3"));
        refuses(SAMPLE.replace("\"schemaVersion\":2","\"schemaVersion\":2,\"schemaVersion\":2"));
        refuses(SAMPLE.replace("\"moduleId\":\"m\"","\"moduleId\":\"missing\""));
        refuses(SAMPLE.replace("\"settings\":{}","\"settings\":[]"));
        refuses(SAMPLE.replace("\"characters\":[],", ""));
        refuses(SAMPLE.replace("\"characters\":[]","\"characters\":[{\"id\":\"same\"},{\"id\":\"same\"}]"));
        refuses(SAMPLE+"{}");
        refuses(SAMPLE.replace("\"public😀\"","not_json"));
    }
    @Test public void stringSpansPreserveEscapesBoundariesAndStrictValidation() throws Exception {
        for(int length:new int[]{0,1,7,8191,32767,32768,65536})for(int chunk:new int[]{1,7,32768}) {
            String padding=new String(new char[length]).replace('\0','中');
            String token="\""+padding+"\\\"\\\\\\n\\u4e2d😀\"";
            String json="{\"ke\\u0079\":"+token+",\"discard\":"+token+",\"tail\":\"end\"}";
            Reader input=new StringReader(json){@Override public int read(char[] b,int o,int n)throws IOException{return super.read(b,o,Math.min(n,chunk));}};
            java.util.Map<String,String> values=new java.util.LinkedHashMap<>();
            try(SnapshotJson cursor=new SnapshotJson(input)) {
                cursor.object(name->{if(name.equals("discard"))cursor.discardString();else values.put(name,cursor.string());});cursor.end();
            }
            assertEquals(padding+"\"\\\n中😀",values.get("key"));assertEquals("end",values.get("tail"));
            refuses(SAMPLE.replace("public😀",padding+"\n"));
            refuses(SAMPLE.replace("public😀",padding+"\\q"));
            refuses(SAMPLE.replace("public😀",padding+"\\u12x4"));
        }
    }
    @Test public void rejectsMalformedUtf8BeforeCommit() throws Exception {
        File file=File.createTempFile("public-snapshot-",".json",InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir());
        try {
            try(OutputStream out=new FileOutputStream(file)){out.write(SAMPLE.getBytes(StandardCharsets.UTF_8));out.write(new byte[]{(byte)0xc3,0x28});}
            try {SnapshotStream.validate(Files.newBufferedReader(file.toPath(),StandardCharsets.UTF_8));fail("Malformed UTF8 accepted");}catch(Exception expected){}
        } finally {assertTrue(file.delete());}
    }
    @Test public void streamsUnicodeAndRejectsStaleCas() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();String name="public-stream-"+UUID.randomUUID()+".sqlite";
        try(LogbookDatabase db=new LogbookDatabase(context,name)) {
            assertEquals(1,db.replace(SAMPLE,0));
            String large=SAMPLE.replace("public😀",new String(new char[65520]).replace('\0','中')+"😀末尾");
            SnapshotStream.validate(new StringReader(large));
            assertEquals(2,db.replace(new StringReader(large),1)); assertEquals(indexed(large),db.snapshot());
            try{db.replace(new StringReader(SAMPLE),1);fail("Stale CAS accepted");}catch(IllegalStateException expected){}
            assertEquals(2,db.revision()); assertEquals(indexed(large),db.snapshot());
        } finally {context.deleteDatabase(name);}
    }
    @Test public void ioFailureRollsBackChunksFieldsAndRevision() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();String name="public-rollback-"+UUID.randomUUID()+".sqlite";
        try(LogbookDatabase db=new LogbookDatabase(context,name)) {
            db.replace(SAMPLE,0); db.releaseReadCache();
            Reader broken=new Reader(){int count;public int read(char[] buffer,int offset,int length)throws IOException{if(count++>1)throw new IOException("public injected read failure");java.util.Arrays.fill(buffer,offset,offset+length,'x');return length;}public void close(){}};
            try{db.replace(broken,1);fail("Partial stream committed");}catch(IOException expected){}
            assertEquals(1,db.revision()); assertEquals(indexed(SAMPLE),db.snapshot());
        } finally {context.deleteDatabase(name);}
    }
    @Test public void bulkBodyWritesPreserveSurrogateAndRawTokenBoundaries()throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();String name="public-body-spans-"+UUID.randomUUID()+".sqlite";
        int prefix="{\"messages\":[{\"text\":\"".length();
        try(LogbookDatabase db=new LogbookDatabase(context,name)) {
            int index=0;
            for(int length:new int[]{65534-prefix,65535-prefix,65536-prefix,131070-prefix,131071-prefix,131072-prefix}) {
                String padding=new String(new char[length]).replace('\0','中');
                String candidate=SAMPLE.replace("\"public😀\"",org.json.JSONObject.quote(padding+"😀\n\u0000完整末尾"));
                assertEquals(++index,db.replace(new StringReader(candidate),index-1));
                assertEquals(indexed(candidate),db.snapshot());
            }
        }finally{context.deleteDatabase(name);}
    }
}
