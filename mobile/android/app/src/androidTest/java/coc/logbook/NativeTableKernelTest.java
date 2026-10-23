package coc.logbook;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import static org.junit.Assert.*;

/** Public corpus only. Complete JS-reader/field differentials use the same
 * corpus; native failures must request full fallback, never partial success. */
@RunWith(AndroidJUnit4.class)
public final class NativeTableKernelTest {
    private byte[] asset(String name)throws Exception{
        Context tests=InstrumentationRegistry.getInstrumentation().getContext();
        try(InputStream input=tests.getAssets().open(name);ByteArrayOutputStream output=new ByteArrayOutputStream()){
            byte[] buffer=new byte[65536];int count;while((count=input.read(buffer))!=-1)output.write(buffer,0,count);return output.toByteArray();
        }
    }
    @Test public void publicCorpusNeverAcceptsDamagedInputAndKeepsCompleteFallback()throws Exception{
        JSONArray cases=new JSONArray(new String(asset("public-io-kernel-manifest.json"),StandardCharsets.UTF_8));
        assertTrue(cases.length()>=32);int invalid=0,compatible=0;
        for(int index=0;index<cases.length();index++){
            JSONObject item=cases.getJSONObject(index);String name=item.getString("name");
            JSONObject result=NativeTableKernel.inspect(asset("public-io-kernel-"+name+".xlsx"),1024L*1024*1024);
            assertEquals(name,item.getBoolean("native"),result!=null);
            if(!item.getBoolean("full")){invalid++;assertNull(name,result);}
            else if(!item.getBoolean("native")){compatible++;assertNull(name,result);}
            if(result!=null){assertTrue(result.getBoolean("supported"));assertEquals(1,result.getInt("version"));assertTrue(result.getLong("validatedCells")>0);}
        }
        assertTrue(invalid>=22);assertTrue(compatible>=5);
    }
    @Test public void sealedOwnerProofBindsExactlyTheSnapshotSentToNativeKernel()throws Exception{
        Context target=InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("coc.logbook.debug55",target.getPackageName());
        File root=new File(target.getCacheDir(),"public-kernel-proof-"+UUID.randomUUID());assertTrue(root.mkdir());
        TableSession owner=new TableSession(root,"public://isolated-kernel",7,"character-table","public.xlsx",null);
        try{
            byte[] bytes=asset("public-io-kernel-complete-public-character-draft.xlsx");
            BackupSession.Proof proof=owner.capture(new ByteArrayInputStream(bytes));
            JSONObject result=owner.inspectCoc7Kernel();assertNotNull(result);
            assertEquals(proof.bytes,result.getJSONObject("source").getLong("bytes"));assertEquals(proof.sha256,result.getJSONObject("source").getString("sha256"));
            bytes[40]^=1;try(FileOutputStream output=new FileOutputStream(owner.source)){output.write(bytes);output.getFD().sync();}
            try{owner.inspectCoc7Kernel();fail("Changed complete input must not reuse a sealed proof");}catch(IOException expected){}
        }finally{owner.close();assertTrue(root.delete());}
    }
    @Test public void readOnlyKernelNeedsNoUnusedIndexButKeepsOwnedSourceCleanup()throws Exception{
        Context target=InstrumentationRegistry.getInstrumentation().getTargetContext();assertEquals("coc.logbook.debug55",target.getPackageName());
        File root=new File(target.getCacheDir(),"public-kernel-deferred-"+UUID.randomUUID());assertTrue(root.mkdir());
        TableSession owner=new TableSession(root,"public://isolated-kernel",7,"character-table","public.xlsx",null,true);
        try{
            assertFalse(new File(owner.directory,"stage.sqlite").exists());
            assertFalse(owner.directory.exists());
            owner.capture(new ByteArrayInputStream(asset("public-io-kernel-complete-public-character-draft.xlsx")));
            assertNotNull(owner.inspectCoc7Kernel());assertFalse(owner.directory.exists());assertFalse(owner.source.exists());
            try{owner.append("candidate",0,new byte[]{1});fail("Read-only snapshot must not grant candidate write");}catch(IOException expected){}
            assertFalse(owner.directory.exists());
        }finally{owner.close();assertTrue(root.delete());}
    }
    @Test public void completeFallbackCreatesTheSameIndexOnFirstStringWrite()throws Exception{
        Context target=InstrumentationRegistry.getInstrumentation().getTargetContext();assertEquals("coc.logbook.debug55",target.getPackageName());
        File root=new File(target.getCacheDir(),"public-kernel-spill-"+UUID.randomUUID());assertTrue(root.mkdir());
        TableSession owner=new TableSession(root,"public://isolated-kernel",7,"character-table","public.xlsx",null,true);
        try{
            owner.capture(new ByteArrayInputStream(asset("public-io-kernel-saved-date-compatible-fallback.xlsx")));
            assertFalse(owner.source.exists());assertNull(owner.inspectCoc7Kernel());assertTrue(owner.source.exists());
            assertFalse(new File(owner.directory,"stage.sqlite").exists());
            owner.append("strings",0,"[0,\"完整公开字符串\"]\n".getBytes(StandardCharsets.UTF_8));
            assertTrue(new File(owner.directory,"stage.sqlite").exists());
            JSONObject read=owner.string(0,0);assertTrue(read.getBoolean("done"));
            assertEquals("完整公开字符串",new String(android.util.Base64.decode(read.getString("base64"),android.util.Base64.DEFAULT),StandardCharsets.UTF_8));
            try(android.database.sqlite.SQLiteDatabase index=android.database.sqlite.SQLiteDatabase.openDatabase(new File(owner.directory,"stage.sqlite").getPath(),null,android.database.sqlite.SQLiteDatabase.OPEN_READONLY);
                android.database.Cursor mode=index.rawQuery("PRAGMA journal_mode",null)){
                assertTrue(mode.moveToFirst());assertEquals("delete",mode.getString(0));
            }
        }finally{owner.close();assertTrue(root.delete());}
    }
    @Test public void memorySnapshotUsesCanonicalShaAndOwnsAnImmutableCopy()throws Exception{
        Context target=InstrumentationRegistry.getInstrumentation().getTargetContext();assertEquals("coc.logbook.debug55",target.getPackageName());
        File root=new File(target.getCacheDir(),"public-kernel-memory-"+UUID.randomUUID());assertTrue(root.mkdir());
        TableSession owner=new TableSession(root,"public://isolated-kernel",7,"character-table","public.xlsx",null,true);
        try{
            byte[] bytes="abc".getBytes(StandardCharsets.UTF_8);BackupSession.Proof proof=owner.capture(new ByteArrayInputStream(bytes));
            assertEquals(3,proof.bytes);assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",proof.sha256);java.util.Arrays.fill(bytes,(byte)0);
            assertNull(owner.inspectCoc7Kernel());assertTrue(owner.source.exists());
            assertEquals("abc",new String(java.nio.file.Files.readAllBytes(owner.source.toPath()),StandardCharsets.UTF_8));
            BackupSession.Proof copied=BackupSession.fileProof(owner.source,3);proof.matches(copied.bytes,copied.sha256);
        }finally{owner.close();assertTrue(root.delete());}
    }
    @Test public void memoryBudgetOverflowKeepsTheCompleteOriginalDiskSource()throws Exception{
        Context target=InstrumentationRegistry.getInstrumentation().getTargetContext();assertEquals("coc.logbook.debug55",target.getPackageName());
        File root=new File(target.getCacheDir(),"public-kernel-memory-overflow-"+UUID.randomUUID());assertTrue(root.mkdir());
        TableSession owner=new TableSession(root,"public://isolated-kernel",7,"character-table","public.xlsx",null,true);
        try{
            byte[] bytes=asset("public-io-kernel-source-cache-overflow-is-full-fallback.xlsx");assertTrue(bytes.length>2*1024*1024);
            BackupSession.Proof proof=owner.capture(new ByteArrayInputStream(bytes));assertEquals(bytes.length,proof.bytes);assertEquals(bytes.length,owner.source.length());assertNull(owner.inspectCoc7Kernel());
            BackupSession.Proof copied=BackupSession.fileProof(owner.source,bytes.length);proof.matches(copied.bytes,copied.sha256);
            assertArrayEquals(bytes,java.nio.file.Files.readAllBytes(owner.source.toPath()));
        }finally{owner.close();assertTrue(root.delete());}
    }
}
