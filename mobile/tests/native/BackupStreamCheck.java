package coc.logbook;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.*;
import org.json.*;

public final class BackupStreamCheck {
    static int checks;
    interface Action {void run()throws Exception;}
    static void require(boolean value,String message){if(!value)throw new AssertionError(message);checks++;}
    static void rejects(String message,Action action)throws Exception{try{action.run();}catch(Exception expected){checks++;return;}throw new AssertionError(message);}
    static JSONObject root(JSONObject complete)throws Exception{
        JSONObject result=new JSONObject(complete.toString());JSONArray records=result.getJSONArray("records");
        for(int i=0;i<records.length();i++)records.put(i,BackupValidation.metadataOf(records.getJSONObject(i)));
        return result;
    }
    static String hash(byte[] bytes)throws Exception{StringBuilder result=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))result.append(String.format("%02x",b&255));return result.toString();}
    static RestoreCandidate.Preview inspect(byte[] bytes)throws Exception{return RestoreCandidate.inspect(new ByteArrayInputStream(bytes),bytes.length,hash(bytes),null);}
    public static void main(String[] args)throws Exception{
        JSONArray rotation=new JSONArray();
        for(int index=0;index<11;index++)rotation.put(new JSONObject().put("tree","public-A").put("id",index));
        for(int index=0;index<20;index++)rotation.put(new JSONObject().put("tree","public-B").put("id",index));
        rotation.put(new JSONObject().put("tree","public-A").put("id",11));String unchanged=rotation.toString();
        require(AutomaticRetention.candidates(rotation,"public-A",10).equals(new HashSet<>(Arrays.asList(0,1))),"ten backups are retained per location after switching");
        require(AutomaticRetention.candidates(rotation,"public-C",10).isEmpty(),"unrelated locations are never rotation candidates");
        require(rotation.toString().equals(unchanged),"retention selection never mutates the registry");
        File directory=Files.createTempDirectory("coc-native-backup-check-").toFile();
        try{
            JSONObject fixture=new JSONObject(Files.readString(new File(args[0]).toPath(),StandardCharsets.UTF_8));
            try(BackupSession readOnly=new BackupSession(new File(directory,"read-only"),"",7,false,false,true,()->2L*1024*1024*1024)){
                readOnly.captureJson(writer->writer.write(fixture.toString()));
                rejects("search source cannot enable output staging",()->readOnly.beginOutput());
                rejects("search source cannot append output",()->readOnly.append("output",0,new byte[]{1}));
            }
            JSONObject header=root(fixture);BackupValidation.metadata(header);checks++;
            for(String json:new String[]{"{\"a\":1,\"\\u0061\":2}","{\"raw\":{\"x\":1,\"x\":2}}","{a:1}","{'a':1}","[1,]","{\"x\":01}","{\"a\":true,}","null false"})
                rejects("strict JSON "+json,()->StrictBackupJson.validate(json));
            StrictBackupJson.validate("{\"emoji😀\":[\"\\u0000\",-1.2e+3,null,true,{\"x\":\"\\\\\\\"\"}]}");checks++;
            StringBuilder small=new StringBuilder();JSONArray rows=fixture.getJSONArray("records");
            for(int i=0;i<rows.length();i++){BackupValidation.record(rows.getJSONObject(i));small.append('R').append(rows.getJSONObject(i)).append('\n');}
            small.append('M').append(header).append('\n');byte[] original=small.toString().getBytes(StandardCharsets.UTF_8);
            RestoreCandidate.Preview preview=inspect(original);require(BackupValidation.same(preview.metadata,header),"complete metadata preserved");
            rejects("missing terminator",()->inspect(Arrays.copyOf(original,original.length-1)));
            rejects("trailing candidate row",()->inspect((small+"R{}\n").getBytes(StandardCharsets.UTF_8)));
            rejects("hash mismatch",()->RestoreCandidate.inspect(new ByteArrayInputStream(original),original.length,"0".repeat(64),null));
            JSONObject wrong=new JSONObject(header.toString());wrong.getJSONArray("records").getJSONObject(0).put("moduleId","missing");
            rejects("native graph invalid",()->BackupValidation.metadata(wrong));
            JSONObject badBody=new JSONObject(rows.getJSONObject(0).toString());badBody.put("sequenceNo","1");
            rejects("native field type coercion forbidden",()->BackupValidation.record(badBody));
            File keep=new File(directory,"keep.txt");Files.writeString(keep.toPath(),"public untouched");
            long[] free={1024L*1024*1024};
            try(BackupSession session=new BackupSession(directory,"public-tree",7,true,false,()->free[0])){
                session.capture("source",new ByteArrayInputStream(original),-1,null);long maximum=session.beginOutput();
                require(maximum>64L*1024*1024,"native budget can exceed old total cap");
                for(int at=0,index=0;at<original.length;at+=65536,index++)session.append("candidate",index,Arrays.copyOfRange(original,at,Math.min(original.length,at+65536)));
                session.verify("candidate",original.length,hash(original));
                session.verify("zip:archives/empty.txt",0,hash(new byte[0]));
                session.finish(new HashSet<>(Arrays.asList("source","candidate","zip:archives/empty.txt")));session.requireReady();checks++;
                rejects("sealed lease cannot append",()->session.append("candidate",0,new byte[]{1}));
                try(InputStream input=new FileInputStream(session.file("candidate"))){RestoreCandidate.inspect(input,original.length,hash(original),null);checks++;}
                rejects("wrong lease token",()->session.require("other"));
            }
            require(keep.exists(),"cleanup preserves unrelated file");
            try(BackupSession empty=new BackupSession(directory,"public-tree",7,true,false,()->free[0])){
                empty.capture("source",new ByteArrayInputStream(original),-1,null);empty.beginOutput();
                for(int at=0,index=0;at<original.length;at+=65536,index++)empty.append("candidate",index,Arrays.copyOfRange(original,at,Math.min(original.length,at+65536)));
                rejects("missing nonempty attachment",()->empty.verify("zip:archives/missing.txt",1,hash(new byte[]{1})));
                rejects("false empty attachment proof",()->empty.verify("zip:archives/false.txt",0,"0".repeat(64)));
                JSONArray selected=new JSONArray().put(new JSONObject().put("zipPath","archives/empty.txt").put("name","empty.txt").put("mime","text/plain").put("bytes",0).put("sha256",hash(new byte[0])));
                empty.previewRestore(new BackupSession.Proof(original.length,hash(original)),selected);empty.requireReady();
                require(empty.attachments.size()==1&&empty.file("zip:archives/empty.txt").length()==0&&empty.proof("zip:archives/empty.txt").sha256.equals(hash(new byte[0])),"empty attachment independently sealed in real preview");
                rejects("sealed preview cannot invent another empty attachment",()->empty.verify("zip:archives/late.txt",0,hash(new byte[0])));
            }
            try(BackupSession session=new BackupSession(directory,"public-tree",7,true,false,()->free[0])){
                session.capture("source",new ByteArrayInputStream(new byte[]{1}),-1,null);session.beginOutput();
                rejects("caller cannot mutate captured source",()->session.append("source",0,new byte[]{1}));
                rejects("out of order chunk",()->session.append("candidate",1,new byte[]{1}));
                rejects("oversized chunk",()->session.append("candidate",0,new byte[LogbookLimits.TRANSFER_CHUNK_BYTES+1]));
                free[0]=StorageBudget.MINIMUM_RESERVE;
                rejects("space drops after native preflight",()->session.append("candidate",0,new byte[]{1}));
            }
            free[0]=1024L*1024*1024;
            // A complete library larger than the JVM heap is written and read
            // one public 1MiB body at a time. No SQLite/device claim here.
            int count=args.length>1?Integer.parseInt(args[1]):96;
            JSONObject seed=rows.getJSONObject(0);String text="公开😀\n\0"+"x".repeat(1024*1024);JSONArray metadataRows=new JSONArray();
            File candidate=new File(directory,"public-scale.part"),backup=new File(directory,"public-scale.json");long start=System.nanoTime();
            try(Writer output=new BufferedWriter(new OutputStreamWriter(new FileOutputStream(candidate),StandardCharsets.UTF_8),65536);
                Writer source=new BufferedWriter(new OutputStreamWriter(new FileOutputStream(backup),StandardCharsets.UTF_8),65536)){
                JSONObject business=new JSONObject(header.toString());business.remove("records");String prefix=business.toString();
                source.write("{\"format\":\"coc.logbook.android\",\"formatVersion\":1,\"snapshot\":"+prefix.substring(0,prefix.length()-1)+",\"records\":[");
                for(int i=0;i<count;i++){
                    JSONObject record=new JSONObject(seed.toString());record.put("id","scale-"+i);record.put("order",i);record.put("manualContent",i+":"+text+":END-"+i);
                    String json=record.toString();metadataRows.put(BackupValidation.metadataOf(record));output.write("R"+json+"\n");
                    if(i>0)source.write(',');source.write(json);
                }
                JSONObject metadata=new JSONObject(header.toString());metadata.put("records",metadataRows);output.write("M"+metadata+"\n");
                source.write("]}}");
            }
            require(SnapshotBackupStream.validate(backup)==count,"native canonical backup visits every complete body");
            BackupSession.Proof proof=BackupSession.fileProof(candidate,candidate.length());int[] seen={0};
            try(InputStream input=new FileInputStream(candidate)){
                RestoreCandidate.Preview large=RestoreCandidate.inspect(input,proof.bytes,proof.sha256,(json,value,index)->{
                    require(index==seen[0]++ && value.getString("manualContent").equals(index+":"+text+":END-"+index),"all native full bodies equal");
                });
                require(large.metadata.getJSONArray("records").length()==count&&seen[0]==count&&proof.bytes>64L*1024*1024,"complete native scale proof");
            }
            System.out.println("BackupStream: "+checks+" checks passed; publicRecords="+count+" bytes="+proof.bytes+" sha256="+proof.sha256+" seconds="+(System.nanoTime()-start)/1e9+" JVMHeapMiB="+(Runtime.getRuntime().maxMemory()/1048576)+" nativeDevice=false");
            require(candidate.delete(),"synthetic candidate cleanup");require(backup.delete(),"synthetic backup cleanup");require(keep.delete(),"fixture cleanup");
        }finally{File[] files=directory.listFiles();if(files!=null)for(File file:files)if(!file.delete())throw new IOException("fixture cleanup");if(!directory.delete())throw new IOException("fixture directory cleanup");}
    }
}
