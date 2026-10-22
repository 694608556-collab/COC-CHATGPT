package coc.logbook;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.*;
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
    private final Map<String,Spool> spools=new LinkedHashMap<>();
    private final Lines stringLines=new Lines();
    private BackupSession.Proof sourceProof,candidateProof,previewDatabaseProof;
    private long written,stringCount,added,updated,skipped,namesCount,warningsCount;
    private boolean ready,detached,closed,ownershipEstablished;
    private JSONObject initialSettings;
    private final String now=java.time.Instant.now().toString();
    private static final Set<String> FILES=new HashSet<>(Arrays.asList("owner","source.part","candidate.part","strings.part","stage.sqlite","stage.sqlite-journal","stage.sqlite-wal","stage.sqlite-shm"));
    private static final class Spool {
        final File file;FileOutputStream output;long bytes,index;
        Spool(File file)throws Exception{this.file=file;if(!file.createNewFile())throw new IOException("表格暂存已存在。");output=new FileOutputStream(file);}
        void seal()throws Exception{if(output!=null){output.flush();output.getFD().sync();output.close();output=null;}}
    }
    interface Line {void accept(String value)throws Exception;}
    private static final class Lines extends ByteArrayOutputStream {
        void append(byte[] input,int offset,int count,Line accept)throws Exception{
            int start=offset,end=offset+count;
            for(int i=offset;i<end;i++)if(input[i]==10){part(input,start,i-start);start=i+1;
                String value=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(buf,0,size())).toString();reset();accept.accept(value);
            }part(input,start,end-start);
        }
        private void part(byte[] input,int start,int length)throws Exception{if((long)size()+length>LogbookLimits.ENTITY_REQUEST_BYTES+4096)throw new IOException("单场或独立字段超过处理上限。");write(input,start,length);}
        void finish()throws Exception{if(size()!=0)throw new IOException("表格暂存末行不完整。");}
    }
    TableSession(File root,String tree,long revision,String kind,String name,StorageBudget.Available available)throws Exception{
        if(!Arrays.asList("record-table","character-table").contains(kind))throw new IOException("表格用途无效。");
        this.tree=tree;this.revision=revision;this.kind=kind;this.name=name;
        int dot=name.lastIndexOf('.');format=dot<0?"":name.substring(dot+1).toLowerCase(Locale.ROOT);
        if(!Arrays.asList("csv","xlsx","xls").contains(format))throw new IOException("仅支持 XLSX、XLS 或 CSV 文件。");
        if(!root.isDirectory()&&!root.mkdirs())throw new IOException("无法建立表格私有暂存。");
        cleanupStale(root);directory=new File(root,"coc-table-"+id);
        source=new File(directory,"source.part");this.available=available==null?StorageBudget.volume(root):available;
        maximumStageBytes=StorageBudget.maximum(this.available,6);
        if(!directory.mkdir())throw new IOException("表格暂存目录已存在。");
        try{
            try(FileOutputStream marker=new FileOutputStream(new File(directory,"owner"))){marker.write(id.getBytes(StandardCharsets.UTF_8));marker.getFD().sync();}
            ownershipEstablished=true;
            stage=SQLiteDatabase.openOrCreateDatabase(new File(directory,"stage.sqlite"),null);
            try(Cursor mode=stage.rawQuery("PRAGMA journal_mode=DELETE",null)){if(!mode.moveToFirst())throw new IOException("表格暂存日志配置失败。");}stage.execSQL("PRAGMA synchronous=FULL");
            stage.execSQL("CREATE TABLE strings(id INTEGER PRIMARY KEY,value BLOB NOT NULL)");
            stage.execSQL("CREATE TABLE incoming(sheet INTEGER NOT NULL,row INTEGER NOT NULL,kind TEXT NOT NULL,value BLOB NOT NULL,PRIMARY KEY(sheet,row))");
            stage.execSQL("CREATE TABLE modules(id TEXT PRIMARY KEY,name TEXT NOT NULL,ordinal INTEGER NOT NULL,value BLOB NOT NULL,count INTEGER NOT NULL DEFAULT 0)");
            stage.execSQL("CREATE INDEX module_name ON modules(name,ordinal)");
            stage.execSQL("CREATE TABLE characters(id TEXT PRIMARY KEY,ordinal INTEGER NOT NULL,value BLOB NOT NULL)");
            stage.execSQL("CREATE TABLE records(id TEXT PRIMARY KEY,module_id TEXT NOT NULL,name TEXT NOT NULL,link TEXT NOT NULL,source TEXT NOT NULL,ordinal INTEGER NOT NULL,value BLOB NOT NULL,manual BLOB,original INTEGER NOT NULL,changed INTEGER NOT NULL DEFAULT 0,raw_bytes INTEGER NOT NULL DEFAULT 0)");
            stage.execSQL("CREATE INDEX record_link ON records(module_id,link)");stage.execSQL("CREATE INDEX record_manual ON records(module_id,source,name,link)");
            stage.execSQL("CREATE INDEX record_order ON records(ordinal)");
            stage.execSQL("CREATE TABLE preview(kind TEXT NOT NULL,position INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(kind,position))");
        }catch(Exception error){try{close();}catch(Exception cleanup){error.addSuppressed(cleanup);}throw error;}
    }
    static long integer(Object value)throws Exception{if(!(value instanceof Number))throw new IOException("表格整数参数无效。");double number=((Number)value).doubleValue();if(!Double.isFinite(number)||number<0||number>StorageBudget.JS_SAFE_INTEGER||number!=Math.floor(number))throw new IOException("表格整数参数无效。");return (long)number;}
    void require(String token)throws Exception{if(closed||!id.equals(token))throw new IOException("表格预览已失效，请重新选择。");}
    BackupSession.Proof capture(InputStream input)throws Exception{
        if(input==null||sourceProof!=null||source.exists())throw new IOException("表格来源无效。");
        long total=0;byte[] buffer=new byte[65536];int n;
        try(FileOutputStream output=new FileOutputStream(source)){
            while((n=input.read(buffer))!=-1){total+=n;if(total>maximumStageBytes)throw new IOException("表格来源暂存空间不足。");StorageBudget.require(available,n);output.write(buffer,0,n);}
            output.getFD().sync();
        }
        sourceProof=BackupSession.fileProof(source,total);return sourceProof;
    }
    BackupSession.Proof sourceProof()throws Exception{if(sourceProof==null)throw new IOException("表格来源未封存。");return sourceProof;}
    void append(String key,long index,byte[] bytes)throws Exception{
        if(ready||closed||sourceProof==null||!Arrays.asList("candidate","strings").contains(key)||bytes.length==0||bytes.length>LogbookLimits.TRANSFER_CHUNK_BYTES)throw new IOException("表格暂存分段无效。");
        if(written+bytes.length>maximumStageBytes)throw new IOException("表格暂存所需空间不足。");
        StorageBudget.require(available,StorageBudget.estimate(bytes.length,3));
        Spool spool=spools.get(key);if(spool==null){spool=new Spool(new File(directory,key+".part"));spools.put(key,spool);}
        if(spool.output==null||spool.index!=index)throw new IOException("表格暂存分段乱序或已封存。");
        spool.output.write(bytes);spool.bytes+=bytes.length;spool.index++;written+=bytes.length;
        if(key.equals("strings")){
            stage.beginTransaction();try{stringLines.append(bytes,0,bytes.length,value->{
                StrictBackupJson.validate(value);JSONArray row=new JSONArray(value);if(row.length()!=2||integer(row.get(0))!=stringCount||!(row.get(1) instanceof String))throw new IOException("共享字符串索引无效。");
                byte[] text=row.getString(1).getBytes(StandardCharsets.UTF_8);if(text.length>LogbookLimits.ENTITY_REQUEST_BYTES)throw new IOException("独立字符串超过处理上限。");StorageBudget.require(available,StorageBudget.estimate(text.length,3));
                stage.execSQL("INSERT INTO strings VALUES(?,?)",new Object[]{stringCount++,text});
            });stage.setTransactionSuccessful();}finally{stage.endTransaction();}
        }
    }
    JSONObject string(long index,long offset)throws Exception{
        if(closed||ready||index>=stringCount)throw new IOException("共享字符串索引无效。");
        try(Cursor row=stage.rawQuery("SELECT length(value),substr(value,?,?) FROM strings WHERE id=?",new String[]{Long.toString(offset+1),Integer.toString(LogbookLimits.TRANSFER_CHUNK_BYTES),Long.toString(index)})){
            if(!row.moveToFirst())throw new IOException("共享字符串不存在。");long bytes=row.getLong(0);if(offset>bytes)throw new IOException("共享字符串偏移无效。");byte[] chunk=row.getBlob(1);
            return new JSONObject().put("base64",android.util.Base64.encodeToString(chunk,android.util.Base64.NO_WRAP)).put("bytes",bytes).put("done",offset+chunk.length==bytes);
        }
    }
    private static byte[] blob(SQLiteDatabase db,String table,String column,String where,String[] args)throws Exception{
        long size;try(Cursor row=db.rawQuery("SELECT length("+column+") FROM "+table+" WHERE "+where,args)){if(!row.moveToFirst()||row.isNull(0))return null;size=row.getLong(0);}
        if(size>LogbookLimits.ENTITY_REQUEST_BYTES+4096)throw new IOException("独立表格字段超过处理上限。");ByteArrayOutputStream output=new ByteArrayOutputStream();
        for(long offset=0;offset<size;){String[] query=new String[args.length+2];query[0]=Long.toString(offset+1);query[1]=Integer.toString(LogbookLimits.TRANSFER_CHUNK_BYTES);System.arraycopy(args,0,query,2,args.length);
            try(Cursor row=db.rawQuery("SELECT substr("+column+",?,?) FROM "+table+" WHERE "+where,query)){if(!row.moveToFirst())throw new IOException("表格暂存条目缺失。");byte[] part=row.getBlob(0);if(part.length==0)throw new IOException("表格暂存条目不完整。");output.write(part);offset+=part.length;}}
        return output.toByteArray();
    }
    private JSONObject value(String table,String id)throws Exception{byte[] bytes=blob(stage,table,"value","id=?",new String[]{id});if(bytes==null)throw new IOException("表格暂存实体缺失。");return new JSONObject(new String(bytes,StandardCharsets.UTF_8));}
    private void seed(LogbookDatabase database,JSONObject defaultSettings)throws Exception{
        SQLiteDatabase business=database.getReadableDatabase();Map<String,String> root=new IndexedSnapshot(business).rootFields();
        if(root.isEmpty()){BackupValidation.settings(defaultSettings);initialSettings=new JSONObject(defaultSettings.toString());}
        JSONArray modules=new JSONArray(root.containsKey("modules")?root.get("modules"):"[]"),characters=new JSONArray(root.containsKey("characters")?root.get("characters"):"[]");
        for(int i=0;i<modules.length();i++){JSONObject row=modules.getJSONObject(i);stage.execSQL("INSERT INTO modules(id,name,ordinal,value) VALUES(?,?,?,?)",new Object[]{row.getString("id"),row.getString("name"),i,row.toString().getBytes(StandardCharsets.UTF_8)});}
        for(int i=0;i<characters.length();i++){JSONObject row=characters.getJSONObject(i);stage.execSQL("INSERT INTO characters VALUES(?,?,?)",new Object[]{row.getString("id"),i,row.toString().getBytes(StandardCharsets.UTF_8)});}
        try(Cursor rows=business.rawQuery("SELECT id,ordinal,COALESCE((SELECT SUM(bytes) FROM indexed_bodies WHERE record_key=indexed_records.row_key AND kind='rawContent'),0) FROM indexed_records ORDER BY ordinal,row_key",null)){
            while(rows.moveToNext()){JSONObject row=new JSONObject(new String(blob(business,"indexed_records","CAST(metadata AS BLOB)","id=?",new String[]{rows.getString(0)}),StandardCharsets.UTF_8));insertRecord(row,rows.getLong(1),null,true,false);if(rows.getLong(2)>0)stage.execSQL("UPDATE records SET raw_bytes=? WHERE id=?",new Object[]{rows.getLong(2),rows.getString(0)});}
        }
        stage.execSQL("UPDATE modules SET count=(SELECT COUNT(*) FROM records WHERE module_id=modules.id)");
    }
    private long scalar(String sql,String...args)throws Exception{try(Cursor row=stage.rawQuery(sql,args)){if(!row.moveToFirst())throw new IOException("表格索引读取失败。");return row.getLong(0);}}
    private void notice(String type,String text)throws Exception{long index=type.equals("names")?namesCount++:warningsCount++;stage.execSQL("INSERT INTO preview VALUES(?,?,?)",new Object[]{type,index,text});}
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
    private static JSONArray mergeNames(JSONArray before,JSONArray incoming)throws Exception{LinkedHashSet<String> names=new LinkedHashSet<>();for(JSONArray group:new JSONArray[]{before,incoming})for(int i=0;i<group.length();i++){Object raw=group.get(i);if(!(raw instanceof String))throw new IOException("参与者名单类型无效。");String name=trim((String)raw);if(!name.isEmpty())names.add(name);}return new JSONArray(names);}
    private JSONArray mergePairs(JSONArray before,JSONArray incoming)throws Exception{
        LinkedHashMap<String,JSONObject> pairs=new LinkedHashMap<>();for(JSONArray group:new JSONArray[]{before,incoming})for(int i=0;i<group.length();i++){
            JSONObject pair=group.getJSONObject(i);BackupValidation.shape(pair,"pc,pl","characterId");String pc=text(pair,"pc"),pl=text(pair,"pl");if(pair.has("characterId")){String id=text(pair,"characterId");if(!id.isEmpty()&&scalar("SELECT COUNT(*) FROM characters WHERE id=?",id)!=1)throw new IOException("角色关联失效。");}
            if(!pc.isEmpty()||!pl.isEmpty())pairs.putIfAbsent(pc+'\0'+pl,pair);
        }return new JSONArray(pairs.values());
    }
    private void row(JSONObject input)throws Exception{
        BackupValidation.shape(input,"sheet,moduleName,sessionName,link,kps,pairs","manualContent,playStatus,status,playDate,fetchedAt");
        for(String key:new String[]{"sheet","moduleName","sessionName","link","manualContent","playStatus","status","playDate","fetchedAt"})if(input.has(key))text(input,key);
        String moduleName=input.getString("moduleName"),session=input.getString("sessionName"),link=input.getString("link");if(trim(moduleName).isEmpty())throw new IOException("表格缺少模组名。");if(!link.isEmpty())url(link);
        if(input.has("playStatus")&&!Arrays.asList("not_started","running","finished").contains(input.getString("playStatus")))throw new IOException("跑团状态无效。");
        if(input.has("status")&&!Arrays.asList("pending","valid","fetch_failed","manual").contains(input.getString("status")))throw new IOException("链接状态无效。");
        // Dates preserve the legacy table text semantics, including Chinese and slash notation.
        String moduleID=null;try(Cursor match=stage.rawQuery("SELECT id FROM modules WHERE name=? ORDER BY ordinal LIMIT 1",new String[]{moduleName})){if(match.moveToFirst())moduleID=match.getString(0);}
        JSONObject module;
        if(moduleID==null){moduleID=UUID.randomUUID().toString();long order=scalar("SELECT COUNT(*) FROM modules");module=new JSONObject().put("id",moduleID).put("name",moduleName).put("playStatus",input.optString("playStatus","not_started")).put("kps",new JSONArray()).put("pairs",new JSONArray()).put("order",order).put("collapsed",false).put("createdAt",now).put("updatedAt",now);stage.execSQL("INSERT INTO modules(id,name,ordinal,value) VALUES(?,?,?,?)",new Object[]{moduleID,moduleName,order,module.toString().getBytes(StandardCharsets.UTF_8)});}else module=value("modules",moduleID);
        module.put("kps",mergeNames(module.getJSONArray("kps"),input.getJSONArray("kps")));module.put("pairs",mergePairs(module.getJSONArray("pairs"),input.getJSONArray("pairs")));stage.execSQL("UPDATE modules SET value=? WHERE id=?",new Object[]{module.toString().getBytes(StandardCharsets.UTF_8),moduleID});
        String manual=input.optString("manualContent","");boolean hasManual=!trim(manual).isEmpty();List<String> matches=new ArrayList<>();
        if(hasManual){String sql="SELECT id FROM records WHERE module_id=? AND source='manual' AND name=?"+(link.isEmpty()?"":" AND link=?")+" LIMIT 2";try(Cursor found=stage.rawQuery(sql,link.isEmpty()?new String[]{moduleID,session}:new String[]{moduleID,session,link})){while(found.moveToNext())matches.add(found.getString(0));}}
        if(matches.size()==1){String id=matches.get(0);JSONObject record=value("records",id);record.put("updatedAt",now);if(input.has("playDate")&&!input.getString("playDate").isEmpty()){record.put("playDate",input.getString("playDate"));record.put("dateSource","manual");}validateCombined(record,manual);stage.execSQL("UPDATE records SET value=?,manual=?,changed=1 WHERE id=?",new Object[]{record.toString().getBytes(StandardCharsets.UTF_8),JSONObject.quote(manual).getBytes(StandardCharsets.UTF_8),id});updated++;notice("names",moduleName+" / "+record.getString("name"));notice("warnings",record.getString("name")+"：将更新已有同名手动场次正文，确认后生效。");return;}
        if(!link.isEmpty()&&scalar("SELECT COUNT(*) FROM records WHERE module_id=? AND link=?",moduleID,link)>0){skipped++;notice("warnings",session+"：来源已存在，已跳过。");return;}
        long count=scalar("SELECT count FROM modules WHERE id=?",moduleID),ordinal=scalar("SELECT COALESCE(MAX(ordinal),-1)+1 FROM records");
        JSONObject record=new JSONObject().put("id",UUID.randomUUID().toString()).put("moduleId",moduleID).put("name",session.isEmpty()?"第"+(count+1)+"场":session).put("sequenceNo",count+1).put("sourceType",!link.isEmpty()&&!hasManual?"online":"manual").put("status",!link.isEmpty()&&!hasManual?"pending":"manual").put("dateSource",input.has("playDate")&&!input.getString("playDate").isEmpty()?"manual":"none").put("order",count).put("createdAt",now).put("updatedAt",now);
        if(!link.isEmpty())record.put("link",link);if(input.has("playDate")&&!input.getString("playDate").isEmpty())record.put("playDate",input.getString("playDate"));String body=hasManual?manual:link.isEmpty()?"":null;
        validateCombined(record,body);insertRecord(record,ordinal,body,false,true);stage.execSQL("UPDATE modules SET count=count+1 WHERE id=?",new Object[]{moduleID});added++;notice("names",moduleName+" / "+record.getString("name"));
    }
    private void validateCombined(JSONObject record,String manual)throws Exception{BackupValidation.record(record);long bytes=JsonFields.bytes(record.toString())+(manual==null?0:17+JsonFields.bytes(JSONObject.quote(manual)));try(Cursor row=stage.rawQuery("SELECT raw_bytes FROM records WHERE id=?",new String[]{record.getString("id")})){if(row.moveToFirst()&&row.getLong(0)>0)bytes+=14+row.getLong(0);}if(bytes>LogbookLimits.ENTITY_REQUEST_BYTES)throw new IOException("单场完整记录超过64MiB。");StorageBudget.require(available,StorageBudget.estimate(bytes,4));}
    private void insertRecord(JSONObject row,long ordinal,String manual,boolean original,boolean changed)throws Exception{stage.execSQL("INSERT INTO records(id,module_id,name,link,source,ordinal,value,manual,original,changed) VALUES(?,?,?,?,?,?,?,?,?,?)",new Object[]{row.getString("id"),row.getString("moduleId"),row.getString("name"),row.optString("link"),row.getString("sourceType"),ordinal,row.toString().getBytes(StandardCharsets.UTF_8),manual==null?null:JSONObject.quote(manual).getBytes(StandardCharsets.UTF_8),original?1:0,changed?1:0});}
    private void character(JSONObject value)throws Exception{Set<String> modules=new HashSet<>();try(Cursor rows=stage.rawQuery("SELECT id FROM modules",null)){while(rows.moveToNext())modules.add(rows.getString(0));}BackupValidation.character(value,modules);String id=value.getString("id");if(id.isEmpty()||scalar("SELECT COUNT(*) FROM characters WHERE id=?",id)!=0||JsonFields.bytes(value.toString())>LogbookLimits.ENTITY_REQUEST_BYTES)throw new IOException("角色标识重复、缺失或字段过大。");stage.execSQL("INSERT INTO characters VALUES(?,?,?)",new Object[]{id,scalar("SELECT COUNT(*) FROM characters"),value.toString().getBytes(StandardCharsets.UTF_8)});added++;notice("names",value.getJSONObject("basic").getString("name"));}
    JSONObject preview(LogbookDatabase database,BackupSession.Proof proof,JSONObject defaultSettings)throws Exception{
        if(ready||closed||database.revision()!=revision)throw new IOException("表格预览版本已变化。");stringLines.finish();for(Spool value:spools.values())value.seal();Spool candidate=spools.get("candidate");if(candidate==null)throw new IOException("没有可新增的有效数据。");
        BackupSession.fileProof(source,sourceProof.bytes).matches(sourceProof.bytes,sourceProof.sha256);BackupSession.fileProof(candidate.file,proof.bytes).matches(proof.bytes,proof.sha256);candidateProof=proof;
        stage.beginTransaction();try{
            seed(database,defaultSettings);Lines lines=new Lines();try(InputStream input=new FileInputStream(candidate.file)){byte[] buffer=new byte[65536];int n;while((n=input.read(buffer))!=-1)lines.append(buffer,0,n,value->{
                if(value.length()<2||value.charAt(0)!=(kind.equals("record-table")?'T':'C'))throw new IOException("表格候选用途不符。");String json=value.substring(1);StrictBackupJson.validate(json);JSONObject wrapper=new JSONObject(json);BackupValidation.shape(wrapper,"sheetOrder,rowOrder,value",kind.equals("character-table")?"warnings":"");long sheet=integer(wrapper.get("sheetOrder")),row=integer(wrapper.get("rowOrder"));wrapper.getJSONObject("value");if(wrapper.has("warnings")){JSONArray warnings=wrapper.getJSONArray("warnings");for(int i=0;i<warnings.length();i++)if(!(warnings.get(i) instanceof String))throw new IOException("角色提醒类型无效。");}StorageBudget.require(available,StorageBudget.estimate(JsonFields.bytes(json),4));stage.execSQL("INSERT INTO incoming VALUES(?,?,?,?)",new Object[]{sheet,row,value.substring(0,1),json.getBytes(StandardCharsets.UTF_8)});
            });}lines.finish();
            try(Cursor rows=stage.rawQuery("SELECT sheet,row,kind FROM incoming ORDER BY sheet,row",null)){
                while(rows.moveToNext()){byte[] bytes=blob(stage,"incoming","value","sheet=? AND row=?",new String[]{Long.toString(rows.getLong(0)),Long.toString(rows.getLong(1))});JSONObject wrapper=new JSONObject(new String(bytes,StandardCharsets.UTF_8)),entry=wrapper.getJSONObject("value");if(rows.getString(2).equals("T"))row(entry);else{character(entry);JSONArray warnings=wrapper.optJSONArray("warnings");if(warnings!=null)for(int i=0;i<warnings.length();i++)notice("warnings",warnings.getString(i));}}
            }
            if(namesCount==0)throw new IOException("没有可新增的有效数据。");if(database.revision()!=revision)throw new IOException("表格预览版本已变化。");stage.setTransactionSuccessful();ready=true;
        }finally{stage.endTransaction();}
        stage.close();stage=null;File frozen=new File(directory,"stage.sqlite");previewDatabaseProof=BackupSession.fileProof(frozen,frozen.length());
        stage=SQLiteDatabase.openDatabase(frozen.getAbsolutePath(),null,SQLiteDatabase.OPEN_READONLY|SQLiteDatabase.NO_LOCALIZED_COLLATORS);
        return new JSONObject().put("id",id).put("revision",revision).put("added",added).put("updated",updated).put("skipped",skipped).put("namesCount",namesCount).put("warningsCount",warningsCount).put("names",page("names",0,100).getJSONArray("values")).put("warnings",page("warnings",0,100).getJSONArray("values"));
    }
    JSONObject page(String kind,long offset,int limit)throws Exception{if(!ready||closed||!Arrays.asList("names","warnings").contains(kind)||offset<0)throw new IOException("表格预览页无效。");JSONArray values=new JSONArray();try(Cursor rows=stage.rawQuery("SELECT value FROM preview WHERE kind=? AND position>=? ORDER BY position LIMIT ?",new String[]{kind,Long.toString(offset),Integer.toString(Math.max(1,Math.min(100,limit)))})){while(rows.moveToNext())values.put(rows.getString(0));}return new JSONObject().put("values",values).put("total",kind.equals("names")?namesCount:warningsCount);}
    void prepareCommit()throws Exception{
        if(!ready||closed||detached)throw new IOException("表格尚未预览或已提交。");
        BackupSession.fileProof(source,sourceProof.bytes).matches(sourceProof.bytes,sourceProof.sha256);File candidate=spools.get("candidate").file;BackupSession.fileProof(candidate,candidateProof.bytes).matches(candidateProof.bytes,candidateProof.sha256);
        StorageBudget.require(available,StorageBudget.estimate(candidateProof.bytes,4));File file=new File(directory,"stage.sqlite");
        if(previewDatabaseProof==null)throw new IOException("表格预览摘要缺失。");BackupSession.fileProof(file,previewDatabaseProof.bytes).matches(previewDatabaseProof.bytes,previewDatabaseProof.sha256);
        try(Cursor check=stage.rawQuery("PRAGMA quick_check",null)){if(!check.moveToFirst()||!"ok".equals(check.getString(0))||check.moveToNext())throw new IOException("表格暂存读取失败。");}
        deleteOwned(directory,id);detached=true;
    }
    void apply(IndexedSnapshot destination)throws Exception{
        if(!ready||!detached||closed)throw new IOException("表格候选未封存。");
        if(initialSettings!=null){destination.tableField("schemaVersion","2");destination.tableField("settings",initialSettings.toString());}
        try(Cursor rows=stage.rawQuery("SELECT id,ordinal,original FROM records WHERE changed=1 ORDER BY ordinal",null)){
            while(rows.moveToNext()){String id=rows.getString(0);JSONObject metadata=value("records",id);byte[] body=blob(stage,"records","manual","id=?",new String[]{id});destination.tableRecord(metadata,rows.getLong(1),rows.getInt(2)==0,body==null?null:new InputStreamReader(new ByteArrayInputStream(body),StandardCharsets.UTF_8));}
        }
        for(String table:new String[]{"modules","characters"}){
            JSONArray values=new JSONArray();try(Cursor rows=stage.rawQuery("SELECT id FROM "+table+" ORDER BY ordinal",null)){while(rows.moveToNext())values.put(value(table,rows.getString(0)));}destination.tableField(table,values.toString());
        }
        destination.tableField("exportedAt",JSONObject.quote(now));
    }
    private static void cleanupStale(File root)throws Exception{File[] children=root.listFiles();if(children==null)throw new IOException("无法检查表格私有暂存。");for(File child:children)if(child.getName().matches("coc-table-[a-f0-9-]{36}")){String id=child.getName().substring(10);File marker=new File(child,"owner");if(marker.isFile()&&marker.length()==36){String value=new String(java.nio.file.Files.readAllBytes(marker.toPath()),StandardCharsets.UTF_8);if(value.equals(id))deleteOwned(child,id);}}}
    private static void deleteOwned(File directory,String id)throws Exception{deleteOwned(directory,id,false);}
    private static void deleteOwned(File directory,String id,boolean initializationFailed)throws Exception{
        if(!directory.exists())return;File marker=new File(directory,"owner");if(!directory.getName().equals("coc-table-"+id)||!directory.getCanonicalFile().getParentFile().equals(directory.getParentFile().getCanonicalFile()))throw new IOException("表格暂存目录引用无效。");
        if(!marker.isFile()&&!initializationFailed||marker.exists()&&!new String(java.nio.file.Files.readAllBytes(marker.toPath()),StandardCharsets.UTF_8).equals(id))throw new IOException("表格暂存所有权标记已变化。");
        File[] files=directory.listFiles();if(files==null)throw new IOException("无法读取表格暂存目录。");for(File file:files)if(!FILES.contains(file.getName())||file.isDirectory()||!file.getCanonicalFile().getParentFile().equals(directory.getCanonicalFile()))throw new IOException("表格暂存存在未知文件，已保留。");
        for(File file:files)if(!file.getName().equals("owner")&&!file.delete())throw new IOException("表格暂存清理失败；未提交。");if(marker.exists()&&!marker.delete())throw new IOException("表格所有权标记清理失败；未提交。");if(!directory.delete())throw new IOException("表格暂存目录清理失败；未提交。");
    }
    public void close()throws Exception{if(closed)return;Exception failure=null;for(Spool spool:spools.values())try{spool.seal();}catch(Exception error){failure=error;}if(stage!=null){try{stage.close();stage=null;}catch(Exception error){failure=error;}}try{if(!detached)deleteOwned(directory,id,!ownershipEstablished);}catch(Exception error){failure=error;}if(failure!=null)throw failure;closed=true;}
}
