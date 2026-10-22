package coc.logbook;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteStatement;
import java.io.*;
import java.util.*;
import org.json.*;

/** SQLite v4: metadata and raw body values are independent, bounded rows. */
final class IndexedSnapshot {
    private final SQLiteDatabase db;
    private final boolean deviceSpace;
    private final StorageBudget.Available available;
    IndexedSnapshot(SQLiteDatabase db){this(db,LogbookLimits.DEVICE_SPACE_LIBRARY,StorageBudget.volume(new File(db.getPath()).getAbsoluteFile().getParentFile()));}
    IndexedSnapshot(SQLiteDatabase db,boolean deviceSpace,StorageBudget.Available available){this.db=db;this.deviceSpace=deviceSpace;this.available=available;}
    static void create(SQLiteDatabase db){
        db.execSQL("CREATE TABLE IF NOT EXISTS indexed_fields(field TEXT NOT NULL,position INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(field,position))");
        db.execSQL("CREATE TABLE IF NOT EXISTS indexed_records(row_key INTEGER PRIMARY KEY,id TEXT UNIQUE,ordinal INTEGER NOT NULL,metadata TEXT NOT NULL,bytes INTEGER NOT NULL DEFAULT 0,body_count INTEGER NOT NULL DEFAULT 0)");
        db.execSQL("CREATE TABLE IF NOT EXISTS indexed_bodies(record_key INTEGER NOT NULL,kind TEXT NOT NULL,position INTEGER NOT NULL,data TEXT NOT NULL,bytes INTEGER NOT NULL,PRIMARY KEY(record_key,kind,position))");
        db.execSQL("CREATE INDEX IF NOT EXISTS indexed_body_sizes ON indexed_bodies(record_key,kind,bytes)");
    }
    static final class CursorReader extends Reader {
        private final Cursor cursor;private String current="";private int offset;
        CursorReader(Cursor cursor){this.cursor=cursor;}
        public int read(char[] buffer,int start,int length)throws IOException{
            if(length==0)return 0;
            while(offset==current.length()){if(!cursor.moveToNext())return -1;current=cursor.getString(0);offset=0;}
            int count=Math.min(length,current.length()-offset);current.getChars(offset,offset+count,buffer,start);offset+=count;return count;
        }
        public void close(){cursor.close();}
    }
    /** One value encoder, no allocation or SQLite cell exceeds 65536 UTF-16 units. */
    private final class BodyWriter extends Writer {
        private final long key;private final String kind;private final char[] buffer=new char[65536];private int length,position;
        BodyWriter(long key,String kind){this.key=key;this.kind=kind;}
        public void write(int c)throws IOException{buffer[length++]=(char)c;if(length==buffer.length)flushPart(false);}
        public void write(char[] chars,int offset,int count)throws IOException{for(int i=0;i<count;i++)write(chars[offset+i]);}
        private void flushPart(boolean end){
            if(length==0)return;int count=!end&&Character.isHighSurrogate(buffer[length-1])?length-1:length;
            String text=new String(buffer,0,count);
            if(deviceSpace)try{StorageBudget.require(available,StorageBudget.estimate(JsonFields.bytes(text),4));}catch(Exception error){throw new IllegalStateException("正文写入所需空间不足；原数据保留。",error);}
            db.execSQL("INSERT INTO indexed_bodies VALUES(?,?,?,?,?)",new Object[]{key,kind,position++,text,JsonFields.bytes(text)});
            if(count<length)buffer[0]=buffer[count];length-=count;
        }
        public void flush(){} public void close(){flushPart(true);}
    }
    private static void chunks(String text,Chunk consumer)throws Exception{
        int position=0;for(int start=0;start<text.length();){int end=Math.min(start+65536,text.length());if(end<text.length()&&Character.isHighSurrogate(text.charAt(end-1)))end--;consumer.put(position++,text.substring(start,end));start=end;}
    }
    interface Chunk{void put(int position,String data)throws Exception;}
    private void field(String name,String value)throws Exception{
        db.execSQL("DELETE FROM indexed_fields WHERE field=?",new Object[]{name});
        chunks(value,(position,data)->{
            if(deviceSpace)StorageBudget.require(available,StorageBudget.estimate(JsonFields.bytes(data),4));
            db.execSQL("INSERT INTO indexed_fields VALUES(?,?,?)",new Object[]{name,position,data});
        });
    }
    Map<String,String> rootFields(){
        Map<String,String> fields=new LinkedHashMap<>();String previous=null;StringBuilder value=new StringBuilder();
        try(Cursor rows=db.rawQuery("SELECT field,data FROM indexed_fields ORDER BY field,position",null)){
            while(rows.moveToNext()){String name=rows.getString(0);if(!name.equals(previous)){if(previous!=null)fields.put(previous,value.toString());previous=name;value.setLength(0);}value.append(rows.getString(1));}
        }if(previous!=null)fields.put(previous,value.toString());return fields;
    }
    Map<String,String> fields(){
        Map<String,String> fields=rootFields();StringBuilder records=new StringBuilder("[");
        try(Cursor rows=db.rawQuery("SELECT metadata FROM indexed_records ORDER BY ordinal,row_key",null)){
            while(rows.moveToNext()){if(records.length()>1)records.append(',');records.append(rows.getString(0));}
        }fields.put("records",records.append(']').toString());return fields;
    }
    JSONArray deferred(){JSONArray ids=new JSONArray();try(Cursor rows=db.rawQuery("SELECT id FROM indexed_records WHERE body_count>0 ORDER BY ordinal,row_key",null)){while(rows.moveToNext())ids.put(rows.getString(0));}return ids;}
    private Long key(String id){try(Cursor rows=db.rawQuery("SELECT row_key FROM indexed_records WHERE id=?",new String[]{id})){return rows.moveToFirst()?rows.getLong(0):null;}}
    private String metadata(long key){try(Cursor row=db.rawQuery("SELECT metadata FROM indexed_records WHERE row_key=?",new String[]{Long.toString(key)})){if(!row.moveToFirst())throw new IllegalStateException("场次已变化。");return row.getString(0);}}
    private void remove(String id){Long key=key(id);if(key!=null){db.execSQL("DELETE FROM indexed_bodies WHERE record_key=?",new Object[]{key});db.execSQL("DELETE FROM indexed_records WHERE row_key=?",new Object[]{key});}}
    private void refreshSize(long key,String metadata)throws Exception{
        long bytes=JsonFields.bytes(metadata);int count=0;
        try(Cursor bodies=db.rawQuery("SELECT kind,SUM(bytes) FROM indexed_bodies WHERE record_key=? GROUP BY kind",new String[]{Long.toString(key)})){
            while(bodies.moveToNext()){bytes+=1+JsonFields.bytes(JSONObject.quote(bodies.getString(0)))+1+bodies.getLong(1);count++;}
        }if(bytes>LogbookLimits.ENTITY_REQUEST_BYTES)throw new IllegalArgumentException("单场完整raw/manual合计超过64MiB；原数据保留。");
        db.execSQL("UPDATE indexed_records SET metadata=?,bytes=?,body_count=? WHERE row_key=?",new Object[]{metadata,bytes,count,key});
    }
    void record(RawJson cursor,String expectedId,boolean keepBody)throws Exception{record(cursor,expectedId,keepBody,null);}
    private void record(RawJson cursor,String expectedId,boolean keepBody,Long appendOrdinal)throws Exception{
        Long existing=expectedId==null?null:key(expectedId);long rowKey;
        Map<String,String> previous=existing==null?new LinkedHashMap<>():JsonFields.split(metadata(existing));
        if(existing==null){try(SQLiteStatement insert=db.compileStatement(appendOrdinal==null?"INSERT INTO indexed_records(id,ordinal,metadata) VALUES(NULL,(SELECT COALESCE(MAX(ordinal),-1)+1 FROM indexed_records),'{}')":"INSERT INTO indexed_records(id,ordinal,metadata) VALUES(NULL,?,'{}')")){if(appendOrdinal!=null)insert.bindLong(1,appendOrdinal);rowKey=insert.executeInsert();}}
        else rowKey=existing;
        if(!keepBody)db.execSQL("DELETE FROM indexed_bodies WHERE record_key=?",new Object[]{rowKey});
        Map<String,String> values=new LinkedHashMap<>();Set<String> seen=new HashSet<>();
        cursor.object((name,input)->{
            if(!seen.add(name))throw new IllegalArgumentException("场次字段重复。");
            if(name.equals("rawContent")||name.equals("manualContent")){
                if(keepBody){input.skip();return;}
                try(Writer writer=new BodyWriter(rowKey,name)){input.copy(writer);}
            }else values.put(name,input.take());
        });
        String id=RecordOverlay.id(values);
        if(id.isEmpty()||expectedId!=null&&!expectedId.equals(id))throw new IllegalArgumentException("场次标识无效或已变化。");
        if(keepBody)for(String name:new String[]{"cacheSourceUrl","fetchedAt"})if(previous.containsKey(name))values.put(name,previous.get(name));
        db.execSQL("UPDATE indexed_records SET id=? WHERE row_key=?",new Object[]{id,rowKey});
        refreshSize(rowKey,JsonFields.join(values));
    }
    void replace(Reader source)throws Exception{
        db.execSQL("DELETE FROM indexed_fields");db.execSQL("DELETE FROM indexed_bodies");db.execSQL("DELETE FROM indexed_records");
        RawJson reader=new RawJson(source);Set<String> seen=new HashSet<>();
        reader.object((name,value)->{if(!seen.add(name))throw new IllegalArgumentException("快照字段重复。");if(name.equals("records"))value.array(row->record(row,null,false));else field(name,value.take());});reader.end();checkSize();
    }
    /** Complete already-inspected private candidate, still checked again inside
     * the transaction so a late body/hash/graph failure rolls everything back. */
    void replaceCandidate(Map<String,String> root,InputStream input,RestoreCandidate.Preview preview)throws Exception{
        db.execSQL("DELETE FROM indexed_fields");db.execSQL("DELETE FROM indexed_bodies");db.execSQL("DELETE FROM indexed_records");
        for(Map.Entry<String,String> value:root.entrySet())if(!value.getKey().equals("records"))field(value.getKey(),value.getValue());
        RestoreCandidate.Preview actual=RestoreCandidate.inspect(input,preview.bytes,preview.sha256,(json,value,index)->{
            RawJson raw=new RawJson(new StringReader(json));record(raw,null,false,(long)index);raw.end();
        });
        if(!BackupValidation.same(actual.metadata,preview.metadata))throw new IOException("恢复候选元数据已变化。");
        checkSize();
    }
    void patch(Map<String,String> changes)throws Exception{
        if(changes.containsKey("records")){
            db.execSQL("DELETE FROM indexed_bodies");db.execSQL("DELETE FROM indexed_records");
            new RawJson(new StringReader(changes.get("records"))).array(row->record(row,null,false));
        }
        JSONArray deleted=new JSONArray(changes.containsKey("recordDeleted")?changes.get("recordDeleted"):"[]");for(int i=0;i<deleted.length();i++)remove(deleted.getString(i));
        if(changes.containsKey("recordValues")){
            Map<String,String> entries=JsonFields.split(changes.get("recordValues"));
            for(Map.Entry<String,String> item:entries.entrySet()){
                Map<String,String> entry=JsonFields.split(item.getValue());
                record(new RawJson(new StringReader(entry.get("value"))),item.getKey(),"true".equals(entry.get("keepBody")));
            }
        }
        JSONObject orders=new JSONObject(changes.containsKey("recordOrders")?changes.get("recordOrders"):"{}");Iterator<String> ids=orders.keys();
        while(ids.hasNext()){String id=ids.next();Long key=key(id);if(key!=null){Map<String,String> value=JsonFields.split(metadata(key));value.put("order",orders.get(id).toString());refreshSize(key,JsonFields.join(value));}}
        for(Map.Entry<String,String> entry:changes.entrySet())if(!Arrays.asList("records","recordValues","recordOrders","recordDeleted").contains(entry.getKey()))field(entry.getKey(),entry.getValue());
        checkSize();
    }
    /** One caller-owned SQLite transaction; unchanged body chunks are never selected or encoded. */
    void importTable(JSONObject candidate)throws Exception {
        importTable(candidate,null);
    }
    void importTable(JSONObject candidate,TableTiming timing)throws Exception {
        Map<String,String> previous=fields();
        TableTiming.mark(timing,"metadataRead");
        TableImport.validate(candidate,previous);
        TableTiming.mark(timing,"tableRules");
        Map<String,String> originals=new HashMap<>();
        if(previous.containsKey("records"))JsonFields.eachElement(previous.get("records"),raw->{try{originals.put(new JSONObject(raw).getString("id"),raw);}catch(Exception e){throw new IllegalArgumentException(e);}});
        JSONArray records=candidate.getJSONArray("records");
        // The caller holds the SQLite write transaction: reserve the append range once, with no concurrent writer.
        long nextOrdinal;
        try(Cursor end=db.rawQuery("SELECT COALESCE(MAX(ordinal),-1)+1 FROM indexed_records",null)){end.moveToFirst();nextOrdinal=end.getLong(0);}
        TableTiming.mark(timing,"recordIndex");
        for(int i=0;i<records.length();i++){
            JSONObject value=records.getJSONObject(i);String id=value.getString("id"),old=originals.get(id);
            if(old==null){record(new RawJson(new StringReader(value.toString())),id,false,nextOrdinal++);continue;}
            if(TableImport.equal(new JSONObject(old),value))continue;
            long rowKey=key(id);
            if(value.has("manualContent")){
                db.execSQL("DELETE FROM indexed_bodies WHERE record_key=? AND kind='manualContent'",new Object[]{rowKey});
                try(Writer writer=new BodyWriter(rowKey,"manualContent")){writer.write(JSONObject.quote(value.getString("manualContent")));}
            }
            JSONObject metadata=new JSONObject(value.toString());metadata.remove("manualContent");
            refreshSize(rowKey,metadata.toString());
        }
        for(String name:new String[]{"schemaVersion","modules","characters","settings"})field(name,candidate.get(name).toString());
        // Strings need JSON quoting, while arrays/objects retain their JSON representation.
        field("exportedAt",JSONObject.quote(candidate.getString("exportedAt")));
        TableTiming.mark(timing,"recordCompareAndWrite");
    }
    /** Complete native graph validation, but only explicit changed records are encoded and written. */
    void importTableDelta(JSONObject delta,String now,TableTiming timing)throws Exception {
        Map<String,String> previous=fields();
        TableTiming.mark(timing,"metadataRead");
        JSONObject candidate=TableImport.delta(delta,previous,now);
        TableTiming.mark(timing,"tableRules");
        SnapshotStream.validate(new StringReader(candidate.toString()));
        TableTiming.mark(timing,"mergedValidation");
        long nextOrdinal;try(Cursor end=db.rawQuery("SELECT COALESCE(MAX(ordinal),-1)+1 FROM indexed_records",null)){end.moveToFirst();nextOrdinal=end.getLong(0);}
        TableTiming.mark(timing,"recordIndex");
        JSONArray added=delta.getJSONArray("recordsAdded"),changed=delta.getJSONArray("manualUpdates");
        // The complete delta/graph validation above proves these IDs are new and
        // have no raw body. Reuse one statement for metadata-only appends; a
        // manual body still takes the existing bounded body writer.
        try(SQLiteStatement insert=db.compileStatement("INSERT INTO indexed_records(id,ordinal,metadata,bytes,body_count) VALUES(?,?,?,?,0)")){
            for(int i=0;i<added.length();i++){
                JSONObject row=added.getJSONObject(i);String metadata=row.toString();
                if(row.has("manualContent"))record(new RawJson(new StringReader(metadata)),row.getString("id"),false,nextOrdinal++);
                else{
                    insert.bindString(1,row.getString("id"));insert.bindLong(2,nextOrdinal++);
                    insert.bindString(3,metadata);insert.bindLong(4,JsonFields.bytes(metadata));insert.executeInsert();
                }
            }
        }
        for(int i=0;i<changed.length();i++){
            JSONObject row=changed.getJSONObject(i);long rowKey=key(row.getString("id"));
            db.execSQL("DELETE FROM indexed_bodies WHERE record_key=? AND kind='manualContent'",new Object[]{rowKey});
            try(Writer writer=new BodyWriter(rowKey,"manualContent")){writer.write(JSONObject.quote(row.getString("manualContent")));}
            JSONObject metadata=new JSONObject(row.toString());metadata.remove("manualContent");refreshSize(rowKey,metadata.toString());
        }
        for(String name:new String[]{"schemaVersion","modules","characters","settings"})field(name,candidate.get(name).toString());
        field("exportedAt",JSONObject.quote(now));
        TableTiming.mark(timing,"recordCompareAndWrite");
    }
    /** Only called for a sealed table session inside its single CAS transaction. */
    void tableRecord(JSONObject value,long ordinal,boolean added,Reader manual)throws Exception {
        if(value.has("rawContent")||value.has("manualContent"))throw new IOException("表格元数据不能携带正文。");
        BackupValidation.record(value);String id=value.getString("id");Long previous=key(id);
        if(added){if(previous!=null)throw new IOException("新增场次标识已存在。");record(new RawJson(new StringReader(value.toString())),id,false,ordinal);previous=key(id);}
        else{
            if(previous==null||manual==null)throw new IOException("待更新手动场次已变化。");
            JSONObject old=new JSONObject(metadata(previous));
            if(!old.getString("sourceType").equals("manual"))throw new IOException("表格不能覆盖在线正文。");
            JSONObject permitted=new JSONObject(value.toString());
            for(String field:new String[]{"updatedAt","playDate","dateSource"}){old.remove(field);permitted.remove(field);}
            if(!BackupValidation.same(old,permitted))throw new IOException("表格试图改写已有场次其他字段。");
        }
        if(manual!=null){
            db.execSQL("DELETE FROM indexed_bodies WHERE record_key=? AND kind='manualContent'",new Object[]{previous});
            try(Reader input=manual;Writer output=new BodyWriter(previous,"manualContent")){
                RawJson encoded=new RawJson(input);encoded.copy(output);encoded.end();
            }
        }
        refreshSize(previous,value.toString());
    }
    void tableField(String name,String value)throws Exception{
        if(!Arrays.asList("schemaVersion","settings","modules","characters","exportedAt").contains(name))throw new IOException("表格根字段无效。");
        field(name,value);
    }
    long bytes(){Map<String,String> root=rootFields();root.put("records","[]");try(Cursor rows=db.rawQuery("SELECT COUNT(*),COALESCE(SUM(bytes),0) FROM indexed_records",null)){rows.moveToFirst();return JsonFields.objectBytes(root)+rows.getLong(1)+Math.max(0,rows.getLong(0)-1);}}
    long projectedBytes(Set<String> selected)throws Exception{
        Map<String,String> root=rootFields();root.put("records","[]");long bytes=JsonFields.objectBytes(root),count=0;
        if(selected==null)return bytes();
        List<String> ids=new ArrayList<>(selected);
        for(int start=0;start<ids.size();start+=400){
            List<String> group=ids.subList(start,Math.min(start+400,ids.size()));
            String placeholders=String.join(",",Collections.nCopies(group.size(),"?"));
            try(Cursor row=db.rawQuery("SELECT COUNT(*),COALESCE(SUM(bytes),0) FROM indexed_records WHERE id IN ("+placeholders+")",group.toArray(new String[0]))){if(!row.moveToFirst())throw new IOException("场次计量读取失败。");count+=row.getLong(0);bytes+=row.getLong(1);}
        }
        if(count!=selected.size())throw new IOException("场次已变化，请重新读取。");return bytes+Math.max(0,count-1);
    }
    long metadataBytes(){Map<String,String> root=rootFields();root.put("records","[]");try(Cursor rows=db.rawQuery("SELECT COUNT(*),COALESCE(SUM(length(CAST(metadata AS BLOB))),0) FROM indexed_records",null)){rows.moveToFirst();return JsonFields.objectBytes(root)+rows.getLong(1)+Math.max(0,rows.getLong(0)-1);}}
    void checkSize(){
        if(!deviceSpace){if(bytes()>LogbookLimits.LIBRARY_BYTES)throw new IllegalArgumentException("数据超过 64 MiB；原数据未改变。");return;}
        try{
            try(Cursor row=db.rawQuery("SELECT COALESCE(MAX(bytes),0) FROM indexed_records",null)){row.moveToFirst();if(row.getLong(0)>LogbookLimits.ENTITY_REQUEST_BYTES)throw new IllegalArgumentException("单场完整raw/manual合计超过64MiB；原数据未改变。");}
            StorageBudget.require(available,0);
        }catch(RuntimeException error){throw error;}catch(Exception error){throw new IllegalStateException("保存空间不足或无法核对；原数据未改变。",error);}
    }
    void write(Writer out,Set<String> selected)throws Exception{
        Map<String,String> root=rootFields();out.write('{');boolean comma=false;
        for(Map.Entry<String,String> field:root.entrySet()){if(comma)out.write(',');comma=true;out.write(JSONObject.quote(field.getKey()));out.write(':');JsonFields.writeText(out,field.getValue());}
        if(comma)out.write(',');out.write("\"records\":[");Set<String> found=new HashSet<>();boolean recordComma=false;
        try(Cursor rows=db.rawQuery("SELECT row_key,id,metadata FROM indexed_records ORDER BY ordinal,row_key",null)){
            while(rows.moveToNext()){
                String id=rows.getString(1);if(selected!=null&&!selected.contains(id))continue;found.add(id);
                if(recordComma)out.write(',');recordComma=true;
                String metadata=rows.getString(2);JsonFields.writeText(out,metadata.substring(0,metadata.length()-1));
                String kind=null;
                try(Cursor parts=db.rawQuery("SELECT kind,data FROM indexed_bodies WHERE record_key=? ORDER BY kind,position",new String[]{Long.toString(rows.getLong(0))})){
                    while(parts.moveToNext()){if(!parts.getString(0).equals(kind)){kind=parts.getString(0);out.write(',');out.write(JSONObject.quote(kind));out.write(':');}JsonFields.writeText(out,parts.getString(1));}
                }out.write('}');
            }
        }out.write("]}");if(selected!=null&&!found.equals(selected))throw new IllegalArgumentException("场次已变化，请重新读取。");
    }
    void migrateLegacy()throws Exception{
        Map<String,String> overrides=new LinkedHashMap<>();String previous=null;StringBuilder value=new StringBuilder();
        try(Cursor rows=db.rawQuery("SELECT field,data FROM snapshot_fields ORDER BY field,position",null)){while(rows.moveToNext()){String name=rows.getString(0);if(!name.equals(previous)){if(previous!=null)overrides.put(previous,value.toString());previous=name;value.setLength(0);}value.append(rows.getString(1));}}if(previous!=null)overrides.put(previous,value.toString());
        boolean chunks;try(Cursor rows=db.rawQuery("SELECT 1 FROM snapshot_chunks LIMIT 1",null)){chunks=rows.moveToFirst();}
        if(chunks){try(Reader input=new CursorReader(db.rawQuery("SELECT data FROM snapshot_chunks ORDER BY position",null))){replace(input);}}
        else {try(Cursor row=db.rawQuery("SELECT json FROM app_state WHERE id=1",null)){if(!row.moveToFirst()||row.isNull(0))throw new IllegalStateException("原正文缺失。");replace(new StringReader(row.getString(0)));}}
        patch(overrides);db.execSQL("UPDATE app_state SET json='indexed-v4' WHERE id=1");
        db.execSQL("DELETE FROM snapshot_chunks");db.execSQL("DELETE FROM snapshot_fields");
    }
}
