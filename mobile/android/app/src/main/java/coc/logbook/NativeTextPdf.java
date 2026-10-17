package coc.logbook;

import android.app.ActivityManager;
import android.content.Context;
import android.graphics.*;
import android.graphics.pdf.PdfDocument;
import java.io.*;
import java.nio.*;
import java.nio.charset.*;
import java.util.*;

/** Original bundled-font A4 renderer. All PdfDocument calls stay on one background thread. */
final class NativeTextPdf implements TextPdfJobs.Renderer {
    private final Context context;
    private Paint latin, chinese;
    private BitSet latinCoverage;

    NativeTextPdf(Context context) { this.context = context.getApplicationContext(); }

    private void loadFonts() throws Exception {
        if (latin != null) return;
        String sf = null, ping = null;
        for (String name : context.getAssets().list("public/fonts")) {
            if (name.startsWith("SF-Pro-Text-Regular-")) sf = "public/fonts/" + name;
            if (name.startsWith("PingFangSC-Regular-")) ping = "public/fonts/" + name;
        }
        if (sf == null || ping == null) throw new IOException("应用原字体缺失，未生成替代字体 PDF。");
        latinCoverage = coverage(sf);
        latin = paint(Typeface.createFromAsset(context.getAssets(), sf));
        chinese = paint(Typeface.createFromAsset(context.getAssets(), ping));
    }

    private static Paint paint(Typeface face) {
        Paint result = new Paint(Paint.ANTI_ALIAS_FLAG);
        result.setTypeface(face); result.setTextSize(24); result.setColor(0xff171717);
        return result;
    }

    /** Uses the actual cmap rather than hasGlyph(), which also reports Android fallback glyphs. */
    private BitSet coverage(String asset) throws Exception {
        byte[] bytes;
        try (InputStream input = context.getAssets().open(asset); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] block = new byte[8192]; int count;
            while ((count = input.read(block)) != -1) out.write(block, 0, count);
            bytes = out.toByteArray();
        }
        ByteBuffer font = ByteBuffer.wrap(bytes).order(ByteOrder.BIG_ENDIAN);
        int cmap = 0;
        for (int i = 0; i < (font.getShort(4) & 65535); i++) {
            int position = 12 + i * 16;
            if (font.getInt(position) == 0x636d6170) cmap = font.getInt(position + 8);
        }
        if (cmap == 0) throw new IOException("原字体没有字符映射。");
        int chosen = 0;
        for (int i = 0; i < (font.getShort(cmap + 2) & 65535); i++) {
            int position = cmap + 4 + i * 8, platform = font.getShort(position) & 65535;
            int encoding = font.getShort(position + 2) & 65535, sub = cmap + font.getInt(position + 4);
            int format = font.getShort(sub) & 65535;
            if ((platform == 0 || platform == 3 && (encoding == 1 || encoding == 10)) && (format == 4 || format == 12)) {
                if (chosen == 0 || format == 12) chosen = sub;
                if (format == 12) break;
            }
        }
        if (chosen == 0) throw new IOException("原字体缺少 Unicode 字符映射。");
        BitSet result = new BitSet(1114112);
        if (font.getShort(chosen) == 12) {
            for (int i = 0; i < font.getInt(chosen + 12); i++) {
                int position = chosen + 16 + i * 12, first = font.getInt(position), end = font.getInt(position + 4);
                int glyph = font.getInt(position + 8);
                for (int cp = first; cp <= end; cp++) if (glyph + cp - first != 0) result.set(cp);
            }
        } else {
            int count = (font.getShort(chosen + 6) & 65535) / 2, ends = chosen + 14;
            int starts = ends + 2 * count + 2, deltas = starts + 2 * count, offsets = deltas + 2 * count;
            for (int i = 0; i < count; i++) {
                int end = font.getShort(ends + i * 2) & 65535, first = font.getShort(starts + i * 2) & 65535;
                int delta = font.getShort(deltas + i * 2), offset = font.getShort(offsets + i * 2) & 65535;
                for (int cp = first; cp <= end; cp++) {
                    int glyph = offset == 0 ? (cp + delta) & 65535 : font.getShort(offsets + i * 2 + offset + 2 * (cp - first)) & 65535;
                    if (offset != 0 && glyph != 0) glyph = (glyph + delta) & 65535;
                    if (glyph != 0) result.set(cp);
                }
            }
        }
        return result;
    }

    private float width(String text) {
        float width = 0;
        for (int start = 0; start < text.length();) {
            boolean sf = latinCoverage.get(text.codePointAt(start));
            int end = start + Character.charCount(text.codePointAt(start));
            while (end < text.length() && latinCoverage.get(text.codePointAt(end)) == sf)
                end += Character.charCount(text.codePointAt(end));
            width += (sf ? latin : chinese).measureText(text, start, end); start = end;
        }
        return width;
    }

    private void draw(Canvas canvas, String text, float y) {
        float x = 86;
        for (int start = 0; start < text.length();) {
            boolean sf = latinCoverage.get(text.codePointAt(start));
            int emoji = emojiEnd(text, start);
            if (emoji > start) {
                Paint paint = sf ? latin : chinese;
                drawEmoji(canvas, text, start, emoji, x, y, paint);
                x += paint.measureText(text, start, emoji); start = emoji; continue;
            }
            int end = start + Character.charCount(text.codePointAt(start));
            while (end < text.length() && latinCoverage.get(text.codePointAt(end)) == sf && emojiEnd(text, end) == end)
                end += Character.charCount(text.codePointAt(end));
            Paint paint = sf ? latin : chinese;
            canvas.drawText(text, start, end, x, y, paint);
            x += paint.measureText(text, start, end); start = end;
        }
    }

    /** Keep emoji sequences intact; ordinary/complex-script runs still use the original font paints. */
    private static int emojiEnd(String text, int start) {
        int cp = text.codePointAt(start), end = start + Character.charCount(cp);
        boolean symbol = cp >= 0x1f000 && cp <= 0x1faff || cp >= 0x2600 && cp <= 0x27ff;
        boolean variant = (cp == 0xa9 || cp == 0xae || cp == 0x2122 || cp >= 0x2190 && cp <= 0x21ff || cp >= '0' && cp <= '9' || cp == '#' || cp == '*')
            && end < text.length() && (text.codePointAt(end) == 0xfe0f || text.codePointAt(end) == 0x20e3);
        if (!symbol && !variant) return start;
        while (end < text.length()) {
            int next = text.codePointAt(end);
            if (next == 0xfe0e || next == 0xfe0f || next == 0x20e3 || next >= 0x1f3fb && next <= 0x1f3ff || next >= 0xe0020 && next <= 0xe007f) end += Character.charCount(next);
            else if (next == 0x200d && end + 1 < text.length()) {
                end++; end += Character.charCount(text.codePointAt(end));
            } else if (cp >= 0x1f1e6 && cp <= 0x1f1ff && next >= 0x1f1e6 && next <= 0x1f1ff) { end += Character.charCount(next); break; }
            else break;
        }
        return end;
    }

    /** Rasterize only the original fallback emoji glyphs, not a full page or a replacement font. */
    private static void drawEmoji(Canvas canvas, String text, int start, int end, float x, float y, Paint paint) {
        Rect bounds = new Rect(); paint.getTextBounds(text, start, end, bounds);
        Paint.FontMetrics metrics = paint.getFontMetrics();
        int left = Math.min(0, bounds.left) - 2, top = (int)Math.floor(Math.min(metrics.top, bounds.top)) - 2;
        int right = (int)Math.ceil(Math.max(paint.measureText(text, start, end), bounds.right)) + 2;
        int bottom = (int)Math.ceil(Math.max(metrics.bottom, bounds.bottom)) + 2;
        Bitmap image = Bitmap.createBitmap(Math.max(1, right - left), Math.max(1, bottom - top), Bitmap.Config.ARGB_8888);
        try {
            new Canvas(image).drawText(text, start, end, -left, -top, paint);
            canvas.drawBitmap(image, x + left, y + top, null);
        } finally { image.recycle(); }
    }

    private float measured(String text, Map<String, Float> cache) {
        Float known = cache.get(text);
        if (known != null) return known;
        float value = width(text);
        if (text.length() <= 128) {
            if (cache.size() >= 8192) cache.clear();
            cache.put(text, value);
        }
        return value;
    }

    /** Binary search is restricted to non-joining BMP text; complex scripts retain code-point wrapping. */
    private void wrap(String paragraph, List<String> lines, Map<String, Float> cache, TextPdfJobs.Progress progress) throws Exception {
        if (paragraph.length() <= 256 && measured(paragraph, cache) <= 1068) { lines.add(paragraph); return; }
        boolean simple = true;
        for (int i = 0; i < paragraph.length(); i++) {
            char cp = paragraph.charAt(i);
            if (!(cp >= 32 && cp <= 126 || cp >= 0x3000 && cp <= 0x3029 || cp >= 0x4e00 && cp <= 0x9fff || cp >= 0xff01 && cp <= 0xff60)) { simple = false; break; }
        }
        for (int start = 0; start < paragraph.length();) {
            progress.checkCancelled(); int end;
            if (simple) {
                int low = start, high = Math.min(start + 16, paragraph.length());
                while (measured(paragraph.substring(start, high), cache) <= 1068) {
                    low = high;
                    if (high == paragraph.length()) break;
                    high = Math.min(paragraph.length(), start + (high - start) * 2);
                }
                while (low + 1 < high) {
                    int middle = (low + high) >>> 1;
                    if (measured(paragraph.substring(start, middle), cache) <= 1068) low = middle;
                    else high = middle;
                }
                end = Math.max(start + 1, low);
            } else {
                end = start;
                while (end < paragraph.length()) {
                    int next = end + Character.charCount(paragraph.codePointAt(end));
                    if (end > start && measured(paragraph.substring(start, next), cache) > 1068) break;
                    end = next;
                    if ((end - start & 255) == 0) progress.checkCancelled();
                }
            }
            lines.add(paragraph.substring(start, end)); start = end;
        }
    }

    private void checkMemory() throws IOException {
        ActivityManager.MemoryInfo info = new ActivityManager.MemoryInfo();
        ((ActivityManager)context.getSystemService(Context.ACTIVITY_SERVICE)).getMemoryInfo(info);
        Runtime runtime = Runtime.getRuntime();
        long headroom = runtime.maxMemory() - (runtime.totalMemory() - runtime.freeMemory());
        if (info.availMem < 32L * 1024 * 1024 || headroom < 12L * 1024 * 1024)
            throw new IOException("手机可用内存不足，未保存半成品；请关闭其他应用后重试。");
    }

    @Override public void render(File input, OutputStream output, TextPdfJobs.Progress progress) throws Exception {
        progress.update("layout", 0, 0); checkMemory(); loadFonts();
        List<String> lines = new ArrayList<>(); Map<String, Float> cache = new HashMap<>();
        CharsetDecoder utf8 = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT);
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(new FileInputStream(input), utf8), 32768)) {
            String paragraph; int count = 0;
            while ((paragraph = reader.readLine()) != null) {
                wrap(paragraph, lines, cache, progress);
                if (++count % 256 == 0) { progress.update("layout", 0, 0); checkMemory(); }
            }
        }
        try (RandomAccessFile tail = new RandomAccessFile(input, "r")) {
            if (tail.length() == 0) lines.add("");
            else { tail.seek(tail.length() - 1); int last = tail.read(); if (last == 10 || last == 13) lines.add(""); }
        }
        cache.clear();
        int pages = Math.max(1, (lines.size() + 41) / 42);
        PdfDocument pdf = new PdfDocument();
        try {
            for (int page = 0; page < pages; page++) {
                progress.update("render", page, pages);
                if (page % 16 == 0) checkMemory();
                PdfDocument.Page current = pdf.startPage(new PdfDocument.PageInfo.Builder(595, 842, page + 1).create());
                try {
                    Canvas canvas = current.getCanvas(); canvas.scale(595f / 1240, 842f / 1754); canvas.drawColor(Color.WHITE);
                    for (int line = page * 42; line < Math.min(lines.size(), (page + 1) * 42); line++) {
                        progress.checkCancelled(); draw(canvas, lines.get(line), 86 + (line - page * 42) * 38);
                    }
                    latin.setTextSize(18);
                    try { canvas.drawText(Integer.toString(page + 1), 600, 1710, latin); }
                    finally { latin.setTextSize(24); }
                } finally { pdf.finishPage(current); }
            }
            progress.update("write", pages, pages); checkMemory(); pdf.writeTo(output);
        } finally { pdf.close(); }
    }
}
