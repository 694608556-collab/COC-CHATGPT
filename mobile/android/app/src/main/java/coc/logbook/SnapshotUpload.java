package coc.logbook;
import java.io.File;

/** One version/tree-bound private snapshot transfer. Serial bridge queue only; no caller paths. */
final class SnapshotUpload implements AutoCloseable {
 private final PdfSpool spool;
 private String id, tree, hash;
 private long revision, bytes, received;
 private int index;
 SnapshotUpload(File directory) throws Exception { spool=new PdfSpool(directory); }
 boolean active(){return id!=null;}
 String begin(String tree,long revision,long bytes,String hash) throws Exception {
  if(id!=null)throw new IllegalStateException("已有数据正在保存。");
  if(bytes<1||bytes>StorageBudget.JS_SAFE_INTEGER||bytes>spool.maximumBytes()||hash==null||!hash.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("快照长度、摘要无效或本次暂存空间不足。");
  String token=spool.begin(tree);this.id=token;this.tree=tree;this.revision=revision;this.bytes=bytes;this.hash=hash;received=0;index=0;return token;
 }
 void append(String token,int position,byte[] chunk) throws Exception {
  require(token);
  try { if(position!=index||chunk.length==0||received+chunk.length>bytes)throw new IllegalArgumentException("快照分段顺序或长度不符。");spool.append(token,chunk);received+=chunk.length;index++; }
  catch(Exception error){close();throw error;}
 }
 /** Bounded lossless wire blocks; the full original length/hash and finish CAS are unchanged. */
 void appendEncoded(String token,int position,String encoding,int rawBytes,byte[] wire) throws Exception {
  require(token);
  try {
   if(position!=index||wire==null||wire.length<1||wire.length>LogbookLimits.TRANSFER_CHUNK_BYTES||
      rawBytes<1||rawBytes>2*1024*1024||rawBytes>bytes-received)
    throw new IllegalArgumentException("快照传输分段无效。");
   if("identity".equals(encoding)) {
    if(rawBytes!=wire.length)throw new IllegalArgumentException("快照原始分段长度不符。");
    append(token,position,wire);return;
   }
   if(!"zlib".equals(encoding))throw new IllegalArgumentException("快照分段编码无效。");
   java.util.zip.Inflater inflater=new java.util.zip.Inflater();
   try {
    inflater.setInput(wire);byte[] buffer=new byte[Math.min(rawBytes,LogbookLimits.TRANSFER_CHUNK_BYTES)];int decoded=0;
    while(!inflater.finished()) {
     int count=inflater.inflate(buffer);
     if(count==0){if(inflater.finished())break;throw new IllegalArgumentException("快照压缩分段不完整或需要字典。");}
     if(count>rawBytes-decoded)throw new IllegalArgumentException("快照解压长度不符。");
     spool.append(token,count==buffer.length?buffer:java.util.Arrays.copyOf(buffer,count));decoded+=count;
    }
    if(decoded!=rawBytes||inflater.getRemaining()!=0)throw new IllegalArgumentException("快照压缩分段长度或尾部无效。");
    received+=decoded;index++;
   }finally{inflater.end();}
  }catch(Exception|OutOfMemoryError error){close();throw error;}
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
