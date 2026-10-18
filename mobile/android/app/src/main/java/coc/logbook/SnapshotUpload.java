package coc.logbook;
import java.io.File;

/** One version/tree-bound private snapshot transfer. Serial bridge queue only; no caller paths. */
final class SnapshotUpload implements AutoCloseable {
 private final PdfSpool spool;
 private String id, tree, hash;
 private long revision, bytes, received;
 private int index;
 SnapshotUpload(File directory) throws Exception { spool=new PdfSpool(directory); }
 String begin(String tree,long revision,long bytes,String hash) throws Exception {
  if(id!=null)throw new IllegalStateException("已有数据正在保存。");
  if(bytes<1||bytes>PdfSpool.MAX_BYTES||hash==null||!hash.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("快照大小或摘要无效。");
  String token=spool.begin(tree);this.id=token;this.tree=tree;this.revision=revision;this.bytes=bytes;this.hash=hash;received=0;index=0;return token;
 }
 void append(String token,int position,byte[] chunk) throws Exception {
  require(token);
  try { if(position!=index||chunk.length==0||received+chunk.length>bytes)throw new IllegalArgumentException("快照分段顺序或长度不符。");spool.append(token,chunk);received+=chunk.length;index++; }
  catch(Exception error){close();throw error;}
 }
 interface Commit<T> { T commit(File file,String tree,long revision) throws Exception; }
 <T> T finish(String token,Commit<T> commit) throws Exception {
  require(token);
  try { return spool.finish(token,"snapshot.json",false,(file,location,name,size,sha)->{
   if(size!=bytes||!sha.equals(hash))throw new IllegalArgumentException("快照不完整或摘要不符，未保存。");
   return commit.commit(file,tree,revision);
  }); } finally { close(); }
 }
 void cancel(String token) throws Exception { if(id!=null&&id.equals(token))close(); }
 private void require(String token) { if(id==null||!id.equals(token))throw new IllegalArgumentException("快照上传已失效。"); }
 @Override public void close() throws Exception { spool.close();id=null;tree=null;hash=null;received=0; }
}
