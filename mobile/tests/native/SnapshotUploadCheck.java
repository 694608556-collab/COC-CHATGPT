package coc.logbook;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
final class SnapshotUploadCheck {
 static String hash(byte[] bytes) throws Exception { StringBuilder s=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))s.append(String.format("%02x",b&255));return s.toString(); }
 static void rejected(Action a) throws Exception { try { a.run(); } catch(Exception ok) { return; } throw new AssertionError("Expected rejection"); }
 interface Action { void run() throws Exception; }
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
  rejected(()->upload.begin("tree",8,64L*1024*1024+1,hash(bytes)));
  System.out.println("Snapshot upload: ordered bounded bytes/hash, stale token, incomplete/duplicate rejection, failed commit and cleanup passed");
 }
}
