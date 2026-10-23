package coc.logbook;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteStatement;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.security.*;
import java.util.*;
import org.json.*;

/** Private, revision-bound table spool. Source and candidate are never database
 * authority. SST, candidate ordering, duplicate lookup and preview pages live
 * in a separate SQLite file; only the final production CAS applies changes. */
final class TableSession implements AutoCloseable {
    final String id=UUID.randomUUID().toString(),tree,kind;
    final long revision,maximumStageBytes;
    final StorageBudget.Available available;
    final File directory,source;
    final String name,format;
    private SQLiteDatabase stage;
    private SQLiteStatement insertBlob,insertChunk;
    // Statements belong to this private database lease and are released before
    // its immutable preview is reopened. Bindings never survive an operation.
    private final Map<String,SQLiteStatement> statements=new HashMap<>();
    private JSONObject operationTiming;
    private long capacityNanos,capacityCalls;
    private final Map<String,Spool> spools=new LinkedHashMap<>();
    private final Lines stringLines=new Lines();
    private BackupSession.Proof sourceProof,candidateProof,previewDatabaseProof;
    private BackupSession.Proof commitProof;
    private FileInputStream commitInput;
    private long commitRecords;
    private long written,stringCount,added,updated,skipped,namesCount,warningsCount;
    private boolean ready,detached,closed,ownershipEstablished;
    private boolean seedPrepared;
    private Throwable preparationError;
    private long preparationNanos,preparationCapacityNanos,preparationCapacityCalls;
    private JSONObject initialSettings;
    private String now;
    // Only the current row's module is resident, and only while constructing
    // this private preview transaction. No data survives into another lease.
    private String currentModuleName,currentModuleID;
    private JSONObject currentModule;
    private LinkedHashSet<String> currentKps;
    private LinkedHashMap<String,JSONObject> currentPairs;
    private long currentModuleCount,nextRecordOrdinal;
    private boolean currentModuleCountDirty;
    private final boolean allowMemorySnapshot;
    private byte[] memorySnapshot;
    private static final Set<String> FILES=new HashSet<>(Arrays.asList("owner","source.part","candidate.part","strings.part","apply.part","stage.sqlite","stage.sqlite-journal","stage.sqlite-wal","stage.sqlite-shm"));
    private static final class Spool {
        final File file;FileOutputStream output;long bytes,index;
        Spool(File file)throws Exception{this.file=file;if(!file.createNewFile())throw new IOException("表格暂存已存在。");output=new FileOutputStream(file);}
        void seal()throws Exception{if(output!=null){output.flush();output.getFD().sync();output.close();output=null;}}
    }
    interface Line {void accept(String value)throws Exception;}
    /** byteLength covers this complete strictly decoded line, excluding LF but
     * retaining CR and JSON whitespace. It is measured here, never caller supplied. */
    interface ProvenLine {void accept(String value,long byteLength)throws Exception;}
    interface Authorization {void check()throws Exception;}
    static final class Lines extends ByteArrayOutputStream {
        /** Validate every original UTF-8 byte before the platform's native
         * string conversion. No replacement decoding can accept malformed
         * input: overlongs, surrogate scalars, overflow and incomplete tails
         * all fail before a complete line reaches its consumer. */
        private String complete(int length)throws CharacterCodingException{
            for(int at=0;at<length;){
                int first=buf[at++]&255;if(first<128)continue;
                int count;
                if(first>=0xc2&&first<=0xdf)count=1;
                else if(first>=0xe0&&first<=0xef)count=2;
                else if(first>=0xf0&&first<=0xf4)count=3;
                else throw new MalformedInputException(1);
                if(length-at<count)throw new MalformedInputException(1);
                int second=buf[at]&255;
                if(first==0xe0&&second<0xa0||first==0xed&&second>=0xa0||first==0xf0&&second<0x90||first==0xf4&&second>=0x90)throw new MalformedInputException(1);
                for(int index=0;index<count;index++)if((buf[at++]&0xc0)!=0x80)throw new MalformedInputException(1);
            }
            return new String(buf,0,length,StandardCharsets.UTF_8);
        }
        void append(byte[] input,int offset,int count,Line accept)throws Exception{
            appendWithProof(input,offset,count,(value,byteLength)->accept.accept(value));
        }
        void appendWithProof(byte[] input,int offset,int count,ProvenLine accept)throws Exception{
            int start=offset,end=offset+count;
            for(int i=offset;i<end;i++)if(input[i]==10){part(input,start,i-start);start=i+1;
                int byteLength=size();String value=complete(byteLength);reset();accept.accept(value,byteLength);
            }part(input,start,end-start);
        }
        private void part(byte[] input,int start,int length)throws Exception{write(input,start,length);}
        void finish()throws Exception{if(size()!=0)throw new IOException("表格暂存末行不完整。");}
    }
    TableSession(File root,String tree,long revision,String kind,String name,StorageBudget.Available available)throws Exception{
        this(root,tree,revision,kind,name,available,false);
    }
    TableSession(File root,String tree,long revision,String kind,String name,StorageBudget.Available available,boolean deferIndex)throws Exception{
        if(!Arrays.asList("record-table","character-table").contains(kind))throw new IOException("表格用途无效。");
        this.tree=tree;this.revision=revision;this.kind=kind;this.name=name;
        int dot=name.lastIndexOf('.');format=dot<0?"":name.substring(dot+1).toLowerCase(Locale.ROOT);
        if(!Arrays.asList("csv","xlsx","xls").contains(format))throw new IOException("仅支持 XLSX、XLS 或 CSV 文件。");
        if(!root.isDirectory()&&!root.mkdirs())throw new IOException("无法建立表格私有暂存。");
        directory=new File(root,"coc-table-"+id);
        source=new File(directory,"source.part");StorageBudget.Available volume=available==null?StorageBudget.volume(root):available;
        this.available=()->{if(operationTiming==null)return volume.bytes();long start=System.nanoTime();try{return volume.bytes();}finally{capacityNanos+=System.nanoTime()-start;capacityCalls++;}};
        maximumStageBytes=StorageBudget.maximum(this.available,6);
        allowMemorySnapshot=deferIndex&&kind.equals("character-table")&&format.equals("xlsx");
        try{
            if(!deferIndex){ensureOwnedDirectory();now=java.time.Instant.now().toString();ensureIndex();}
        }catch(Exception|OutOfMemoryError error){try{close();}catch(Exception cleanup){error.addSuppressed(cleanup);}throw error;}
    }
    private void ensureOwnedDirectory()throws Exception{
        if(ownershipEstablished)return;
        if(closed)throw new IOException("表格私有租约已关闭。");
        File root=directory.getParentFile();cleanupStale(root);
        if(!directory.mkdir())throw new IOException("表格暂存目录已存在。");
        try(FileOutputStream marker=new FileOutputStream(new File(directory,"owner"))){marker.write(id.getBytes(StandardCharsets.UTF_8));marker.getFD().sync();}
        ownershipEstablished=true;
    }
    private void ensureIndex()throws Exception{
        if(stage!=null)return;
        if(closed||ready)throw new IOException("表格私有索引阶段无效。");
        ensureOwnedDirectory();
            stage=SQLiteDatabase.openOrCreateDatabase(new File(directory,"stage.sqlite"),null);
            try(Cursor mode=stage.rawQuery("PRAGMA journal_mode=DELETE",null)){if(!mode.moveToFirst())throw new IOException("表格暂存日志配置失败。");}stage.execSQL("PRAGMA synchronous=FULL");
            // One durable schema transaction, rather than a separate FULL
            // journal commit for every table/index before the picker returns.
            stage.beginTransaction();try{
            stage.execSQL("CREATE TABLE blobs(id INTEGER PRIMARY KEY,bytes INTEGER NOT NULL,resident BLOB)");
            stage.execSQL("CREATE TABLE blob_chunks(owner INTEGER NOT NULL,position INTEGER NOT NULL,offset INTEGER NOT NULL,data BLOB NOT NULL,PRIMARY KEY(owner,position))");
            stage.execSQL("CREATE INDEX blob_offsets ON blob_chunks(owner,offset)");
            stage.execSQL("CREATE TABLE strings(id INTEGER PRIMARY KEY,value INTEGER NOT NULL)");
            stage.execSQL("CREATE TABLE incoming(sheet INTEGER NOT NULL,row INTEGER NOT NULL,kind TEXT NOT NULL,value INTEGER NOT NULL,PRIMARY KEY(sheet,row))");
            stage.execSQL("CREATE TABLE modules(id TEXT PRIMARY KEY,name TEXT NOT NULL,ordinal INTEGER NOT NULL,value INTEGER NOT NULL,count INTEGER NOT NULL DEFAULT 0)");
            stage.execSQL("CREATE INDEX module_name ON modules(name,ordinal)");
            stage.execSQL("CREATE TABLE characters(id TEXT PRIMARY KEY,ordinal INTEGER NOT NULL,value INTEGER NOT NULL)");
            stage.execSQL("CREATE TABLE records(id TEXT PRIMARY KEY,module_id TEXT NOT NULL,name TEXT NOT NULL,link TEXT NOT NULL,source TEXT NOT NULL,ordinal INTEGER NOT NULL,value INTEGER,manual INTEGER,original INTEGER NOT NULL,changed INTEGER NOT NULL DEFAULT 0,raw_bytes INTEGER NOT NULL DEFAULT 0,bytes INTEGER,resident BLOB)");
            stage.execSQL("CREATE INDEX record_link ON records(module_id,link)");stage.execSQL("CREATE INDEX record_manual ON records(module_id,source,name,link)");
            stage.execSQL("CREATE INDEX record_order ON records(ordinal)");
            stage.execSQL("CREATE TABLE preview(kind TEXT NOT NULL,position INTEGER NOT NULL,value INTEGER,bytes INTEGER,resident BLOB,PRIMARY KEY(kind,position))");
            stage.setTransactionSuccessful();}finally{stage.endTransaction();}
    }
    static long integer(Object value)throws Exception{if(!(value instanceof Number))throw new IOException("表格整数参数无效。");double number=((Number)value).doubleValue();if(!Double.isFinite(number)||number<0||number>StorageBudget.JS_SAFE_INTEGER||number!=Math.floor(number))throw new IOException("表格整数参数无效。");return (long)number;}
    void require(String token)throws Exception{
        if(closed||!id.equals(token))throw new IOException("表格预览已失效，请重新选择。");
        if(preparationError!=null)throw new IOException("表格索引预备未完成，请重新选择；原数据未改变。",preparationError);
    }
    void preparationFailed(Throwable error){seedPrepared=false;if(preparationError==null)preparationError=error;}
    /** Runs only after this import's complete source capture, on the same
     * serial bridge queue as append/preview/cancel. The JS parser may run in
     * parallel; no business row is written and nothing crosses an owner. */
    void prepareSeed(LogbookDatabase database,JSONObject defaultSettings,Authorization authorize,boolean measure)throws Exception{
        long started=System.nanoTime();
        try{
            require(id);if(ready||seedPrepared||sourceProof==null||memorySnapshot!=null||!kind.equals("record-table"))throw new IOException("表格索引预备阶段无效。");
            if(database.revision()!=revision)throw new IOException("表格预备版本已变化。");authorize.check();
            operationTiming=measure?new JSONObject():null;capacityNanos=0;capacityCalls=0;
            ensureIndex();if(now==null)now=java.time.Instant.now().toString();
            stage.beginTransaction();try{
                seed(database,defaultSettings);nextRecordOrdinal=scalar("SELECT COALESCE(MAX(ordinal),-1)+1 FROM records");
                if(database.revision()!=revision)throw new IOException("表格预备版本已变化。");authorize.check();if(database.revision()!=revision)throw new IOException("表格预备版本已变化。");stage.setTransactionSuccessful();
            }finally{stage.endTransaction();}
            if(database.revision()!=revision)throw new IOException("表格预备版本已变化。");
            seedPrepared=true;
        }catch(Exception|OutOfMemoryError error){preparationFailed(error);throw error;}
        finally{preparationNanos=System.nanoTime()-started;preparationCapacityNanos=capacityNanos;preparationCapacityCalls=capacityCalls;operationTiming=null;}
    }
    BackupSession.Proof capture(InputStream input)throws Exception{
        if(input==null||sourceProof!=null||source.exists())throw new IOException("表格来源无效。");
        if(allowMemorySnapshot)return captureReadonlySnapshot(input);
        ensureOwnedDirectory();
        long total=0;byte[] buffer=new byte[65536];int n;
        try(FileOutputStream output=new FileOutputStream(source)){
            while((n=input.read(buffer))!=-1){total+=n;if(total>maximumStageBytes)throw new IOException("表格来源暂存空间不足。");StorageBudget.require(available,n);output.write(buffer,0,n);}
            output.getFD().sync();
        }
        sourceProof=BackupSession.fileProof(source,total);return sourceProof;
    }
    private static String digestHex(byte[] digest){final char[] digits="0123456789abcdef".toCharArray(),text=new char[digest.length*2];for(int index=0;index<digest.length;index++){int value=digest[index]&255;text[index*2]=digits[value>>>4];text[index*2+1]=digits[value&15];}return new String(text);}
    private BackupSession.Proof captureReadonlySnapshot(InputStream input)throws Exception{
        MessageDigest digest=MessageDigest.getInstance("SHA-256");ByteArrayOutputStream memory=new ByteArrayOutputStream(65536);
        FileOutputStream disk=null;long total=0;byte[] window=new byte[65536];int count;
        try{
            while((count=input.read(window))!=-1){
                total+=count;if(total>maximumStageBytes)throw new IOException("表格来源暂存空间不足。");StorageBudget.require(available,count);digest.update(window,0,count);
                if(disk==null&&total>2*1024*1024){
                    ensureOwnedDirectory();if(!source.createNewFile())throw new IOException("表格来源已存在。");disk=new FileOutputStream(source);memory.writeTo(disk);memory=null;
                }
                if(disk!=null)disk.write(window,0,count);else memory.write(window,0,count);
            }
            if(disk!=null)disk.getFD().sync();
        }finally{if(disk!=null)disk.close();}
        BackupSession.Proof proof=new BackupSession.Proof(total,digestHex(digest.digest()));
        if(memory!=null)memorySnapshot=memory.toByteArray();else{BackupSession.Proof copied=BackupSession.fileProof(source,total);proof.matches(copied.bytes,copied.sha256);}
        sourceProof=proof;return proof;
    }
    private void materializeMemorySource()throws Exception{
        if(memorySnapshot==null)return;ensureOwnedDirectory();if(!source.createNewFile())throw new IOException("表格来源已存在。");
        try(FileOutputStream output=new FileOutputStream(source)){output.write(memorySnapshot);output.getFD().sync();}
        BackupSession.Proof copied=BackupSession.fileProof(source,sourceProof.bytes);sourceProof.matches(copied.bytes,copied.sha256);memorySnapshot=null;
    }
    BackupSession.Proof sourceProof()throws Exception{if(sourceProof==null)throw new IOException("表格来源未封存。");return sourceProof;}
    JSONObject inspectCoc7Kernel()throws Exception{
        return inspectCoc7Kernel(null);
    }
    JSONObject inspectCoc7Kernel(JSONObject timing)throws Exception{
        if(closed||ready||sourceProof==null||!kind.equals("character-table")||!format.equals("xlsx"))return null;
        // Resident resource budget only. Larger sources use the unchanged
        // complete streaming reader, with no fixed content-size quota.
        if(sourceProof.bytes>2*1024*1024)return null;
        if(memorySnapshot!=null){
            // This private immutable copy and its SHA are constructed together
            // at complete EOF; no source/capability/byte array is exposed.
            if(memorySnapshot.length!=sourceProof.bytes)throw new IOException("角色卡完整快照长度已变化。");
            JSONObject payload=NativeTableKernel.inspect(memorySnapshot,maximumStageBytes,timing);
            if(payload==null){materializeMemorySource();return null;}
            return new JSONObject().put("source",new JSONObject().put("bytes",sourceProof.bytes).put("sha256",sourceProof.sha256)).put("payload",payload);
        }
        long snapshotStart=System.nanoTime();MessageDigest digest=MessageDigest.getInstance("SHA-256");
        ByteArrayOutputStream snapshot=new ByteArrayOutputStream((int)sourceProof.bytes);
        long total=0;byte[] window=new byte[65536];int count;
        try(InputStream input=new FileInputStream(source)){
            while((count=input.read(window))!=-1){total+=count;if(total>sourceProof.bytes)throw new IOException("角色卡完整来源长度已变化。");digest.update(window,0,count);snapshot.write(window,0,count);}
        }
        StringBuilder hash=new StringBuilder();for(byte value:digest.digest())hash.append(String.format(Locale.ROOT,"%02x",value&255));
        sourceProof.matches(total,hash.toString());
        if(timing!=null)timing.put("snapshotProofMs",(System.nanoTime()-snapshotStart)/1000000.0);
        JSONObject payload=NativeTableKernel.inspect(snapshot.toByteArray(),maximumStageBytes,timing);
        if(payload==null)return null;
        return new JSONObject().put("source",new JSONObject().put("bytes",total).put("sha256",hash.toString())).put("payload",payload);
    }
    JSONObject inspectRecordsKernel(JSONObject timing)throws Exception{
        require(id);
        if(ready||sourceProof==null||!kind.equals("record-table")||!format.equals("xlsx"))return null;
        // Only an optional resident reader budget. The complete durable source
        // remains the owner for candidate staging, preview, and final commit.
        if(sourceProof.bytes>2*1024*1024)return null;
        long started=System.nanoTime();byte[] complete=new byte[(int)sourceProof.bytes];int total=0;
        MessageDigest digest=MessageDigest.getInstance("SHA-256");
        try(InputStream input=new FileInputStream(source)){
            while(total<complete.length){int count=input.read(complete,total,complete.length-total);if(count<0)throw new IOException("场次表格完整来源已截断。");if(count==0)continue;digest.update(complete,total,count);total+=count;}
            if(input.read()!=-1)throw new IOException("场次表格完整来源包含额外内容。");
        }
        sourceProof.matches(total,digestHex(digest.digest()));
        if(timing!=null)timing.put("recordsSnapshotProofMs",(System.nanoTime()-started)/1000000.0);
        String payload=NativeTableKernel.inspectRecords(complete,maximumStageBytes,timing);
        if(payload==null)return null;
        return new JSONObject().put("source",new JSONObject().put("bytes",sourceProof.bytes).put("sha256",sourceProof.sha256)).put("payloadJson",payload);
    }
    void append(String key,long index,byte[] bytes)throws Exception{
        require(id);
        if(memorySnapshot!=null)throw new IOException("只读角色卡快照不能用于写入暂存。");
        if(ready||closed||sourceProof==null||!Arrays.asList("candidate","strings").contains(key)||bytes.length==0||bytes.length>LogbookLimits.TRANSFER_CHUNK_BYTES)throw new IOException("表格暂存分段无效。");
        if(written+bytes.length>maximumStageBytes)throw new IOException("表格暂存所需空间不足。");
        StorageBudget.require(available,StorageBudget.estimate(bytes.length,3));
        Spool spool=spools.get(key);if(spool==null){spool=new Spool(new File(directory,key+".part"));spools.put(key,spool);}
        if(spool.output==null||spool.index!=index)throw new IOException("表格暂存分段乱序或已封存。");
        spool.output.write(bytes);spool.bytes+=bytes.length;spool.index++;written+=bytes.length;
        if(key.equals("strings")){
            ensureIndex();
            stage.beginTransaction();try{stringLines.append(bytes,0,bytes.length,value->{
                StrictBackupJson.validate(value);JSONArray row=new JSONArray(value);if(row.length()!=2||integer(row.get(0))!=stringCount||!(row.get(1) instanceof String))throw new IOException("共享字符串索引无效。");
                execute("INSERT INTO strings VALUES(?,?)",stringCount++,storeText(row.getString(1)));
            });stage.setTransactionSuccessful();}finally{stage.endTransaction();}
        }
    }
    JSONObject string(long index,long offset)throws Exception{
        require(id);
        if(closed||ready||index<0||index>=stringCount||offset<0)throw new IOException("共享字符串索引无效。");
        Long ref=reference("strings","value","id=?",new String[]{Long.toString(index)});if(ref==null)throw new IOException("共享字符串不存在。");
        long bytes=scalar("SELECT bytes FROM blobs WHERE id=?",Long.toString(ref));if(offset>bytes)throw new IOException("共享字符串偏移无效。");
        try(Cursor row=stage.rawQuery("SELECT resident,(SELECT COUNT(*) FROM blob_chunks WHERE owner=blobs.id) FROM blobs WHERE id=?",new String[]{Long.toString(ref)})){
            if(!row.moveToFirst())throw new IOException("共享字符串完整值缺失。");
            if(!row.isNull(0)){byte[] complete=row.getBlob(0);if(complete.length!=bytes||complete.length==0||complete.length>65536||row.getLong(1)!=0)throw new IOException("共享字符串完整值无效。");byte[] part=Arrays.copyOfRange(complete,(int)offset,complete.length);return new JSONObject().put("base64",android.util.Base64.encodeToString(part,android.util.Base64.NO_WRAP)).put("bytes",bytes).put("done",true);}
        }
        int count=(int)Math.min(LogbookLimits.TRANSFER_CHUNK_BYTES,bytes-offset);byte[] chunk=new byte[count];int filled=0;
        // rawQuery binds strings: computed expressions have no column affinity,
        // so their byte offsets must be explicitly compared as integers.
        try(Cursor rows=stage.rawQuery("SELECT offset,data FROM blob_chunks WHERE owner=? AND offset>=? AND offset<? AND offset+length(data)>CAST(? AS INTEGER) ORDER BY position",new String[]{Long.toString(ref),Long.toString(Math.max(0,offset-LogbookLimits.TRANSFER_CHUNK_BYTES)),Long.toString(offset+count),Long.toString(offset)})){
            while(rows.moveToNext()){long start=rows.getLong(0);byte[] part=rows.getBlob(1);int from=(int)Math.max(0,offset-start),take=Math.min(part.length-from,count-filled);if(take<0||start+from!=offset+filled)throw new IOException("共享字符串分段不完整。");System.arraycopy(part,from,chunk,filled,take);filled+=take;}
        }
        if(filled!=count)throw new IOException("共享字符串分段不完整。");
        return new JSONObject().put("base64",android.util.Base64.encodeToString(chunk,android.util.Base64.NO_WRAP)).put("bytes",bytes).put("done",offset+count==bytes);
    }
    /** Content is stored in bounded values; SQLite's single-BLOB limit is never a content limit. */
    private long storeText(String text)throws Exception{
        return storeText(text,JsonFields.bytes(text));
    }
    private long storeText(String text,long bytes)throws Exception{
        long ref;StorageBudget.require(available,StorageBudget.estimate(bytes,3));
        if(insertBlob==null)insertBlob=stage.compileStatement("INSERT INTO blobs(bytes,resident) VALUES(?,?)");
        if(insertChunk==null)insertChunk=stage.compileStatement("INSERT INTO blob_chunks VALUES(?,?,?,?)");
        // A complete small value needs one bounded SQLite cell; larger values
        // retain the identical full chunk path. This is never a content limit.
        byte[] resident=bytes>0&&bytes<=65536?text.getBytes(StandardCharsets.UTF_8):null;
        if(resident!=null){if(resident.length!=bytes)throw new IOException("表格文本UTF-8计量不符。");StorageBudget.require(available,StorageBudget.estimate(resident.length,3));}
        try{insertBlob.bindLong(1,bytes);if(resident==null)insertBlob.bindNull(2);else insertBlob.bindBlob(2,resident);ref=insertBlob.executeInsert();}finally{insertBlob.clearBindings();}
        if(resident!=null)return ref;
        long offset=0,position=0;
        for(int at=0;at<text.length();){int end=(int)Math.min((long)at+65536,text.length());if(end<text.length()&&Character.isHighSurrogate(text.charAt(end-1)))end--;
            byte[] part=text.substring(at,end).getBytes(StandardCharsets.UTF_8);StorageBudget.require(available,StorageBudget.estimate(part.length,3));
            try{insertChunk.bindLong(1,ref);insertChunk.bindLong(2,position++);insertChunk.bindLong(3,offset);insertChunk.bindBlob(4,part);insertChunk.executeInsert();}finally{insertChunk.clearBindings();}offset=Math.addExact(offset,part.length);at=end;
        }
        if(offset!=bytes)throw new IOException("表格文本UTF-8计量不符。");return ref;
    }
    private SQLiteStatement statement(String sql){
        SQLiteStatement result=statements.get(sql);if(result==null){result=stage.compileStatement(sql);statements.put(sql,result);}return result;
    }
    private void execute(String sql,Object...args){
        SQLiteStatement query=statement(sql);
        try{
            for(int i=0;i<args.length;i++){Object value=args[i];int index=i+1;
                if(value==null)query.bindNull(index);else if(value instanceof byte[])query.bindBlob(index,(byte[])value);
                else if(value instanceof Float||value instanceof Double)query.bindDouble(index,((Number)value).doubleValue());
                else if(value instanceof Number)query.bindLong(index,((Number)value).longValue());else query.bindString(index,(String)value);
            }
            query.execute();
        }finally{query.clearBindings();}
    }
    private void closeStatements(){if(insertBlob!=null){insertBlob.close();insertBlob=null;}if(insertChunk!=null){insertChunk.close();insertChunk=null;}for(SQLiteStatement query:statements.values())query.close();statements.clear();}
    private Long reference(String table,String column,String where,String[] args)throws Exception{
        try(Cursor row=stage.rawQuery("SELECT "+column+" FROM "+table+" WHERE "+where,args)){if(!row.moveToFirst()||row.isNull(0))return null;return row.getLong(0);}
    }
    private void replaceText(String table,String id,String column,String text)throws Exception{
        replaceText(table,id,column,text,JsonFields.bytes(text));
    }
    private void replaceText(String table,String id,String column,String text,long bytes)throws Exception{
        Long previous=reference(table,column,"id=?",new String[]{id});long next=storeText(text,bytes);
        execute("UPDATE "+table+" SET "+column+"=? WHERE id=?",next,id);
        if(previous!=null){execute("DELETE FROM blob_chunks WHERE owner=?",previous);execute("DELETE FROM blobs WHERE id=?",previous);}
    }
    private InputStream content(long ref)throws Exception{
        Cursor rows=stage.rawQuery("SELECT "+joinedBlobColumns()+" FROM blobs b LEFT JOIN blob_chunks c ON c.owner=b.id WHERE b.id=? ORDER BY c.position",new String[]{Long.toString(ref)});
        try{rows.moveToFirst();return new JoinedContent(rows,0,-1,true);}catch(Exception error){rows.close();throw error;}
    }
    private static String joinedBlobColumns(){
        // Mixed resident/chunk representations are corrupt, even if their
        // bytes agree. Synthetic -1 position makes the full reader reject it.
        return "b.bytes,CASE WHEN b.resident IS NULL THEN c.position WHEN c.owner IS NOT NULL OR length(b.resident)>65536 THEN -1 ELSE 0 END,CASE WHEN b.resident IS NULL THEN c.offset ELSE 0 END,COALESCE(b.resident,c.data)";
    }
    /** One ordered query carries both the manifest and every bounded chunk.
     * LEFT JOIN preserves empty/missing chunk evidence. For a preview page the
     * next group's first row stays positioned for its own complete reader. */
    private static final class JoinedContent extends InputStream {
        private final Cursor rows;private final int column,groupColumn;private final long group;private final boolean ownsCursor;
        private byte[] part=new byte[0];private int at;private long bytes=-1,position,total;private boolean first=true,manifest,ended;
        JoinedContent(Cursor rows,int column,int groupColumn,boolean ownsCursor){this.rows=rows;this.column=column;this.groupColumn=groupColumn;this.ownsCursor=ownsCursor;group=groupColumn<0||rows.isAfterLast()?0:rows.getLong(groupColumn);}
        // Only an allocation hint. read() still validates the manifest and
        // every joined row through EOF, including empty and mixed values.
        private int smallValueBytes(){
            if(!first||rows.isBeforeFirst()||rows.isAfterLast()||rows.isNull(column))return -1;
            long expected=rows.getLong(column);return expected>=0&&expected<=65536?(int)expected:-1;
        }
        private int finish()throws IOException{ended=true;if(!manifest||total!=bytes)throw new IOException("表格内容分段不完整。");return -1;}
        public int read()throws IOException{byte[] one=new byte[1];return read(one,0,1)<0?-1:one[0]&255;}
        public int read(byte[] buffer,int start,int count)throws IOException{
            if(buffer==null)throw new NullPointerException();if(start<0||count<0||start>buffer.length-count)throw new IndexOutOfBoundsException();if(count==0)return 0;if(ended)return -1;
            while(at==part.length){
                if(first){first=false;if(rows.isAfterLast()||rows.isBeforeFirst())return finish();}else if(!rows.moveToNext())return finish();
                if(groupColumn>=0&&rows.getLong(groupColumn)!=group)return finish();
                if(rows.isNull(column))throw new IOException("表格内容完整长度缺失。");long expected=rows.getLong(column);
                if(expected<0||manifest&&bytes!=expected)throw new IOException("表格内容完整长度无效。");bytes=expected;manifest=true;
                if(rows.isNull(column+1)||rows.isNull(column+2)||rows.isNull(column+3)){
                    if(bytes!=0||position!=0||!rows.isNull(column+1)||!rows.isNull(column+2)||!rows.isNull(column+3))throw new IOException("表格内容分段缺失。");
                    continue;
                }
                if(rows.getLong(column+1)!=position||rows.getLong(column+2)!=total)throw new IOException("表格内容分段乱序。");
                part=rows.getBlob(column+3);at=0;if(part.length==0||part.length>LogbookLimits.TRANSFER_CHUNK_BYTES||part.length>bytes-total)throw new IOException("表格内容分段无效。");position++;
            }
            int copied=Math.min(count,part.length-at);System.arraycopy(part,at,buffer,start,copied);at+=copied;total+=copied;return copied;
        }
        public void close(){if(ownsCursor)rows.close();}
    }
    private String contentText(long ref)throws Exception{
        return contentText(content(ref));
    }
    private static String contentText(InputStream source)throws Exception{
        int small=source instanceof JoinedContent?((JoinedContent)source).smallValueBytes():-1;
        if(small>=0)try(InputStream input=source){
            byte[] complete=new byte[small];int filled=0;
            while(filled<complete.length){int count=input.read(complete,filled,complete.length-filled);if(count<0)throw new IOException("表格内容分段不完整。");filled+=count;}
            if(input.read()!=-1)throw new IOException("表格内容完整长度不符。");
            return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(complete)).toString();
        }
        // The small allocation budget is never a content quota. Larger values
        // retain the complete strict streaming decoder without truncation.
        try(Reader input=new InputStreamReader(source,StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT))){StringBuilder text=new StringBuilder();char[] part=new char[32768];int n;while((n=input.read(part))!=-1)text.append(part,0,n);return text.toString();}
    }
    private static byte[] seedMetadata(SQLiteDatabase db,String id,long size,byte[] first)throws Exception{
        if(size<0||first==null||first.length!=Math.min(size,(long)LogbookLimits.TRANSFER_CHUNK_BYTES))throw new IOException("表格原记录元数据首段不完整。");
        if(first.length==size)return first;
        ByteArrayOutputStream output=new ByteArrayOutputStream();output.write(first);long offset=first.length;
        while(offset<size){
            try(Cursor row=db.rawQuery("SELECT length(CAST(metadata AS BLOB)),substr(CAST(metadata AS BLOB),?,?) FROM indexed_records WHERE id=?",new String[]{Long.toString(offset+1),Integer.toString(LogbookLimits.TRANSFER_CHUNK_BYTES),id})){
                if(!row.moveToFirst()||row.isNull(0)||row.isNull(1)||row.getLong(0)!=size)throw new IOException("表格原记录元数据缺失或长度已变化。");
                byte[] part=row.getBlob(1);if(part.length!=Math.min(size-offset,(long)LogbookLimits.TRANSFER_CHUNK_BYTES))throw new IOException("表格原记录元数据后续分段不完整。");
                output.write(part);offset+=part.length;
            }
        }
        return output.toByteArray();
    }
    private JSONObject value(String table,String id)throws Exception{Long ref=reference(table,"value","id=?",new String[]{id});if(ref==null)throw new IOException("表格暂存实体缺失。");return new JSONObject(contentText(ref));}
    /** Both record readers consume this complete representation through a
     * strict UTF-8 decoder to EOF. A reference and inline bytes never coexist. */
    private InputStream recordMetadataContent(Cursor row,int column)throws Exception{
        if(!row.isNull(column+2)){
            if(!row.isNull(column)||row.isNull(column+1)||row.getType(column+1)!=Cursor.FIELD_TYPE_INTEGER||row.getType(column+2)!=Cursor.FIELD_TYPE_BLOB)throw new IOException("表格场次元数据表示混合或不完整。");
            long bytes=row.getLong(column+1);byte[] complete=row.getBlob(column+2);
            if(bytes<1||bytes>65536||complete.length!=bytes)throw new IOException("表格场次元数据完整长度无效。");
            return new ByteArrayInputStream(complete);
        }
        if(row.isNull(column)||!row.isNull(column+1)||row.getType(column)!=Cursor.FIELD_TYPE_INTEGER)throw new IOException("表格场次元数据引用不完整。");
        return content(row.getLong(column));
    }
    private JSONObject recordValue(String id)throws Exception{
        try(Cursor row=stage.rawQuery("SELECT value,bytes,resident FROM records WHERE id=?",new String[]{id})){
            if(!row.moveToFirst())throw new IOException("表格暂存实体缺失。");return new JSONObject(contentText(recordMetadataContent(row,0)));
        }
    }
    private void seed(LogbookDatabase database,JSONObject defaultSettings)throws Exception{
        SQLiteDatabase business=database.getReadableDatabase();Map<String,String> root=new IndexedSnapshot(business).rootFields();
        if(root.isEmpty()){BackupValidation.settings(defaultSettings);initialSettings=new JSONObject(defaultSettings.toString());}
        JSONArray modules=new JSONArray(root.containsKey("modules")?root.get("modules"):"[]"),characters=new JSONArray(root.containsKey("characters")?root.get("characters"):"[]");
        for(int i=0;i<modules.length();i++){JSONObject row=modules.getJSONObject(i);execute("INSERT INTO modules(id,name,ordinal,value) VALUES(?,?,?,?)",row.getString("id"),row.getString("name"),i,storeText(row.toString()));}
        for(int i=0;i<characters.length();i++){JSONObject row=characters.getJSONObject(i);execute("INSERT INTO characters VALUES(?,?,?)",row.getString("id"),i,storeText(row.toString()));}
        try(Cursor rows=business.rawQuery("SELECT id,ordinal,COALESCE((SELECT SUM(bytes) FROM indexed_bodies WHERE record_key=indexed_records.row_key AND kind='rawContent'),0),length(CAST(metadata AS BLOB)),substr(CAST(metadata AS BLOB),1,"+LogbookLimits.TRANSFER_CHUNK_BYTES+") FROM indexed_records ORDER BY ordinal,row_key",null)){
            while(rows.moveToNext()){
                if(rows.isNull(3))throw new IOException("表格原记录元数据长度缺失。");
                byte[] metadata=seedMetadata(business,rows.getString(0),rows.getLong(3),rows.isNull(4)?null:rows.getBlob(4));
                JSONObject row=new JSONObject(StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(metadata)).toString());
                insertRecord(row,rows.getLong(1),null,true,false,Math.max(0,rows.getLong(2)));
            }
        }
        stage.execSQL("UPDATE modules SET count=(SELECT COUNT(*) FROM records WHERE module_id=modules.id)");
    }
    private long scalar(String sql,String...args)throws Exception{
        SQLiteStatement query=statement(sql);try{for(int i=0;i<args.length;i++)query.bindString(i+1,args[i]);return query.simpleQueryForLong();}
        catch(android.database.sqlite.SQLiteDoneException error){throw new IOException("表格索引读取失败。",error);}finally{query.clearBindings();}
    }
    private void notice(String type,String text)throws Exception{
        long index=type.equals("names")?namesCount++:warningsCount++,bytes=JsonFields.bytes(text);
        if(bytes>0&&bytes<=65536){
            // Exactly the same two live capacity checks as storeText's small
            // complete representation; only its separate blob INSERT is saved.
            StorageBudget.require(available,StorageBudget.estimate(bytes,3));byte[] complete=text.getBytes(StandardCharsets.UTF_8);
            if(complete.length!=bytes)throw new IOException("表格预览UTF-8计量不符。");StorageBudget.require(available,StorageBudget.estimate(complete.length,3));
            SQLiteStatement query=statement("INSERT INTO preview(kind,position,bytes,resident) VALUES(?,?,?,?)");
            try{query.bindString(1,type);query.bindLong(2,index);query.bindLong(3,bytes);query.bindBlob(4,complete);query.executeInsert();}finally{query.clearBindings();}
        }else{
            long ref=storeText(text,bytes);SQLiteStatement query=statement("INSERT INTO preview(kind,position,value) VALUES(?,?,?)");
            try{query.bindString(1,type);query.bindLong(2,index);query.bindLong(3,ref);query.executeInsert();}finally{query.clearBindings();}
        }
    }
    private static String text(JSONObject row,String key)throws Exception{Object value=row.get(key);if(!(value instanceof String))throw new IOException("表格文本类型无效。");return (String)value;}
    private static boolean space(char value){return value>=9&&value<=13||value==' '||value=='\u00a0'||value=='\u1680'||value>='\u2000'&&value<='\u200a'||value=='\u2028'||value=='\u2029'||value=='\u202f'||value=='\u205f'||value=='\u3000'||value=='\ufeff';}
    private static String trim(String value){int start=0,end=value.length();while(start<end&&space(value.charAt(start)))start++;while(end>start&&space(value.charAt(end-1)))end--;return value.substring(start,end);}
    private static void url(String value)throws Exception{
        java.net.URI uri=new java.net.URI(trim(value));String scheme=uri.getScheme()==null?"":uri.getScheme().toLowerCase(Locale.ROOT);boolean key=false;
        if(uri.getRawQuery()!=null)for(String part:uri.getRawQuery().split("&")){String[] pair=part.split("=",2);if(java.net.URLDecoder.decode(pair[0],"UTF-8").equals("key")){key=pair.length==2&&!trim(java.net.URLDecoder.decode(pair[1],"UTF-8")).isEmpty();break;}}
        boolean defaultPort=uri.getPort()==-1||scheme.equals("https")&&uri.getPort()==443||scheme.equals("http")&&uri.getPort()==80;
        if(!Arrays.asList("http","https").contains(scheme)||!"log.weizaima.com".equalsIgnoreCase(uri.getHost())||uri.getRawUserInfo()!=null&&!uri.getRawUserInfo().isEmpty()||!defaultPort||!key)throw new IOException("请输入包含 key 参数的完整海豹日志网址。");
        if(uri.getRawFragment()!=null){String fragment=uri.getRawFragment();for(int start=0;start<fragment.length();){if(fragment.charAt(start)!='%'){start++;continue;}ByteArrayOutputStream bytes=new ByteArrayOutputStream();while(start<fragment.length()&&fragment.charAt(start)=='%'){if(start+2>=fragment.length())throw new IOException("链接密码转义无效。");bytes.write(Integer.parseInt(fragment.substring(start+1,start+3),16));start+=3;}StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes.toByteArray()));}}
    }
    private String participantKey(JSONObject pair)throws Exception{
        BackupValidation.shape(pair,"pc,pl","characterId");String pc=text(pair,"pc"),pl=text(pair,"pl");
        if(pair.has("characterId")){String id=text(pair,"characterId");if(!id.isEmpty()&&scalar("SELECT COUNT(*) FROM characters WHERE id=?",id)!=1)throw new IOException("角色关联失效。");}
        return pc.isEmpty()&&pl.isEmpty()?null:pc+'\0'+pl;
    }
    private boolean loadParticipants(JSONObject module)throws Exception{
        currentKps=new LinkedHashSet<>();currentPairs=new LinkedHashMap<>();boolean changed=false;
        JSONArray names=module.getJSONArray("kps"),pairs=module.getJSONArray("pairs");
        for(int i=0;i<names.length();i++){
            Object raw=names.get(i);if(!(raw instanceof String))throw new IOException("参与者名单类型无效。");String name=trim((String)raw);
            if(!name.equals(raw))changed=true;if(name.isEmpty()||!currentKps.add(name))changed=true;
        }
        for(int i=0;i<pairs.length();i++){
            JSONObject pair=pairs.getJSONObject(i);String key=participantKey(pair);
            if(key==null||currentPairs.putIfAbsent(key,pair)!=null)changed=true;
        }
        return changed;
    }
    private boolean mergeParticipants(JSONArray names,JSONArray pairs)throws Exception{
        boolean changed=false;
        for(int i=0;i<names.length();i++){
            Object raw=names.get(i);if(!(raw instanceof String))throw new IOException("参与者名单类型无效。");String name=trim((String)raw);
            if(!name.isEmpty()&&currentKps.add(name))changed=true;
        }
        for(int i=0;i<pairs.length();i++){
            // Validate before empty/duplicate elimination: a discarded pair
            // still has to satisfy its complete shape and live association.
            JSONObject pair=pairs.getJSONObject(i);String key=participantKey(pair);
            if(key!=null&&currentPairs.putIfAbsent(key,pair)==null)changed=true;
        }
        return changed;
    }
    private void row(JSONObject input)throws Exception{
        long rowPhase=System.nanoTime();
        BackupValidation.shape(input,"sheet,moduleName,sessionName,link,kps,pairs","manualContent,playStatus,status,playDate,fetchedAt");
        for(String key:new String[]{"sheet","moduleName","sessionName","link","manualContent","playStatus","status","playDate","fetchedAt"})if(input.has(key))text(input,key);
        String moduleName=input.getString("moduleName"),session=input.getString("sessionName"),link=input.getString("link");if(trim(moduleName).isEmpty())throw new IOException("表格缺少模组名。");if(!link.isEmpty())url(link);
        if(input.has("playStatus")&&!Arrays.asList("not_started","running","finished").contains(input.getString("playStatus")))throw new IOException("跑团状态无效。");
        if(input.has("status")&&!Arrays.asList("pending","valid","fetch_failed","manual").contains(input.getString("status")))throw new IOException("链接状态无效。");
        // Dates preserve the legacy table text semantics, including Chinese and slash notation.
        boolean participantsChanged=false;
        if(currentModule==null||!moduleName.equals(currentModuleName)){
            flushModuleCount();
            String foundID=null;try(Cursor match=stage.rawQuery("SELECT id FROM modules WHERE name=? ORDER BY ordinal LIMIT 1",new String[]{moduleName})){if(match.moveToFirst())foundID=match.getString(0);}
            JSONObject found;
            if(foundID==null){foundID=UUID.randomUUID().toString();long order=scalar("SELECT COUNT(*) FROM modules");found=new JSONObject().put("id",foundID).put("name",moduleName).put("playStatus",input.optString("playStatus","not_started")).put("kps",new JSONArray()).put("pairs",new JSONArray()).put("order",order).put("collapsed",false).put("createdAt",now).put("updatedAt",now);execute("INSERT INTO modules(id,name,ordinal,value) VALUES(?,?,?,?)",foundID,moduleName,order,storeText(found.toString()));}else found=value("modules",foundID);
            currentModuleName=moduleName;currentModuleID=foundID;currentModule=found;currentModuleCount=scalar("SELECT count FROM modules WHERE id=?",foundID);
            participantsChanged=loadParticipants(found);
        }
        String moduleID=currentModuleID;JSONObject module=currentModule;
        // Every supplied participant is checked before duplicate-link lookup.
        // The old list is validated on this module's load; character rows
        // cannot change inside a record-table preview. No cache crosses owners.
        participantsChanged|=mergeParticipants(input.getJSONArray("kps"),input.getJSONArray("pairs"));
        if(participantsChanged){module.put("kps",new JSONArray(currentKps));module.put("pairs",new JSONArray(currentPairs.values()));replaceText("modules",moduleID,"value",module.toString());}
        addTiming("rowValidationModuleMs",rowPhase);rowPhase=System.nanoTime();
        String manual=input.optString("manualContent","");boolean hasManual=!trim(manual).isEmpty();List<String> matches=new ArrayList<>();
        if(hasManual){String sql="SELECT id FROM records WHERE module_id=? AND source='manual' AND name=?"+(link.isEmpty()?"":" AND link=?")+" LIMIT 2";try(Cursor found=stage.rawQuery(sql,link.isEmpty()?new String[]{moduleID,session}:new String[]{moduleID,session,link})){while(found.moveToNext())matches.add(found.getString(0));}}
        if(matches.size()==1){String id=matches.get(0);JSONObject record=recordValue(id);record.put("updatedAt",now);if(input.has("playDate")&&!input.getString("playDate").isEmpty()){record.put("playDate",input.getString("playDate"));record.put("dateSource","manual");}RecordText encoded=validateCombined(record,manual,-1);replaceRecordMetadata(id,encoded);replaceText("records",id,"manual",encoded.manual,encoded.manualBytes);execute("UPDATE records SET changed=1 WHERE id=?",id);updated++;notice("names",moduleName+" / "+record.getString("name"));notice("warnings",record.getString("name")+"：将更新已有同名手动场次正文，确认后生效。");return;}
        if(!link.isEmpty()&&scalar("SELECT COUNT(*) FROM records WHERE module_id=? AND link=?",moduleID,link)>0){skipped++;notice("warnings",session+"：来源已存在，已跳过。");return;}
        long count=currentModuleCount,ordinal=nextRecordOrdinal;
        JSONObject record=new JSONObject().put("id",UUID.randomUUID().toString()).put("moduleId",moduleID).put("name",session.isEmpty()?"第"+(count+1)+"场":session).put("sequenceNo",count+1).put("sourceType",!link.isEmpty()&&!hasManual?"online":"manual").put("status",!link.isEmpty()&&!hasManual?"pending":"manual").put("dateSource",input.has("playDate")&&!input.getString("playDate").isEmpty()?"manual":"none").put("order",count).put("createdAt",now).put("updatedAt",now);
        if(!link.isEmpty())record.put("link",link);if(input.has("playDate")&&!input.getString("playDate").isEmpty())record.put("playDate",input.getString("playDate"));String body=hasManual?manual:link.isEmpty()?"":null;
        addTiming("rowLookupBuildMs",rowPhase);rowPhase=System.nanoTime();
        // This UUID is generated here for a new INSERT, so it has no retained
        // raw body. A collision still fails the records primary-key INSERT.
        RecordText encoded=validateCombined(record,body,0);addTiming("rowRecordValidationMs",rowPhase);rowPhase=System.nanoTime();
        insertEncodedRecord(record,ordinal,encoded,false,true,0);currentModuleCount=Math.addExact(count,1);currentModuleCountDirty=true;nextRecordOrdinal=Math.addExact(ordinal,1);added++;
        addTiming("rowInsertMs",rowPhase);rowPhase=System.nanoTime();notice("names",moduleName+" / "+record.getString("name"));addTiming("rowNoticeMs",rowPhase);
    }
    private void addTiming(String name,long start)throws Exception{if(operationTiming!=null)operationTiming.put(name,operationTiming.optDouble(name,0)+(System.nanoTime()-start)/1000000.0);}
    private void flushModuleCount()throws Exception{
        if(currentModuleCountDirty){execute("UPDATE modules SET count=? WHERE id=?",currentModuleCount,currentModuleID);currentModuleCountDirty=false;}
    }
    /** Exact immutable serialization is shared only within one validated row;
     * there is no cross-row cache or caller-provided byte count. */
    private static final class RecordText {
        final String metadata,manual;final long metadataBytes,manualBytes;
        RecordText(JSONObject record,String body){metadata=record.toString();manual=body==null?null:JSONObject.quote(body);metadataBytes=JsonFields.bytes(metadata);manualBytes=manual==null?0:JsonFields.bytes(manual);}
    }
    private RecordText validateCombined(JSONObject record,String manual,long retainedRawBytes)throws Exception{
        BackupValidation.record(record);RecordText encoded=new RecordText(record,manual);long bytes=encoded.metadataBytes+(manual==null?0:17+encoded.manualBytes);
        if(retainedRawBytes<0)try(Cursor row=stage.rawQuery("SELECT raw_bytes FROM records WHERE id=?",new String[]{record.getString("id")})){retainedRawBytes=row.moveToFirst()?row.getLong(0):0;}
        if(retainedRawBytes>0)bytes=Math.addExact(bytes,Math.addExact(14,retainedRawBytes));StorageBudget.require(available,StorageBudget.estimate(bytes,4));
        return encoded;
    }
    private byte[] inlineRecordMetadata(RecordText encoded)throws Exception{
        if(encoded.metadataBytes<1||encoded.metadataBytes>65536)return null;
        // Keep storeText's two exact live checks in their original order.
        // Only the separate blob INSERT is removed; no space is reserved.
        StorageBudget.require(available,StorageBudget.estimate(encoded.metadataBytes,3));byte[] complete=encoded.metadata.getBytes(StandardCharsets.UTF_8);
        if(complete.length!=encoded.metadataBytes)throw new IOException("表格文本UTF-8计量不符。");StorageBudget.require(available,StorageBudget.estimate(complete.length,3));return complete;
    }
    private void replaceRecordMetadata(String id,RecordText encoded)throws Exception{
        Long previous=reference("records","value","id=?",new String[]{id});byte[] resident=inlineRecordMetadata(encoded);Long value=resident==null?storeText(encoded.metadata,encoded.metadataBytes):null;
        execute("UPDATE records SET value=?,bytes=?,resident=? WHERE id=?",value,resident==null?null:encoded.metadataBytes,resident,id);
        if(previous!=null){execute("DELETE FROM blob_chunks WHERE owner=?",previous);execute("DELETE FROM blobs WHERE id=?",previous);}
    }
    private void insertRecord(JSONObject row,long ordinal,String manual,boolean original,boolean changed,long rawBytes)throws Exception{insertEncodedRecord(row,ordinal,new RecordText(row,manual),original,changed,rawBytes);}
    private void insertEncodedRecord(JSONObject row,long ordinal,RecordText encoded,boolean original,boolean changed,long rawBytes)throws Exception{
        byte[] resident=inlineRecordMetadata(encoded);Long value=resident==null?storeText(encoded.metadata,encoded.metadataBytes):null;Long manual=encoded.manual==null?null:storeText(encoded.manual,encoded.manualBytes);
        SQLiteStatement query=statement("INSERT INTO records(id,module_id,name,link,source,ordinal,value,manual,original,changed,raw_bytes,bytes,resident) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)");
        try{
            query.bindString(1,row.getString("id"));query.bindString(2,row.getString("moduleId"));query.bindString(3,row.getString("name"));query.bindString(4,row.optString("link"));query.bindString(5,row.getString("sourceType"));query.bindLong(6,ordinal);if(value==null)query.bindNull(7);else query.bindLong(7,value);
            if(manual==null)query.bindNull(8);else query.bindLong(8,manual);query.bindLong(9,original?1:0);query.bindLong(10,changed?1:0);query.bindLong(11,rawBytes);if(resident==null){query.bindNull(12);query.bindNull(13);}else{query.bindLong(12,encoded.metadataBytes);query.bindBlob(13,resident);}query.executeInsert();
        }finally{query.clearBindings();}
    }
    private void character(JSONObject value)throws Exception{Set<String> modules=new HashSet<>();try(Cursor rows=stage.rawQuery("SELECT id FROM modules",null)){while(rows.moveToNext())modules.add(rows.getString(0));}BackupValidation.character(value,modules);String id=value.getString("id");if(id.isEmpty()||scalar("SELECT COUNT(*) FROM characters WHERE id=?",id)!=0)throw new IOException("角色标识重复或缺失。");String encoded=value.toString();long bytes=JsonFields.bytes(encoded);StorageBudget.require(available,StorageBudget.estimate(bytes,4));execute("INSERT INTO characters VALUES(?,?,?)",id,scalar("SELECT COUNT(*) FROM characters"),storeText(encoded,bytes));added++;notice("names",value.getJSONObject("basic").getString("name"));}
    JSONObject preview(LogbookDatabase database,BackupSession.Proof proof,JSONObject defaultSettings)throws Exception{
        return preview(database,proof,defaultSettings,false);
    }
    private void applyCandidate(JSONObject wrapper,boolean record)throws Exception{
        JSONObject entry=wrapper.getJSONObject("value");
        if(record)row(entry);
        else{character(entry);JSONArray warnings=wrapper.optJSONArray("warnings");if(warnings!=null)for(int i=0;i<warnings.length();i++)notice("warnings",warnings.getString(i));}
    }
    JSONObject preview(LogbookDatabase database,BackupSession.Proof proof,JSONObject defaultSettings,boolean measure)throws Exception{
        require(id);
        JSONObject timing=measure?new JSONObject():null;long phase=System.nanoTime();
        operationTiming=timing;capacityNanos=0;capacityCalls=0;
        if(memorySnapshot!=null)throw new IOException("只读角色卡快照不能用于提交预览。");
        if(ready||closed||database.revision()!=revision)throw new IOException("表格预览版本已变化。");stringLines.finish();for(Spool value:spools.values())value.seal();Spool candidate=spools.get("candidate");if(candidate==null)throw new IOException("没有可新增的有效数据。");
        BackupSession.fileProof(source,sourceProof.bytes).matches(sourceProof.bytes,sourceProof.sha256);BackupSession.fileProof(candidate.file,proof.bytes).matches(proof.bytes,proof.sha256);candidateProof=proof;
        if(timing!=null)timing.put("sealProofMs",(System.nanoTime()-phase)/1000000.0);phase=System.nanoTime();
        ensureIndex();if(now==null)now=java.time.Instant.now().toString();
        stage.beginTransaction();try{
            if(!seedPrepared){seed(database,defaultSettings);nextRecordOrdinal=scalar("SELECT COALESCE(MAX(ordinal),-1)+1 FROM records");}
            if(timing!=null)timing.put("seedMs",(System.nanoTime()-phase)/1000000.0);phase=System.nanoTime();
            // Resource budget only: larger complete candidates retain the
            // disk ordering path. The resident map never leaves this preview,
            // and is filled only after the full sealed-file proof succeeded.
            final SortedMap<long[],JSONObject> resident=proof.bytes<=2L*1024*1024?new TreeMap<>((a,b)->{int sheet=Long.compare(a[0],b[0]);return sheet!=0?sheet:Long.compare(a[1],b[1]);}):null;
            if(timing!=null)timing.put("residentCandidate",resident==null?0:1);
            Lines lines=new Lines();try(InputStream input=new FileInputStream(candidate.file)){byte[] buffer=new byte[65536];int n;while((n=input.read(buffer))!=-1)lines.appendWithProof(buffer,0,n,(value,byteLength)->{
                if(value.length()<2||value.charAt(0)!=(kind.equals("record-table")?'T':'C'))throw new IOException("表格候选用途不符。");String json=value.substring(1);JSONObject wrapper=StrictTableJson.parseObject(json);BackupValidation.shape(wrapper,"sheetOrder,rowOrder,value",kind.equals("character-table")?"warnings":"");long sheet=integer(wrapper.get("sheetOrder")),row=integer(wrapper.get("rowOrder"));wrapper.getJSONObject("value");if(wrapper.has("warnings")){JSONArray warnings=wrapper.getJSONArray("warnings");for(int i=0;i<warnings.length();i++)if(!(warnings.get(i) instanceof String))throw new IOException("角色提醒类型无效。");}
                // Strict UTF-8 decoding above preserves every raw JSON byte.
                // Only the already-checked ASCII purpose prefix is excluded;
                // keep the same live capacity check after ALL line validation.
                StorageBudget.require(available,StorageBudget.estimate(byteLength-1,4));
                if(resident!=null){if(resident.put(new long[]{sheet,row},wrapper)!=null)throw new IOException("表格候选坐标重复。");}
                else execute("INSERT INTO incoming VALUES(?,?,?,?)",sheet,row,value.substring(0,1),storeText(json));
            });}lines.finish();
            if(timing!=null)timing.put("candidateIndexMs",(System.nanoTime()-phase)/1000000.0);phase=System.nanoTime();
            if(resident!=null){for(JSONObject wrapper:resident.values())applyCandidate(wrapper,kind.equals("record-table"));resident.clear();}
            else try(Cursor rows=stage.rawQuery("SELECT value,kind FROM incoming ORDER BY sheet,row",null)){
                while(rows.moveToNext())applyCandidate(new JSONObject(contentText(rows.getLong(0))),rows.getString(1).equals("T"));
            }
            flushModuleCount();
            if(timing!=null)timing.put("applyRowsMs",(System.nanoTime()-phase)/1000000.0);phase=System.nanoTime();
            if(namesCount==0)throw new IOException("没有可新增的有效数据。");if(database.revision()!=revision)throw new IOException("表格预览版本已变化。");stage.setTransactionSuccessful();ready=true;
        }catch(OutOfMemoryError error){throw new IOException("当前运行内存不足以完整预览表格；原数据未改变。",error);}
        finally{currentModule=null;currentModuleName=null;currentModuleID=null;currentKps=null;currentPairs=null;currentModuleCountDirty=false;stage.endTransaction();}
        closeStatements();stage.close();stage=null;File frozen=new File(directory,"stage.sqlite");previewDatabaseProof=BackupSession.fileProof(frozen,frozen.length());
        stage=SQLiteDatabase.openDatabase(frozen.getAbsolutePath(),null,SQLiteDatabase.OPEN_READONLY|SQLiteDatabase.NO_LOCALIZED_COLLATORS);
        if(timing!=null)timing.put("freezeProofMs",(System.nanoTime()-phase)/1000000.0);phase=System.nanoTime();
        JSONObject result=new JSONObject().put("id",id).put("revision",revision).put("added",added).put("updated",updated).put("skipped",skipped).put("namesCount",namesCount).put("warningsCount",warningsCount).put("names",page("names",0,100).getJSONArray("values")).put("warnings",page("warnings",0,100).getJSONArray("values"));
        if(timing!=null){timing.put("previewPageMs",(System.nanoTime()-phase)/1000000.0);timing.put("capacityMs",capacityNanos/1000000.0).put("capacityCalls",capacityCalls);timing.put("preparedSeed",seedPrepared).put("preparedSeedMs",preparationNanos/1000000.0).put("preparedCapacityMs",preparationCapacityNanos/1000000.0).put("preparedCapacityCalls",preparationCapacityCalls);result.put("timing",timing);}operationTiming=null;return result;
    }
    JSONObject page(String kind,long offset,int limit)throws Exception{
        if(!ready||closed||!Arrays.asList("names","warnings").contains(kind)||offset<0)throw new IOException("表格预览页无效。");
        JSONArray values=new JSONArray();long total=kind.equals("names")?namesCount:warningsCount;int count=Math.max(1,Math.min(100,limit));
        // Apply LIMIT to names, never to their chunks. One huge name still has
        // every byte validated and decoded before moving to the next name.
        String sql="SELECT p.position,p.value,p.bytes,p.resident,"+joinedBlobColumns()+" FROM (SELECT position,value,bytes,resident FROM preview WHERE kind=? AND position>=? ORDER BY position LIMIT ?) p LEFT JOIN blobs b ON b.id=p.value LEFT JOIN blob_chunks c ON c.owner=b.id ORDER BY p.position,c.position";
        CharsetDecoder decoder=null;
        try(Cursor rows=stage.rawQuery(sql,new String[]{kind,Long.toString(offset),Integer.toString(count)})){
            rows.moveToFirst();while(!rows.isAfterLast()){
                if(rows.getLong(0)!=offset+values.length())throw new IOException("表格预览条目缺失或乱序。");
                if(!rows.isNull(3)){
                    if(!rows.isNull(1)||rows.isNull(2))throw new IOException("表格预览包含混合或不完整表示。");long bytes=rows.getLong(2);byte[] complete=rows.getBlob(3);
                    if(bytes<1||bytes>65536||complete.length!=bytes)throw new IOException("表格预览完整长度无效。");
                    if(decoder==null)decoder=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT);
                    ByteBuffer input=ByteBuffer.wrap(complete);String text=decoder.reset().decode(input).toString();if(input.hasRemaining())throw new IOException("表格预览完整字节未取齐。");values.put(text);rows.moveToNext();
                }else{
                    if(rows.isNull(1)||!rows.isNull(2))throw new IOException("表格预览引用或完整表示无效。");
                    values.put(contentText(new JoinedContent(rows,4,0,false)));
                }
            }
        }
        if(values.length()!=Math.min((long)count,Math.max(0,total-offset)))throw new IOException("表格预览条目不完整。");
        return new JSONObject().put("values",values).put("total",total);
    }
    void prepareCommit()throws Exception{
        if(!ready||closed||detached)throw new IOException("表格尚未预览或已提交。");
        BackupSession.fileProof(source,sourceProof.bytes).matches(sourceProof.bytes,sourceProof.sha256);File candidate=spools.get("candidate").file;BackupSession.fileProof(candidate,candidateProof.bytes).matches(candidateProof.bytes,candidateProof.sha256);
        StorageBudget.require(available,StorageBudget.estimate(candidateProof.bytes,4));File file=new File(directory,"stage.sqlite");
        if(previewDatabaseProof==null)throw new IOException("表格预览摘要缺失。");BackupSession.fileProof(file,previewDatabaseProof.bytes).matches(previewDatabaseProof.bytes,previewDatabaseProof.sha256);
        try(Cursor check=stage.rawQuery("PRAGMA quick_check",null)){if(!check.moveToFirst()||!"ok".equals(check.getString(0))||check.moveToNext())throw new IOException("表格暂存读取失败。");}
        File transfer=new File(directory,"apply.part");if(!transfer.createNewFile())throw new IOException("表格提交暂存已存在。");
        writeCommit(transfer);commitProof=BackupSession.fileProof(transfer,transfer.length());commitInput=new FileInputStream(transfer);
        BackupSession.streamProof(commitInput,commitProof.bytes).matches(commitProof.bytes,commitProof.sha256);commitInput.getChannel().position(0);
        closeStatements();stage.close();stage=null;
        BackupSession.fileProof(file,previewDatabaseProof.bytes).matches(previewDatabaseProof.bytes,previewDatabaseProof.sha256);
        deleteOwned(directory,id);detached=true;
    }
    private void copyContent(long ref,Writer output)throws Exception{
        try(Reader input=new InputStreamReader(content(ref),StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT))){char[] buffer=new char[32768];int count;while((count=input.read(buffer))!=-1)output.write(buffer,0,count);}
    }
    /** Close SQLite before unlinking its pathname. Commit only reads an ordinary
     * already-open file descriptor, like the existing native fetch/restore paths. */
    private void writeCommit(File file)throws Exception{
        commitRecords=scalar("SELECT COUNT(*) FROM records WHERE changed=1");
        try(FileOutputStream raw=new FileOutputStream(file)){
            OutputStream bounded=new FilterOutputStream(raw){
                public void write(byte[] bytes,int offset,int count)throws IOException{try{StorageBudget.require(available,count);}catch(Exception error){throw new IOException("表格提交暂存空间不足。",error);}out.write(bytes,offset,count);}
                public void write(int value)throws IOException{write(new byte[]{(byte)value},0,1);}
            };
            Writer output=new BufferedWriter(new OutputStreamWriter(bounded,StandardCharsets.UTF_8),32768);
            output.write('{');
            if(initialSettings!=null)output.write("\"schemaVersion\":2,\"settings\":"+initialSettings+",");
            output.write("\"records\":[");boolean comma=false;
            try(Cursor rows=stage.rawQuery("SELECT ordinal,original,value,bytes,resident,manual FROM records WHERE changed=1 ORDER BY ordinal",null)){
                while(rows.moveToNext()){
                    if(comma)output.write(',');comma=true;
                    output.write("{\"ordinal\":"+rows.getLong(0)+",\"added\":"+(rows.getInt(1)==0)+",\"value\":");
                    try(Reader input=new InputStreamReader(recordMetadataContent(rows,2),StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT))){char[] part=new char[32768];int count;while((count=input.read(part))!=-1)output.write(part,0,count);}
                    if(!rows.isNull(5)){output.write(",\"manual\":");copyContent(rows.getLong(5),output);}output.write('}');
                }
            }
            output.write(']');
            for(String table:new String[]{"modules","characters"}){
                output.write(",\""+table+"\":[");comma=false;
                try(Cursor rows=stage.rawQuery("SELECT value FROM "+table+" ORDER BY ordinal",null)){while(rows.moveToNext()){if(comma)output.write(',');comma=true;copyContent(rows.getLong(0),output);}}
                output.write(']');
            }
            output.write(",\"exportedAt\":"+JSONObject.quote(now)+"}");output.flush();raw.getFD().sync();
        }
    }
    void apply(IndexedSnapshot destination)throws Exception{
        if(!ready||!detached||closed||stage!=null||commitInput==null||commitProof==null)throw new IOException("表格候选未封存。");
        commitInput.getChannel().position(0);MessageDigest digest=MessageDigest.getInstance("SHA-256");long[] bytes={0},count={0};
        InputStream checked=new FilterInputStream(commitInput){
            public int read(byte[] buffer,int offset,int length)throws IOException{int n=in.read(buffer,offset,length);if(n>0){bytes[0]=Math.addExact(bytes[0],n);if(bytes[0]>commitProof.bytes)throw new IOException("表格提交暂存长度已变化。");digest.update(buffer,offset,n);}return n;}
            public int read()throws IOException{byte[] one=new byte[1];return read(one,0,1)<0?-1:one[0]&255;}
        };
        RawJson input=new RawJson(new InputStreamReader(checked,StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)));Set<String> seen=new HashSet<>();
        Set<String> expected=new HashSet<>(Arrays.asList("records","modules","characters","exportedAt"));if(initialSettings!=null){expected.add("schemaVersion");expected.add("settings");}
        input.object((name,value)->{
            if(!expected.contains(name)||!seen.add(name))throw new IOException("表格提交字段重复或无效。");
            if(!name.equals("records")){destination.tableField(name,value.take());return;}
            value.array(record->{
                Long[] ordinal={null};Boolean[] added={null};JSONObject[] metadata={null};boolean[] applied={false};Set<String> fields=new HashSet<>();
                record.object((field,part)->{
                    if(!fields.add(field))throw new IOException("表格提交场次字段重复。");
                    if(field.equals("ordinal"))ordinal[0]=integer(new JSONArray("["+part.take()+"]").get(0));
                    else if(field.equals("added")){Object flag=new JSONArray("["+part.take()+"]").get(0);if(!(flag instanceof Boolean))throw new IOException("表格提交场次类型无效。");added[0]=(Boolean)flag;}
                    else if(field.equals("value"))metadata[0]=new JSONObject(part.take());
                    else if(field.equals("manual")){if(ordinal[0]==null||added[0]==null||metadata[0]==null)throw new IOException("表格提交正文顺序无效。");destination.tableRecord(metadata[0],ordinal[0],added[0],part);applied[0]=true;}
                    else throw new IOException("表格提交场次字段无效。");
                });
                if(ordinal[0]==null||added[0]==null||metadata[0]==null)throw new IOException("表格提交场次不完整。");
                if(!applied[0])destination.tableRecord(metadata[0],ordinal[0],added[0],null);count[0]++;
            });
        });input.end();StringBuilder hash=new StringBuilder();for(byte b:digest.digest())hash.append(String.format("%02x",b&255));
        commitProof.matches(bytes[0],hash.toString());if(!seen.equals(expected)||count[0]!=commitRecords)throw new IOException("表格提交场次未取齐。");
    }
    private static void cleanupStale(File root)throws Exception{File[] children=root.listFiles();if(children==null)throw new IOException("无法检查表格私有暂存。");for(File child:children)if(child.getName().matches("coc-table-[a-f0-9-]{36}")){String id=child.getName().substring(10);File marker=new File(child,"owner");if(marker.isFile()&&marker.length()==36){String value=new String(java.nio.file.Files.readAllBytes(marker.toPath()),StandardCharsets.UTF_8);if(value.equals(id))deleteOwned(child,id);}}}
    private static void deleteOwned(File directory,String id)throws Exception{deleteOwned(directory,id,false);}
    private static void deleteOwned(File directory,String id,boolean initializationFailed)throws Exception{
        if(!directory.exists())return;File marker=new File(directory,"owner");if(!directory.getName().equals("coc-table-"+id)||!directory.getCanonicalFile().getParentFile().equals(directory.getParentFile().getCanonicalFile()))throw new IOException("表格暂存目录引用无效。");
        if(!marker.isFile()&&!initializationFailed||marker.exists()&&!new String(java.nio.file.Files.readAllBytes(marker.toPath()),StandardCharsets.UTF_8).equals(id))throw new IOException("表格暂存所有权标记已变化。");
        File[] files=directory.listFiles();if(files==null)throw new IOException("无法读取表格暂存目录。");for(File file:files)if(!FILES.contains(file.getName())||file.isDirectory()||!file.getCanonicalFile().getParentFile().equals(directory.getCanonicalFile()))throw new IOException("表格暂存存在未知文件，已保留。");
        for(File file:files)if(!file.getName().equals("owner")&&!file.delete())throw new IOException("表格暂存清理失败；未提交。");if(marker.exists()&&!marker.delete())throw new IOException("表格所有权标记清理失败；未提交。");if(!directory.delete())throw new IOException("表格暂存目录清理失败；未提交。");
    }
    public void close()throws Exception{if(closed)return;memorySnapshot=null;Exception failure=null;for(Spool spool:spools.values())try{spool.seal();}catch(Exception error){failure=error;}if(commitInput!=null)try{commitInput.close();commitInput=null;}catch(Exception error){failure=error;}if(stage!=null){try{closeStatements();stage.close();stage=null;}catch(Exception error){failure=error;}}try{if(!detached)deleteOwned(directory,id,!ownershipEstablished);}catch(Exception error){failure=error;}if(failure!=null)throw failure;closed=true;}
}
