package coc.logbook;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Iterator;
import java.util.List;
import java.util.Random;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Independent unchanged strict validator + the device's JSONObject are the oracle. */
@RunWith(AndroidJUnit4.class)
public final class StrictTableJsonTest {
    private static String repeat(String value, int count) {
        StringBuilder result = new StringBuilder();
        for (int index = 0; index < count; index++) result.append(value);
        return result.toString();
    }

    private static JSONObject oracle(String source) throws Exception {
        StrictBackupJson.validate(source);
        return new JSONObject(source);
    }

    private static void sameValue(Object expected, Object actual) throws Exception {
        assertNotNull(expected);
        assertNotNull(actual);
        assertEquals("Native JSON value class changed", expected.getClass(), actual.getClass());
        if (expected instanceof JSONObject) {
            JSONObject left = (JSONObject) expected, right = (JSONObject) actual;
            List<String> keys = new ArrayList<>(), actualKeys = new ArrayList<>();
            for (Iterator<String> it = left.keys(); it.hasNext();) keys.add(it.next());
            for (Iterator<String> it = right.keys(); it.hasNext();) actualKeys.add(it.next());
            assertEquals("Complete key order changed", keys, actualKeys);
            for (String key : keys) sameValue(left.get(key), right.get(key));
        } else if (expected instanceof JSONArray) {
            JSONArray left = (JSONArray) expected, right = (JSONArray) actual;
            assertEquals(left.length(), right.length());
            for (int index = 0; index < left.length(); index++) sameValue(left.get(index), right.get(index));
        } else if (expected instanceof Double) {
            assertEquals("Double precision/sign changed", Double.doubleToRawLongBits((Double) expected), Double.doubleToRawLongBits((Double) actual));
        } else if (expected == JSONObject.NULL) {
            assertSame(JSONObject.NULL, actual);
        } else {
            assertEquals(expected, actual);
        }
    }

    private static boolean equivalent(String source) throws Exception {
        JSONObject expected = null, actual = null;
        Exception before = null, after = null;
        try { expected = oracle(source); } catch (Exception failure) { before = failure; }
        try { actual = StrictTableJson.parseObject(source); } catch (Exception failure) { after = failure; }
        assertEquals("Strict acceptance changed for public source: " + source, before == null, after == null);
        if (before != null) return false;
        sameValue(expected, actual);
        assertEquals("Full JSON serialization changed", expected.toString(), actual.toString());
        return true;
    }

    private static Object generated(Random random, int depth) throws Exception {
        switch (random.nextInt(depth == 0 ? 7 : 9)) {
            case 0: return JSONObject.NULL;
            case 1: return random.nextBoolean();
            case 2: return random.nextInt();
            case 3: return random.nextLong();
            case 4: return random.nextDouble() * (random.nextBoolean() ? 1e30 : -1e-30);
            case 5: return new String[]{"", "中文😀\u0000\n\"\\[]{}", "\ud800", "\udfff", "\r\n\t\b\f", repeat("x", 129)}[random.nextInt(6)];
            case 6: return random.nextBoolean() ? -0.0 : 9007199254740993L;
            case 7:
                JSONArray array = new JSONArray();
                for (int n = random.nextInt(5); n > 0; n--) array.put(generated(random, depth - 1));
                return array;
            default:
                JSONObject object = new JSONObject();
                for (int n = random.nextInt(5); n > 0; n--) object.put("字段😀\\\"" + n, generated(random, depth - 1));
                return object;
        }
    }

    @Test public void thousandSeededObjectsKeepEveryTypeValueAndOrderedField() throws Exception {
        Random random = new Random(20261023L);
        for (int index = 0; index < 1000; index++) {
            JSONObject object = new JSONObject().put("sheetOrder", index).put("rowOrder", index * 2)
                .put("value", generated(random, 4)).put("tail", "完整末尾😀\u0000" + index);
            assertTrue("Generated JSON must be accepted", equivalent(object.toString()));
        }
    }

    @Test public void numericBoundariesUseExactPlatformScalarSemantics() throws Exception {
        String[] numbers = {"0", "-0", "0.0", "-0.0", "0e0", "-0e0", "2.0", "2e0", "1E+03", "1e-0003",
            "2147483647", "2147483648", "-2147483648", "-2147483649", "9007199254740991", "9007199254740992", "9007199254740993",
            "9223372036854775807", "9223372036854775808", "-9223372036854775808", "-9223372036854775809",
            "1.7976931348623157e308", "1.7976931348623159e308", "1e309", "-1e309", "2.2250738585072014e-308",
            "5e-324", "1e-324", "-1e-324", "1e-9999", "-1e-9999", repeat("9", 4000)};
        for (String number : numbers) {
            equivalent("{\"number\":" + number + "}");
            equivalent("{\"array\":[" + number + ",null,true,false,\"complete tail\"]}");
            equivalent("{\"nested\":{\"number\":" + number + "},\"tail\":0}");
        }
    }

    @Test public void completeEscapesAndUtf16CodeUnitsMatchWithoutNormalization() throws Exception {
        String escaped = "{\"\\u006b\\u0065y\":\"\\\"\\\\\\/\\b\\f\\n\\r\\t\\u0000\\u4e2d\\uD83D\\uDE00\\ud800X\\udfff\",\"tail\":\"末尾\"}";
        assertTrue(equivalent(escaped));
        assertEquals("\"\\/\b\f\n\r\t\u0000中😀\ud800X\udfff", StrictTableJson.parseObject(escaped).getString("key"));
        assertTrue(equivalent("{\"a\":\"\\u0061\",\"b\":\"a\",\"c\":\"\\\\u0061\"}"));
        assertTrue(equivalent("{\"literal\":\"中文😀\ud800\udfff\",\"\ud800\":\"末尾\"}"));
    }

    @Test public void coordinateIntegerFastPathKeepsEveryBoundaryAndRejectsLookalikes() throws Exception {
        long[] values = {0, 1, 9, 10, 99, 100, 1000, 999999999L, 1000000000L,
            2147483646L, 2147483647L, 2147483648L, 9999999999L, 10000000000L};
        for (long value : values) {
            String source = "{\"sheetOrder\":" + value + ",\"rowOrder\":0,\"tail\":\"完整末尾\"}";
            assertTrue(equivalent(source));
            if (value <= Integer.MAX_VALUE) assertEquals(Integer.class, StrictTableJson.parseObject(source).get("sheetOrder").getClass());
        }
        Random random = new Random(2147483647L);
        for (int index = 0; index < 300; index++)
            assertTrue(equivalent("{\"rowOrder\":" + (random.nextInt() & Integer.MAX_VALUE) + "}"));
        for (String invalid : new String[]{"00", "01", "0000000001", "1a", "a1", "1_0", "1\\u0030", "１２", "1\u0000", "1+0", "0x10"})
            assertFalse(equivalent("{\"rowOrder\":" + invalid + "}"));
        for (String fallback : new String[]{"-0", "-1", "-2147483648", "0.0", "-0.0", "1e0", "1.00", "2147483648", "1e309"})
            equivalent("{\"rowOrder\":" + fallback + "}");
    }

    @Test public void decodedDuplicateKeysAreRejectedAtEveryLevel() throws Exception {
        for (String source : new String[]{
            "{\"a\":1,\"a\":2}", "{\"a\":1,\"\\u0061\":2}",
            "{\"nested\":[{\"x\":null,\"\\u0078\":false}]}",
            "{\"😀\":1,\"\\ud83d\\ude00\":2}",
            "{\"\\ud800\":1,\"\ud800\":2}", "{\"\\n\":1,\"\\u000a\":2}"
        }) assertFalse(equivalent(source));
    }

    @Test public void malformedGrammarWrongRootsAndNonJsonWhitespaceStayRejected() throws Exception {
        String[] fragments = {"01", "-01", "+1", ".1", "1.", "1e", "1e+", "0x1", "NaN", "Infinity", "-Infinity", "undefined",
            "truex", "False", "NULL", "/*x*/1", "//x\n1", "[1,]", "[,1]", "[1,,2]", "[1;2]", "{\"x\":1,}",
            "{'a':1}", "{a:1}", "{\"a\"=1}", "{\"a\"=>1}", "\"bad\\q\"", "\"bad\\u00Q1\"", "\"bad\\u00１1\"", "\"bad\n\"", "\"bad\u0000\"", "\"unfinished\\"};
        for (String fragment : fragments) assertFalse(equivalent("{\"value\":" + fragment + "}"));
        for (String source : new String[]{"", " ", "null", "false", "1", "\"value\"", "[]", "{} false", "{}{}", "{\"x\":1}\u0000", "\ufeff{}", "{\u00a0\"x\":1}", "{\f\"x\":1}"})
            assertFalse(equivalent(source));
        assertTrue(equivalent(" \t\r\n{\"x\":[true,false,null]} \t\r\n"));
    }

    @Test public void everyTruncatedPrefixAndExtraTailIsChecked() throws Exception {
        String complete = "{\"sheetOrder\":0,\"rowOrder\":1,\"value\":{\"text\":\"中文\\uD83D\\uDE00\\n尾\",\"array\":[-1.25e3,true,null,{\"x\":\"y\"}]}}";
        for (int length = 0; length < complete.length(); length++) assertFalse(equivalent(complete.substring(0, length)));
        assertTrue(equivalent(complete));
        for (String tail : Arrays.asList("x", "null", "]", ",", " /*comment*/")) assertFalse(equivalent(complete + tail));
    }

    @Test public void originalDepthBoundaryAndCompleteLargeStringsArePreserved() throws Exception {
        for (int depth : new int[]{254, 255, 256, 257}) {
            String source = "{\"value\":" + repeat("[", depth) + "0" + repeat("]", depth) + "}";
            assertEquals(depth <= 255, equivalent(source));
        }
        String full = repeat("中😀\u0000\r\n", 20000) + "不可丢失的最后正文";
        String source = new JSONObject().put("text", full).put("tail", true).toString();
        assertTrue(equivalent(source));
        assertEquals(full, StrictTableJson.parseObject(source).getString("text"));
    }

    @Test public void separateParsesNeverReuseMutableValues() throws Exception {
        String source = "{\"values\":[{\"text\":\"完整正文\"}],\"tail\":null}";
        JSONObject first = StrictTableJson.parseObject(source), second = StrictTableJson.parseObject(source);
        first.getJSONArray("values").getJSONObject(0).put("text", "modified public copy");
        first.remove("tail");
        sameValue(oracle(source), second);
        assertTrue(second.has("tail"));
    }
}
