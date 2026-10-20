package coc.logbook;

import android.util.JsonReader;
import android.util.JsonToken;
import java.io.Reader;
import java.util.*;

/** The existing native snapshot checks without materializing unchanged message objects. */
final class SnapshotStream {
    static void validate(Reader input) throws Exception {
        try (JsonReader reader = new JsonReader(input)) {
            reader.setLenient(false);
            Set<String> required = new HashSet<>(Arrays.asList("schemaVersion","exportedAt","modules","records","characters","settings"));
            Set<String> seen = new HashSet<>(), modules = new HashSet<>(), references = new HashSet<>();
            reader.beginObject();
            while (reader.hasNext()) {
                String key = reader.nextName();
                if (!required.contains(key) || !seen.add(key)) throw new IllegalArgumentException("备份字段无效或重复。");
                switch (key) {
                    case "schemaVersion": if (reader.nextInt() != 2) throw new IllegalArgumentException("备份版本不兼容。"); break;
                    case "exportedAt": if (reader.peek() != JsonToken.STRING) throw new IllegalArgumentException("备份时间无效。"); reader.nextString(); break;
                    case "settings": reader.beginObject(); while(reader.hasNext()){reader.nextName(); reader.skipValue();} reader.endObject(); break;
                    default: entities(reader, key.equals("modules") ? modules : new HashSet<>(), key.equals("records") ? references : null);
                }
            }
            reader.endObject();
            if (!seen.equals(required) || reader.peek() != JsonToken.END_DOCUMENT) throw new IllegalArgumentException("快照结构不完整或包含多余内容。");
            if (!modules.containsAll(references)) throw new IllegalArgumentException("场次关联失效。");
        }
    }
    private static void entities(JsonReader reader, Set<String> ids, Set<String> references) throws Exception {
        reader.beginArray();
        while (reader.hasNext()) {
            String id = null, module = null;
            reader.beginObject();
            while (reader.hasNext()) {
                String key = reader.nextName();
                if (key.equals("id") || references != null && key.equals("moduleId")) {
                    if (reader.peek() != JsonToken.STRING) throw new IllegalArgumentException("实体标识无效。");
                    String value = reader.nextString();
                    if (key.equals("id")) { if(id != null) throw new IllegalArgumentException("实体标识重复。"); id=value; }
                    else { if(module != null) throw new IllegalArgumentException("场次关联重复。"); module=value; }
                } else reader.skipValue();
            }
            reader.endObject();
            if (id == null || id.isEmpty() || !ids.add(id)) throw new IllegalArgumentException("备份实体标识无效或重复。");
            if (references != null) { if(module == null) throw new IllegalArgumentException("场次关联失效。"); references.add(module); }
        }
        reader.endArray();
    }
}
