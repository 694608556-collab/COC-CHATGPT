package coc.logbook;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/** Standalone JVM contract checks; deliberately does not stand in for Android/SQLite/SAF tests. */
public final class MetadataCheck {
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
