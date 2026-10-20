package coc.logbook;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import java.io.*;
import java.util.*;
/** Native snapshot ownership; v4 indexes bodies separately without changing snapshot schema. */
final class LogbookDatabase extends SQLiteOpenHelper {
 LogbookDatabase(Context context){this(context,"coc-logbook.sqlite");}
 LogbookDatabase(Context context,String name){super(context,name,null,4);}
 @Override public void onCreate(SQLiteDatabase db){
  db.execSQL("CREATE TABLE app_state(id INTEGER PRIMARY KEY CHECK(id=1),json TEXT,revision INTEGER NOT NULL)");
  db.execSQL("INSERT INTO app_state VALUES(1,NULL,0)");
  db.execSQL("CREATE TABLE snapshot_chunks(position INTEGER PRIMARY KEY,data TEXT NOT NULL)");
  createFields(db);IndexedSnapshot.create(db);
 }
 private void createFields(SQLiteDatabase db){db.execSQL("CREATE TABLE IF NOT EXISTS snapshot_fields(field TEXT NOT NULL,position INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(field,position))");}
 @Override public void onUpgrade(SQLiteDatabase db,int before,int after){
  if(before<1||before>3||after!=4)throw new IllegalStateException("数据库版本暂不兼容，未清空任何数据。");
  createFields(db);IndexedSnapshot.create(db);
  try(Cursor row=db.rawQuery("SELECT json FROM app_state WHERE id=1",null)){
   if(row.moveToFirst()&&!row.isNull(0))new IndexedSnapshot(db).migrateLegacy();
  }catch(Exception error){throw new IllegalStateException("正文索引升级未完成；原数据未清空。",error);}
 }
 private boolean exists(){try(Cursor row=getReadableDatabase().rawQuery("SELECT json IS NOT NULL FROM app_state WHERE id=1",null)){return row.moveToFirst()&&row.getInt(0)==1;}}
 synchronized Map<String,String> fields(){return exists()?new IndexedSnapshot(getReadableDatabase()).fields():null;}
 synchronized org.json.JSONArray deferred(){return new IndexedSnapshot(getReadableDatabase()).deferred();}
 synchronized void writeSnapshot(Writer writer,Set<String> selected)throws Exception{
  if(!exists())throw new IllegalStateException("尚无已保存数据。");
  new IndexedSnapshot(getReadableDatabase()).write(writer,selected);
 }
 synchronized String snapshot(){
  if(!exists())return null;
  try{StringWriter out=new StringWriter();writeSnapshot(out,null);return out.toString();}
  catch(Exception error){throw new IllegalStateException("正文读取失败；原数据未改变。",error);}
 }
 long revision(){try(Cursor row=getReadableDatabase().rawQuery("SELECT revision FROM app_state WHERE id=1",null)){row.moveToFirst();return row.getLong(0);}}
 interface Edit{void apply(IndexedSnapshot store)throws Exception;}
 synchronized long edit(long expected,Edit edit)throws Exception{
  SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
  try{
   if(revision()!=expected)throw new IllegalStateException("数据已变化，请重新读取。");
   IndexedSnapshot store=new IndexedSnapshot(db);edit.apply(store);store.checkSize();
   db.execSQL("UPDATE app_state SET json='indexed-v4',revision=? WHERE id=1",new Object[]{expected+1});
   db.setTransactionSuccessful();return expected+1;
  }finally{db.endTransaction();}
 }
 synchronized long replaceFields(Map<String,String> fields,long expected)throws Exception{
  if(!exists())throw new IllegalStateException("尚无已保存数据。");
  return edit(expected,store->store.patch(fields));
 }
 synchronized long replace(Reader reader,long expected)throws Exception{return edit(expected,store->store.replace(reader));}
 synchronized long replace(String json,long expected){
  try{return replace(new StringReader(json),expected);}catch(RuntimeException error){throw error;}catch(Exception error){throw new IllegalStateException("保存失败；原数据未改变。",error);}
 }
 synchronized void releaseReadCache(){/* Bodies are never cached in Java. */}
}
