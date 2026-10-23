package coc.logbook;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.lang.reflect.*;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public final class TableInlinePreviewTest {
    private static final long FREE=32L*1024*1024*1024;
    private final Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
    private static void remove(File root)throws Exception{if(!root.exists())return;for(File file:Objects.requireNonNull(root.listFiles())){if(file.isDirectory())remove(file);else assertTrue(file.delete());}assertTrue(root.delete());}
    private static Object invoke(Method method,Object owner,Object...args)throws Exception{
        try{return method.invoke(owner,args);}catch(InvocationTargetException error){Throwable cause=error.getCause();if(cause instanceof Exception)throw (Exception)cause;throw (Error)cause;}
    }
    private static void notice(TableSession owner,String type,String text)throws Exception{
        Method method=TableSession.class.getDeclaredMethod("notice",String.class,String.class);method.setAccessible(true);invoke(method,owner,type,text);
    }
    private static void ready(TableSession owner)throws Exception{Field field=TableSession.class.getDeclaredField("ready");field.setAccessible(true);field.setBoolean(owner,true);}
    private static SQLiteDatabase index(TableSession owner,int mode){return SQLiteDatabase.openDatabase(new File(owner.directory,"stage.sqlite").getPath(),null,mode);}
    private static long count(SQLiteDatabase db,String table)throws Exception{try(Cursor rows=db.rawQuery("SELECT COUNT(*) FROM "+table,null)){assertTrue(rows.moveToFirst());return rows.getLong(0);}}

    @Test public void completeInlineBoundaryAndFallbackValuesKeepEveryPageByte()throws Exception{
        File root=new File(context.getCacheDir(),"public-inline-pages-"+UUID.randomUUID());assertTrue(root.mkdir());
        try(TableSession owner=new TableSession(root,"public",0,"record-table","public.csv",()->FREE)){
            String boundary=String.join("",Collections.nCopies(65532,"A"))+"😀",large=String.join("",Collections.nCopies(100000,"中😀"))+"完整尾";
            List<String> values=new ArrayList<>(Arrays.asList("","A","中😀\u0000\r\n尾",boundary,boundary+"尾",large));for(int i=0;i<101;i++)values.add("分页"+i+"😀");
            for(String value:values)notice(owner,"names",value);notice(owner,"warnings","");notice(owner,"warnings","完整警告😀\u0000尾");ready(owner);
            try(SQLiteDatabase db=index(owner,SQLiteDatabase.OPEN_READONLY);Cursor rows=db.rawQuery("SELECT position,value,bytes,resident FROM preview WHERE kind='names' ORDER BY position",null)){
                int at=0;while(rows.moveToNext()){
                    byte[] complete=values.get(at++).getBytes(StandardCharsets.UTF_8);
                    if(complete.length>0&&complete.length<=65536){assertTrue(rows.isNull(1));assertEquals(complete.length,rows.getLong(2));assertArrayEquals(complete,rows.getBlob(3));}
                    else{assertFalse(rows.isNull(1));assertTrue(rows.isNull(2));assertTrue(rows.isNull(3));}
                }
                assertEquals(values.size(),at);assertEquals("Only four empty/large fallback values need blobs",4,count(db,"blobs"));
            }
            List<String> complete=new ArrayList<>();for(int offset=0;offset<values.size();offset+=100){JSONArray page=owner.page("names",offset,100).getJSONArray("values");for(int i=0;i<page.length();i++)complete.add(page.getString(i));}assertEquals(values,complete);
            assertEquals(new JSONArray(values.subList(3,7)).toString(),owner.page("names",3,4).getJSONArray("values").toString());assertEquals(new JSONArray(values.subList(99,103)).toString(),owner.page("names",99,4).getJSONArray("values").toString());
            assertEquals(new JSONArray().put("").put("完整警告😀\u0000尾").toString(),owner.page("warnings",0,100).getJSONArray("values").toString());assertEquals(0,owner.page("names",values.size(),100).getJSONArray("values").length());
        }finally{remove(root);}
    }

    @Test public void inlineAndFallbackPagesRejectEveryIncompleteMixedOrInvalidRepresentation()throws Exception{
        File root=new File(context.getCacheDir(),"public-inline-corrupt-"+UUID.randomUUID());assertTrue(root.mkdir());
        try(TableSession owner=new TableSession(root,"public",0,"record-table","public.csv",()->FREE);SQLiteDatabase db=index(owner,SQLiteDatabase.OPEN_READWRITE)){
            String text="中😀\u0000完整尾",large=String.join("",Collections.nCopies(65537,"A"));byte[] bytes=text.getBytes(StandardCharsets.UTF_8);
            notice(owner,"names","有效首行😀");notice(owner,"names",text);notice(owner,"names",large);notice(owner,"names","有效尾行");ready(owner);
            long fallback;try(Cursor row=db.rawQuery("SELECT value FROM preview WHERE kind='names' AND position=2",null)){assertTrue(row.moveToFirst());fallback=row.getLong(0);}
            for(int scenario=0;scenario<11;scenario++){
                db.execSQL("UPDATE preview SET value=NULL,bytes=?,resident=? WHERE kind='names' AND position=1",new Object[]{bytes.length,bytes});
                if(scenario==0)db.execSQL("UPDATE preview SET bytes=bytes+1 WHERE position=1");
                if(scenario==1)db.execSQL("UPDATE preview SET bytes=2,resident=? WHERE position=1",new Object[]{new byte[]{(byte)0xc3,0x28}});
                if(scenario==2)db.execSQL("UPDATE preview SET bytes=3,resident=? WHERE position=1",new Object[]{new byte[]{(byte)0xf0,(byte)0x9f,(byte)0x98}});
                if(scenario==3)db.execSQL("UPDATE preview SET bytes=65537,resident=? WHERE position=1",new Object[]{new byte[65537]});
                if(scenario==4)db.execSQL("UPDATE preview SET bytes=NULL WHERE position=1");
                if(scenario==5)db.execSQL("UPDATE preview SET bytes=0,resident=? WHERE position=1",new Object[]{new byte[0]});
                if(scenario==6)db.execSQL("UPDATE preview SET value=999999 WHERE position=1");
                if(scenario==7)db.execSQL("UPDATE preview SET value=? WHERE position=1",new Object[]{fallback});
                if(scenario==8)db.execSQL("UPDATE preview SET resident=NULL WHERE position=1");
                if(scenario==9)db.execSQL("UPDATE preview SET resident=NULL,bytes=NULL WHERE position=1");
                if(scenario==10)db.execSQL("UPDATE preview SET bytes=-1 WHERE position=1");
                try{owner.page("names",0,100);fail("accepted invalid inline representation "+scenario);}catch(IOException expected){}
            }
            db.execSQL("UPDATE preview SET value=NULL,bytes=?,resident=? WHERE position=1",new Object[]{bytes.length,bytes});
            for(int scenario=0;scenario<3;scenario++){
                db.execSQL("UPDATE preview SET value=?,bytes=NULL,resident=NULL WHERE position=2",new Object[]{fallback});
                if(scenario==0)db.execSQL("UPDATE preview SET bytes=65537 WHERE position=2");
                if(scenario==1)db.execSQL("UPDATE preview SET bytes=1,resident=? WHERE position=2",new Object[]{new byte[]{65}});
                if(scenario==2)db.execSQL("DELETE FROM blob_chunks WHERE owner=? AND position=1",new Object[]{fallback});
                try{owner.page("names",0,100);fail("accepted invalid fallback representation "+scenario);}catch(IOException expected){}
            }
        }finally{remove(root);}
    }

    @Test public void bothLiveCapacityChecksRemainBeforeAnInlineRowCanBeWritten()throws Exception{
        for(int failAt:new int[]{1,2,0}){
            File root=new File(context.getCacheDir(),"public-inline-space-"+UUID.randomUUID());assertTrue(root.mkdir());int[] calls={0};boolean[] checking={false};
            try(TableSession owner=new TableSession(root,"public",0,"record-table","public.csv",()->{if(checking[0]&&++calls[0]==failAt)return StorageBudget.MINIMUM_RESERVE;return FREE;})){
                checking[0]=true;
                if(failAt==0){notice(owner,"names","完整公开😀\u0000尾");assertEquals(2,calls[0]);}
                else try{notice(owner,"names","完整公开😀\u0000尾");fail("ignored live capacity failure "+failAt);}catch(IOException expected){assertEquals(failAt,calls[0]);}
                checking[0]=false;try(SQLiteDatabase db=index(owner,SQLiteDatabase.OPEN_READONLY)){assertEquals(failAt==0?1:0,count(db,"preview"));assertEquals(0,count(db,"blobs"));}
            }finally{remove(root);}
        }
    }

    @Test public void reusedLineDecoderKeepsBoundariesAndRejectsInvalidOrUnfinishedLaterLines()throws Exception{
        Class<?> type=Class.forName("coc.logbook.TableSession$Lines");Constructor<?> constructor=type.getDeclaredConstructor();constructor.setAccessible(true);
        Method append=type.getDeclaredMethod("append",byte[].class,int.class,int.class,TableSession.Line.class),finish=type.getDeclaredMethod("finish");append.setAccessible(true);finish.setAccessible(true);
        Object lines=constructor.newInstance();List<String> values=new ArrayList<>();TableSession.Line accept=values::add;byte[] complete="中😀\u0000\nASCII\n\n尾\r\n".getBytes(StandardCharsets.UTF_8);
        for(int i=0;i<complete.length;i++)invoke(append,lines,complete,i,1,accept);invoke(finish,lines);assertEquals(Arrays.asList("中😀\u0000","ASCII","","尾\r"),values);
        byte[] another="另一完整行😀\n".getBytes(StandardCharsets.UTF_8);invoke(append,lines,another,0,another.length,accept);invoke(finish,lines);assertEquals("另一完整行😀",values.get(4));
        byte[][] invalid={{(byte)0xc3,0x28,10},{(byte)0xf0,(byte)0x9f,(byte)0x98,10},{(byte)0xed,(byte)0xa0,(byte)0x80,10},{(byte)0xc0,(byte)0x80,10}};
        for(byte[] broken:invalid){Object reader=constructor.newInstance();List<String> observed=new ArrayList<>();TableSession.Line receive=observed::add;invoke(append,reader,another,0,another.length,receive);try{invoke(append,reader,broken,0,broken.length,receive);fail("accepted malformed later UTF-8 line");}catch(CharacterCodingException expected){}assertEquals(Collections.singletonList("另一完整行😀"),observed);}
        Object unfinished=constructor.newInstance();byte[] partial={(byte)0xf0,(byte)0x9f};invoke(append,unfinished,partial,0,partial.length,accept);try{invoke(finish,unfinished);fail("accepted unfinished final line");}catch(IOException expected){}
    }

    private JSONObject fixture()throws Exception{
        try(InputStream in=InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("public-capacity.json")){
            ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[65536];int count;while((count=in.read(buffer))!=-1)out.write(buffer,0,count);return new JSONObject(out.toString("UTF-8")).put("records",new JSONArray());
        }
    }
    private static BackupSession.Proof send(TableSession owner,String candidate)throws Exception{
        byte[] bytes=candidate.getBytes(StandardCharsets.UTF_8);long index=0;for(int at=0;at<bytes.length;at+=LogbookLimits.TRANSFER_CHUNK_BYTES)owner.append("candidate",index++,Arrays.copyOfRange(bytes,at,Math.min(bytes.length,at+LogbookLimits.TRANSFER_CHUNK_BYTES)));
        StringBuilder hash=new StringBuilder();for(byte value:MessageDigest.getInstance("SHA-256").digest(bytes))hash.append(String.format(Locale.ROOT,"%02x",value&255));return new BackupSession.Proof(bytes.length,hash.toString());
    }
    @Test public void completeInlinePreviewCommitsAndItsFrozenDatabaseProofRejectsMutation()throws Exception{
        String name="public-inline-proof-"+UUID.randomUUID()+".sqlite";File root=new File(context.getCacheDir(),"public-inline-proof-"+UUID.randomUUID());assertTrue(root.mkdir());
        try(LogbookDatabase db=new LogbookDatabase(context,name,true,()->FREE)){
            JSONObject original=fixture();String body=String.join("",Collections.nCopies(10000,"完整正文😀"))+"\r\n\u0000终";
            for(boolean corrupt:new boolean[]{false,true}){
                db.replace(original.toString(),db.revision());long revision=db.revision();String before=db.snapshot();
                try(TableSession owner=new TableSession(root,"public",revision,"record-table","public.csv",()->FREE)){
                    owner.capture(new ByteArrayInputStream("public inline source".getBytes(StandardCharsets.UTF_8)));
                    JSONObject row=new JSONObject().put("sheet","公开表").put("moduleName","公开内联").put("sessionName","完整预览😀").put("link","").put("manualContent",body).put("kps",new JSONArray()).put("pairs",new JSONArray());
                    String candidate="T"+new JSONObject().put("sheetOrder",0).put("rowOrder",0).put("value",row)+"\n";assertEquals("公开内联 / 完整预览😀",owner.preview(db,send(owner,candidate),original.getJSONObject("settings")).getJSONArray("names").getString(0));assertEquals(before,db.snapshot());
                    if(corrupt){try(SQLiteDatabase index=index(owner,SQLiteDatabase.OPEN_READWRITE);Cursor stored=index.rawQuery("SELECT bytes FROM preview WHERE kind='names' AND position=0",null)){assertTrue(stored.moveToFirst());byte[] changed=new byte[stored.getInt(0)];Arrays.fill(changed,(byte)65);index.execSQL("UPDATE preview SET resident=? WHERE kind='names' AND position=0",new Object[]{changed});}try{owner.prepareCommit();fail("accepted changed complete inline preview");}catch(IOException expected){}assertEquals(before,db.snapshot());assertEquals(revision,db.revision());}
                    else{owner.prepareCommit();db.edit(revision,owner::apply);assertEquals(body,new JSONObject(db.snapshot()).getJSONArray("records").getJSONObject(0).getString("manualContent"));}
                }
            }
        }finally{context.deleteDatabase(name);remove(root);}
    }
}
