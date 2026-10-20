package coc.logbook;

import java.util.LinkedHashMap;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/** Native-owned record fragments. Unchanged bodies never enter JSONObject or metadata writes. */
final class RecordOverlay {
    /** Applies the existing 64 MB snapshot limit without assembling or encoding all body text. */
    static long bytes(Map<String,String> fields) throws Exception {
        long records = 2;
        for (Map<String,String> row : rows(fields).values()) {
            if (records > 2) records++;
            records += JsonFields.objectBytes(row);
        }
        Map<String,String> metadata = new LinkedHashMap<>(fields);
        metadata.remove("recordValues"); metadata.remove("recordDeleted"); metadata.remove("recordOrders");
        metadata.put("records","[]");
        return JsonFields.objectBytes(metadata) - 2 + records;
    }
    static String id(Map<String,String> row) throws Exception {
        return new JSONArray("[" + row.get("id") + "]").getString(0);
    }
    static Map<String,Map<String,String>> rows(Map<String,String> fields) throws Exception {
        Map<String,Map<String,String>> rows = new LinkedHashMap<>();
        JsonFields.eachElement(fields.get("records"), raw -> {
            Map<String,String> row = JsonFields.split(raw);
            try { rows.put(id(row), row); } catch (Exception error) { throw new IllegalArgumentException(error); }
        });
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
    /** Read-only projection of committed fields; never persists a body-free snapshot. */
    static JSONObject view(Map<String,String> fields, java.util.Set<String> selected) throws Exception {
        Map<String,String> view = new LinkedHashMap<>(fields);
        StringBuilder records = new StringBuilder("[");
        JSONArray deferred = new JSONArray();
        java.util.Set<String> found = new java.util.HashSet<>();
        for (Map.Entry<String,Map<String,String>> entry : rows(fields).entrySet()) {
            String id = entry.getKey(); Map<String,String> row = entry.getValue();
            if (selected != null && !selected.contains(id)) continue;
            found.add(id);
            if (records.length() > 1) records.append(',');
            if (selected == null) {
                records.append(metadata(row).toString());
                if (row.containsKey("rawContent") || row.containsKey("manualContent")) deferred.put(id);
            } else records.append(JsonFields.join(row));
        }
        if (selected != null && !found.equals(selected)) throw new IllegalArgumentException("场次已变化，请重新读取。");
        view.put("records",records.append(']').toString());
        view.remove("recordOrders"); view.remove("recordValues"); view.remove("recordDeleted");
        return new JSONObject().put("json",JsonFields.join(view)).put("deferredRecordIds",deferred);
    }
    static void compose(Map<String,String> fields) throws Exception {
        StringBuilder records = new StringBuilder("[");
        for (Map<String,String> row : rows(fields).values()) {
            if (records.length() > 1) records.append(','); records.append(JsonFields.join(row));
        }
        fields.put("records", records.append(']').toString());
        fields.remove("recordOrders"); fields.remove("recordValues"); fields.remove("recordDeleted");
    }
    /** Same exact-revision projection as view, without assembling the selected body JSON. */
    static void writeView(java.io.Writer out, Map<String,String> fields, java.util.Set<String> selected) throws Exception {
        Map<String,Map<String,String>> records = rows(fields);
        if (!records.keySet().containsAll(selected)) throw new IllegalArgumentException("场次已变化，请重新读取。");
        out.write('{'); boolean comma = false;
        for (Map.Entry<String,String> field : fields.entrySet()) {
            if (java.util.Arrays.asList("recordOrders", "recordValues", "recordDeleted").contains(field.getKey())) continue;
            if (comma) out.write(','); comma = true;
            out.write('"'); out.write(field.getKey()); out.write("\":");
            if (!field.getKey().equals("records")) JsonFields.writeText(out, field.getValue());
            else {
                out.write('['); boolean recordComma = false;
                for (Map.Entry<String,Map<String,String>> row : records.entrySet()) if (selected.contains(row.getKey())) {
                    if (recordComma) out.write(','); recordComma = true; JsonFields.write(out, row.getValue());
                }
                out.write(']');
            }
        }
        out.write('}');
    }
}
