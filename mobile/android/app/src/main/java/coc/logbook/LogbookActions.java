package coc.logbook;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/** Applies the same list-only actions as data/actions.ts to a native-owned snapshot. */
final class LogbookActions {
    private static JSONObject find(JSONArray rows, String id) throws Exception {
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.getJSONObject(i);
            if (id.equals(row.getString("id"))) return row;
        }
        throw new IllegalArgumentException("目标已不存在，请重新读取。");
    }

    static void apply(JSONObject data, JSONObject action) throws Exception {
        String type = action.getString("type");
        JSONArray modules = data.getJSONArray("modules"), records = data.getJSONArray("records"), characters = data.getJSONArray("characters");
        if ("clear".equals(type)) {
            data.put("modules", new JSONArray()); data.put("records", new JSONArray()); data.put("characters", new JSONArray());
        } else if ("delete".equals(type)) {
            String kind = action.getString("kind"), id = action.getString("id");
            if ("module".equals(kind)) {
                find(modules, id);
                data.put("modules", without(modules, "id", id));
                data.put("records", without(records, "moduleId", id));
                for (int i = 0; i < characters.length(); i++) {
                    JSONObject character = characters.getJSONObject(i);
                    JSONArray before = character.getJSONArray("moduleIds"), after = new JSONArray();
                    for (int j = 0; j < before.length(); j++) if (!id.equals(before.getString(j))) after.put(before.getString(j));
                    character.put("moduleIds", after);
                    if (after.length() == 0) character.remove("moduleId"); else character.put("moduleId", after.getString(0));
                }
            } else if ("record".equals(kind)) {
                find(records, id); data.put("records", without(records, "id", id));
            } else if ("character".equals(kind)) {
                find(characters, id); data.put("characters", without(characters, "id", id));
                for (int i = 0; i < modules.length(); i++) {
                    JSONArray pairs = modules.getJSONObject(i).getJSONArray("pairs");
                    for (int j = 0; j < pairs.length(); j++) {
                        JSONObject pair = pairs.getJSONObject(j);
                        if (id.equals(pair.optString("characterId"))) pair.remove("characterId");
                    }
                }
            } else throw new IllegalArgumentException("不支持此删除类型。");
        } else if ("reorder".equals(type)) {
            String kind = action.getString("kind"), id = action.getString("id"), targetId = action.getString("targetId");
            if (!"module".equals(kind) && !"record".equals(kind)) throw new IllegalArgumentException("不支持此排序类型。");
            JSONArray source = "module".equals(kind) ? modules : records;
            JSONObject selected = find(source, id), target = find(source, targetId);
            if ("record".equals(kind) && !selected.getString("moduleId").equals(target.getString("moduleId")))
                throw new IllegalArgumentException("只能在同一列表内排序。");
            List<JSONObject> rows = ordered(source, "record".equals(kind) ? selected.getString("moduleId") : null);
            int targetIndex = rows.indexOf(target);
            rows.remove(selected); rows.add(targetIndex, selected);
            for (int i = 0; i < rows.size(); i++) rows.get(i).put("order", i);
        } else if ("realign".equals(type)) {
            String moduleId = action.getString("moduleId"); find(modules, moduleId);
            List<JSONObject> rows = ordered(records, moduleId);
            for (int i = 0; i < rows.size(); i++) rows.get(i).put("sequenceNo", i + 1);
        } else if ("reset".equals(type)) {
            JSONObject record = find(records, action.getString("id"));
            if ("online".equals(record.getString("sourceType"))) {
                record.put("previousStatus", record.getString("status")); record.put("status", "pending"); record.remove("lastError");
            }
        } else throw new IllegalArgumentException("不支持此列表操作。");
        data.put("exportedAt", java.time.Instant.now().toString());
    }

    private static JSONArray without(JSONArray rows, String key, String value) throws Exception {
        JSONArray result = new JSONArray();
        for (int i = 0; i < rows.length(); i++) if (!value.equals(rows.getJSONObject(i).getString(key))) result.put(rows.getJSONObject(i));
        return result;
    }

    private static List<JSONObject> ordered(JSONArray source, String moduleId) throws Exception {
        List<JSONObject> result = new ArrayList<>();
        for (int i = 0; i < source.length(); i++) {
            JSONObject row = source.getJSONObject(i);
            if (moduleId == null || moduleId.equals(row.getString("moduleId"))) result.add(row);
        }
        result.sort(Comparator.comparingDouble(row -> row.optDouble("order")));
        return result;
    }
}
