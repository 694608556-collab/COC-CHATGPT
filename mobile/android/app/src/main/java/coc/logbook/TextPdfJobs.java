package coc.logbook;

import java.io.*;
import java.util.concurrent.*;

/** Owns one background PDF job and its private files; no caller-provided paths or shared-file writes. */
final class TextPdfJobs implements AutoCloseable {
    interface Renderer { void render(File input, OutputStream output, Progress progress) throws Exception; }
    interface Progress {
        void update(String stage, int pages, int total) throws Exception;
        void checkCancelled() throws Exception;
    }
    static final class Status {
        final String stage, error;
        final int pages, total;
        Status(String stage, int pages, int total, String error) {
            this.stage = stage; this.pages = pages; this.total = total; this.error = error;
        }
    }
    private static final class Job {
        final PdfSpool.Sealed input;
        final File output;
        volatile boolean cancelled;
        volatile Status status = new Status("layout", 0, 0, "");
        Future<?> future;
        Job(PdfSpool.Sealed input, File output) { this.input = input; this.output = output; }
    }
    private final File directory;
    private final Renderer renderer;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private Job active;

    TextPdfJobs(File directory, Renderer renderer) throws Exception {
        this.directory = directory; this.renderer = renderer;
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("无法创建 PDF 工作目录。");
        File[] stale = directory.listFiles((dir, name) -> name.matches("coc-text-[a-f0-9-]+\\.part"));
        if (stale == null) throw new IOException("无法读取 PDF 工作目录。");
        for (File file : stale) delete(file);
    }

    /** Ownership transfers only on success; the serial bridge starts a job without awaiting rendering. */
    synchronized void start(PdfSpool.Sealed input) throws Exception {
        if (active != null) { delete(input.file); throw new IllegalStateException("已有 PDF 正在导出。"); }
        Job job = new Job(input, new File(directory, "coc-text-" + input.id + ".part"));
        active = job;
        job.future = executor.submit(() -> render(job));
    }

    private void render(Job job) {
        Progress progress = new Progress() {
            public void checkCancelled() throws Exception {
                if (job.cancelled || Thread.currentThread().isInterrupted()) throw new InterruptedIOException("导出已取消。");
            }
            public void update(String stage, int pages, int total) throws Exception {
                checkCancelled(); job.status = new Status(stage, pages, total, "");
            }
        };
        try {
            try (FileOutputStream file = new FileOutputStream(job.output)) {
                class BoundedOutput extends OutputStream {
                    long size;
                    IOException failure;
                    @Override public void write(int value) throws IOException { write(new byte[]{(byte)value}, 0, 1); }
                    @Override public void write(byte[] bytes, int offset, int length) throws IOException {
                        // Android 9 Skia retries swallowed OutputStream exceptions. Drain/discard instead,
                        // then reject outside writeTo; never publish these cancelled/failed private bytes.
                        if (job.cancelled || failure != null) return;
                        if (size + length > PdfSpool.MAX_BYTES) { failure = new IOException("PDF 超过 64 MB，未保存；正文未截断。"); return; }
                        try { file.write(bytes, offset, length); size += length; }
                        catch (IOException error) { failure = error; }
                    }
                }
                BoundedOutput bounded = new BoundedOutput();
                renderer.render(job.input.file, bounded, progress);
                if (bounded.failure != null) throw bounded.failure;
                progress.checkCancelled(); file.getFD().sync();
            }
            delete(job.input.file);
            progress.update("ready", job.status.total, job.status.total);
        } catch (Exception | OutOfMemoryError error) {
            String message = error.getMessage() == null ? "PDF 生成失败。" : error.getMessage();
            try { delete(job.input.file); delete(job.output); }
            catch (Exception cleanup) { message += " " + cleanup.getMessage(); }
            job.status = new Status(job.cancelled ? "cancelled" : "failed", job.status.pages, job.status.total, message);
        }
    }

    synchronized Status status(String id) { return require(id).status; }
    synchronized boolean owns(String id) { return active != null && active.input.id.equals(id); }
    private Job require(String id) {
        if (!owns(id)) throw new IllegalArgumentException("PDF 任务已失效。");
        return active;
    }
    /** Signals immediately, even when the storage queue is busy; cleanup waits outside the monitor. */
    synchronized void requestCancel(String id) { if (owns(id)) active.cancelled = true; }
    void cancel(String id) throws Exception {
        Job job;
        synchronized (this) { if (!owns(id)) return; job = active; job.cancelled = true; }
        job.future.get();
        synchronized (this) {
            delete(job.input.file); delete(job.output);
            if (active == job) active = null;
        }
    }
    synchronized <T> T finish(String id, String name, PdfSpool.Publisher<T> publisher) throws Exception {
        Job job = require(id);
        if (!job.status.stage.equals("ready")) throw new IllegalStateException("PDF 尚未生成完成。");
        try {
            if (job.cancelled) throw new InterruptedIOException("导出已取消。");
            return PdfSpool.publish(job.output, job.input.tree, name, true, publisher);
        }
        finally { delete(job.input.file); delete(job.output); active = null; }
    }
    private static void delete(File file) throws IOException {
        if (file.exists() && !file.delete()) throw new IOException("PDF 临时文件清理失败，请重开应用重试。");
    }
    @Override public void close() throws Exception {
        String id;
        synchronized (this) { id = active == null ? null : active.input.id; }
        if (id != null) cancel(id);
        executor.shutdown();
    }
}
