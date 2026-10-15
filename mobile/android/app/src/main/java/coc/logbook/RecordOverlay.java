package coc.logbook;

import java.util.LinkedHashMap;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/** Native-owned record fragments. Unchanged bodies never enter JSONObject or metadata writes. */
final class RecordOverlay {
    static String id(Map<String,String> row) throws Exception {
        return new JSONArray("[" + row.get("id") + "]").getString(0);
    }
    static Map<String,Map<String,String>> rows(Map<String,String> fields) throws Exception {
        Map<String,Map<String,String>> rows = new LinkedHashMap<>();
        for (String raw : JsonFields.elements(fields.get("records"))) {
            Map<String,String> row = JsonFields.split(raw); rows.put(id(row), row);
        }
        JSONObject values = new JSONObject(fields.containsKey("recordValues") ? fields.get("recordValues") : "{}");
        java.util.Iterator<String> keys = values.keys();
        while (keys.hasNext()) {
            String id = keys.next(); JSONObject entry = values.getJSONObject(id);
            Map<String,String> row = JsonFields.split(entry.getJSONObject("value").toString());
            Map<String,String> old = rows.get(id);
            if (entry.getBoolean("keepBody") && old != null) {
                for (String key : new String[]{"rawContent", "cacheSourceUrl", "fetchedAt"})
                    if (old.containsKey(key)) row.put(key, old.get(key));
            }
            rows.put(id, row);
        }
        JSONArray deleted = new JSONArray(fields.containsKey("recordDeleted") ? fields.get("recordDeleted") : "[]");
        for (int i = 0; i < deleted.length(); i++) rows.remove(deleted.getString(i));
        JSONObject orders = new JSONObject(fields.containsKey("recordOrders") ? fields.get("recordOrders") : "{}");
        for (Map.Entry<String,Map<String,String>> entry : rows.entrySet())
            if (orders.has(entry.getKey())) entry.getValue().put("order", orders.get(entry.getKey()).toString());
        return rows;
    }
    static JSONObject metadata(Map<String,String> row) throws Exception {
        Map<String,String> copy = new LinkedHashMap<>(row);
        copy.remove("rawContent"); copy.remove("manualContent");
        return new JSONObject(JsonFields.join(copy));
    }
    static void compose(Map<String,String> fields) throws Exception {
        StringBuilder records = new StringBuilder("[");
        for (Map<String,String> row : rows(fields).values()) {
            if (records.length() > 1) records.append(','); records.append(JsonFields.join(row));
        }
        fields.put("records", records.append(']').toString());
        fields.remove("recordOrders"); fields.remove("recordValues"); fields.remove("recordDeleted");
    }
}
