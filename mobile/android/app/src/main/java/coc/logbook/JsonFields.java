package coc.logbook;

import java.util.LinkedHashMap;
import java.util.Map;

/** Slices already validated JSON without decoding unchanged log messages. Not an input validator. */
final class JsonFields {
    static Map<String, String> split(String json) {
        Map<String, String> fields = new LinkedHashMap<>();
        int i = space(json, 0);
        if (json.charAt(i++) != '{') throw new IllegalArgumentException("快照结构错误。");
        while (true) {
            i = space(json, i);
            if (json.charAt(i) == '}') break;
            int end = stringEnd(json, i);
            String key = key(json.substring(i + 1, end - 1));
            i = space(json, end);
            if (json.charAt(i++) != ':') throw new IllegalArgumentException("快照字段错误。");
            int start = space(json, i);
            i = valueEnd(json, start);
            if (fields.put(key, json.substring(start, i).trim()) != null) throw new IllegalArgumentException("快照字段重复。");
            i = space(json, i);
            if (json.charAt(i) == '}') break;
            if (json.charAt(i++) != ',') throw new IllegalArgumentException("快照分隔错误。");
        }
        if (space(json, i + 1) != json.length()) throw new IllegalArgumentException("快照包含多余内容。");
        return fields;
    }
    static String join(Map<String, String> fields) {
        StringBuilder out = new StringBuilder("{");
        for (Map.Entry<String, String> field : fields.entrySet()) {
            if (out.length() > 1) out.append(',');
            out.append('"').append(field.getKey().replace("\\", "\\\\").replace("\"", "\\\"")).append("\":").append(field.getValue());
        }
        return out.append('}').toString();
    }
    /** Element fragments retain raw body text and number precision. */
    static java.util.List<String> elements(String json) {
        java.util.List<String> rows = new java.util.ArrayList<>();
        int i = space(json, 0);
        if (json.charAt(i++) != '[') throw new IllegalArgumentException("快照数组错误。");
        while (true) {
            i = space(json, i);
            if (json.charAt(i) == ']') break;
            int start = i; i = valueEnd(json, i); rows.add(json.substring(start, i).trim());
            i = space(json, i);
            if (json.charAt(i) == ']') break;
            if (json.charAt(i++) != ',') throw new IllegalArgumentException("快照数组分隔错误。");
        }
        return rows;
    }
    private static int space(String json, int i) {
        while (i < json.length() && Character.isWhitespace(json.charAt(i))) i++;
        return i;
    }
    private static int stringEnd(String json, int i) {
        if (json.charAt(i++) != '"') throw new IllegalArgumentException("快照字符串错误。");
        while (i < json.length()) {
            char c = json.charAt(i++);
            if (c == '\\') i++;
            else if (c == '"') return i;
        }
        throw new IllegalArgumentException("快照字符串不完整。");
    }
    private static int valueEnd(String json, int i) {
        if (json.charAt(i) == '"') return stringEnd(json, i);
        int depth = 0;
        for (; i < json.length(); i++) {
            char c = json.charAt(i);
            if (c == '"') { i = stringEnd(json, i) - 1; continue; }
            if (c == '[' || c == '{') depth++;
            else if (c == ']' || c == '}') {
                if (depth == 0) return i;
                if (--depth == 0) return i + 1;
            } else if (c == ',' && depth == 0) return i;
        }
        throw new IllegalArgumentException("快照值不完整。");
    }
    private static String key(String raw) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < raw.length(); i++) {
            char c = raw.charAt(i);
            if (c == '\\') {
                c = raw.charAt(++i);
                if (c == 'u') { c = (char)Integer.parseInt(raw.substring(i + 1, i + 5), 16); i += 4; }
                else if (c == 'b') c = '\b'; else if (c == 'f') c = '\f';
                else if (c == 'n') c = '\n'; else if (c == 'r') c = '\r'; else if (c == 't') c = '\t';
            }
            out.append(c);
        }
        return out.toString();
    }
}
