package coc.logbook;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import java.io.*;
import java.util.*;
/** Native snapshot ownership; v4 indexes bodies separately without changing snapshot schema. */
final class LogbookDatabase extends SQLiteOpenHelper {
 private final boolean deviceSpace;
 private final StorageBudget.Available available;
 LogbookDatabase(Context context){this(context,"coc-logbook.sqlite");}
 LogbookDatabase(Context context,String name){this(context,name,LogbookLimits.DEVICE_SPACE_LIBRARY,null);}
 LogbookDatabase(Context context,String name,boolean deviceSpace,StorageBudget.Available available){super(context,name,null,5);this.deviceSpace=deviceSpace;this.available=available==null?StorageBudget.volume(context.getDatabasePath(name).getParentFile()):available;}
 @Override public void onCreate(SQLiteDatabase db){
  db.execSQL("CREATE TABLE app_state(id INTEGER PRIMARY KEY CHECK(id=1),json TEXT,revision INTEGER NOT NULL)");
  db.execSQL("INSERT INTO app_state VALUES(1,NULL,0)");
  db.execSQL("CREATE TABLE snapshot_chunks(position INTEGER PRIMARY KEY,data TEXT NOT NULL)");
  createFields(db);IndexedSnapshot.create(db);
 }
 private void createFields(SQLiteDatabase db){db.execSQL("CREATE TABLE IF NOT EXISTS snapshot_fields(field TEXT NOT NULL,position INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(field,position))");}
 @Override public void onUpgrade(SQLiteDatabase db,int before,int after){
  // v5 marks the new large-library adapter. Existing v4 body blocks/metadata
  // are untouched; older helpers must refuse downgrade rather than open a
  // library whose whole-body paths they cannot safely handle.
  if(before==4&&after==5)return;
  if(before<1||before>3||after!=5)throw new IllegalStateException("数据库版本暂不兼容，未清空任何数据。");
  createFields(db);IndexedSnapshot.create(db);
  try(Cursor row=db.rawQuery("SELECT json FROM app_state WHERE id=1",null)){
   if(row.moveToFirst()&&!row.isNull(0))new IndexedSnapshot(db).migrateLegacy();
  }catch(Exception error){throw new IllegalStateException("正文索引升级未完成；原数据未清空。",error);}
 }
 private boolean exists(){try(Cursor row=getReadableDatabase().rawQuery("SELECT json IS NOT NULL FROM app_state WHERE id=1",null)){return row.moveToFirst()&&row.getInt(0)==1;}}
 synchronized Map<String,String> fields(){return exists()?new IndexedSnapshot(getReadableDatabase()).fields():null;}
 synchronized org.json.JSONArray deferred(){return new IndexedSnapshot(getReadableDatabase()).deferred();}
 synchronized long logicalBytes(){return exists()?new IndexedSnapshot(getReadableDatabase()).bytes():0;}
 synchronized long recordCount(){try(Cursor row=getReadableDatabase().rawQuery("SELECT COUNT(*) FROM indexed_records",null)){if(!row.moveToFirst())throw new IllegalStateException("场次数量读取失败。");return row.getLong(0);}}
 synchronized long projectedBytes(Set<String> ids)throws Exception{return new IndexedSnapshot(getReadableDatabase()).projectedBytes(ids);}
 synchronized void writeSnapshot(Writer writer,Set<String> selected)throws Exception{
  if(!exists())throw new IllegalStateException("尚无已保存数据。");
  new IndexedSnapshot(getReadableDatabase()).write(writer,selected);
 }
 synchronized BackupSession.Proof writeSearchSnapshot(OutputStream output,Set<String> selected,long memory,String prefix,Map<String,Long> timing)throws Exception{
  return writeSearchSnapshot(output,selected,memory,prefix,timing,null);
 }
 synchronized BackupSession.Proof writeSearchSnapshot(OutputStream output,Set<String> selected,long memory,String prefix,Map<String,Long> timing,SearchSnapshot.Boundaries boundaries)throws Exception{
  if(!exists())throw new IllegalStateException("尚无已保存数据。");
  return SearchSnapshot.write(getReadableDatabase(),output,selected,memory,prefix,timing,boundaries);
 }
 synchronized String snapshot(){
  if(!exists())return null;
  try{StringWriter out=new StringWriter();writeSnapshot(out,null);return out.toString();}
  catch(Exception error){throw new IllegalStateException("正文读取失败；原数据未改变。",error);}
 }
 long revision(){try(Cursor row=getReadableDatabase().rawQuery("SELECT revision FROM app_state WHERE id=1",null)){row.moveToFirst();return row.getLong(0);}}
 interface Edit{void apply(IndexedSnapshot store)throws Exception;}
 interface Authorization{void check()throws Exception;}
 synchronized long edit(long expected,Edit edit)throws Exception{
  return edit(expected,edit,null);
 }
 synchronized long edit(long expected,Edit edit,TableTiming timing)throws Exception{
  return edit(expected,edit,timing,()->{});
 }
 private synchronized long edit(long expected,Edit edit,TableTiming timing,Authorization authorizeCommit)throws Exception{
  SQLiteDatabase db=getWritableDatabase();
  if(deviceSpace)StorageBudget.require(available,StorageBudget.estimate(new IndexedSnapshot(db,deviceSpace,available).metadataBytes(),4));
  db.beginTransaction();
  TableTiming.mark(timing,"transactionBegin");
  try{
   if(revision()!=expected)throw new IllegalStateException("数据已变化，请重新读取。");
   TableTiming.mark(timing,"transactionCAS");
   IndexedSnapshot store=new IndexedSnapshot(db,deviceSpace,available);edit.apply(store);store.checkSize();
   TableTiming.mark(timing,"capacity");
   authorizeCommit.check();
   db.execSQL("UPDATE app_state SET json='indexed-v4',revision=? WHERE id=1",new Object[]{expected+1});
   TableTiming.mark(timing,"revisionWrite");
   db.setTransactionSuccessful();return expected+1;
  }finally{db.endTransaction();TableTiming.mark(timing,"transactionEnd");}
 }
 synchronized long replaceFields(Map<String,String> fields,long expected)throws Exception{
  if(!exists())throw new IllegalStateException("尚无已保存数据。");
  return edit(expected,store->store.patch(fields));
 }
 synchronized long replace(Reader reader,long expected)throws Exception{return edit(expected,store->store.replace(reader));}
 synchronized long restoreCandidate(InputStream input,RestoreCandidate.Preview preview,long expected,boolean restoreSettings,String defaultSettings,Authorization authorize)throws Exception{
  Objects.requireNonNull(authorize,"Native restore authorization is required");
  BackupValidation.metadata(preview.metadata);
  Map<String,String> root=JsonFields.split(preview.metadata.toString());root.remove("records");
  return edit(expected,store->{
   authorize.check();
   if(!restoreSettings){Map<String,String> current=store.rootFields();root.put("settings",current.containsKey("settings")?current.get("settings"):defaultSettings);}
   store.replaceCandidate(root,input,preview);
  },null,authorize);
 }
 synchronized long replace(String json,long expected){
  try{return replace(new StringReader(json),expected);}catch(RuntimeException error){throw error;}catch(Exception error){throw new IllegalStateException("保存失败；原数据未改变。",error);}
 }
 synchronized void releaseReadCache(){/* Bodies are never cached in Java. */}
}
