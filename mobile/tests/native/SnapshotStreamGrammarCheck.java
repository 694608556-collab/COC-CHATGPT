package coc.logbook;

import java.io.*;
import java.util.Random;
import org.json.*;

/** Independent whole-text strict grammar oracle versus the bounded stream cursor. */
public final class SnapshotStreamGrammarCheck {
    private static String snapshot(String value) {
        return "{\"schemaVersion\":2,\"exportedAt\":\"public\",\"modules\":[{\"id\":\"m\"}],\"characters\":[],\"settings\":{},\"records\":[{\"id\":\"r\",\"moduleId\":\"m\",\"extra\":" + value + "}]}";
    }
    private static Object value(Random random, int depth) throws Exception {
        switch (random.nextInt(depth == 0 ? 5 : 7)) {
            case 0: return JSONObject.NULL;
            case 1: return random.nextBoolean();
            case 2: return random.nextLong();
            case 3: return random.nextDouble() * -1e30;
            case 4: return new String[]{"", "中文😀\u0000\n\"\\[]{}", "x".repeat(127)}[random.nextInt(3)];
            case 5:
                JSONArray array = new JSONArray(); for (int n = random.nextInt(5); n > 0; n--) array.put(value(random, depth-1)); return array;
            default:
                JSONObject object = new JSONObject(); for (int n = random.nextInt(5); n > 0; n--) object.put("字段"+n, value(random, depth-1)); return object;
        }
    }
    private static void bounded(String source, int chunk) throws Exception {
        SnapshotStream.validate(new FilterReader(new StringReader(source)) {
            public int read(char[] buffer, int offset, int length) throws IOException { return super.read(buffer, offset, Math.min(length, chunk)); }
        });
    }
    public static void main(String[] args) throws Exception {
        Random random = new Random(20261023L);
        for (int index = 0; index < 1000; index++) {
            String wrapper = new JSONArray().put(value(random, 4)).toString();
            String source = snapshot(wrapper.substring(1, wrapper.length()-1));
            StrictBackupJson.validate(source); bounded(source, index % 31 + 1);
        }
        String[] malformed = {"01", "+1", ".1", "1.", "1e", "1e+", "truex", "False", "NaN", "/*x*/1", "[1,]", "{\"x\":false,}", "{\"x\":1,\"\\u0078\":2}", "\"bad\\q\"", "\"bad\\u00Q1\"", "\"bad\n\""};
        for (String value : malformed) {
            String source = snapshot(value); boolean oracle = false, stream = false;
            try { StrictBackupJson.validate(source); } catch (Exception expected) { oracle = true; }
            try { bounded(source, 1); } catch (Exception expected) { stream = true; }
            if (!oracle || !stream) throw new AssertionError("Malformed grammar accepted: " + value);
        }
        bounded(snapshot("null").replace("\"schemaVersion\":2", "\"schemaVersion\":2.0"), 1);
        bounded(snapshot("null").replace("\"schemaVersion\":2", "\"schemaVersion\":2e0"), 1);
        System.out.println("SnapshotStream grammar: 1000 seeded differential cases, 16 malformed cases and numeric-version compatibility passed");
    }
}
