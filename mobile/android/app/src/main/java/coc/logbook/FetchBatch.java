package coc.logbook;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import org.json.*;

/** One CAS-bound batch. Completed bodies go to private disk, never a whole-library heap copy. */
final class FetchBatch implements AutoCloseable {
    final String id=UUID.randomUUID().toString(),tree;
    final long revision;
    private final File file;
    private final Map<String,Map<String,String>> targets=new LinkedHashMap<>();
    private final Map<String,Part> parts=new LinkedHashMap<>();
    private static final class Part {long start,length;byte[] hash;boolean keepBody;}
    FetchBatch(File directory,String tree,long revision,Set<String> ids,Map<String,String> fields)throws Exception{
        this.tree=tree;this.revision=revision;
        Map<String,Map<String,String>> rows=RecordOverlay.rows(fields);
        for(String id:ids){Map<String,String> row=rows.get(id);if(row==null||!"online".equals(stringValue(row.get("sourceType"))))throw new IllegalArgumentException("检测目标已变化。");targets.put(id,row);}
        if(targets.isEmpty())throw new IllegalArgumentException("没有在线检测目标。");
        if(!directory.isDirectory()&&!directory.mkdirs())throw new IOException("无法创建检测暂存。");
        // This directory is exclusive to batch staging; stale files never contain committed data.
        File[] stale=directory.listFiles();if(stale!=null)for(File old:stale)if(!old.delete())throw new IOException("旧检测暂存清理失败。");
        file=File.createTempFile("batch-",".json",directory);
    }
    void require(String token){if(!id.equals(token))throw new IllegalArgumentException("检测批次已失效。");}
    void stage(File snapshot)throws Exception{
        SnapshotStream.validate(java.nio.file.Files.newBufferedReader(snapshot.toPath(),StandardCharsets.UTF_8));
        long start=file.length();Map<String,String> metadata=new LinkedHashMap<>();int[] count={0};boolean[] body={false};
        MessageDigest digest=MessageDigest.getInstance("SHA-256");
        try(Writer out=new BufferedWriter(new OutputStreamWriter(new DigestOutputStream(new FileOutputStream(file,true),digest),StandardCharsets.UTF_8),32768);
            Reader input=java.nio.file.Files.newBufferedReader(snapshot.toPath(),StandardCharsets.UTF_8)){
            RawJson reader=new RawJson(input);
            reader.object((field,value)->{
                if(!field.equals("records")){value.skip();return;}
                value.array(record->{
                    if(++count[0]!=1)throw new IllegalArgumentException("每次仅暂存一个检测结果。");
                    out.write('{');boolean[] comma={false};Set<String> seen=new HashSet<>();
                    record.object((name,raw)->{
                        if(!seen.add(name))throw new IllegalArgumentException("检测字段重复。");
                        if(comma[0])out.write(',');comma[0]=true;out.write(JSONObject.quote(name));out.write(':');
                        if(name.equals("rawContent")){body[0]=true;raw.copy(out);}
                        else {String text=raw.take();metadata.put(name,text);out.write(text);}
                    });out.write('}');
                });
            });reader.end();
        }catch(Exception|OutOfMemoryError error){try(RandomAccessFile output=new RandomAccessFile(file,"rw")){output.setLength(start);}throw error;}
        try{
            String key=RecordOverlay.id(metadata);Map<String,String> before=targets.get(key);
            if(count[0]!=1||before==null||parts.containsKey(key))throw new IllegalArgumentException("检测结果缺失、重复或目标不符。");
            for(String name:new String[]{"moduleId","sourceType","link"})if(!sameString(before.get(name),metadata.get(name)))throw new IllegalArgumentException("检测来源已变化。");
            String status=stringValue(metadata.get("status"));boolean success="valid".equals(status);
            if(!Arrays.asList("valid","invalid","fetch_failed").contains(status)||metadata.containsKey("manualContent"))throw new IllegalArgumentException("检测结果无效。");
            if(success&&(!body[0]||!sameString(before.get("link"),metadata.get("cacheSourceUrl"))))throw new IllegalArgumentException("检测正文或来源不完整。");
            if(file.length()>PdfSpool.MAX_BYTES)throw new IllegalArgumentException("检测正文超过 64 MiB；整批未保存。");
            Part part=new Part();part.start=start;part.length=file.length()-start;part.hash=digest.digest();part.keepBody=!success;parts.put(key,part);
        }catch(Exception error){try(RandomAccessFile output=new RandomAccessFile(file,"rw")){output.setLength(start);}throw error;}
    }
    /** Compare JSON string values, not native/JS escape spelling; never coerce other JSON types. */
    private static String stringValue(String token)throws JSONException{
        if(token==null||token.length()<2||token.charAt(0)!='"'||token.charAt(token.length()-1)!='"')return null;
        JSONArray values=new JSONArray("["+token+"]");Object value=values.get(0);
        return values.length()==1&&value instanceof String?(String)value:null;
    }
    /** Exact decoded identity: no URL normalization, trimming, or changes to the opaque body tokens. */
    private static boolean sameString(String expected,String actual)throws JSONException{
        String value=stringValue(expected);return value!=null&&value.equals(stringValue(actual));
    }
    /** All hashes and complete target coverage are checked before deleting the candidate and opening CAS. */
    long finish(LogbookDatabase database,String exportedAt)throws Exception{
        if(!parts.keySet().equals(targets.keySet()))throw new IllegalStateException("检测尚未全部结束，整批未保存。");
        try(RandomAccessFile input=new RandomAccessFile(file,"r")){
            byte[] buffer=new byte[65536];
            for(Part part:parts.values()){
                input.seek(part.start);long remaining=part.length;MessageDigest digest=MessageDigest.getInstance("SHA-256");
                while(remaining>0){int count=input.read(buffer,0,(int)Math.min(buffer.length,remaining));if(count<0)throw new EOFException();digest.update(buffer,0,count);remaining-=count;}
                if(!MessageDigest.isEqual(part.hash,digest.digest()))throw new IOException("检测暂存摘要不符，未保存。");
            }
            if(!file.delete())throw new IOException("检测暂存清理失败，未保存。");
            return database.edit(revision,store->{
                for(Map.Entry<String,Part> entry:parts.entrySet()){
                    Part part=entry.getValue();input.seek(part.start);
                    InputStream bounded=new InputStream(){long left=part.length;
                        public int read()throws IOException{if(left==0)return -1;int value=input.read();if(value<0)throw new EOFException();left--;return value;}
                        public int read(byte[] bytes,int offset,int length)throws IOException{if(left==0)return -1;int count=input.read(bytes,offset,(int)Math.min(length,left));if(count<0)throw new EOFException();left-=count;return count;}
                    };
                    try(Reader reader=new InputStreamReader(bounded,StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT))){
                        RawJson raw=new RawJson(reader);store.record(raw,entry.getKey(),part.keepBody);raw.end();
                    }
                }
                Map<String,String> timestamp=new LinkedHashMap<>();timestamp.put("exportedAt",JSONObject.quote(exportedAt));store.patch(timestamp);
            });
        }
    }
    public void close()throws IOException{if(file.exists()&&!file.delete())throw new IOException("检测暂存清理失败。");}
}
