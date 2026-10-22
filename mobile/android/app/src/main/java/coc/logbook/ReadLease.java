package coc.logbook;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.UUID;

/** One immutable, bounded private read source. Never registers or modifies a shared archive. */
final class ReadLease implements AutoCloseable {
    static final class Value {
        final String id, sha256;
        final File file;
        final long bytes, revision;
        Value(String id, File file, long bytes, String sha256, long revision) {
            this.id = id; this.file = file; this.bytes = bytes; this.sha256 = sha256; this.revision = revision;
        }
    }
    private final File directory;
    private final long maximumBytes;
    private final StorageBudget.Available available;
    private Value active;
    ReadLease(File directory) throws Exception {
        this(directory,0,null);
    }
    ReadLease(File directory,long maximumBytes) throws Exception {
        this(directory,maximumBytes,StorageBudget.volume(directory));
    }
    private ReadLease(File directory,long maximumBytes,StorageBudget.Available available) throws Exception {
        this.directory = directory;
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("无法创建只读正文目录。");
        this.available=available==null?StorageBudget.volume(directory):available;
        this.maximumBytes=maximumBytes;
        if(maximumBytes<0||maximumBytes>StorageBudget.JS_SAFE_INTEGER)throw new IOException("只读来源空间预算无效。");
        File[] stale = directory.listFiles((dir,name) -> name.matches("coc-read-[a-f0-9-]+\\.json"));
        if (stale == null) throw new IOException("无法读取正文工作目录。");
        for (File file : stale) delete(file);
    }
    Value create(String json, long revision) throws Exception {
        return create(writer -> {
            for(int start=0;start<json.length();) {
                int end=Math.min(start+32768,json.length());
                if(end<json.length() && Character.isHighSurrogate(json.charAt(end-1)))end--;
                writer.write(json,start,end-start); start=end;
            }
        }, revision);
    }
    interface Producer { void write(Writer writer) throws Exception; }
    Value create(Producer producer, long revision) throws Exception {
        if (active != null) throw new IllegalStateException("已有只读正文任务。");
        final long operationMaximum=maximumBytes==0?StorageBudget.maximum(available,2):maximumBytes;
        String id = UUID.randomUUID().toString(); File file = new File(directory, "coc-read-" + id + ".json");
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (FileOutputStream output = new FileOutputStream(file);
                 Writer writer = new BufferedWriter(new OutputStreamWriter(new DigestOutputStream(new FilterOutputStream(output) {
                     long count;
                     @Override public void write(byte[] bytes, int offset, int length) throws IOException {
                         if (length > operationMaximum-count) throw new IOException("正文超过本次可用空间预算，未创建导出文件。");
                         if(available!=null)try{StorageBudget.require(available,length);}catch(Exception error){throw new IOException("正文暂存可用空间不足。",error);}
                         out.write(bytes, offset, length); count += length;
                     }
                     @Override public void write(int value) throws IOException {
                         if (++count > operationMaximum) throw new IOException("正文超过本次可用空间预算，未创建导出文件。");
                         if(available!=null)try{StorageBudget.require(available,1);}catch(Exception error){throw new IOException("正文暂存可用空间不足。",error);}
                         out.write(value);
                     }
                 },digest), StandardCharsets.UTF_8))) {
                producer.write(writer);
            }
            StringBuilder hash = new StringBuilder();
            for (byte b : digest.digest()) hash.append(String.format("%02x",b&255));
            active = new Value(id,file,file.length(),hash.toString(),revision); return active;
        } catch (Exception | OutOfMemoryError error) { delete(file); throw error; }
    }
    void release(String id) throws Exception { if (active != null && active.id.equals(id)) close(); }
    private static void delete(File file) throws IOException {
        if (file.exists() && !file.delete()) throw new IOException("只读正文临时文件清理失败，请重开应用重试。");
    }
    @Override public void close() throws Exception {
        if (active != null) { delete(active.file); active = null; }
    }
}
