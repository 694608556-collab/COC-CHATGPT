package coc.logbook;

import java.io.*;
import java.util.*;

/** Strict snapshot cursor. Ignored strings are validated without retaining text;
 * Android 9 JsonReader.skipValue still materializes long strings. */
final class SnapshotJson implements AutoCloseable {
    interface Field { void accept(String name) throws Exception; }
    interface Element { void accept() throws Exception; }
    private final Reader input;
    private final char[] buffer = new char[32768];
    private int position, limit, depth;
    SnapshotJson(Reader input) { this.input = input; }
    private int peek() throws IOException {
        while (position == limit) {
            int count = input.read(buffer); if (count < 0) return -1;
            position = 0; limit = count;
        }
        return buffer[position];
    }
    private int take() throws IOException { int value = peek(); if (value >= 0) position++; return value; }
    private void fail() { throw new IllegalArgumentException("快照JSON结构、字段或转义无效。"); }
    private void space() throws IOException { while (peek() == ' ' || peek() == '\t' || peek() == '\r' || peek() == '\n') take(); }
    private void expect(int value) throws IOException { space(); if (take() != value) fail(); }
    private void enter() { if (++depth > 256) fail(); }
    void object(Field field) throws Exception {
        expect('{'); enter(); Set<String> keys = new HashSet<>(); space();
        if (peek() != '}') for (;;) {
            String key = string(); if (!keys.add(key)) fail(); expect(':'); field.accept(key); space();
            if (peek() != ',') break; take();
        }
        expect('}'); depth--;
    }
    void array(Element element) throws Exception {
        expect('['); enter(); space();
        if (peek() != ']') for (;;) { element.accept(); space(); if (peek() != ',') break; take(); }
        expect(']'); depth--;
    }
    String string() throws IOException { return string(true); }
    void discardString() throws IOException { string(false); }
    private String string(boolean retain) throws IOException {
        expect('"'); StringBuilder text = retain ? new StringBuilder() : null;
        for (;;) {
            int value = take();
            if (value == '"') return retain ? text.toString() : null;
            if (value < 32) fail();
            if (value == '\\') {
                int escape = take();
                switch (escape) {
                    case '"': case '\\': case '/': value = escape; break;
                    case 'b': value = '\b'; break;
                    case 'f': value = '\f'; break;
                    case 'n': value = '\n'; break;
                    case 'r': value = '\r'; break;
                    case 't': value = '\t'; break;
                    case 'u':
                        value = 0;
                        for (int index = 0; index < 4; index++) {
                            int hex = take(), digit = hex < 0 || hex > 127 ? -1 : Character.digit((char)hex, 16);
                            if (digit < 0) fail(); value = value * 16 + digit;
                        }
                        break;
                    default: fail();
                }
            }
            if (retain) text.append((char)value);
        }
    }
    private boolean digit(int value) { return value >= '0' && value <= '9'; }
    private void numberPart(StringBuilder text) throws IOException { int value = take(); if (text != null) text.append((char)value); }
    private String number(boolean retain) throws IOException {
        space(); StringBuilder text = retain ? new StringBuilder() : null;
        if (peek() == '-') numberPart(text);
        if (peek() == '0') numberPart(text);
        else { if (peek() < '1' || peek() > '9') fail(); do { numberPart(text); } while (digit(peek())); }
        if (peek() == '.') { numberPart(text); if (!digit(peek())) fail(); do { numberPart(text); } while (digit(peek())); }
        if (peek() == 'e' || peek() == 'E') {
            numberPart(text); if (peek() == '+' || peek() == '-') numberPart(text);
            if (!digit(peek())) fail(); do { numberPart(text); } while (digit(peek()));
        }
        return retain ? text.toString() : null;
    }
    void versionTwo() throws IOException { if (Double.parseDouble(number(true)) != 2) throw new IllegalArgumentException("备份版本不兼容。"); }
    private void literal(String text) throws IOException { for (int index = 0; index < text.length(); index++) if (take() != text.charAt(index)) fail(); }
    void skip() throws Exception {
        space(); int value = peek();
        if (value == '"') { string(false); return; }
        if (value == '{') { object(key -> skip()); return; }
        if (value == '[') { array(() -> skip()); return; }
        if (value == 't') literal("true"); else if (value == 'f') literal("false"); else if (value == 'n') literal("null"); else number(false);
    }
    void end() throws IOException { space(); if (peek() != -1) fail(); }
    @Override public void close() throws IOException { input.close(); }
}
