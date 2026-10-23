package coc.logbook;

import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.lang.reflect.*;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Small allocations must still consume and validate complete joined values. */
@RunWith(AndroidJUnit4.class)
public final class TableSmallContentTest {
    private final Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
    private static final long FREE=32L*1024*1024*1024;
    private interface Check {void run(TableSession owner,SQLiteDatabase database)throws Exception;}
    private void isolated(Check check)throws Exception {
        File root=new File(context.getCacheDir(),"public-small-content-"+UUID.randomUUID());assertTrue(root.mkdir());
        try(TableSession owner=new TableSession(root,"public",0,"record-table","public.csv",()->FREE);
            SQLiteDatabase database=SQLiteDatabase.openDatabase(new File(owner.directory,"stage.sqlite").getPath(),null,SQLiteDatabase.OPEN_READWRITE)) {
            check.run(owner,database);
        }finally{remove(root);}
    }
    private static void remove(File root)throws Exception {
        if(!root.exists())return;for(File file:Objects.requireNonNull(root.listFiles())){if(file.isDirectory())remove(file);else assertTrue(file.delete());}assertTrue(root.delete());
    }
    private static String content(TableSession owner,long id)throws Exception {
        Method method=TableSession.class.getDeclaredMethod("contentText",long.class);method.setAccessible(true);
        try{return (String)method.invoke(owner,id);}catch(InvocationTargetException error){throw (Exception)error.getCause();}
    }
    private static void chunks(SQLiteDatabase database,long id,byte[] value)throws Exception {
        database.execSQL("DELETE FROM blob_chunks WHERE owner=?",new Object[]{id});
        database.execSQL("INSERT OR REPLACE INTO blobs(id,bytes,resident) VALUES(?,?,NULL)",new Object[]{id,value.length});
        int offset=0,position=0;int[] sizes={1,3,2,7,113,1009,LogbookLimits.TRANSFER_CHUNK_BYTES};
        while(offset<value.length){int count=Math.min(value.length-offset,sizes[Math.min(position,sizes.length-1)]);database.execSQL("INSERT INTO blob_chunks VALUES(?,?,?,?)",new Object[]{id,position++,offset,Arrays.copyOfRange(value,offset,offset+count)});offset+=count;}
    }
    private static void rejected(TableSession owner,long id)throws Exception {
        try{content(owner,id);fail("accepted corrupt public small content");}catch(IOException expected){}
    }
    @Test public void smallMultiChunkValuesDecodeEveryByteAcrossUtf8Boundaries()throws Exception {
        isolated((owner,database)->{
            String boundary=String.join("",Collections.nCopies(65532,"A"))+"😀";
            String[] values={"","中😀\u0000\r\n完整尾",boundary,boundary+"尾"};
            for(int i=0;i<values.length;i++){chunks(database,100+i,values[i].getBytes(StandardCharsets.UTF_8));assertEquals(values[i],content(owner,100+i));}
        });
    }
    @Test public void exactFirstChunkCannotHideAnExtraTrailingChunk()throws Exception {
        isolated((owner,database)->{
            byte[] complete="完整😀\u0000\r\n尾".getBytes(StandardCharsets.UTF_8);long id=200;
            for(byte[] extra:new byte[][]{new byte[]{65},new byte[0]}) {
                chunks(database,id,new byte[0]);database.execSQL("UPDATE blobs SET bytes=? WHERE id=?",new Object[]{complete.length,id});
                database.execSQL("INSERT INTO blob_chunks VALUES(?,0,0,?)",new Object[]{id,complete});
                assertEquals(new String(complete,StandardCharsets.UTF_8),content(owner,id));
                database.execSQL("INSERT INTO blob_chunks VALUES(?,1,?,?)",new Object[]{id,complete.length,extra});rejected(owner,id);
            }
        });
    }
    @Test public void smallChunksStillRejectMissingBytesPositionsAndOffsets()throws Exception {
        isolated((owner,database)->{
            byte[] complete="中😀\u0000\r\n完整末尾".getBytes(StandardCharsets.UTF_8);long id=300;
            for(int scenario=0;scenario<4;scenario++) {
                chunks(database,id,complete);
                if(scenario==0)database.execSQL("DELETE FROM blob_chunks WHERE owner=? AND position=1",new Object[]{id});
                if(scenario==1)database.execSQL("UPDATE blob_chunks SET offset=offset+1 WHERE owner=? AND position=1",new Object[]{id});
                if(scenario==2)database.execSQL("UPDATE blobs SET bytes=bytes+1 WHERE id=?",new Object[]{id});
                if(scenario==3)database.execSQL("UPDATE blobs SET bytes=bytes-1 WHERE id=?",new Object[]{id});
                rejected(owner,id);
            }
        });
    }
    @Test public void smallCompleteResidentAndChunkValuesStrictlyRejectInvalidUtf8()throws Exception {
        isolated((owner,database)->{
            byte[][] invalid={{(byte)0xc3,0x28},{(byte)0xf0,(byte)0x9f,(byte)0x98},{(byte)0xed,(byte)0xa0,(byte)0x80},{(byte)0xc0,(byte)0x80},{(byte)0xf4,(byte)0x90,(byte)0x80,(byte)0x80}};
            for(byte[] value:invalid)for(boolean resident:new boolean[]{false,true}) {
                long id=400;chunks(database,id,value);
                if(resident){database.execSQL("DELETE FROM blob_chunks WHERE owner=?",new Object[]{id});database.execSQL("UPDATE blobs SET resident=? WHERE id=?",new Object[]{value,id});}
                try{content(owner,id);fail("accepted invalid UTF-8");}catch(CharacterCodingException expected){}
            }
        });
    }
    @Test public void emptyManifestStillRejectsEmptyNonemptyAndResidentChunks()throws Exception {
        isolated((owner,database)->{
            long id=500;chunks(database,id,new byte[0]);assertEquals("",content(owner,id));
            for(int scenario=0;scenario<4;scenario++) {
                chunks(database,id,new byte[0]);
                if(scenario==0)database.execSQL("INSERT INTO blob_chunks VALUES(?,0,0,?)",new Object[]{id,new byte[0]});
                if(scenario==1)database.execSQL("INSERT INTO blob_chunks VALUES(?,0,0,?)",new Object[]{id,new byte[]{65}});
                if(scenario==2)database.execSQL("UPDATE blobs SET resident=? WHERE id=?",new Object[]{new byte[0],id});
                if(scenario==3){database.execSQL("UPDATE blobs SET resident=? WHERE id=?",new Object[]{new byte[0],id});database.execSQL("INSERT INTO blob_chunks VALUES(?,0,0,?)",new Object[]{id,new byte[0]});}
                rejected(owner,id);
            }
        });
    }
    @Test public void completeSmallPageValuesLeaveTheNextGroupForItsOwnReader()throws Exception {
        isolated((owner,database)->{
            String large=String.join("",Collections.nCopies(65536,"A"))+"完整大尾😀";
            String[] values={"","中😀\u0000\r\n尾","完整驻留😀",large,"末尾"};
            for(int i=0;i<values.length;i++) {
                long id=600+i;byte[] value=values[i].getBytes(StandardCharsets.UTF_8);chunks(database,id,value);
                if(i==2){database.execSQL("DELETE FROM blob_chunks WHERE owner=?",new Object[]{id});database.execSQL("UPDATE blobs SET resident=? WHERE id=?",new Object[]{value,id});}
                database.execSQL("INSERT INTO preview(kind,position,value) VALUES('names',?,?)",new Object[]{i,id});
            }
            Field ready=TableSession.class.getDeclaredField("ready");ready.setAccessible(true);ready.setBoolean(owner,true);
            Field names=TableSession.class.getDeclaredField("namesCount");names.setAccessible(true);names.setLong(owner,values.length);
            assertEquals(new JSONArray(Arrays.asList(values)).toString(),owner.page("names",0,100).getJSONArray("values").toString());
            assertEquals(new JSONArray(Arrays.asList(values[1],values[2])).toString(),owner.page("names",1,2).getJSONArray("values").toString());
            assertEquals(0,owner.page("names",values.length,100).getJSONArray("values").length());
            database.execSQL("INSERT INTO blob_chunks VALUES(602,0,0,?)",new Object[]{values[2].getBytes(StandardCharsets.UTF_8)});
            try{owner.page("names",0,100);fail("accepted mixed representation in small preview page");}catch(IOException expected){}
        });
    }
}
