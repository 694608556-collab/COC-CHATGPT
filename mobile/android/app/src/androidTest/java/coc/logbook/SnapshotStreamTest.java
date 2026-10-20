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
}
