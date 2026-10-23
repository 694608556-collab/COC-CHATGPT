package coc.logbook;

import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

/**
 * One strict structural parse of a complete, already UTF-8-decoded table line.
 * No input or result is cached. This grants no source, file or commit authority;
 * callers must retain full source proofs and all table/business validation.
 */
final class StrictTableJson {
    private static final Pattern NUMBER = Pattern.compile("-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?");
    private final String text;
    private int offset;

    private StrictTableJson(String text) {
        this.text = text;
    }

    /** Same accepted object roots and value semantics as strict validation followed by Android JSONObject. */
    static JSONObject parseObject(String text) throws Exception {
        StrictTableJson input = new StrictTableJson(text);
        Object value = input.value(0);
        input.space();
        if (input.offset != text.length() || !(value instanceof JSONObject)) input.fail();
        return (JSONObject) value;
    }

    private void fail() {
        throw new IllegalArgumentException("表格JSON不完整、含重复字段或类型拼写无效。");
    }

    private char peek() {
        return offset < text.length() ? text.charAt(offset) : '\0';
    }

    private void space() {
        while (offset < text.length() && " \t\r\n".indexOf(text.charAt(offset)) >= 0) offset++;
    }

    private void expect(char expected) {
        space();
        if (offset >= text.length() || text.charAt(offset) != expected) fail();
        offset++;
    }

    /** Decode while checking the original grammar; retain exact UTF-16 surrogate semantics. */
    private String string() {
        expect('"');
        int start = offset;
        StringBuilder decoded = null;
        while (offset < text.length()) {
            char value = text.charAt(offset++);
            if (value == '"') {
                if (decoded == null) return text.substring(start, offset - 1);
                decoded.append(text, start, offset - 1);
                return decoded.toString();
            }
            if (value < 32) fail();
            if (value != '\\') continue;
            if (decoded == null) decoded = new StringBuilder();
            decoded.append(text, start, offset - 1);
            if (offset >= text.length()) fail();
            char escape = text.charAt(offset++);
            switch (escape) {
                case '"': case '\\': case '/': decoded.append(escape); break;
                case 'b': decoded.append('\b'); break;
                case 'f': decoded.append('\f'); break;
                case 'n': decoded.append('\n'); break;
                case 'r': decoded.append('\r'); break;
                case 't': decoded.append('\t'); break;
                case 'u':
                    int unit = 0;
                    for (int index = 0; index < 4; index++) {
                        if (offset >= text.length()) fail();
                        char hex = text.charAt(offset++);
                        int digit = Character.digit(hex, 16);
                        if (digit < 0 || hex > 127) fail();
                        unit = (unit << 4) | digit;
                    }
                    decoded.append((char) unit);
                    break;
                default: fail();
            }
            start = offset;
        }
        fail();
        return null; // fail always throws.
    }

    private Object value(int depth) throws Exception {
        if (depth > 256) fail();
        space();
        char next = peek();
        if (next == '"') return string();
        if (next == '{') {
            offset++;
            space();
            JSONObject object = new JSONObject();
            if (peek() != '}') for (;;) {
                String key = string();
                // Every parsed value is non-null (JSON null is JSONObject.NULL),
                // so the result itself retains every decoded key for this check.
                if (object.has(key)) fail();
                expect(':');
                // JSONObject.put retains Android's numeric validity checks.
                object.put(key, value(depth + 1));
                space();
                if (peek() != ',') break;
                offset++;
            }
            expect('}');
            return object;
        }
        if (next == '[') {
            offset++;
            space();
            JSONArray array = new JSONArray();
            if (peek() != ']') for (;;) {
                array.put(value(depth + 1));
                space();
                if (peek() != ',') break;
                offset++;
            }
            expect(']');
            return array;
        }
        int start = offset;
        while (offset < text.length() && ",]} \t\r\n".indexOf(text.charAt(offset)) < 0) offset++;
        String scalar = text.substring(start, offset);
        if (scalar.equals("true")) return Boolean.TRUE;
        if (scalar.equals("false")) return Boolean.FALSE;
        if (scalar.equals("null")) return JSONObject.NULL;
        // Table coordinates are normally canonical non-negative int values.
        // Check every character and the range directly; other numeric forms
        // retain the platform decoder, including signed zero and overflow.
        if (!scalar.isEmpty() && scalar.length() <= 10 &&
            (scalar.length() == 1 || scalar.charAt(0) != '0')) {
            long integer = 0;
            boolean decimal = true;
            for (int index = 0; index < scalar.length(); index++) {
                char digit = scalar.charAt(index);
                if (digit < '0' || digit > '9') { decimal = false; break; }
                integer = integer * 10 + digit - '0';
            }
            if (decimal && integer <= Integer.MAX_VALUE) return Integer.valueOf((int) integer);
        }
        if (!NUMBER.matcher(scalar).matches()) fail();
        // Decode only this strictly checked scalar with the same platform
        // implementation as the old full object parse: Integer/Long/Double,
        // negative zero, exponents, overflow and precision stay compatible.
        return new JSONTokener(scalar).nextValue();
    }
}
