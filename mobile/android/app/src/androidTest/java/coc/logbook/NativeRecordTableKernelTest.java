package coc.logbook;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Complete public sources only. A projection is never a commit capability. */
@RunWith(AndroidJUnit4.class)
public final class NativeRecordTableKernelTest {
    private final Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
    private static final long FREE=32L*1024*1024*1024;
    private byte[] asset(String name)throws Exception{
        try(InputStream input=InstrumentationRegistry.getInstrumentation().getContext().getAssets().open(name);ByteArrayOutputStream output=new ByteArrayOutputStream()){
            byte[] buffer=new byte[65536];int n;while((n=input.read(buffer))!=-1)output.write(buffer,0,n);return output.toByteArray();
        }
    }
    private static String hex(byte[] bytes){StringBuilder text=new StringBuilder();for(byte value:bytes)text.append(String.format(Locale.ROOT,"%02x",value&255));return text.toString();}
    private static void remove(File root)throws Exception{if(!root.exists())return;for(File item:Objects.requireNonNull(root.listFiles())){if(item.isDirectory())remove(item);else assertTrue(item.delete());}assertTrue(root.delete());}
    private static boolean supported(String json)throws Exception{return json!=null&&new JSONObject(json).optBoolean("supported");}
    private static String candidate(String body)throws Exception{
        JSONObject value=new JSONObject().put("sheet","公开投影").put("moduleName","公开投影新模组").put("sessionName","完整候选").put("link","").put("manualContent",body).put("kps",new JSONArray()).put("pairs",new JSONArray());
        return "T"+new JSONObject().put("sheetOrder",0).put("rowOrder",1).put("value",value)+"\n";
    }
    private static BackupSession.Proof send(TableSession owner,String text)throws Exception{
        byte[] bytes=text.getBytes(StandardCharsets.UTF_8);int index=0;for(int at=0;at<bytes.length;at+=LogbookLimits.TRANSFER_CHUNK_BYTES)owner.append("candidate",index++,Arrays.copyOfRange(bytes,at,Math.min(bytes.length,at+LogbookLimits.TRANSFER_CHUNK_BYTES)));
        return new BackupSession.Proof(bytes.length,hex(MessageDigest.getInstance("SHA-256").digest(bytes)));
    }
    @Test public void completePublicWorkbookKeepsAllLinksAndTheEntireLastManualCell()throws Exception{
        JSONObject payload=new JSONObject(NativeTableKernel.inspectRecords(asset("public-io-table.xlsx"),FREE,null));
        assertTrue(payload.getBoolean("supported"));assertEquals(1,payload.getInt("version"));assertEquals("records",payload.getString("projection"));assertTrue(payload.getBoolean("compact"));
        JSONArray sheets=payload.getJSONArray("sheets");assertEquals(1,sheets.length());JSONObject sheet=sheets.getJSONObject(0);assertEquals("场次",sheet.getString("name"));assertEquals(0,sheet.getInt("order"));assertEquals(0,sheet.getJSONArray("mergedRanges").length());
        JSONArray rows=sheet.getJSONArray("rows");assertEquals(116,rows.length());Set<String> links=new HashSet<>();boolean manual=false;long cells=0;JSONObject strings=payload.getJSONObject("strings");
        for(int r=0;r<rows.length();r++){
            JSONObject row=rows.getJSONObject(r);assertEquals(r,row.getInt("index"));JSONArray tokens=row.getJSONArray("cells");cells+=tokens.length();
            for(int c=0;c<tokens.length();c++){
                JSONArray token=tokens.getJSONArray(c);assertEquals(6,token.length());String text=token.getString(1).equals("s")?strings.getString(token.getString(2)):token.getString(1).equals("inlineStr")?token.getString(3):token.getString(2);
                if(text.startsWith("https://log.weizaima.com/?key=public-io-"))links.add(text);
                if(r==115&&token.getString(0).equals("D116")){assertEquals("PUBLIC_MANUAL_BEGIN\n完整😀正文\nPUBLIC_MANUAL_END",text);manual=true;}
            }
        }
        assertEquals(cells,payload.getLong("validatedCells"));assertTrue(manual);assertEquals(114,links.size());for(int i=0;i<114;i++)assertTrue(links.contains("https://log.weizaima.com/?key=public-io-"+i));
    }
    @Test public void damagedOriginalCorpusCannotBecomeARecordsProjection()throws Exception{
        JSONArray cases=new JSONArray(new String(asset("public-io-kernel-manifest.json"),StandardCharsets.UTF_8));int invalid=0;
        for(int i=0;i<cases.length();i++){JSONObject item=cases.getJSONObject(i);if(!item.getBoolean("full")){invalid++;assertFalse(item.getString("name"),supported(NativeTableKernel.inspectRecords(asset("public-io-kernel-"+item.getString("name")+".xlsx"),FREE,null)));}}
        assertTrue(invalid>=22);
    }
    @Test public void completeRecordsCorpusPreservesAllSupportedAndFullFallbackCases()throws Exception{
        JSONArray cases=new JSONArray(new String(asset("public-io-record-kernel-manifest.json"),StandardCharsets.UTF_8));assertTrue(cases.length()>=30);int compatible=0,complete=0;
        for(int i=0;i<cases.length();i++){
            JSONObject item=cases.getJSONObject(i);byte[] bytes=asset("public-io-record-kernel-"+item.getString("name")+".xlsx");assertEquals(item.getLong("bytes"),bytes.length);
            String encoded=NativeTableKernel.inspectRecords(bytes,FREE,null);boolean accepted=supported(encoded);assertEquals(item.getString("name"),item.getBoolean("native"),accepted);
            if(accepted){complete++;JSONObject result=new JSONObject(encoded);assertEquals("records",result.getString("projection"));assertTrue(result.getJSONArray("sheets").length()>0);}
            if(item.getBoolean("full")&&!item.getBoolean("native"))compatible++;
        }
        assertTrue(complete>=5);assertTrue(compatible>=7);
    }
    @Test public void projectionKeepsDurableSourceAndNormalCompletePreviewCommit()throws Exception{
        String name="public-record-kernel-"+UUID.randomUUID()+".sqlite";File root=new File(context.getCacheDir(),"public-record-kernel-"+UUID.randomUUID());assertTrue(root.mkdir());
        try(LogbookDatabase db=new LogbookDatabase(context,name,true,()->FREE)){
            JSONObject original=new JSONObject(new String(asset("public-capacity.json"),StandardCharsets.UTF_8));db.replace(original.toString(),0);int oldCount=original.getJSONArray("records").length();String before=db.snapshot();
            try(TableSession owner=new TableSession(root,"public",1,"record-table","public.xlsx",()->FREE,true)){
                byte[] source=asset("public-io-table.xlsx");BackupSession.Proof proof=owner.capture(new ByteArrayInputStream(source));JSONObject result=owner.inspectRecordsKernel(null);assertNotNull(result);assertTrue(supported(result.getString("payloadJson")));
                assertEquals(proof.bytes,result.getJSONObject("source").getLong("bytes"));assertEquals(proof.sha256,result.getJSONObject("source").getString("sha256"));assertArrayEquals(source,java.nio.file.Files.readAllBytes(owner.source.toPath()));assertFalse(new File(owner.directory,"stage.sqlite").exists());
                owner.prepareSeed(db,original.getJSONObject("settings"),()->{},false);String body=String.join("",Collections.nCopies(10000,"完整公开😀"))+"\u0000\r\n末尾";
                JSONObject preview=owner.preview(db,send(owner,candidate(body)),original.getJSONObject("settings"));assertEquals(1,preview.getInt("added"));assertEquals(before,db.snapshot());owner.prepareCommit();assertEquals(2,db.edit(1,owner::apply));
                JSONArray saved=new JSONObject(db.snapshot()).getJSONArray("records");assertEquals(oldCount+1,saved.length());assertEquals(body,saved.getJSONObject(oldCount).getString("manualContent"));for(int i=0;i<oldCount;i++)assertTrue(BackupValidation.same(original.getJSONArray("records").getJSONObject(i),saved.getJSONObject(i)));
            }
        }finally{context.deleteDatabase(name);remove(root);}
    }
    @Test public void shortenedExtendedAndChangedSealedSourceAreRejectedBeforeProjection()throws Exception{
        File root=new File(context.getCacheDir(),"public-record-proof-"+UUID.randomUUID());assertTrue(root.mkdir());byte[] source=asset("public-io-table.xlsx");
        try{
            for(int mode=0;mode<3;mode++)try(TableSession owner=new TableSession(root,"public",0,"record-table","public.xlsx",()->FREE,true)){
                owner.capture(new ByteArrayInputStream(source));try(RandomAccessFile file=new RandomAccessFile(owner.source,"rw")){if(mode==0)file.setLength(source.length-1);if(mode==1){file.seek(source.length);file.write(65);}if(mode==2){file.seek(40);file.write(source[40]^1);}}
                try{owner.inspectRecordsKernel(null);fail("Changed complete source accepted "+mode);}catch(IOException expected){}
            }
        }finally{remove(root);}
    }
    @Test public void sourceBudgetOverflowAndUnsupportedFormatsKeepEveryFallbackByte()throws Exception{
        File root=new File(context.getCacheDir(),"public-record-fallback-"+UUID.randomUUID());assertTrue(root.mkdir());
        try{
            byte[] large=asset("public-io-kernel-source-cache-overflow-is-full-fallback.xlsx");assertTrue(large.length>2*1024*1024);
            try(TableSession owner=new TableSession(root,"public",0,"record-table","public.xlsx",()->FREE,true)){BackupSession.Proof proof=owner.capture(new ByteArrayInputStream(large));assertNull(owner.inspectRecordsKernel(null));assertArrayEquals(large,java.nio.file.Files.readAllBytes(owner.source.toPath()));BackupSession.fileProof(owner.source,large.length).matches(proof.bytes,proof.sha256);owner.append("candidate",0,candidate("完整fallback末尾").getBytes(StandardCharsets.UTF_8));}
            for(String extension:new String[]{"csv","xls"})try(TableSession owner=new TableSession(root,"public",0,"record-table","public."+extension,()->FREE,true)){byte[] source=asset("public-io-table."+extension);owner.capture(new ByteArrayInputStream(source));assertNull(owner.inspectRecordsKernel(null));assertArrayEquals(source,java.nio.file.Files.readAllBytes(owner.source.toPath()));}
        }finally{remove(root);}
    }
}
