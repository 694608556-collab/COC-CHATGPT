package coc.logbook;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/** Standalone JVM contract checks; deliberately does not stand in for Android/SQLite/SAF tests. */
public final class MetadataCheck {
    /** Count real target lookups instead of relying on machine-dependent millisecond limits. */
    private static final class CountedRows extends JSONArray {
        int reads;
        @Override public JSONObject getJSONObject(int index) { reads++; return super.getJSONObject(index); }
    }
    private static int checks;
    private static void check(boolean ok, String message) {
        if (!ok) throw new AssertionError(message); checks++;
    }
    private static void rejects(Throwing action) throws Exception {
        try { action.run(); } catch (Exception expected) { checks++; return; }
        throw new AssertionError("Invalid request was accepted");
    }
    interface Throwing { void run() throws Exception; }
    public static void main(String[] args) throws Exception {
        check("20261022COC跑团记录簿.json".equals(DocumentNames.backup(java.time.LocalDate.of(2026,10,22),"json")),"local date backup name");
        check("20261022COC跑团记录簿1.zip".equals(DocumentNames.available(java.util.List.of("20261022COC跑团记录簿.json"),"20261022COC跑团记录簿.zip")),"JSON ZIP share daily numbering from one");
        check("20261022COC跑团记录簿5.json".equals(DocumentNames.available(java.util.List.of("20261022COC跑团记录簿4.zip"),"20261022COC跑团记录簿.json")),"continue maximum after old backup removal");
        check("20261023COC跑团记录簿.json".equals(DocumentNames.available(java.util.List.of("20261022COC跑团记录簿4.zip"),"20261023COC跑团记录簿.json")),"next day starts without suffix");
        check("20261016模组合集.txt".equals(DocumentNames.available(java.util.List.of(),"20261016模组合集.txt")),"no random filename suffix");
        check("记录 (3).TXT".equals(DocumentNames.available(java.util.List.of("记录.txt","记录 (2).txt"),"记录.TXT")),"case insensitive desktop numbering preserves existing files");
        check("记录.版本 (2).txt".equals(DocumentNames.available(java.util.List.of("记录.版本.txt"),"记录.版本.txt")),"only final extension is separated");
        CountedRows batchRows = new CountedRows();
        JSONArray selected = new JSONArray();
        for (int i=0;i<1000;i++) {
            batchRows.put(new JSONObject().put("id","batch-"+i));
            if (i<999) selected.put("batch-"+i);
        }
        JSONObject batch = new JSONObject().put("modules",new JSONArray()).put("records",batchRows).put("characters",new JSONArray());
        LogbookActions.apply(batch,new JSONObject().put("type","delete-records").put("ids",selected));
        check(batchRows.reads<=4000,"batch target checks must not repeatedly scan the whole list: "+batchRows.reads);
        check(batch.getJSONArray("records").length()==1,"batch removes only selected targets");
        check(batchRows.length()==1000,"batch does not mutate original array");
        batch.put("records",batchRows);
        rejects(() -> LogbookActions.apply(batch,new JSONObject().put("type","delete-records").put("ids",new JSONArray().put("batch-0").put("missing"))));
        check(batch.getJSONArray("records")==batchRows && batchRows.length()==1000,"missing final target cannot partially delete");
        rejects(() -> LogbookActions.apply(batch,new JSONObject().put("type","delete-records").put("ids",new JSONArray().put("batch-0").put("batch-0"))));
        Map<String,String> fields = JsonFields.split(Files.readString(Path.of(args[0])));
        String originalSnapshot = JsonFields.join(fields);
        JSONObject overview = RecordOverlay.view(fields,null);
        JSONObject overviewData = new JSONObject(overview.getString("json"));
        JSONArray overviewRows = overviewData.getJSONArray("records");
        for (int i=0;i<overviewRows.length();i++) {
            check(!overviewRows.getJSONObject(i).has("rawContent") && !overviewRows.getJSONObject(i).has("manualContent"),"overview has no log bodies");
        }
        String selectedId = overview.getJSONArray("deferredRecordIds").getString(0);
        java.util.Set<String> selectedIds = new java.util.HashSet<>(); selectedIds.add(selectedId);
        JSONObject content = RecordOverlay.view(fields,selectedIds);
        check(new JSONObject(content.getString("json")).getJSONArray("records").length()==1,"content contains only selected record");
        check(content.getString("json").contains("900719925474099312345"),"selected body keeps raw numeric precision");
        selectedIds.add("missing"); rejects(() -> RecordOverlay.view(fields,selectedIds));
        check(originalSnapshot.equals(JsonFields.join(fields)),"read projections never mutate persisted fields");
        JSONArray modules = new JSONArray(fields.get("modules")), characters = new JSONArray(fields.get("characters"));
        String now = "2026-10-15T02:00:00Z";
        JSONObject character = new JSONObject(characters.getJSONObject(0).toString());
        String cid = character.getString("id");
        modules.getJSONObject(0).getJSONArray("pairs").put(new JSONObject().put("pc","old").put("pl","player").put("characterId",cid));
        String originalModules = modules.toString();
        character.getJSONObject("basic").put("name","新角色");
        EntityEdits.character(character,modules,characters,now);
        check(originalModules.equals(modules.toString()),"character rename does not alter module participants");
        JSONObject detached = new JSONObject(character.toString()).put("moduleIds",new JSONArray());
        EntityEdits.character(detached,modules,characters,now);
        check(originalModules.equals(modules.toString()),"character ownership does not alter module participants");
        check(character.getJSONArray("weapons").getJSONObject(0).getString("damage").equals("1D6"),"weapon fields");
        check(character.getJSONObject("background").getString("自定义,背景").equals("保留全文"),"custom background");
        rejects(() -> EntityEdits.character(new JSONObject(character.toString()).put("edition",8),modules,characters,now));
        rejects(() -> EntityEdits.character(new JSONObject(character.toString()).put("unknown",true),modules,characters,now));
        JSONObject bad = new JSONObject(character.toString()); bad.getJSONObject("background").put("自定义,背景",new JSONObject());
        rejects(() -> EntityEdits.character(bad,modules,characters,now));
        Map<String,Map<String,String>> rows = RecordOverlay.rows(fields);
        String id = rows.keySet().iterator().next(); Map<String,String> original = rows.get(id);
        check(original.containsKey("rawContent"),"fixture online body");
        String exact = original.get("rawContent");
        JSONObject value = RecordOverlay.metadata(original); value.remove("cacheSourceUrl"); value.remove("fetchedAt"); value.put("name","小请求改名");
        JSONObject values = new JSONObject(); values.put(id,EntityEdits.record(value,original,modules,rows,now));
        fields.put("recordValues",values.toString()); fields.put("recordOrders",new JSONObject().put(id,9).toString());
        Map<String,String> renamed = RecordOverlay.rows(fields).get(id);
        check(exact.equals(renamed.get("rawContent")),"exact body text/precision preserved");
        check("9".equals(renamed.get("order")),"latest order overlay");
        check(!fields.get("recordValues").contains("rawContent"),"body absent from writes");
        JSONObject invalid = new JSONObject(value.toString()).put("rawContent",new JSONObject());
        rejects(() -> EntityEdits.record(invalid,renamed,modules,RecordOverlay.rows(fields),now));
        rejects(() -> EntityEdits.record(new JSONObject(value.toString()).put("sequenceNo",-1),renamed,modules,RecordOverlay.rows(fields),now));
        rejects(() -> EntityEdits.record(new JSONObject(value.toString()).put("moduleId","missing"),renamed,modules,RecordOverlay.rows(fields),now));
        rejects(() -> EntityEdits.record(new JSONObject(value.toString()).put("link","https://example.com/"),renamed,modules,RecordOverlay.rows(fields),now));
        JSONObject manual = new JSONObject(value.toString()).put("sourceType","manual").put("manualContent","新手动全文");
        values.put(id,EntityEdits.record(manual,renamed,modules,RecordOverlay.rows(fields),now)); fields.put("recordValues",values.toString());
        Map<String,String> switched = RecordOverlay.rows(fields).get(id);
        check(!switched.containsKey("rawContent"),"source change clears old body");
        check("新手动全文".equals(new JSONArray("["+switched.get("manualContent")+"]").getString(0)),"manual body retained");
        JSONObject back = new JSONObject(value.toString()).put("link","https://log.weizaima.com/?key=public-return");
        values.put(id,EntityEdits.record(back,switched,modules,RecordOverlay.rows(fields),now)); fields.put("recordValues",values.toString());
        check(!RecordOverlay.rows(fields).get(id).containsKey("rawContent"),"old source cannot resurrect base body");
        JSONObject metadata = new JSONObject(); metadata.put("modules",modules); metadata.put("characters",characters);
        JSONArray metadataRows = new JSONArray(); for (Map<String,String> row : RecordOverlay.rows(fields).values()) metadataRows.put(RecordOverlay.metadata(row));
        metadata.put("records",metadataRows);
        rejects(() -> LogbookActions.apply(metadata,new JSONObject().put("type","delete-records").put("ids",new JSONArray().put(id).put("missing"))));
        check(metadata.getJSONArray("records").length()==rows.size(),"batch validation precedes mutation");
        fields.put("recordDeleted",new JSONArray().put(id).toString());
        check(!RecordOverlay.rows(fields).containsKey(id),"deleted record excluded");
        long bytes = RecordOverlay.bytes(fields);
        RecordOverlay.compose(fields);
        check(bytes == JsonFields.join(fields).getBytes(java.nio.charset.StandardCharsets.UTF_8).length,"snapshot size counts composed body without allocating byte copy");
        String unicode = "中文😀\\\"\uD800";
        check(JsonFields.bytes(unicode) == unicode.getBytes(java.nio.charset.StandardCharsets.UTF_8).length,"UTF-8 size with surrogate edge");
        check(!fields.containsKey("recordValues") && !fields.containsKey("recordDeleted") && !fields.containsKey("recordOrders"),"internal metadata absent from export");
        check(!JsonFields.join(fields).contains("小请求改名"),"deleted record cannot reappear in backup");
        System.out.println("Native metadata helpers: " + checks + " checks passed. Android bridge/SQLite/SAF/device not exercised.");
    }
}
