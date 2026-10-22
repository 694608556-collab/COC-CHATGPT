package coc.logbook;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.UUID;

/** One private, bounded PDF spool. Call on the bridge's serial queue; never accepts caller paths. */
final class PdfSpool implements AutoCloseable {
    private final long maximumBytes;
    private final File directory;
    private File file;
    private FileOutputStream output;
    private String id, tree;
    private long size;

    /** Creates/cleans only our dedicated cache directory; never scans shared user storage. */
    PdfSpool(File directory) throws Exception {
        this(directory, LogbookLimits.ARCHIVE_FILE_BYTES);
    }

    /** Budget chosen by the native operation, never by a bridge argument. */
    PdfSpool(File directory, long maximumBytes) throws Exception {
        this.maximumBytes = maximumBytes;
        this.directory = directory;
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("无法创建 PDF 临时目录。");
        File[] stale = directory.listFiles((dir, name) -> name.matches("coc-pdf-[a-f0-9-]+\\.part"));
        if (stale == null) throw new IllegalStateException("无法读取 PDF 临时目录。");
        for (File item : stale) if (!item.delete()) throw new IllegalStateException("无法清理上次 PDF 临时文件。");
    }

    /** Starts one private spool bound to the current archive tree. */
    String begin(String location) throws Exception {
        if (file != null) throw new IllegalStateException("已有 PDF 正在导出。");
        id = UUID.randomUUID().toString();
        file = new File(directory, "coc-pdf-" + id + ".part");
        tree = location; size = 0;
        try { output = new FileOutputStream(file); return id; }
        catch (Exception error) { close(); throw error; }
    }

    /** Appends a single bounded chunk; failed writes invalidate and clean this spool. */
    void append(String token, byte[] bytes) throws Exception {
        require(token);
        try {
            if (output == null || bytes.length > LogbookLimits.TRANSFER_CHUNK_BYTES || size + bytes.length > maximumBytes)
                throw new IllegalArgumentException("PDF 文件或分段超过大小限制。");
            output.write(bytes); size += bytes.length;
        } catch (Exception error) { close(); throw error; }
    }

    /** Publisher receives a complete closed file; it must roll back its own new destination on failure. */
    interface Publisher<T> { T publish(File source, String tree, String name, long size, String sha256) throws Exception; }

    /** Transfers a sealed private input to a background renderer; the receiver must delete it. */
    static final class Sealed {
        final File file;
        final String id, tree;
        Sealed(File file, String id, String tree) { this.file = file; this.id = id; this.tree = tree; }
    }
    Sealed take(String token) throws Exception {
        require(token);
        try {
            output.flush(); output.getFD().sync(); output.close(); output = null;
            if (file.length() != size) throw new IllegalStateException("正文临时文件不完整。");
            Sealed result = new Sealed(file, id, tree);
            file = null; id = null; tree = null; size = 0;
            return result;
        } catch (Exception error) { close(); throw error; }
    }

    /** Seals, verifies completeness and publishes once; always removes the private spool. */
    <T> T finish(String token, String name, Publisher<T> publisher) throws Exception {
        return finish(token, name, true, publisher);
    }

    /** Same bounded transaction for generated non-PDF exports; no external paths or byte truncation. */
    <T> T finish(String token, String name, boolean pdf, Publisher<T> publisher) throws Exception {
        require(token);
        try {
            output.flush(); output.getFD().sync(); output.close(); output = null;
            if (file.length() != size) throw new IllegalStateException("导出临时文件不完整。");
            return publish(file, tree, name, pdf, maximumBytes, publisher);
        } finally { close(); }
    }

    /** Shared verification/commit boundary for both browser raster and native text PDF files. */
    static <T> T publish(File file, String tree, String name, boolean pdf, Publisher<T> publisher) throws Exception {
            return publish(file, tree, name, pdf, LogbookLimits.ARCHIVE_FILE_BYTES, publisher);
    }

    private static <T> T publish(File file, String tree, String name, boolean pdf, long maximumBytes, Publisher<T> publisher) throws Exception {
            long size = file.length();
            if (name == null || name.isEmpty() || name.equals(".") || name.equals("..") || name.length() > 255 || (pdf && !name.endsWith(".pdf")) || name.matches(".*[/\\\\\u0000-\u001f].*"))
                throw new IllegalArgumentException("导出文件名不合法。");
            if ((pdf && size < 16) || size > maximumBytes) throw new IllegalStateException("导出临时文件不完整或超过大小限制。");
            if (pdf) try (RandomAccessFile input = new RandomAccessFile(file, "r")) {
                byte[] header = new byte[5]; input.readFully(header);
                byte[] tail = new byte[(int)Math.min(32, size)]; input.seek(size - tail.length); input.readFully(tail);
                if (!"%PDF-".equals(new String(header, StandardCharsets.US_ASCII)) || !new String(tail, StandardCharsets.US_ASCII).trim().endsWith("%%EOF"))
                    throw new IllegalStateException("PDF 不完整，未保存。");
            }
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (FileInputStream input = new FileInputStream(file)) {
                byte[] chunk = new byte[32768]; int n;
                while ((n = input.read(chunk)) != -1) digest.update(chunk, 0, n);
            }
            StringBuilder hash = new StringBuilder();
            for (byte b : digest.digest()) hash.append(String.format("%02x", b & 255));
            return publisher.publish(file, tree, name, size, hash.toString());
    }

    /** Idempotent cancellation cannot remove another export or an already published document. */
    void cancel(String token) throws Exception { if (id != null && id.equals(token)) close(); }

    private void require(String token) {
        if (file == null || id == null || !id.equals(token)) throw new IllegalArgumentException("PDF 暂存已失效。");
    }

    /** Closes handles before deletion; a failed deletion is reported and retained for a cleanup retry. */
    @Override public void close() throws Exception {
        try { if (output != null) output.close(); }
        finally { output = null; }
        if (file != null && file.exists() && !file.delete()) throw new IllegalStateException("PDF 临时文件清理失败，请重开应用重试。");
        file = null; id = null; tree = null; size = 0;
    }
}
