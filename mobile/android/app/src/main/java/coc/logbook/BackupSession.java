package coc.logbook;

import java.io.*;
import java.security.*;
import java.util.*;

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
        Entry(File file)throws Exception{this.file=file;if(!file.createNewFile())throw new IOException("备份暂存已存在。");output=new FileOutputStream(file);}
        void seal()throws Exception{
            if(output!=null){output.flush();output.getFD().sync();output.close();output=null;}
            proof=fileProof(file,bytes);proof.matches(bytes,proof.sha256);
        }
    }
    final String id=UUID.randomUUID().toString(),tree;
    final long revision;
    final boolean restoring,includeArchives;
    final StorageBudget.Available available;
    private final File directory;
    private final Map<String,Entry> entries=new LinkedHashMap<>();
    private final long maximumInputBytes;
    private long inputBytes,outputBytes,maximumOutputBytes;
    private boolean ready,closed;
    BackupSession(File directory,String tree,long revision,boolean restoring,boolean includeArchives)throws Exception{
        this(directory,tree,revision,restoring,includeArchives,null);
    }
    BackupSession(File directory,String tree,long revision,boolean restoring,boolean includeArchives,StorageBudget.Available available)throws Exception{
        this.directory=directory;this.tree=tree;this.revision=revision;this.restoring=restoring;this.includeArchives=includeArchives;
        if(!directory.isDirectory()&&!directory.mkdirs())throw new IOException("无法创建私有备份暂存目录。");
        this.available=available==null?StorageBudget.volume(directory):available;
        File[] stale=directory.listFiles((dir,name)->name.matches("coc-backup-[a-f0-9-]+-[0-9]+\\.part"));
        if(stale==null)throw new IOException("无法读取私有备份暂存目录。");
        for(File file:stale)delete(file);
        maximumInputBytes=StorageBudget.maximum(this.available,restoring?6:3);
    }
    void require(String token)throws IOException{if(closed||!id.equals(token))throw new IOException("备份暂存租约已失效。");}
    private Entry create(String key)throws Exception{
        if(entries.containsKey(key))return entries.get(key);
        if(entries.size()>=2002)throw new IOException("备份暂存条目过多。");
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
        if(closed||ready||maximumOutputBytes!=0||entries.containsKey("source"))throw new IOException("备份来源阶段无效。");
        Entry entry=create("source");
        OutputStream bounded=new OutputStream(){
            public void write(int value)throws IOException{write(new byte[]{(byte)value},0,1);}
            public void write(byte[] bytes,int start,int length)throws IOException{
                try{if(inputBytes+length>maximumInputBytes)throw new IOException("完整备份来源暂存空间不足。");StorageBudget.require(available,length);entry.output.write(bytes,start,length);entry.bytes+=length;inputBytes+=length;}
                catch(IOException error){throw error;}catch(Exception error){throw new IOException(error);}
            }
        };
        Writer writer=new BufferedWriter(new OutputStreamWriter(bounded,java.nio.charset.StandardCharsets.UTF_8),32768);
        producer.write(writer);writer.flush();entry.seal();return entry.proof;
    }
    long beginOutput()throws Exception{
        if(closed||ready||!entries.containsKey("source")||entries.get("source").proof==null)throw new IOException("备份来源未封存。");
        if(maximumOutputBytes==0)maximumOutputBytes=StorageBudget.maximum(available,restoring?4:2);
        return maximumOutputBytes;
    }
    void append(String key,int index,byte[] chunk)throws Exception{
        if(closed||ready||maximumOutputBytes==0||key==null||key.length()>4096||key.indexOf('\0')>=0||
            (restoring?(!key.equals("candidate")&&!key.startsWith("zip:")):!key.equals("output")))throw new IOException("备份暂存条目标识无效。");
        if(chunk.length==0||chunk.length>LogbookLimits.TRANSFER_CHUNK_BYTES||outputBytes+chunk.length>maximumOutputBytes)throw new IOException("备份暂存分段或可用空间不足。");
        Entry entry=create(key);
        if(entry.output==null||entry.index!=index)throw new IOException("备份暂存已封存或分段乱序。");
        if(key.startsWith("zip:")&&entry.bytes+chunk.length>LogbookLimits.ARCHIVE_FILE_BYTES)throw new IOException("单个归档附件超过64MiB。");
        StorageBudget.require(available,chunk.length);
        entry.output.write(chunk);entry.bytes+=chunk.length;entry.index++;outputBytes+=chunk.length;
    }
    Proof verify(String key,long bytes,String hash)throws Exception{
        Entry entry=entries.get(key);
        if(entry==null&&key.startsWith("zip:")&&bytes==0&&"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".equals(hash))entry=create(key);
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
    static Proof fileProof(File file,long maximumBytes)throws Exception{
        long total=0;MessageDigest hash=MessageDigest.getInstance("SHA-256");byte[] buffer=new byte[65536];
        try(InputStream input=new FileInputStream(file)){int count;while((count=input.read(buffer))!=-1){total+=count;if(total>maximumBytes)throw new IOException("备份文件长度已变化。");hash.update(buffer,0,count);}}
        StringBuilder digest=new StringBuilder();for(byte b:hash.digest())digest.append(String.format("%02x",b&255));return new Proof(total,digest.toString());
    }
    private static void delete(File file)throws IOException{
        File resolved=file.getCanonicalFile();
        if(!resolved.getParentFile().equals(file.getParentFile().getCanonicalFile())||!resolved.getName().equals(file.getName()))throw new IOException("私有暂存文件引用无效。");
        if(file.exists()&&!file.delete())throw new IOException("备份私有暂存清理失败；未提交数据。");
    }
    public void close()throws Exception{
        Exception failure=null;
        for(Entry entry:entries.values()){
            try{if(entry.output!=null){entry.output.close();entry.output=null;}delete(entry.file);}catch(Exception error){if(failure==null)failure=error;}
        }
        if(failure!=null)throw failure;
        entries.clear();closed=true;
    }
}
