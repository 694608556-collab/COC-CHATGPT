package coc.logbook;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.Deflater;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Real Android decompression and private staging: original bytes/hash and cleanup remain authoritative. */
@RunWith(AndroidJUnit4.class)
public class SnapshotUploadEncodedTest {
 private static String hash(byte[] bytes)throws Exception{MessageDigest d=MessageDigest.getInstance("SHA-256");return hex(d.digest(bytes));}
 private static String hex(byte[] bytes){StringBuilder s=new StringBuilder();for(byte b:bytes)s.append(String.format("%02x",b&255));return s.toString();}
 private static byte[] zip(byte[] bytes)throws Exception {
  Deflater deflater=new Deflater(1);deflater.setInput(bytes);deflater.finish();
  try(ByteArrayOutputStream output=new ByteArrayOutputStream()){byte[] buffer=new byte[8192];while(!deflater.finished()){int n=deflater.deflate(buffer);output.write(buffer,0,n);}return output.toByteArray();}finally{deflater.end();}
 }
 private static File directory()throws Exception{File dir=new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir(),"public-encoded-upload-"+UUID.randomUUID());assertTrue(dir.mkdirs());return dir;}
 private interface Failure{void run()throws Exception;}
 private static void rejects(Failure action)throws Exception{try{action.run();fail("Invalid transport reached acceptance");}catch(Exception expected){}}
 @Test public void complete68MiBAndMixedWireFormatsRetainAllOriginalBytes()throws Exception {
  File dir=directory();try(SnapshotUpload upload=new SnapshotUpload(dir)) {
   byte[] block=new byte[2*1024*1024];Arrays.fill(block,(byte)'x');byte[] sentinel="完整中文😀\u0000\\\"".getBytes(StandardCharsets.UTF_8);System.arraycopy(sentinel,0,block,262140,sentinel.length);
   byte[] wire=zip(block);MessageDigest digest=MessageDigest.getInstance("SHA-256");for(int i=0;i<34;i++)digest.update(block);String expected=hex(digest.digest());
   String id=upload.begin("public-tree",7,68L*1024*1024,expected);
   for(int i=0;i<34;i++)upload.appendEncoded(id,i,"zlib",block.length,wire);
   upload.finish(id,(file,tree,revision)->{
    assertEquals(68L*1024*1024,file.length());assertEquals(7,revision);MessageDigest actual=MessageDigest.getInstance("SHA-256");try(InputStream input=new FileInputStream(file)){byte[] chunk=new byte[65536];int n;while((n=input.read(chunk))!=-1)actual.update(chunk,0,n);}assertEquals(expected,hex(actual.digest()));return null;
   });
   byte[] tail="尾段完整😀".getBytes(StandardCharsets.UTF_8),all=new byte[block.length+tail.length];System.arraycopy(block,0,all,0,block.length);System.arraycopy(tail,0,all,block.length,tail.length);
   String mixed=upload.begin("public-tree",8,all.length,hash(all));upload.appendEncoded(mixed,0,"zlib",block.length,wire);upload.appendEncoded(mixed,1,"identity",tail.length,tail);
   upload.finish(mixed,(file,tree,revision)->{assertArrayEquals(all,Files.readAllBytes(file.toPath()));return null;});assertEquals(0,dir.list().length);
  }finally{assertEquals(0,dir.list().length);assertTrue(dir.delete());}
 }
 @Test public void corruptTruncatedTrailingOversizedAndWrongOrdinalCannotLeavePartialUploads()throws Exception {
  File dir=directory();try(SnapshotUpload upload=new SnapshotUpload(dir)) {
   byte[] full=new byte[2*1024*1024];Arrays.fill(full,(byte)'x');byte[] wire=zip(full),corrupt=wire.clone();corrupt[corrupt.length-1]^=1;
   byte[] twice=new byte[wire.length*2];System.arraycopy(wire,0,twice,0,wire.length);System.arraycopy(wire,0,twice,wire.length,wire.length);
   for(byte[] bad:new byte[][]{new byte[0],Arrays.copyOf(wire,wire.length-1),corrupt,Arrays.copyOf(wire,wire.length+1),twice,new byte[262145]}) {
    String id=upload.begin("public-tree",1,full.length,hash(full));rejects(()->upload.appendEncoded(id,0,"zlib",full.length,bad));assertFalse(upload.active());assertEquals(0,dir.list().length);
   }
   for(int length:new int[]{0,full.length-1,full.length+1}) {
    String id=upload.begin("public-tree",1,full.length+1,hash(full));rejects(()->upload.appendEncoded(id,0,"zlib",length,wire));assertFalse(upload.active());assertEquals(0,dir.list().length);
   }
   String wrong=upload.begin("public-tree",1,full.length,hash(full));rejects(()->upload.appendEncoded(wrong,1,"zlib",full.length,wire));assertFalse(upload.active());
   String token=upload.begin("public-tree",1,full.length,hash(full));rejects(()->upload.appendEncoded("other-owner",0,"zlib",full.length,wire));assertTrue(upload.active());upload.appendEncoded(token,0,"zlib",full.length,wire);upload.cancel(token);
   String badHash=upload.begin("public-tree",1,full.length,String.join("",Collections.nCopies(64,"0")));upload.appendEncoded(badHash,0,"zlib",full.length,wire);rejects(()->upload.finish(badHash,(file,tree,revision)->{fail("Bad original hash reached commit");return null;}));
   assertEquals(0,dir.list().length);
  }finally{assertEquals(0,dir.list().length);assertTrue(dir.delete());}
 }
}
