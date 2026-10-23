package coc.logbook;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import android.content.Context;
import java.io.*;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Public byte fixtures prove the complete decoded-line accounting contract. */
@RunWith(AndroidJUnit4.class)
public final class TableCandidateLineProofTest {
    private static final long FREE=32L*1024*1024*1024;
    @Test public void completeLineByteProofSurvivesEveryTransportBoundary()throws Exception {
        String large="T{\"value\":\""+String.join("",Collections.nCopies(50000,"完整😀"))+"\"}";
        List<String> expected=Arrays.asList("T{\"value\":\"ASCII\"}","T{\"value\":\"中😀\\r\\n\\u0000\\ud800\"}\r",large);
        byte[] input=(String.join("\n",expected)+"\n").getBytes(StandardCharsets.UTF_8);
        for(int chunk:new int[]{1,3,113,65536,input.length}) {
            TableSession.Lines lines=new TableSession.Lines();List<String> decoded=new ArrayList<>();List<Long> lengths=new ArrayList<>();
            for(int at=0;at<input.length;at+=chunk)lines.appendWithProof(input,at,Math.min(chunk,input.length-at),(value,byteLength)->{decoded.add(value);lengths.add(byteLength);});
            lines.finish();assertEquals(expected,decoded);assertEquals(expected.size(),lengths.size());
            for(int index=0;index<expected.size();index++) {
                String value=expected.get(index);assertEquals((long)value.getBytes(StandardCharsets.UTF_8).length,(long)lengths.get(index));
                assertEquals("Exact raw JSON bytes after the one-byte purpose prefix",JsonFields.bytes(value.substring(1)),lengths.get(index)-1);
                assertNotNull(StrictTableJson.parseObject(decoded.get(index).substring(1)));
            }
        }
    }

    @Test public void invalidUtf8NeverPublishesALineProofAndJsonStillRejectsInvalidGrammar()throws Exception {
        for(byte[] invalid:new byte[][]{{(byte)0xc3,0x28},{(byte)0xed,(byte)0xa0,(byte)0x80},{(byte)0xf0,(byte)0x9f,(byte)0x98},{(byte)0xc0,(byte)0x80}}) {
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();bytes.write("T{\"value\":\"".getBytes(StandardCharsets.UTF_8));bytes.write(invalid);bytes.write("\"}\n".getBytes(StandardCharsets.UTF_8));
            TableSession.Lines lines=new TableSession.Lines();int[] callbacks={0};byte[] input=bytes.toByteArray();
            try{lines.appendWithProof(input,0,input.length,(value,length)->callbacks[0]++);fail("Invalid UTF-8 received a byte proof");}catch(CharacterCodingException expected){}
            assertEquals(0,callbacks[0]);
        }
        for(String invalid:new String[]{"T{\"value\":1,\"value\":2}","T{\"value\":01}","T{\"value\":true} trailing","T{\"value\":\"\\x41\"}"}) {
            byte[] input=(invalid+"\n").getBytes(StandardCharsets.UTF_8);TableSession.Lines lines=new TableSession.Lines();
            try{lines.appendWithProof(input,0,input.length,(value,length)->StrictTableJson.parseObject(value.substring(1)));fail("Byte accounting bypassed strict JSON");}catch(IllegalArgumentException expected){}
        }
    }

    @Test public void completeEarlierLineCannotHideAnUnterminatedTail()throws Exception {
        TableSession.Lines lines=new TableSession.Lines();byte[] input="T{\"value\":1}\nT{\"value\":2}".getBytes(StandardCharsets.UTF_8);int[] callbacks={0};
        lines.appendWithProof(input,0,input.length,(value,length)->callbacks[0]++);assertEquals(1,callbacks[0]);
        try{lines.finish();fail("Unterminated complete-looking tail was accepted");}catch(IOException expected){}
    }

    @Test public void laterCandidateStillChecksFallingCapacityAndCannotCommitAPartialPreview()throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();String databaseName="public-line-proof-"+UUID.randomUUID()+".sqlite";
        File root=new File(context.getCacheDir(),"public-line-proof-"+UUID.randomUUID());assertTrue(root.mkdir());
        try(LogbookDatabase database=new LogbookDatabase(context,databaseName,true,()->FREE)) {
            JSONObject initial;try(InputStream source=InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("public-capacity.json");ByteArrayOutputStream bytes=new ByteArrayOutputStream()) {
                byte[] chunk=new byte[65536];int count;while((count=source.read(chunk))!=-1)bytes.write(chunk,0,count);initial=new JSONObject(bytes.toString("UTF-8"));
            }
            database.replace(initial.toString(),0);String before=database.snapshot();boolean[] checking={false};int[] checks={0};
            try(TableSession owner=new TableSession(root,"public",1,"record-table","public.csv",()->checking[0]&&++checks[0]>=2?StorageBudget.MINIMUM_RESERVE:FREE,true)) {
                owner.capture(new ByteArrayInputStream("public source".getBytes(StandardCharsets.UTF_8)));owner.prepareSeed(database,initial.getJSONObject("settings"),()->{},false);
                StringBuilder candidate=new StringBuilder();for(int index=0;index<2;index++) {
                    JSONObject row=new JSONObject().put("sheet","公开").put("moduleName","公开字节证明").put("sessionName","公开场"+index).put("link","").put("kps",new JSONArray()).put("pairs",new JSONArray()).put("manualContent",index==0?String.join("",Collections.nCopies(30000,"完整😀"))+"\r\n\u0000尾":"完整末场");
                    candidate.append('T').append(new JSONObject().put("sheetOrder",0).put("rowOrder",index).put("value",row)).append("\r\n");
                }
                byte[] bytes=candidate.toString().getBytes(StandardCharsets.UTF_8);long part=0;for(int at=0;at<bytes.length;at+=LogbookLimits.TRANSFER_CHUNK_BYTES)owner.append("candidate",part++,Arrays.copyOfRange(bytes,at,Math.min(bytes.length,at+LogbookLimits.TRANSFER_CHUNK_BYTES)));
                StringBuilder hash=new StringBuilder();for(byte value:MessageDigest.getInstance("SHA-256").digest(bytes))hash.append(String.format(Locale.ROOT,"%02x",value&255));
                checking[0]=true;
                try{owner.preview(database,new BackupSession.Proof(bytes.length,hash.toString()),initial.getJSONObject("settings"));fail("Later line skipped its current capacity check");}catch(IOException expected){}finally{checking[0]=false;}
                assertEquals("Each complete candidate line must consult live capacity",2,checks[0]);assertEquals(before,database.snapshot());assertEquals(1,database.revision());
                try{owner.prepareCommit();fail("Failed preview became committable");}catch(IOException expected){}
            }
        }finally{context.deleteDatabase(databaseName);assertEquals(0,Objects.requireNonNull(root.listFiles()).length);assertTrue(root.delete());}
    }
}
