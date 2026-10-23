package coc.logbook;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Complete public bytes and real space checks at the source writer boundary. */
@RunWith(AndroidJUnit4.class)
public final class BackupCaptureBufferTest {
    private File directory(){return new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir(),"public-capture-"+UUID.randomUUID());}
    private String source(){return "{\"body\":\""+String.join("",Collections.nCopies(150000,"完整😀正文"))+"\",\"tail\":\"PUBLIC_END\"}";}
    @Test public void sourceWritesKeepCompleteUtf8AndAvoidPerSmallChunkVolumeQueries()throws Exception{
        String text=source();byte[] expected=text.getBytes(StandardCharsets.UTF_8);
        for(boolean searching:new boolean[]{false,true}){
            File directory=directory();int[] queries={0};
            try(BackupSession owner=new BackupSession(directory,"",7,false,false,searching,()->{queries[0]++;return 1024L*1024*1024;})){
                BackupSession.Proof proof=owner.captureJson(writer->{for(int at=0;at<text.length();at+=4093)writer.write(text,at,Math.min(4093,text.length()-at));});
                proof.matches(expected.length,BackupSession.digestHex(MessageDigest.getInstance("SHA-256").digest(expected)));
                assertArrayEquals(expected,Files.readAllBytes(owner.file("source").toPath()));
                assertTrue("Each actual bounded write must recheck space without thousands of 8KiB probes: "+queries[0],queries[0]<=3+expected.length/(128*1024));
            }finally{assertTrue(directory.delete());}
        }
    }
    @Test public void spaceLossBeforeALaterWriteRejectsTheCompleteProofAndCleansOnlyItsOwnSource()throws Exception{
        File directory=directory();int[] queries={0};String text=source();
        try(BackupSession owner=new BackupSession(directory,"",7,false,false,true,()->++queries[0]>=3?1:1024L*1024*1024)){
            try{owner.captureJson(writer->writer.write(text));fail("A later write ignored its current volume budget");}catch(IOException expected){}
            File[] partial=directory.listFiles();assertNotNull(partial);assertEquals(1,partial.length);
            assertTrue(partial[0].length()>0&&partial[0].length()<text.getBytes(StandardCharsets.UTF_8).length);
        }finally{assertEquals(0,Objects.requireNonNull(directory.list()).length);assertTrue(directory.delete());}
    }
    @Test public void producerFailureCannotFlushOrPublishItsUnfinishedTail()throws Exception{
        File directory=directory();IOException failure=new IOException("public producer failure");
        try(BackupSession owner=new BackupSession(directory,"",7,false,false,true,()->1024L*1024*1024)){
            try{owner.captureJson(writer->{writer.write(source());throw failure;});fail("Incomplete producer returned a proof");}catch(IOException actual){assertSame(failure,actual);}
        }finally{assertEquals(0,Objects.requireNonNull(directory.list()).length);assertTrue(directory.delete());}
    }
}
