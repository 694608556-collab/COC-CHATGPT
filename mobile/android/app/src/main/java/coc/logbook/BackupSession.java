package coc.logbook;

import java.io.*;
import java.security.*;
import java.util.*;
import org.json.*;

/** One native-owned version/tree-bound large backup operation. Inputs and
 * generated entries are private, uniquely named and never caller paths.
 * No method grants SQLite or document publication authority.
 */
final class BackupSession implements AutoCloseable {
    static final class Proof {
        final long bytes; final String sha256;
        Proof(long bytes,String sha256){this.bytes=bytes;this.sha256=sha256;}
        void matches(long size,String hash)throws IOException{
            if(size!=bytes||hash==null||!sha256.equals(hash))throw new IOException("备份文件完整长度或摘要不符。");
        }
    }
    private static final class Entry {
        final File file; FileOutputStream output; long bytes; int index; Proof proof;
        android.os.ParcelFileDescriptor memory;
        Entry(File file)throws Exception{this.file=file;if(!file.createNewFile())throw new IOException("备份暂存已存在。");output=new FileOutputStream(file);}
        Entry(byte[] complete,long budget)throws Exception{
            int fd=NativeSearchKernel.sealedSource(complete,budget);if(fd<0)throw new SearchSnapshot.Unavailable();
            memory=android.os.ParcelFileDescriptor.adoptFd(fd);file=new File("/proc/self/fd/"+fd);bytes=complete.length;
            try{proof=fileProof(file,bytes);proof.matches(bytes,digestHex(MessageDigest.getInstance("SHA-256").digest(complete)));}
            catch(Exception|OutOfMemoryError failure){memory.close();memory=null;throw failure;}
        }
        void seal()throws Exception{
            seal(true);
        }
        void seal(boolean durable)throws Exception{
            if(output!=null){output.flush();if(durable)output.getFD().sync();output.close();output=null;}
            proof=fileProof(file,bytes);proof.matches(bytes,proof.sha256);
        }
    }
    final String id=UUID.randomUUID().toString(),tree;
    final long revision;
    final boolean restoring,includeArchives,searching;
    final StorageBudget.Available available;
    private final File directory;
    private final Map<String,Entry> entries=new LinkedHashMap<>();
    private final long maximumInputBytes;
    private long inputBytes,outputBytes,maximumOutputBytes;
    private boolean ready,closed;
    private int searchPartIndex;
    private long searchMemoryBudget,searchMemoryParts;
    private ByteArrayOutputStream activeSearchMemory;
    private Entry activeSearchPart;
    private OutputStream activeSearchOutput;
    RestoreCandidate.Preview restorePreview;
    final List<Attachment> attachments=new ArrayList<>();
    static final class Attachment {
        final String key,name,mime;final Proof proof;
        Attachment(String key,String name,String mime,Proof proof){this.key=key;this.name=name;this.mime=mime;this.proof=proof;}
    }
    BackupSession(File directory,String tree,long revision,boolean restoring,boolean includeArchives)throws Exception{
        this(directory,tree,revision,restoring,includeArchives,null);
    }
    BackupSession(File directory,String tree,long revision,boolean restoring,boolean includeArchives,StorageBudget.Available available)throws Exception{
        this(directory,tree,revision,restoring,includeArchives,false,available);
    }
    BackupSession(File directory,String tree,long revision,boolean restoring,boolean includeArchives,boolean searching,StorageBudget.Available available)throws Exception{
        this.directory=directory;this.tree=tree;this.revision=revision;this.restoring=restoring;this.includeArchives=includeArchives;this.searching=searching;
        if(!directory.isDirectory()&&!directory.mkdirs())throw new IOException("无法创建私有备份暂存目录。");
        this.available=available==null?StorageBudget.volume(directory):available;
        File[] stale=directory.listFiles((dir,name)->name.matches("coc-backup-[a-f0-9-]+-[0-9]+\\.part"));
        if(stale==null)throw new IOException("无法读取私有备份暂存目录。");
        for(File file:stale)delete(file);
        maximumInputBytes=StorageBudget.maximum(this.available,restoring?6:searching?2:3);
    }
    void require(String token)throws IOException{if(closed||!id.equals(token))throw new IOException("备份暂存租约已失效。");}
    private Entry create(String key)throws Exception{
        if(entries.containsKey(key))return entries.get(key);
        Entry value=new Entry(new File(directory,"coc-backup-"+id+"-"+entries.size()+".part"));entries.put(key,value);return value;
    }
    Proof capture(String key,InputStream source,long expectedBytes,String expectedHash)throws Exception{
        if(closed||ready||maximumOutputBytes!=0||(!key.equals("source")&&!key.startsWith("archive:")))throw new IOException("备份来源阶段无效。");
        Entry entry=create(key);if(entry.bytes!=0||entry.proof!=null)throw new IOException("备份来源重复。");
        byte[] buffer=new byte[65536];int length;
        while((length=source.read(buffer))!=-1){
            if(inputBytes+length>maximumInputBytes)throw new IOException("备份来源暂存空间不足。");
            StorageBudget.require(available,length);entry.output.write(buffer,0,length);entry.bytes+=length;inputBytes+=length;
        }
        entry.seal();
        if(expectedBytes>=0)entry.proof.matches(expectedBytes,expectedHash);
        return entry.proof;
    }
    interface Producer {void write(Writer output)throws Exception;}
    Proof captureJson(Producer producer)throws Exception{
        return captureBytes(output->{
            Writer writer=new BufferedWriter(new OutputStreamWriter(output,java.nio.charset.StandardCharsets.UTF_8),32768);
            producer.write(writer);writer.flush();
        });
    }
    interface ByteProducer {void write(OutputStream output)throws Exception;}
    /** Only a searching lease can create disposable read-only source slices.
     * Their bytes count against the same current-space budget as the full source. */
    OutputStream beginSearchPart(int index)throws Exception{
        if(!searching||closed||ready||maximumOutputBytes!=0||index!=searchPartIndex||activeSearchPart!=null||activeSearchMemory!=null)
            throw new IOException("搜索分片阶段或次序无效。");
        if(searchMemoryBudget>0){
            activeSearchMemory=new ByteArrayOutputStream();final ByteArrayOutputStream buffer=activeSearchMemory;
            return new OutputStream(){
                public void write(int value)throws IOException{write(new byte[]{(byte)value},0,1);}
                public void write(byte[] bytes,int start,int length)throws IOException{
                    if(closed||activeSearchMemory!=buffer)throw new IOException("搜索分片租约已失效。");
                    if(length>searchMemoryBudget-searchMemoryParts-buffer.size())throw new SearchSnapshot.Unavailable();
                    buffer.write(bytes,start,length);
                }
            };
        }
        final Entry entry=create("search:"+index);activeSearchPart=entry;
        OutputStream bounded=new OutputStream(){
            public void write(int value)throws IOException{write(new byte[]{(byte)value},0,1);}
            public void write(byte[] bytes,int start,int length)throws IOException{
                if(closed||activeSearchPart!=entry)throw new IOException("搜索分片租约已失效。");
                if(inputBytes+length>maximumInputBytes)throw new SearchSnapshot.Unavailable();
                try{StorageBudget.require(available,length);entry.output.write(bytes,start,length);entry.bytes+=length;inputBytes+=length;}
                catch(IOException error){throw error;}catch(Exception error){throw new IOException(error);}
            }
        };
        activeSearchOutput=new BufferedOutputStream(bounded,256*1024);return activeSearchOutput;
    }
    /** A part cannot be named by a readable credential until durable full readback succeeds. */
    String finishSearchPart(int index)throws Exception{
        if(searchMemoryBudget>0){
            if(!searching||closed||index!=searchPartIndex||activeSearchMemory==null||activeSearchMemory.size()==0)throw new IOException("搜索分片封存次序无效。");
            byte[] bytes=activeSearchMemory.toByteArray();Entry entry=new Entry(bytes,searchMemoryBudget);
            String key="search:"+index;entries.put(key,entry);searchMemoryParts+=bytes.length;activeSearchMemory=null;searchPartIndex++;return key;
        }
        if(!searching||closed||activeSearchPart==null||index!=searchPartIndex)throw new IOException("搜索分片封存次序无效。");
        // Disposable immutable read views can be consumed speculatively. Their
        // full readback/EOF/SHA remains mandatory; the canonical full source
        // still flushes and fsyncs before its final proof can publish results.
        activeSearchOutput.flush();activeSearchPart.seal(false);
        if(activeSearchPart.bytes==0)throw new IOException("搜索分片不能为空。");
        String key="search:"+index;activeSearchPart=null;activeSearchOutput=null;searchPartIndex++;return key;
    }
    Proof captureBytes(ByteProducer producer)throws Exception{
        if(closed||ready||maximumOutputBytes!=0||entries.containsKey("source"))throw new IOException("备份来源阶段无效。");
        Entry entry=create("source");
        OutputStream bounded=new OutputStream(){
            public void write(int value)throws IOException{write(new byte[]{(byte)value},0,1);}
            public void write(byte[] bytes,int start,int length)throws IOException{
                try{if(inputBytes+length>maximumInputBytes){if(searching&&(activeSearchPart!=null||searchPartIndex>0))throw new SearchSnapshot.Unavailable();throw new IOException("完整备份来源暂存空间不足。");}StorageBudget.require(available,length);entry.output.write(bytes,start,length);entry.bytes+=length;inputBytes+=length;}
                catch(IOException error){throw error;}catch(Exception error){throw new IOException(error);}
            }
        };
        // Coalesce encoder-sized writes before the actual-write space check.
        // Flush, fsync and complete readback remain inside captureJson; this
        // bounded transport buffer is never an input or content-size limit.
        OutputStream output=new BufferedOutputStream(bounded,256*1024);
        producer.write(output);output.flush();entry.seal();return entry.proof;
    }
    /** Kernel-sealed derived search views; all bytes are independently read back.
     * The source is disposable and has no database, restore or publication authority.
     * A resource/feature failure requests a new lease through the complete disk path.
     */
    Proof captureSearchMemory(ByteProducer producer,long budget)throws Exception{
        if(!searching||closed||ready||maximumOutputBytes!=0||!entries.isEmpty()||budget<1)throw new SearchSnapshot.Unavailable();
        searchMemoryBudget=budget;ByteArrayOutputStream buffer=new ByteArrayOutputStream();
        OutputStream bounded=new OutputStream(){
            public void write(int value)throws IOException{write(new byte[]{(byte)value},0,1);}
            public void write(byte[] bytes,int start,int length)throws IOException{
                if(length>budget-buffer.size())throw new SearchSnapshot.Unavailable();buffer.write(bytes,start,length);
            }
        };
        producer.write(bounded);
        if(activeSearchMemory!=null)throw new IOException("搜索分片尚未完整封存。");
        Entry source=new Entry(buffer.toByteArray(),budget);entries.put("source",source);return source.proof;
    }
    long beginOutput()throws Exception{
        if(searching)throw new IOException("正文搜索来源只读，不能暂存输出或发布文件。");
        if(closed||ready||!entries.containsKey("source")||entries.get("source").proof==null)throw new IOException("备份来源未封存。");
        if(maximumOutputBytes==0)maximumOutputBytes=StorageBudget.maximum(available,restoring?4:3);
        return maximumOutputBytes;
    }
    void append(String key,int index,byte[] chunk)throws Exception{
        if(closed||ready||maximumOutputBytes==0||key==null||key.length()>4096||key.indexOf('\0')>=0||
            (restoring?(!key.equals("candidate")&&!key.startsWith("zip:")):!key.equals("output")))throw new IOException("备份暂存条目标识无效。");
        if(chunk.length==0||chunk.length>LogbookLimits.TRANSFER_CHUNK_BYTES||outputBytes+chunk.length>maximumOutputBytes)throw new IOException("备份暂存分段或可用空间不足。");
        Entry entry=create(key);
        if(entry.output==null||entry.index!=index)throw new IOException("备份暂存已封存或分段乱序。");
        StorageBudget.require(available,chunk.length);
        entry.output.write(chunk);entry.bytes+=chunk.length;entry.index++;outputBytes+=chunk.length;
    }
    Proof verify(String key,long bytes,String hash)throws Exception{
        if(closed||key==null||key.length()>4096||key.indexOf('\0')>=0)throw new IOException("备份暂存条目标识无效。");
        Entry entry=entries.get(key);
        if(entry==null&&restoring&&!ready&&maximumOutputBytes>0&&key.startsWith("zip:")&&bytes==0&&"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".equals(hash)){
            StorageBudget.require(available,0);entry=create(key);
        }
        if(entry==null)throw new IOException("备份暂存条目缺失。");
        entry.seal();entry.proof.matches(bytes,hash);return entry.proof;
    }
    Proof proof(String key)throws Exception{Entry entry=entries.get(key);if(entry==null||entry.proof==null)throw new IOException("备份来源未取齐。");return entry.proof;}
    File file(String key)throws Exception{Entry entry=entries.get(key);if(entry==null||entry.output!=null)throw new IOException("备份来源未封存。");return entry.file;}
    void finish(Set<String> kept)throws Exception{
        if(closed||ready)throw new IOException("备份暂存状态无效。");
        for(Map.Entry<String,Entry> item:entries.entrySet()){
            if(item.getValue().output!=null)item.getValue().seal();
            if(!kept.contains(item.getKey()))delete(item.getValue().file);
        }
        entries.keySet().retainAll(kept);ready=true;
    }
    void requireReady()throws IOException{if(closed||!ready)throw new IOException("备份预览尚未完成。");}
    void verifySources()throws Exception{
        for(Map.Entry<String,Entry> value:entries.entrySet())if(value.getKey().equals("source")||value.getKey().startsWith("archive:")){
            Proof expected=value.getValue().proof;if(expected==null)throw new IOException("备份来源尚未封存。");verify(value.getKey(),expected.bytes,expected.sha256);
        }
    }
    static Proof requestProof(JSONObject value)throws Exception{
        Object raw=value.get("bytes"),hash=value.get("sha256");
        if(!(raw instanceof Number)||!(hash instanceof String))throw new IOException("备份证明类型无效。");
        double bytes=((Number)raw).doubleValue();
        if(!Double.isFinite(bytes)||bytes<0||bytes>StorageBudget.JS_SAFE_INTEGER||bytes!=Math.floor(bytes)||!((String)hash).matches("[a-f0-9]{64}"))throw new IOException("备份证明长度或摘要无效。");
        return new Proof((long)bytes,(String)hash);
    }
    void previewRestore(Proof candidate,JSONArray selected)throws Exception{
        if(!restoring||ready||closed)throw new IOException("恢复预览状态无效。");
        verify("candidate",candidate.bytes,candidate.sha256);
        RestoreCandidate.Preview preview;
        try(InputStream input=new FileInputStream(file("candidate"))){preview=RestoreCandidate.inspect(input,candidate.bytes,candidate.sha256,null);}
        Set<String> keep=new HashSet<>(Arrays.asList("source","candidate"));List<Attachment> checked=new ArrayList<>();long total=0;
        for(int i=0;i<selected.length();i++){
            JSONObject value=selected.getJSONObject(i);BackupValidation.shape(value,"zipPath,name,mime,bytes,sha256","");
            if(!(value.get("zipPath") instanceof String)||!(value.get("name") instanceof String)||!(value.get("mime") instanceof String))throw new IOException("恢复附件类型无效。");
            String key="zip:"+value.getString("zipPath"),name=value.getString("name"),mime=value.getString("mime");Proof proof=requestProof(value);
            if(key.length()>4096||name.isEmpty()||name.length()>255||name.equals(".")||name.equals("..")||name.matches(".*[/\\\\\u0000-\u001f].*")||mime.isEmpty()||mime.length()>128||!keep.add(key))throw new IOException("恢复附件名称或重复引用无效。");
            total=Math.addExact(total,proof.bytes);StorageBudget.require(available,StorageBudget.estimate(proof.bytes,2));
            verify(key,proof.bytes,proof.sha256);checked.add(new Attachment(key,name,mime,proof));
        }
        finish(keep);restorePreview=preview;attachments.addAll(checked);
    }
    static Proof fileProof(File file,long maximumBytes)throws Exception{
        try(InputStream input=new FileInputStream(file)){return streamProof(input,maximumBytes);}
    }
    /** Encode only the already-computed digest; complete input reading and SHA
     * remain unchanged. Avoid per-byte Formatter setup on older ART runtimes. */
    static String digestHex(byte[] digest){
        final char[] digits="0123456789abcdef".toCharArray(),text=new char[digest.length*2];
        for(int index=0;index<digest.length;index++){int value=digest[index]&255;text[index*2]=digits[value>>>4];text[index*2+1]=digits[value&15];}
        return new String(text);
    }
    static Proof streamProof(InputStream input,long maximumBytes)throws Exception{
        if(input==null||maximumBytes<0||maximumBytes>StorageBudget.JS_SAFE_INTEGER)throw new IOException("备份读取证明无效。");
        long total=0;MessageDigest hash=MessageDigest.getInstance("SHA-256");byte[] buffer=new byte[65536];
        int count;while((count=input.read(buffer))!=-1){total=Math.addExact(total,count);if(total>maximumBytes)throw new IOException("备份文件长度已变化。");hash.update(buffer,0,count);}
        return new Proof(total,digestHex(hash.digest()));
    }
    private static void delete(File file)throws IOException{
        File resolved=file.getCanonicalFile();
        if(!resolved.getParentFile().equals(file.getParentFile().getCanonicalFile())||!resolved.getName().equals(file.getName()))throw new IOException("私有暂存文件引用无效。");
        if(file.exists()&&!file.delete())throw new IOException("备份私有暂存清理失败；未提交数据。");
    }
    public void close()throws Exception{
        Exception failure=null;
        for(Entry entry:entries.values()){
            try{if(entry.output!=null){entry.output.close();entry.output=null;}if(entry.memory!=null){entry.memory.close();entry.memory=null;}else delete(entry.file);}catch(Exception error){if(failure==null)failure=error;}
        }
        if(failure!=null)throw failure;
        entries.clear();activeSearchMemory=null;closed=true;
    }
}
