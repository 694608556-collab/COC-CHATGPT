package coc.logbook;

import java.io.Reader;
import java.util.*;

/** Existing native snapshot checks, retaining identifiers rather than body strings. */
final class SnapshotStream {
    static void validate(Reader input) throws Exception {
        try (SnapshotJson reader = new SnapshotJson(input)) {
            Set<String> required = new HashSet<>(Arrays.asList("schemaVersion","exportedAt","modules","records","characters","settings"));
            Set<String> seen = new HashSet<>(), modules = new HashSet<>(), references = new HashSet<>();
            reader.object(key -> {
                if (!required.contains(key) || !seen.add(key)) throw new IllegalArgumentException("备份字段无效或重复。");
                switch (key) {
                    case "schemaVersion": reader.versionTwo(); break;
                    case "exportedAt": reader.discardString(); break;
                    case "settings": reader.object(name -> reader.skip()); break;
                    default: entities(reader, key.equals("modules") ? modules : new HashSet<>(), key.equals("records") ? references : null);
                }
            });
            reader.end();
            if (!seen.equals(required)) throw new IllegalArgumentException("快照结构不完整或包含多余内容。");
            if (!modules.containsAll(references)) throw new IllegalArgumentException("场次关联失效。");
        }
    }
    private static void entities(SnapshotJson reader, Set<String> ids, Set<String> references) throws Exception {
        reader.array(() -> {
            String[] identity = new String[2];
            reader.object(key -> {
                if (key.equals("id") || references != null && key.equals("moduleId")) {
                    identity[key.equals("id") ? 0 : 1] = reader.string();
                } else reader.skip();
            });
            String id = identity[0], module = identity[1];
            if (id == null || id.isEmpty() || !ids.add(id)) throw new IllegalArgumentException("备份实体标识无效或重复。");
            if (references != null) { if(module == null) throw new IllegalArgumentException("场次关联失效。"); references.add(module); }
        });
    }
}
