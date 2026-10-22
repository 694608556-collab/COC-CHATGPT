package coc.logbook;

import java.util.*;
import org.json.*;

/** Non-mutating complete backup validation. Do not reuse EntityEdits: editing
 * changes timestamps, associations and source fields, while restore preserves
 * all validated fields exactly. Bodies are validated one record at a time.
 */
final class BackupValidation {
    private static final java.util.concurrent.ConcurrentMap<String,String[]> FIELD_LISTS=new java.util.concurrent.ConcurrentHashMap<>();
    private static final java.util.concurrent.ConcurrentMap<String,java.util.concurrent.ConcurrentMap<String,Set<String>>> SHAPES=new java.util.concurrent.ConcurrentHashMap<>();
    /** Definitions are internal constants. Reuse their immutable fields across messages. */
    private static String[] fields(String names){
        String[] found=FIELD_LISTS.get(names);if(found!=null)return found;
        String[] created=names.split(",");String[] prior=FIELD_LISTS.putIfAbsent(names,created);return prior==null?created:prior;
    }
    private static Set<String> allowed(String required,String optional){
        java.util.concurrent.ConcurrentMap<String,Set<String>> variants=SHAPES.get(required);
        if(variants==null){java.util.concurrent.ConcurrentMap<String,Set<String>> created=new java.util.concurrent.ConcurrentHashMap<>();java.util.concurrent.ConcurrentMap<String,Set<String>> prior=SHAPES.putIfAbsent(required,created);variants=prior==null?created:prior;}
        Set<String> found=variants.get(optional);if(found!=null)return found;
        Set<String> created=new HashSet<>(Arrays.asList(fields(required)));created.addAll(Arrays.asList(fields(optional)));created.remove("");
        created=Collections.unmodifiableSet(created);Set<String> prior=variants.putIfAbsent(optional,created);return prior==null?created:prior;
    }
    private static void fail() { throw new IllegalArgumentException("备份字段不完整或类型不合法。"); }
    static void shape(JSONObject value, String required, String optional) throws Exception {
        Set<String> allowed = allowed(required,optional);
        Iterator<String> keys = value.keys();
        while (keys.hasNext()) if (!allowed.contains(keys.next())) fail();
        for (String key : fields(required)) if (!key.isEmpty() && !value.has(key)) fail();
    }
    private static void text(JSONObject value, String fields) throws Exception {
        for (String key : fields(fields)) if (value.has(key) && !(value.get(key) instanceof String)) fail();
    }
    private static void numbers(JSONObject value, String fields) throws Exception {
        for (String key : fields(fields)) if (value.has(key) && !number(value.get(key))) fail();
    }
    private static boolean number(Object value) { return value instanceof Number && Double.isFinite(((Number)value).doubleValue()); }
    private static void choice(JSONObject value, String field, String... allowed) throws Exception {
        if (!Arrays.asList(allowed).contains(value.get(field))) fail();
    }
    private static List<String> strings(JSONArray values) throws Exception {
        List<String> result = new ArrayList<>();
        for (int i=0;i<values.length();i++) { Object value=values.get(i); if (!(value instanceof String)) fail(); result.add((String)value); }
        return result;
    }
    private static Set<String> ids(JSONArray rows) throws Exception {
        Set<String> result = new HashSet<>();
        for (int i=0;i<rows.length();i++) {
            JSONObject row=rows.getJSONObject(i); Object id=row.get("id");
            if (!(id instanceof String) || ((String)id).isEmpty() || !result.add((String)id)) fail();
        }
        return result;
    }
    static void settings(JSONObject value) throws Exception {
        shape(value,"theme,filterPreset","autoBackup"); choice(value,"theme","light","dark");
        JSONObject filters=value.getJSONObject("filterPreset");
        String flags="hideDiceCommands,hideImages,hideOffTopic,hideTime,hidePlatformAccount,hideYearMonthDay,indentFirstLine,darkDisplay";
        shape(filters,flags,"");
        for (String key:flags.split(",")) if (!(filters.get(key) instanceof Boolean)) fail();
        if (value.has("autoBackup")) {
            JSONObject automatic=value.getJSONObject("autoBackup"); shape(automatic,"enabled,interval,retention","");
            if (!(automatic.get("enabled") instanceof Boolean) || !number(automatic.get("retention")) || automatic.getDouble("retention")!=10) fail();
            choice(automatic,"interval","idle","daily","weekly");
        }
    }
    private static void module(JSONObject value, Set<String> characters) throws Exception {
        shape(value,"id,name,playStatus,kps,pairs,order,collapsed,createdAt,updatedAt","");
        text(value,"id,name,playStatus,createdAt,updatedAt"); numbers(value,"order"); strings(value.getJSONArray("kps"));
        if (!(value.get("collapsed") instanceof Boolean)) fail(); choice(value,"playStatus","running","finished","not_started");
        JSONArray pairs=value.getJSONArray("pairs");
        for(int i=0;i<pairs.length();i++) {
            JSONObject pair=pairs.getJSONObject(i);shape(pair,"pc,pl","characterId");text(pair,"pc,pl,characterId");
            if(pair.has("characterId")&&!pair.getString("characterId").isEmpty()&&!characters.contains(pair.getString("characterId"))) fail();
        }
    }
    static void character(JSONObject value, Set<String> modules) throws Exception {
        shape(value,"id,moduleIds,edition,basic,attrs,editionSnapshots,derived,occupationFormula,skills,weapons,items,background,story,createdAt,updatedAt","moduleId,occupationPointOverride");
        text(value,"id,moduleId,occupationFormula,story,createdAt,updatedAt"); numbers(value,"edition,occupationPointOverride");
        if(!Arrays.asList(6.0,7.0).contains(value.getDouble("edition")))fail();
        JSONObject basic=value.getJSONObject("basic");String fields="name,occupation,age,gender,birthplace,residence";shape(basic,fields,"");text(basic,fields);
        JSONObject attrs=value.getJSONObject("attrs");fields="STR,CON,SIZ,DEX,APP,INT,POW,EDU";shape(attrs,fields,"");numbers(attrs,fields);
        JSONObject derived=value.getJSONObject("derived");shape(derived,"hpCurrent,mpCurrent,sanCurrent,db","luck6,luck7");text(derived,"db");numbers(derived,"hpCurrent,mpCurrent,sanCurrent,luck6,luck7");
        JSONObject snapshots=value.getJSONObject("editionSnapshots");Iterator<String> keys=snapshots.keys();
        while(keys.hasNext()){JSONObject row=snapshots.getJSONObject(keys.next());Iterator<String> names=row.keys();while(names.hasNext())if(!number(row.get(names.next())))fail();}
        JSONObject background=value.getJSONObject("background");keys=background.keys();while(keys.hasNext())if(!(background.get(keys.next()) instanceof String))fail();
        strings(value.getJSONArray("items"));
        JSONArray skills=value.getJSONArray("skills");
        for(int i=0;i<skills.length();i++){
            JSONObject skill=skills.getJSONObject(i);shape(skill,"id,name,base,occupation,interest,growth","hidden,builtIn,mappingState");text(skill,"id,name,mappingState");numbers(skill,"base,occupation,interest,growth");
            for(String flag:new String[]{"hidden","builtIn"})if(skill.has(flag)&&!(skill.get(flag) instanceof Boolean))fail();
            if(skill.has("mappingState"))choice(skill,"mappingState","ok","review","unmapped");
        }
        JSONArray weapons=value.getJSONArray("weapons");
        for(int i=0;i<weapons.length();i++){JSONObject weapon=weapons.getJSONObject(i);keys=weapon.keys();while(keys.hasNext()){Object field=weapon.get(keys.next());if(!(field instanceof String)&&!number(field))fail();}}
        List<String> linked=strings(value.getJSONArray("moduleIds"));
        if(new HashSet<>(linked).size()!=linked.size()||!modules.containsAll(linked))fail();
        if(value.has("moduleId")&&!value.getString("moduleId").isEmpty()&&!modules.contains(value.getString("moduleId")))fail();
    }
    static void record(JSONObject value) throws Exception {
        shape(value,"id,moduleId,name,sequenceNo,sourceType,status,dateSource,order,createdAt,updatedAt","link,previousStatus,playDate,manualContent,lastError,rawContent,cacheSourceUrl,fetchedAt");
        text(value,"id,moduleId,name,sourceType,status,dateSource,createdAt,updatedAt,link,previousStatus,playDate,manualContent,lastError,cacheSourceUrl,fetchedAt");numbers(value,"sequenceNo,order");
        if(value.getString("id").isEmpty()||value.getString("moduleId").isEmpty())fail();
        double sequence=value.getDouble("sequenceNo");if(sequence<0||sequence!=Math.floor(sequence))fail();
        choice(value,"sourceType","online","manual");choice(value,"status","pending","valid","invalid","fetch_failed","manual");choice(value,"dateSource","parsed","manual","none");
        if(value.has("previousStatus"))choice(value,"previousStatus","pending","valid","invalid","fetch_failed","manual");
        if(value.has("rawContent")){
            JSONObject raw=value.getJSONObject("rawContent");shape(raw,"parserVersion,messages","title,sourceUrl,responseHash");text(raw,"title,sourceUrl,responseHash");numbers(raw,"parserVersion");
            JSONArray messages=raw.getJSONArray("messages");
            for(int i=0;i<messages.length();i++){
                JSONObject message=messages.getJSONObject(i);shape(message,"id,order,displayName,text,type,isDiceCommand,isOffTopic,images","timestamp,platformAccount,raw");text(message,"id,displayName,text,type,timestamp,platformAccount");numbers(message,"order");
                if(!(message.get("isDiceCommand") instanceof Boolean)||!(message.get("isOffTopic") instanceof Boolean))fail();
                JSONArray images=message.getJSONArray("images");for(int j=0;j<images.length();j++){JSONObject image=images.getJSONObject(j);shape(image,"url","alt");text(image,"url,alt");}
            }
            if("online".equals(value.getString("sourceType"))){
                for(String source:new String[]{value.optString("cacheSourceUrl"),raw.optString("sourceUrl")})
                    if(!source.isEmpty()&&!source.equals(value.optString("link")))throw new IllegalArgumentException("正文来源与场次链接不一致。");
            }
        }
    }
    static void metadata(JSONObject root) throws Exception {
        shape(root,"schemaVersion,exportedAt,modules,records,characters,settings","");text(root,"exportedAt");
        if(!number(root.get("schemaVersion"))||root.getDouble("schemaVersion")!=2)fail();settings(root.getJSONObject("settings"));
        JSONArray modules=root.getJSONArray("modules"),characters=root.getJSONArray("characters"),records=root.getJSONArray("records");
        Set<String> mids=ids(modules),cids=ids(characters);ids(records);
        for(int i=0;i<modules.length();i++)module(modules.getJSONObject(i),cids);
        for(int i=0;i<characters.length();i++)character(characters.getJSONObject(i),mids);
        for(int i=0;i<records.length();i++){
            JSONObject record=records.getJSONObject(i);record(record);
            if(record.has("rawContent")||record.has("manualContent")||!mids.contains(record.getString("moduleId")))fail();
        }
    }
    static JSONObject metadataOf(JSONObject record) throws Exception {
        JSONObject value=new JSONObject();Iterator<String> keys=record.keys();
        while(keys.hasNext()){String key=keys.next();if(!key.equals("rawContent")&&!key.equals("manualContent"))value.put(key,record.get(key));}
        return value;
    }
    static boolean same(Object a,Object b) throws Exception {
        if(a instanceof JSONObject && b instanceof JSONObject){
            JSONObject left=(JSONObject)a,right=(JSONObject)b;if(left.length()!=right.length())return false;
            Iterator<String> keys=left.keys();while(keys.hasNext()){String key=keys.next();if(!right.has(key)||!same(left.get(key),right.get(key)))return false;}return true;
        }
        if(a instanceof JSONArray && b instanceof JSONArray){JSONArray left=(JSONArray)a,right=(JSONArray)b;if(left.length()!=right.length())return false;for(int i=0;i<left.length();i++)if(!same(left.get(i),right.get(i)))return false;return true;}
        if(a instanceof Number && b instanceof Number)return ((Number)a).doubleValue()==((Number)b).doubleValue();
        return Objects.equals(a,b);
    }
}
