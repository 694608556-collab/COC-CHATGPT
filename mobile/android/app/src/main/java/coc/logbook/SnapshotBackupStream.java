package coc.logbook;

import java.io.*;
import java.nio.charset.*;
import java.util.*;
import org.json.*;

/** Full semantic check of the native-generated immutable schema-2 backup.
 * All bodies are visited, but only one complete record and bounded graph
 * metadata are materialized. No authorization or database mutation here.
 */
final class SnapshotBackupStream {
    private static String take(RawJson input)throws Exception{return take(input,false);}
    private static String take(RawJson input,boolean metadataCollection)throws Exception{
        StringWriter text=new StringWriter();
        input.copy(new Writer(){long count;
            public void write(char[] value,int offset,int length)throws IOException{
                count+=length;if(!metadataCollection&&count>LogbookLimits.ENTITY_REQUEST_BYTES)throw new IOException("备份单场或字段超过64MiB。");text.write(value,offset,length);
            }
            public void flush(){}public void close(){}
        });
        String result=text.toString();if(!metadataCollection&&JsonFields.bytes(result)>LogbookLimits.ENTITY_REQUEST_BYTES)throw new IOException("备份单场或字段超过64MiB。");StrictBackupJson.validate(result);return result;
    }
    static int validate(File file)throws Exception{
        try(Reader input=new InputStreamReader(new FileInputStream(file),StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT))){
            RawJson reader=new RawJson(input);Map<String,String> envelope=new LinkedHashMap<>();Set<String> seen=new HashSet<>();boolean[] snapshot={false};int[] count={0};
            reader.object((name,value)->{
                if(!seen.add(name))throw new IOException("备份根字段重复。");
                if(name.equals("snapshot")){snapshot[0]=true;count[0]=snapshot(value);}
                else if(Arrays.asList("format","formatVersion","exportedAt","restoreScope").contains(name))envelope.put(name,take(value));
                else throw new IOException("备份根字段不属于手机格式。");
            });reader.end();
            if(!snapshot[0]||!"\"coc.logbook.android\"".equals(envelope.get("format"))||!"1".equals(envelope.get("formatVersion")))throw new IOException("手机备份版本无效。");
            return count[0];
        }
    }
    private static int snapshot(RawJson input)throws Exception{
        JSONObject root=new JSONObject();JSONArray rows=new JSONArray();Set<String> seen=new HashSet<>();
        input.object((name,value)->{
            if(!seen.add(name))throw new IOException("备份字段重复。");
            if(name.equals("records"))value.array(row->{
                String json=take(row);JSONObject record=new JSONObject(json);BackupValidation.record(record);
                rows.put(BackupValidation.metadataOf(record));
            });
            else{
                if(!Arrays.asList("schemaVersion","exportedAt","modules","characters","settings").contains(name))throw new IOException("备份字段不属于手机范围。");
                String json=take(value,name.equals("modules")||name.equals("characters"));
                root.put(name,new JSONArray("["+json+"]").get(0));
            }
        });
        if(!seen.equals(new HashSet<>(Arrays.asList("schemaVersion","exportedAt","modules","records","characters","settings"))))throw new IOException("备份字段不完整。");
        root.put("records",rows);BackupValidation.metadata(root);
        return rows.length();
    }
}
