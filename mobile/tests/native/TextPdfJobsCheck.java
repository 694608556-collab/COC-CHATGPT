package coc.logbook;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Exercises asynchronous export, cancellation and publication through the public job boundary. */
public final class TextPdfJobsCheck {
    public static void main(String[] args) throws Exception {
        File root = Files.createTempDirectory("coc-text-pdf-check-").toFile();
        CountDownLatch rendering = new CountDownLatch(1), release = new CountDownLatch(1);
        try (PdfSpool spool = new PdfSpool(new File(root, "input"));
             TextPdfJobs jobs = new TextPdfJobs(new File(root, "output"), (input, output, progress) -> {
                 if (!"完整中文正文\n末尾".equals(Files.readString(input.toPath()))) throw new AssertionError("Body lost");
                 progress.update("render", 151, 151);
                 rendering.countDown();
                 while (!release.await(10, TimeUnit.MILLISECONDS)) progress.checkCancelled();
                 output.write("%PDF-1.4\ncomplete-151-pages\n%%EOF\n".getBytes(StandardCharsets.UTF_8));
             })) {
            String id = spool.begin("test-tree");
            spool.append(id, "完整中文正文\n末尾".getBytes(StandardCharsets.UTF_8));
            jobs.start(spool.take(id));
            if (!rendering.await(2, TimeUnit.SECONDS)) throw new AssertionError("Job did not start");
            TextPdfJobs.Status status = jobs.status(id);
            if (!status.stage.equals("render") || status.pages != 151 || status.total != 151)
                throw new AssertionError("Real progress unavailable while rendering");
            release.countDown();
            for (int i = 0; i < 200 && !jobs.status(id).stage.equals("ready"); i++) Thread.sleep(10);
            String result = jobs.finish(id, "complete.pdf", (source, tree, name, size, hash) -> {
                if (!tree.equals("test-tree") || !source.isFile() || hash.length() != 64 || size != source.length())
                    throw new AssertionError("Unverified publication");
                return Files.readString(source.toPath());
            });
            if (!result.contains("complete-151-pages")) throw new AssertionError("Truncated output");
            if (new File(root, "input").list().length != 0 || new File(root, "output").list().length != 0)
                throw new AssertionError("Private files leaked");
        }
        CountDownLatch started = new CountDownLatch(1);
        try (PdfSpool spool = new PdfSpool(new File(root, "cancel-input"));
             TextPdfJobs jobs = new TextPdfJobs(new File(root, "cancel-output"), (input, output, progress) -> {
                 started.countDown();
                 while (true) { progress.update("render", 1, 151); Thread.sleep(5); }
             })) {
            String id = spool.begin("test-tree"); spool.append(id, new byte[]{65}); jobs.start(spool.take(id));
            if (!started.await(2, TimeUnit.SECONDS)) throw new AssertionError("Cancel test did not start");
            jobs.requestCancel(id); jobs.cancel(id); jobs.cancel(id);
            if (new File(root, "cancel-input").list().length != 0 || new File(root, "cancel-output").list().length != 0)
                throw new AssertionError("Cancelled files leaked");
            id = spool.begin("test-tree"); spool.append(id, new byte[]{65}); jobs.start(spool.take(id)); jobs.cancel(id);
        }
        CountDownLatch writing = new CountDownLatch(1), resume = new CountDownLatch(1);
        try (PdfSpool spool = new PdfSpool(new File(root, "ready-input"));
             TextPdfJobs jobs = new TextPdfJobs(new File(root, "ready-output"), (input, output, progress) -> {
                 progress.update("write", 151, 151); output.write("%PDF-1.4\ncomplete\n%%EOF".getBytes(StandardCharsets.US_ASCII));
             })) {
            String id = spool.begin("test-tree"); spool.append(id, new byte[]{65}); jobs.start(spool.take(id));
            for (int i = 0; i < 200 && !jobs.status(id).stage.equals("ready"); i++) Thread.sleep(10);
            jobs.requestCancel(id);
            try { jobs.finish(id, "cancelled.pdf", (a,b,c,d,e) -> { throw new AssertionError("Cancelled ready job was published"); }); }
            catch (InterruptedIOException expected) { }
        }
        try (PdfSpool spool = new PdfSpool(new File(root, "write-input"));
             TextPdfJobs jobs = new TextPdfJobs(new File(root, "write-output"), (input, output, progress) -> {
                 progress.update("write", 151, 151); writing.countDown(); resume.await();
                 // Android 9 Skia can swallow Java stream exceptions and retry the same write.
                 long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(800);
                 while (true) {
                     try { output.write(new byte[4096]); break; }
                     catch (IOException error) { if (System.nanoTime() > deadline) throw error; }
                 }
             })) {
            String id = spool.begin("test-tree"); spool.append(id, new byte[]{65}); jobs.start(spool.take(id));
            if (!writing.await(2, TimeUnit.SECONDS)) throw new AssertionError("Write did not start");
            jobs.requestCancel(id); long start = System.nanoTime(); resume.countDown(); jobs.cancel(id);
            if (System.nanoTime() - start > TimeUnit.MILLISECONDS.toNanos(500))
                throw new AssertionError("Cancelled stream trapped the native writer in retry");
        }
        System.out.println("Text PDF: asynchronous progress, publication, cancel and native writer retry protection passed");
    }
}
