package coc.logbook;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import org.json.*;

/** Public one-record semantic backup/restore check. Reports its actual JVM heap;
 * this is neither Android SQLite instrumentation nor a phone capacity promise. */
public final class SingleRecordCapacityCheck {
    private static String hex(byte[] value){StringBuilder text=new StringBuilder();for(byte b:value)text.append(String.format("%02x",b&255));return text.toString();}
    private static void require(boolean ok,String reason){if(!ok)throw new AssertionError(reason);}
    public static void main(String[] args)throws Exception{
        File directory=Files.createTempDirectory("coc-public-single-record-").toFile();
        File candidate=new File(directory,"candidate"),backup=new File(directory,"backup.json");
        try{
            JSONObject root=new JSONObject(Files.readString(new File(args[0]).toPath(),StandardCharsets.UTF_8));
            JSONObject record=null;JSONArray original=root.getJSONArray("records");
            for(int i=0;i<original.length();i++)if("manual".equals(original.getJSONObject(i).getString("sourceType"))){record=BackupValidation.metadataOf(original.getJSONObject(i));break;}
            require(record!=null,"public manual fixture missing");
            root.put("records",new JSONArray().put(record));BackupValidation.metadata(root);
            String row=record.toString(),head=row.substring(0,row.length()-1)+",\"manualContent\":\"";
            JSONObject fields=new JSONObject(root.toString());fields.remove("records");String fieldJson=fields.toString();
            String block="x".repeat(65536),start="公开单场😀\n\u0000",tail="\r\n完整末尾😀";
            MessageDigest expected=MessageDigest.getInstance("SHA-256");expected.update(start.getBytes(StandardCharsets.UTF_8));
            try(Writer output=new BufferedWriter(new OutputStreamWriter(new FileOutputStream(candidate),StandardCharsets.UTF_8),65536);
                Writer canonical=new BufferedWriter(new OutputStreamWriter(new FileOutputStream(backup),StandardCharsets.UTF_8),65536)){
                output.write('R');output.write(head);canonical.write("{\"format\":\"coc.logbook.android\",\"formatVersion\":1,\"snapshot\":"+fieldJson.substring(0,fieldJson.length()-1)+",\"records\":["+head);
                String quoted=JSONObject.quote(start);output.write(quoted.substring(1,quoted.length()-1));canonical.write(quoted.substring(1,quoted.length()-1));
                byte[] bytes=block.getBytes(StandardCharsets.US_ASCII);
                for(int i=0;i<1088;i++){output.write(block);canonical.write(block);expected.update(bytes);}
                quoted=JSONObject.quote(tail);output.write(quoted.substring(1,quoted.length()-1));canonical.write(quoted.substring(1,quoted.length()-1));expected.update(tail.getBytes(StandardCharsets.UTF_8));
                output.write("\"}\nM"+root+"\n");canonical.write("\"}]}}");
            }
            String expectedHash=hex(expected.digest());
            require(candidate.length()>68L*1024*1024,"single record did not cross old boundary");
            require(SnapshotBackupStream.validate(backup)==1,"complete backup validation lost record");
            BackupSession.Proof proof=BackupSession.fileProof(candidate,candidate.length());int[] visited={0};
            try(InputStream input=new FileInputStream(candidate)){
                RestoreCandidate.Preview preview=RestoreCandidate.inspect(input,proof.bytes,proof.sha256,(json,value,index)->{
                    String body=value.getString("manualContent");require(index==0&&body.startsWith(start)&&body.endsWith(tail),"single body boundary changed");
                    require(hex(MessageDigest.getInstance("SHA-256").digest(body.getBytes(StandardCharsets.UTF_8))).equals(expectedHash),"single complete body hash changed");visited[0]++;
                });
                require(visited[0]==1&&preview.offlineRecords==1&&BackupValidation.same(preview.metadata,root),"restore proof/metadata changed");
            }
            try(InputStream input=new FileInputStream(candidate)){
                boolean rejected=false;try{RestoreCandidate.inspect(input,proof.bytes,"0".repeat(64),null);}catch(IOException expectedFailure){rejected=true;}
                require(rejected,"large candidate changed proof accepted");
            }
            System.out.println("SingleRecordCapacity: bodyMiB=68 completeUnicodeNulHash=true backupAndRestoreValidation=true corruptProofRejected=true JVMHeapMiB="+(Runtime.getRuntime().maxMemory()/1048576)+" AndroidSQLite=false physicalPhone=false");
        }finally{for(File file:new File[]{candidate,backup})if(file.exists()&&!file.delete())throw new IOException("public fixture cleanup failed");if(!directory.delete())throw new IOException("public directory cleanup failed");}
    }
}
