package coc.logbook;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.lang.reflect.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Complete values on both sides of the optional resident-cell budget. */
@RunWith(AndroidJUnit4.class)
public final class TableResidentTextTest {
    private final Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
    private Object call(TableSession owner,String method,Class<?> type,Object value)throws Exception{
        Method methodRef=TableSession.class.getDeclaredMethod(method,type);methodRef.setAccessible(true);
        try{return methodRef.invoke(owner,value);}catch(InvocationTargetException error){throw (Exception)error.getCause();}
    }
    private void remove(File root)throws Exception{if(!root.exists())return;for(File file:Objects.requireNonNull(root.listFiles())){if(file.isDirectory())remove(file);else assertTrue(file.delete());}assertTrue(root.delete());}
    @Test public void exactBoundaryEmptyAndLargeValuesKeepAllBytesAndStringRanges()throws Exception{
        File root=new File(context.getCacheDir(),"public-resident-"+UUID.randomUUID());assertTrue(root.mkdir());
        try(TableSession owner=new TableSession(root,"public",0,"record-table","public.csv",()->32L*1024*1024*1024)){
            owner.capture(new ByteArrayInputStream("public".getBytes(StandardCharsets.UTF_8)));
            String boundary=String.join("",Collections.nCopies(65532,"A"))+"😀";
            String[] values={"", "中😀\u0000\r\n尾",boundary,boundary+"尾",String.join("",Collections.nCopies(100000,"中😀"))+"完整末尾"};
            for(String value:values){
                long ref=(Long)call(owner,"storeText",String.class,value);assertEquals(value,call(owner,"contentText",long.class,ref));
                try(SQLiteDatabase db=SQLiteDatabase.openDatabase(new File(owner.directory,"stage.sqlite").getPath(),null,SQLiteDatabase.OPEN_READONLY);
                    Cursor row=db.rawQuery("SELECT bytes,length(resident),(SELECT COUNT(*) FROM blob_chunks WHERE owner=blobs.id) FROM blobs WHERE id=?",new String[]{Long.toString(ref)})){
                    assertTrue(row.moveToFirst());int length=value.getBytes(StandardCharsets.UTF_8).length;assertEquals(length,row.getLong(0));
                    if(length>0&&length<=65536){assertEquals(length,row.getLong(1));assertEquals(0,row.getInt(2));}else{assertTrue(row.isNull(1));if(length>0)assertTrue(row.getInt(2)>0);}
                }
            }
            // Independent transport chunking also crosses the optional budget.
            StringBuilder lines=new StringBuilder();for(int i=0;i<values.length;i++)lines.append(new JSONArray().put(i).put(values[i])).append('\n');
            byte[] input=lines.toString().getBytes(StandardCharsets.UTF_8);long segment=0;
            for(int at=0;at<input.length;at+=LogbookLimits.TRANSFER_CHUNK_BYTES)owner.append("strings",segment++,Arrays.copyOfRange(input,at,Math.min(input.length,at+LogbookLimits.TRANSFER_CHUNK_BYTES)));
            for(int index=0;index<values.length;index++){
                ByteArrayOutputStream complete=new ByteArrayOutputStream();long offset=0;boolean done=false;
                while(!done){JSONObject piece=owner.string(index,offset);byte[] bytes=android.util.Base64.decode(piece.getString("base64"),android.util.Base64.DEFAULT);complete.write(bytes);offset+=bytes.length;done=piece.getBoolean("done");assertEquals(values[index].getBytes(StandardCharsets.UTF_8).length,piece.getLong("bytes"));}
                assertArrayEquals(values[index].getBytes(StandardCharsets.UTF_8),complete.toByteArray());
            }
        }finally{remove(root);}
    }
    @Test public void residentCorruptionAndMixedRepresentationsAreRejected()throws Exception{
        File root=new File(context.getCacheDir(),"public-resident-invalid-"+UUID.randomUUID());assertTrue(root.mkdir());
        try(TableSession owner=new TableSession(root,"public",0,"record-table","public.csv",()->32L*1024*1024*1024)){
            long ref=(Long)call(owner,"storeText",String.class,"完整😀尾");
            for(int scenario=0;scenario<4;scenario++){
                try(SQLiteDatabase db=SQLiteDatabase.openDatabase(new File(owner.directory,"stage.sqlite").getPath(),null,SQLiteDatabase.OPEN_READWRITE)){
                    byte[] value="完整😀尾".getBytes(StandardCharsets.UTF_8);db.execSQL("DELETE FROM blob_chunks WHERE owner=?",new Object[]{ref});
                    db.execSQL("UPDATE blobs SET bytes=?,resident=? WHERE id=?",new Object[]{value.length,value,ref});
                    if(scenario==0)db.execSQL("UPDATE blobs SET bytes=bytes+1 WHERE id=?",new Object[]{ref});
                    if(scenario==1)db.execSQL("INSERT INTO blob_chunks VALUES(?,0,0,?)",new Object[]{ref,value});
                    if(scenario==2)db.execSQL("UPDATE blobs SET bytes=2,resident=? WHERE id=?",new Object[]{new byte[]{(byte)0xc3,0x28},ref});
                    if(scenario==3)db.execSQL("UPDATE blobs SET bytes=65537,resident=? WHERE id=?",new Object[]{new byte[65537],ref});
                }
                try{call(owner,"contentText",long.class,ref);fail("accepted invalid resident representation "+scenario);}catch(IOException expected){}
            }
        }finally{remove(root);}
    }
}
