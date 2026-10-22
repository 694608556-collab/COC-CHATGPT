package coc.logbook;

import java.io.*;
import java.util.Arrays;

/** Bounded heap regression for complete large strings, grammar and associations. */
public final class SnapshotStreamCheck {
    private static final String PREFIX = "{\"schemaVersion\":2,\"exportedAt\":\"public\",\"modules\":[{\"id\":\"m\"}],\"characters\":[],\"settings\":{},\"records\":[{\"id\":\"r\",\"moduleId\":\"m\",\"manualContent\":\"";
    private static final String SUFFIX = "\\u0000\\n完整末尾😀\"}]}";
    private static void reject(String source) throws Exception {
        try { SnapshotStream.validate(new StringReader(source)); }
        catch (IllegalArgumentException | IOException expected) { return; }
        throw new AssertionError("Malformed snapshot accepted: " + source);
    }
    public static void main(String[] args) throws Exception {
        final int body = 70 * 1024 * 1024;
        final long[] consumed = {0};
        SnapshotStream.validate(new Reader() {
            long at;
            public int read(char[] target, int offset, int length) {
                if (at == PREFIX.length() + (long)body + SUFFIX.length()) return -1;
                int count = 0;
                while (count < length && at < PREFIX.length() + (long)body + SUFFIX.length()) {
                    if (at < PREFIX.length()) target[offset + count++] = PREFIX.charAt((int)at++);
                    else if (at < PREFIX.length() + (long)body) {
                        int run = (int)Math.min(length - count, PREFIX.length() + (long)body - at);
                        Arrays.fill(target, offset + count, offset + count + run, 'x'); at += run; count += run;
                    } else target[offset + count++] = SUFFIX.charAt((int)(at++ - PREFIX.length() - body));
                }
                consumed[0] += count; return count;
            }
            public void close() {}
        });
        if (consumed[0] != PREFIX.length() + (long)body + SUFFIX.length()) throw new AssertionError("Body not consumed completely");
        String valid = PREFIX + "public" + SUFFIX;
        SnapshotStream.validate(new FilterReader(new StringReader(valid.replace("\"id\"", "\"\\u0069d\""))) {
            public int read(char[] target, int offset, int length) throws IOException { return super.read(target, offset, Math.min(1, length)); }
        });
        for (String bad : new String[] {
            valid + "{}", valid.replace("\"schemaVersion\":2", "\"schemaVersion\":02"),
            valid.replace("\"schemaVersion\":2", "\"schemaVersion\":\"2\""),
            valid.replace("\"moduleId\":\"m\"", "\"moduleId\":\"missing\""),
            valid.replace("\"id\":\"r\"", "\"id\":\"r\",\"\\u0069d\":\"r\""),
            valid.replace("\"settings\":{}", "\"settings\":[]"),
            valid.replace("public\\u0000", "bad\\q"), valid.replace("public\\u0000", "bad\n"),
            valid.replace("\"settings\":{}", "\"settings\":{\"a\":truex}"),
            valid.replace("\"settings\":{}", "\"settings\":{\"a\":1,}"),
            valid.replace("\"settings\":{}", "\"settings\":{\"a\":{\"x\":1,\"x\":2}}"),
            valid.substring(0, valid.length()-1)
        }) reject(bad);
        System.out.println("SnapshotStream: complete 70MiB string at constrained heap, split escapes, grammar, duplicate keys and graph checks passed");
    }
}
