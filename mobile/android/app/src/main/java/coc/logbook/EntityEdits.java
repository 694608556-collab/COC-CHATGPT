package coc.logbook;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/** Validation and relationship updates for the two single-entity bridge requests. */
final class EntityEdits {
    private static void shape(JSONObject value, String required, String optional) throws Exception {
        Set<String> allowed = new HashSet<>(Arrays.asList((required + "," + optional).split(",")));
        allowed.remove("");
        java.util.Iterator<String> keys = value.keys();
        while (keys.hasNext()) if (!allowed.contains(keys.next())) throw new IllegalArgumentException("实体字段不合法。");
        for (String key : required.split(",")) if (!key.isEmpty() && !value.has(key)) throw new IllegalArgumentException("实体字段不完整。");
    }
    private static void text(JSONObject value, String keys) throws Exception {
        for (String key : keys.split(",")) if (value.has(key) && !(value.get(key) instanceof String)) throw new IllegalArgumentException("文本类型不合法。");
    }
    private static void numbers(JSONObject value, String keys) throws Exception {
        for (String key : keys.split(",")) if (value.has(key) && (!(value.get(key) instanceof Number) || !Double.isFinite(((Number)value.get(key)).doubleValue()))) throw new IllegalArgumentException("数值不合法。");
    }
    private static void strings(JSONArray values) throws Exception {
        for (int i = 0; i < values.length(); i++) if (!(values.get(i) instanceof String)) throw new IllegalArgumentException("名单类型不合法。");
    }
    private static Set<String> ids(JSONArray rows) throws Exception {
        Set<String> ids = new HashSet<>();
        for (int i = 0; i < rows.length(); i++) ids.add(rows.getJSONObject(i).getString("id"));
        return ids;
    }
    static void character(JSONObject value, JSONArray modules, JSONArray characters, String now) throws Exception {
        shape(value, "id,moduleIds,edition,basic,attrs,editionSnapshots,derived,occupationFormula,skills,weapons,items,background,story,createdAt,updatedAt", "moduleId,occupationPointOverride");
        text(value, "id,moduleId,occupationFormula,story,createdAt,updatedAt"); numbers(value, "edition,occupationPointOverride");
        if (!(value.get("edition") instanceof Number) || !Arrays.asList(6.0,7.0).contains(((Number)value.get("edition")).doubleValue())) throw new IllegalArgumentException("角色版次不合法。");
        JSONObject basic = value.getJSONObject("basic");
        shape(basic, "name,occupation,age,gender,birthplace,residence", ""); text(basic, "name,occupation,age,gender,birthplace,residence");
        String name = basic.getString("name").trim(); if (name.isEmpty()) throw new IllegalArgumentException("请填写角色姓名。"); basic.put("name", name);
        JSONObject attrs = value.getJSONObject("attrs"); shape(attrs, "STR,CON,SIZ,DEX,APP,INT,POW,EDU", ""); numbers(attrs, "STR,CON,SIZ,DEX,APP,INT,POW,EDU");
        JSONObject snapshots = value.getJSONObject("editionSnapshots");
        java.util.Iterator<String> editions = snapshots.keys();
        while (editions.hasNext()) { JSONObject snapshot = snapshots.getJSONObject(editions.next()); java.util.Iterator<String> keys = snapshot.keys(); while (keys.hasNext()) { Object number = snapshot.get(keys.next()); if (!(number instanceof Number) || !Double.isFinite(((Number)number).doubleValue())) throw new IllegalArgumentException("版次属性不合法。"); } }
        JSONObject derived = value.getJSONObject("derived"); shape(derived, "hpCurrent,mpCurrent,sanCurrent,db", "luck6,luck7"); numbers(derived, "hpCurrent,mpCurrent,sanCurrent,luck6,luck7"); text(derived, "db");
        JSONArray skills = value.getJSONArray("skills");
        for (int i = 0; i < skills.length(); i++) {
            JSONObject skill = skills.getJSONObject(i); shape(skill, "id,name,base,occupation,interest,growth", "hidden,builtIn,mappingState"); text(skill, "id,name,mappingState"); numbers(skill, "base,occupation,interest,growth");
            for (String key : new String[]{"hidden","builtIn"}) if (skill.has(key) && !(skill.get(key) instanceof Boolean)) throw new IllegalArgumentException("技能类型不合法。");
            if (skill.has("mappingState") && !Arrays.asList("ok","review","unmapped").contains(skill.getString("mappingState"))) throw new IllegalArgumentException("技能映射不合法。");
        }
        JSONArray weapons = value.getJSONArray("weapons");
        for (int i = 0; i < weapons.length(); i++) {
            JSONObject weapon = weapons.getJSONObject(i); java.util.Iterator<String> keys = weapon.keys();
            while (keys.hasNext()) { Object field = weapon.get(keys.next()); if (!(field instanceof String) && (!(field instanceof Number) || !Double.isFinite(((Number)field).doubleValue()))) throw new IllegalArgumentException("武器字段不合法。"); }
        }
        strings(value.getJSONArray("items"));
        JSONObject background = value.getJSONObject("background"); java.util.Iterator<String> keys = background.keys(); while (keys.hasNext()) if (!(background.get(keys.next()) instanceof String)) throw new IllegalArgumentException("背景字段不合法。");
        JSONArray linked = value.getJSONArray("moduleIds"); strings(linked); Set<String> moduleIds = ids(modules), selected = new HashSet<>();
        for (int i = 0; i < linked.length(); i++) if (!moduleIds.contains(linked.getString(i)) || !selected.add(linked.getString(i))) throw new IllegalArgumentException("模组关联失效或重复。");
        if (linked.length() == 0) value.remove("moduleId"); else value.put("moduleId",linked.getString(0));
        String id = value.getString("id"); if (id.isEmpty()) throw new IllegalArgumentException("角色标识缺失。");
        boolean found = false;
        for (int i = 0; i < characters.length(); i++) if (id.equals(characters.getJSONObject(i).getString("id"))) { value.put("createdAt",characters.getJSONObject(i).getString("createdAt")); characters.put(i,value); found = true; break; }
        value.put("updatedAt",now); if (!found) characters.put(value);
        // Character ownership and name are independent of module PC/PL entries.
    }
    static JSONObject record(JSONObject value, Map<String,String> old, JSONArray modules, Map<String,Map<String,String>> rows, String now) throws Exception {
        shape(value, "id,moduleId,name,sequenceNo,sourceType,status,dateSource,order,createdAt,updatedAt", "link,previousStatus,playDate,manualContent,lastError");
        text(value, "id,moduleId,name,sourceType,status,dateSource,createdAt,updatedAt,link,previousStatus,playDate,manualContent,lastError"); numbers(value,"sequenceNo,order");
        String id = value.getString("id"), source = value.getString("sourceType");
        if (id.isEmpty() || !ids(modules).contains(value.getString("moduleId")) || !Arrays.asList("online","manual").contains(source) ||
            !Arrays.asList("pending","valid","invalid","fetch_failed","manual").contains(value.getString("status")) ||
            !Arrays.asList("parsed","manual","none").contains(value.getString("dateSource")) ||
            (value.has("previousStatus") && !Arrays.asList("pending","valid","invalid","fetch_failed","manual").contains(value.getString("previousStatus")))) throw new IllegalArgumentException("场次字段或关联不合法。");
        double sequence = value.getDouble("sequenceNo"); if (sequence < 0 || sequence != Math.floor(sequence)) throw new IllegalArgumentException("场次序号须为非负整数。");
        JSONObject before = old == null ? null : RecordOverlay.metadata(old);
        boolean unchanged = before != null && source.equals(before.getString("sourceType")) && value.optString("link").equals(before.optString("link"));
        if ("online".equals(source)) {
            if (!unchanged) {
                java.net.URI uri = new java.net.URI(value.optString("link"));
                String query = uri.getRawQuery(); boolean key = false;
                if (query != null) for (String part : query.split("&")) { String[] pair = part.split("=",2); if ("key".equals(java.net.URLDecoder.decode(pair[0],"UTF-8")) && pair.length == 2 && !java.net.URLDecoder.decode(pair[1],"UTF-8").isEmpty()) key = true; }
                if (!"log.weizaima.com".equals(uri.getHost()) || !Arrays.asList("http","https").contains(uri.getScheme()) || uri.getUserInfo() != null || uri.getPort() != -1 || !key) throw new IllegalArgumentException("请输入包含 key 参数的完整海豹日志网址。");
            }
            for (Map.Entry<String,Map<String,String>> row : rows.entrySet()) {
                JSONObject metadata = RecordOverlay.metadata(row.getValue());
                if (!id.equals(row.getKey()) && value.getString("moduleId").equals(metadata.getString("moduleId")) && value.optString("link").equals(metadata.optString("link"))) throw new IllegalArgumentException("同一模组已有此来源链接。");
            }
            value.remove("manualContent");
        }
        if (before != null) value.put("createdAt",before.getString("createdAt"));
        if (before != null && !unchanged) { value.remove("lastError"); value.put("status","manual".equals(source) ? "manual" : "pending"); }
        value.put("updatedAt",now);
        JSONObject entry = new JSONObject(); entry.put("value",value); entry.put("keepBody",unchanged && (old.containsKey("rawContent") || old.containsKey("cacheSourceUrl") || old.containsKey("fetchedAt"))); return entry;
    }
}
