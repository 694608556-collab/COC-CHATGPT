package coc.logbook;

import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.security.*;
import org.json.*;

/** Complete native validation of private restore protocol v1. No SQLite or SAF
 * authority here. Caller owns one open immutable input and must unlink before
 * the CAS transaction; processing never allocates all library bodies.
 */
final class RestoreCandidate {
    static final class Preview {
        final JSONObject metadata;
        final int offlineRecords;
        final long bytes;
        final String sha256;
        Preview(JSONObject metadata,int offlineRecords,long bytes,String sha256){this.metadata=metadata;this.offlineRecords=offlineRecords;this.bytes=bytes;this.sha256=sha256;}
    }
    interface Record {void accept(String json,JSONObject value,int index)throws Exception;}
    private static final class Line extends ByteArrayOutputStream {
        String decode() throws Exception {
            return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(buf,0,count)).toString();
        }
    }
    static Preview inspect(InputStream input,long expectedBytes,String expectedHash,Record each)throws Exception{
        MessageDigest hash=MessageDigest.getInstance("SHA-256");byte[] buffer=new byte[65536];Line line=new Line();
        long total=0,metadataBytes=2;int count=0,offline=0;JSONObject metadata=null;JSONArray rows=new JSONArray();
        int length;
        while((length=input.read(buffer))!=-1){
            total+=length;if(total>expectedBytes)throw new IOException("恢复候选长度已变化。");hash.update(buffer,0,length);
            int start=0;
            for(int i=0;i<length;i++){
                if(buffer[i]!=10)continue;
                line.write(buffer,start,i-start);start=i+1;
                if(line.size()>LogbookLimits.SNAPSHOT_REQUEST_BYTES+1)throw new IOException("单场完整数据或元数据超过64MiB。");
                String value=line.decode();line.reset();
                if(value.length()<2||metadata!=null)throw new IOException("恢复候选顺序或结束标记无效。");
                char kind=value.charAt(0);String json=value.substring(1);
                StrictBackupJson.validate(json);JSONObject object=new JSONObject(json);
                if(kind=='R'){
                    BackupValidation.record(object);
                    JSONObject row=BackupValidation.metadataOf(object);
                    metadataBytes+=JsonFields.bytes(row.toString())+1;
                    if(metadataBytes>LogbookLimits.SNAPSHOT_REQUEST_BYTES)throw new IOException("恢复元数据超过处理上限。");
                    rows.put(row);count++;
                    if(object.has("rawContent")||("manual".equals(object.getString("sourceType"))&&!object.optString("manualContent").isEmpty()))offline++;
                    if(each!=null)each.accept(json,object,count-1);
                    // Keep only independently bounded metadata, never body values.
                }else if(kind=='M'){
                    BackupValidation.metadata(object);
                    if(!BackupValidation.same(rows,object.getJSONArray("records")))throw new IOException("恢复场次未取齐、重复或元数据不符。");
                    metadata=object;
                }else throw new IOException("恢复候选协议版本无效。");
            }
            line.write(buffer,start,length-start);
            if(line.size()>LogbookLimits.SNAPSHOT_REQUEST_BYTES+1)throw new IOException("单场完整数据或元数据超过64MiB。");
        }
        StringBuilder digest=new StringBuilder();for(byte b:hash.digest())digest.append(String.format("%02x",b&255));
        if(line.size()!=0||metadata==null||total!=expectedBytes||!digest.toString().equals(expectedHash))throw new IOException("恢复候选不完整或完整摘要不符。");
        return new Preview(metadata,offline,total,digest.toString());
    }
}
