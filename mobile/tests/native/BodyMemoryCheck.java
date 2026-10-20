package coc.logbook;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.*;
import java.util.*;

/** Public synthetic pressure case: run with -Xmx192m, never with user data. */
public final class BodyMemoryCheck {
    private static Map<String,String> fixture() {
        List<String> rows=new ArrayList<>();
        for(int i=0;i<118;i++) rows.add("{\"id\":\"public-"+i+"\",\"moduleId\":\"m\",\"rawContent\":{\"messages\":[{\"text\":\""+"公开abcdef".repeat(32768)+"\",\"raw\":900719925474099312345}]}}");
        Map<String,String> fields=new LinkedHashMap<>();
        fields.put("schemaVersion","2"); fields.put("modules","[{\"id\":\"m\"}]");
        rows.set(0,"["+rows.get(0)); rows.set(rows.size()-1,rows.get(rows.size()-1)+"]");
        fields.put("records",String.join(",",rows)); fields.put("characters","[]"); fields.put("settings","{}"); fields.put("exportedAt","\"date\"");
        return fields;
    }
    public static void main(String[] args) throws Exception {
        Map<String,String> small=fixtureSmall(); Set<String> selected=Set.of("a");
        StringWriter output=new StringWriter(); RecordOverlay.writeView(output,small,selected);
        if(!output.toString().equals(RecordOverlay.view(small,selected).getString("json"))) throw new AssertionError("Projection changed");
        boolean refused=false; try{RecordOverlay.writeView(new StringWriter(),small,Set.of("missing"));}catch(IllegalArgumentException expected){refused=true;}
        if(!refused)throw new AssertionError("Missing target accepted");
        Map<String,String> fields=fixture(); System.gc();
        Set<String> ids=new HashSet<>(); for(int i=0;i<118;i++)ids.add("public-"+i);
        MessageDigest expected=MessageDigest.getInstance("SHA-256");
        try(Writer writer=new OutputStreamWriter(new DigestOutputStream(OutputStream.nullOutputStream(),expected),StandardCharsets.UTF_8)){JsonFields.write(writer,fields);}
        File directory=Files.createTempDirectory("coc-public-memory-").toFile();
        try(ReadLease lease=new ReadLease(directory)) {
            ReadLease.Value value=lease.create(writer->RecordOverlay.writeView(writer,fields,ids),7);
            if(value.bytes!=JsonFields.objectBytes(fields)||!value.sha256.equals(HexFormat.of().formatHex(expected.digest())))throw new AssertionError("Pressure content changed");
            lease.release(value.id);
        }
        if(directory.list().length!=0)throw new AssertionError("Lease leaked");
        System.out.println("118 public bodies / 192 MiB heap: exact projection, full bytes/hash, missing target and cleanup passed");
    }
    private static Map<String,String> fixtureSmall() {
        return JsonFields.split("{\"schemaVersion\":2,\"records\":[{\"id\":\"a\",\"moduleId\":\"m\",\"order\":1,\"manualContent\":\"中文😀\"},{\"id\":\"b\"}],\"recordOrders\":{\"a\":3},\"recordDeleted\":[\"b\"],\"recordValues\":{},\"modules\":[{\"id\":\"m\"}],\"characters\":[],\"settings\":{},\"exportedAt\":\"date\"}");
    }
}
