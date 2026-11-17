package coc.logbook;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
final class SnapshotUploadCheck {
 static String hash(byte[] bytes) throws Exception { StringBuilder s=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))s.append(String.format("%02x",b&255));return s.toString(); }
 static void rejected(Action a) throws Exception { try { a.run(); } catch(Exception ok) { return; } throw new AssertionError("Expected rejection"); }
 interface Action { void run() throws Exception; }
 static byte[] zlib(byte[] bytes) throws Exception {
  java.util.zip.Deflater deflater=new java.util.zip.Deflater(1);deflater.setInput(bytes);deflater.finish();
  try(java.io.ByteArrayOutputStream output=new java.io.ByteArrayOutputStream()) {
   byte[] buffer=new byte[8192];while(!deflater.finished()){int n=deflater.deflate(buffer);output.write(buffer,0,n);}return output.toByteArray();
  }finally{deflater.end();}
 }
 public static void main(String[] args) throws Exception {
  java.io.File dir=Files.createTempDirectory("snapshot-upload").toFile();
  SnapshotUpload upload=new SnapshotUpload(dir);byte[] bytes="{\"中文\":\"😀\"}".getBytes(StandardCharsets.UTF_8);
  String id=upload.begin("tree",7,bytes.length,hash(bytes));
  rejected(()->upload.append("wrong",0,bytes));
  upload.append(id,0,bytes);
  long result=upload.finish(id,(f,t,r)->{if(!t.equals("tree")||r!=7||!java.util.Arrays.equals(Files.readAllBytes(f.toPath()),bytes))throw new AssertionError();return r+1;});
  if(result!=8||dir.list().length!=0)throw new AssertionError();
  id=upload.begin("tree",8,bytes.length,hash(bytes)); final String incomplete=id;
  rejected(()->upload.finish(incomplete,(f,t,r)->r));if(dir.list().length!=0)throw new AssertionError();
  final String outOfOrder=upload.begin("tree",8,bytes.length,hash(bytes));rejected(()->upload.append(outOfOrder,1,bytes));
  final String duplicate=upload.begin("tree",8,bytes.length,hash(bytes));upload.append(duplicate,0,bytes);rejected(()->upload.append(duplicate,0,new byte[0]));
  final String badHash=upload.begin("tree",8,bytes.length,"0".repeat(64));upload.append(badHash,0,bytes);rejected(()->upload.finish(badHash,(f,t,r)->r));
  final String failedCommit=upload.begin("tree",8,bytes.length,hash(bytes));upload.append(failedCommit,0,bytes);rejected(()->upload.finish(failedCommit,(f,t,r)->{throw new Exception("CAS denied");}));
  final String canceled=upload.begin("tree",8,bytes.length,hash(bytes));upload.cancel("wrong");upload.append(canceled,0,bytes);upload.cancel(canceled);upload.cancel(canceled);
  final String stale=upload.begin("tree",8,bytes.length,hash(bytes));upload.append(stale,0,bytes);
  // Closing a canceled transfer leaves no private bytes; actual process death is tested on device.
  upload.close();new SnapshotUpload(dir).close();if(dir.list().length!=0)throw new AssertionError();
  byte[] chunk=new byte[256*1024];java.util.Arrays.fill(chunk,(byte)'x');MessageDigest largeHash=MessageDigest.getInstance("SHA-256");
  for(int i=0;i<272;i++)largeHash.update(chunk);
  StringBuilder hex=new StringBuilder();for(byte b:largeHash.digest())hex.append(String.format("%02x",b&255));
  String large=upload.begin("tree",8,68L*1024*1024,hex.toString());for(int i=0;i<272;i++)upload.append(large,i,chunk);
  upload.finish(large,(file,tree,revision)->{if(file.length()!=68L*1024*1024||revision!=8)throw new AssertionError("Large upload truncated");return null;});
  if(dir.list().length!=0)throw new AssertionError("Large upload leaked");
  byte[] expanded=new byte[2*1024*1024];java.util.Arrays.fill(expanded,(byte)'x');
  byte[] sentinel="完整中文😀\u0000\\\"900719925474099312345".getBytes(StandardCharsets.UTF_8);System.arraycopy(sentinel,0,expanded,262140,sentinel.length);
  byte[] compressed=zlib(expanded);if(compressed.length>=256*1024)throw new AssertionError("Public sample did not compress");
  final String packed=upload.begin("tree",9,expanded.length,hash(expanded));
  upload.appendEncoded(packed,0,"zlib",expanded.length,compressed);
  upload.finish(packed,(file,tree,revision)->{if(revision!=9||!java.util.Arrays.equals(Files.readAllBytes(file.toPath()),expanded))throw new AssertionError("Lossless transport changed original bytes");return null;});
  if(dir.list().length!=0)throw new AssertionError("Compressed upload leaked");
  byte[] corrupt=compressed.clone();corrupt[corrupt.length-1]^=1;
  byte[] trailing=java.util.Arrays.copyOf(compressed,compressed.length+1);
  byte[] concatenated=new byte[compressed.length*2];System.arraycopy(compressed,0,concatenated,0,compressed.length);System.arraycopy(compressed,0,concatenated,compressed.length,compressed.length);
  for(byte[] invalid:new byte[][]{new byte[0],java.util.Arrays.copyOf(compressed,compressed.length-1),corrupt,trailing,concatenated,new byte[256*1024+1]}) {
   String rejected=upload.begin("tree",9,expanded.length,hash(expanded));
   rejected(()->upload.appendEncoded(rejected,0,"zlib",expanded.length,invalid));
   if(upload.active()||dir.list().length!=0)throw new AssertionError("Invalid compressed data retained a partial upload");
  }
  for(int declared:new int[]{0,expanded.length-1,expanded.length+1}) {
   String rejected=upload.begin("tree",9,expanded.length+1,hash(expanded));
   rejected(()->upload.appendEncoded(rejected,0,"zlib",declared,compressed));
   if(upload.active()||dir.list().length!=0)throw new AssertionError("Invalid expanded length retained an upload");
  }
  final String badOrder=upload.begin("tree",9,expanded.length,hash(expanded));rejected(()->upload.appendEncoded(badOrder,1,"zlib",expanded.length,compressed));
  final String badEncoding=upload.begin("tree",9,expanded.length,hash(expanded));rejected(()->upload.appendEncoded(badEncoding,0,"gzip",expanded.length,compressed));
  final String wrongIdentity=upload.begin("tree",9,bytes.length+1,hash(bytes));rejected(()->upload.appendEncoded(wrongIdentity,0,"identity",bytes.length+1,bytes));
  final String otherOwner=upload.begin("tree",9,expanded.length,hash(expanded));
  rejected(()->upload.appendEncoded("wrong-owner",0,"zlib",expanded.length,compressed));upload.appendEncoded(otherOwner,0,"zlib",expanded.length,compressed);upload.cancel(otherOwner);
  final String wrongFullHash=upload.begin("tree",9,expanded.length,"0".repeat(64));upload.appendEncoded(wrongFullHash,0,"zlib",expanded.length,compressed);
  rejected(()->upload.finish(wrongFullHash,(file,tree,revision)->{throw new AssertionError("Corrupt full hash reached commit");}));
  byte[] plainBlock=new byte[2*1024*1024];java.util.Arrays.fill(plainBlock,(byte)'x');byte[] packedBlock=zlib(plainBlock);
  String largeEncoded=upload.begin("tree",10,68L*1024*1024,hex.toString());for(int i=0;i<34;i++)upload.appendEncoded(largeEncoded,i,"zlib",plainBlock.length,packedBlock);
  upload.finish(largeEncoded,(file,tree,revision)->{if(file.length()!=68L*1024*1024||revision!=10||!BackupHash(file).equals(hex.toString()))throw new AssertionError("Large compressed upload lost original bytes");return null;});
  if(dir.list().length!=0)throw new AssertionError("Compressed checks leaked a private spool");
  System.out.println("Snapshot upload: ordered bounded bytes/hash, stale token, incomplete/duplicate rejection, failed commit and cleanup passed");
 }
 static String BackupHash(java.io.File file)throws Exception {
  MessageDigest hash=MessageDigest.getInstance("SHA-256");try(java.io.InputStream input=new java.io.FileInputStream(file)){byte[] block=new byte[65536];int n;while((n=input.read(block))!=-1)hash.update(block,0,n);}StringBuilder text=new StringBuilder();for(byte b:hash.digest())text.append(String.format("%02x",b&255));return text.toString();
 }
}
