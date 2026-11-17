package coc.logbook;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** The same immutable candidate must pass complete grammar, identity and graph checks on either path. */
@RunWith(AndroidJUnit4.class)
public class SnapshotValidationTest {
 private static final String SAMPLE="{\"schemaVersion\":2,\"exportedAt\":\"date\",\"modules\":[{\"id\":\"m\"}],\"records\":[{\"id\":\"r\",\"moduleId\":\"m\",\"rawContent\":{\"messages\":[{\"text\":\"公开中文😀\",\"raw\":900719925474099312345}]}}],\"characters\":[],\"settings\":{}}";
 @Test public void fullCandidateReadsExactlyAndMalformedOrUnrelatedContentNeverPasses()throws Exception {
  File file=File.createTempFile("public-snapshot-validation-",".json",InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir());
  try {
   String[] variants={SAMPLE,SAMPLE.replace("公开中文😀",new String(new char[100000]).replace('\0','中')+"😀末尾"),
    SAMPLE.replace("\"moduleId\":\"m\"","\"moduleId\":\"missing\""),SAMPLE.replace("\"id\":\"r\"","\"id\":123"),
    SAMPLE.replace("\"id\":\"r\"","\"id\":\"r\",\"\\u0069d\":\"r\""),SAMPLE.replace("\"schemaVersion\":2","\"schemaVersion\":2e0"),
    SAMPLE.replace("\"schemaVersion\":2","\"schemaVersion\":\"2\""),SAMPLE.replace("\"settings\":{}","\"settings\":[]"),
    SAMPLE.replace("\"raw\":900719925474099312345","\"raw\":{\"unused\":[1,]}"),SAMPLE.replace("\"characters\":[],",""),
    SAMPLE+"{}",SAMPLE.replace("公开中文😀","invalid\\q"),SAMPLE.replace("公开中文😀","invalid\n")};
   for(String text:variants) {
    boolean expected;try{SnapshotStream.validate(new StringReader(text));expected=true;}catch(Exception invalid){expected=false;}
    Files.write(file.toPath(),text.getBytes(StandardCharsets.UTF_8));
    for(long budget:new long[]{0,16L*1024*1024}) {
     boolean accepted=false;try(Reader input=SnapshotStream.openValidated(file,budget)) {
      StringWriter output=new StringWriter();char[] block=new char[8192];int n;while((n=input.read(block))!=-1)output.write(block,0,n);
      assertEquals(text,output.toString());accepted=true;
     }catch(IllegalArgumentException|IOException invalid){}
     assertEquals("Native acceleration must not change complete validation",expected,accepted);
    }
   }
   Files.write(file.toPath(),new byte[]{(byte)0xc3,0x28});
   try(Reader ignored=SnapshotStream.openValidated(file,16L*1024*1024)){fail("Malformed UTF-8 accepted");}catch(IOException|IllegalArgumentException expected){}
  }finally{assertTrue(file.delete());}
 }
}
