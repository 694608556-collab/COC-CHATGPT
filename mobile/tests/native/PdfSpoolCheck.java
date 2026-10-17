package coc.logbook;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.Arrays;

/** Public begin/append/finish/cancel checks with real private files; Android SAF is separately device-tested. */
public final class PdfSpoolCheck {
    public static void main(String[] args) throws Exception {
        File directory = Files.createTempDirectory("coc-pdf-spool-check-").toFile();
        byte[] complete = "%PDF-1.4\nPUBLIC Chinese fixture bytes\n%%EOF\n".getBytes(StandardCharsets.UTF_8);
        PdfSpool spool = new PdfSpool(directory);
        String id = spool.begin("test-tree");
        spool.append(id, Arrays.copyOfRange(complete, 0, 10));
        spool.append(id, Arrays.copyOfRange(complete, 10, complete.length));
        String result = spool.finish(id, "public.pdf", (source, tree, name, size, hash) -> {
            if (!tree.equals("test-tree") || !name.equals("public.pdf") || size != complete.length || !Arrays.equals(Files.readAllBytes(source.toPath()), complete))
                throw new AssertionError("Complete ordered bytes not preserved");
            StringBuilder expected = new StringBuilder();
            for (byte b : MessageDigest.getInstance("SHA-256").digest(complete)) expected.append(String.format("%02x", b & 255));
            if (!expected.toString().equals(hash)) throw new AssertionError("Checksum mismatch");
            return "published";
        });
        if (!result.equals("published") || directory.list().length != 0) throw new AssertionError("Success leaked spool");
        String textId = spool.begin("text-tree");
        byte[] text = "{\"text\":\"完整中文😀\"}".getBytes(StandardCharsets.UTF_8);
        spool.append(textId, text);
        long published = spool.finish(textId, "public.json", false, (source, tree, name, size, hash) -> {
            if (!Arrays.equals(Files.readAllBytes(source.toPath()), text) || !tree.equals("text-tree"))
                throw new AssertionError("Text spool altered complete bytes/location");
            return size;
        });
        if (published != text.length || directory.list().length != 0) throw new AssertionError("Text publication leaked spool");
        for (String invalidName : new String[]{".", ".."}) {
            String invalidId = spool.begin("text-tree"); spool.append(invalidId, text);
            boolean denied = false;
            try { spool.finish(invalidId, invalidName, false, (a,b,c,d,e) -> { throw new AssertionError("Unsafe text name published"); }); }
            catch (IllegalArgumentException expected) { denied = true; }
            if (!denied || directory.list().length != 0) throw new AssertionError("Invalid name leaked spool");
        }
        spool.cancel(id);
        id = spool.begin("test-tree"); spool.append(id, complete); spool.cancel(id); spool.cancel(id);
        if (directory.list().length != 0) throw new AssertionError("Cancel leaked spool");
        id = spool.begin("test-tree"); spool.append(id, new byte[10]);
        boolean rejected = false;
        try { spool.finish(id, "partial.pdf", (a,b,c,d,e) -> { throw new AssertionError("Incomplete file published"); }); }
        catch (IllegalStateException expected) { rejected = true; }
        if (!rejected || directory.list().length != 0) throw new AssertionError("Incomplete failure leaked spool");
        id = spool.begin("test-tree"); spool.append(id, complete); rejected = false;
        try { spool.finish(id, "fail.pdf", (a,b,c,d,e) -> { throw new IllegalStateException("Simulated publication failure"); }); }
        catch (IllegalStateException expected) { rejected = true; }
        if (!rejected || directory.list().length != 0) throw new AssertionError("Publication failure leaked spool");
        id = spool.begin("test-tree"); rejected = false;
        byte[] chunk = new byte[256 * 1024];
        try { for (int i = 0; i < 257; i++) spool.append(id, chunk); }
        catch (IllegalArgumentException expected) { rejected = true; }
        if (!rejected || directory.list().length != 0) throw new AssertionError("Size failure leaked spool");
        File stale = new File(directory, "coc-pdf-01234567-abcd.part"); Files.write(stale.toPath(), complete);
        File unrelated = new File(directory, "leave-user-file.pdf"); Files.write(unrelated.toPath(), complete);
        spool = new PdfSpool(directory);
        if (stale.exists() || !Arrays.equals(Files.readAllBytes(unrelated.toPath()), complete)) throw new AssertionError("Crash cleanup touched wrong file");
        spool.close(); Files.delete(unrelated.toPath()); Files.delete(directory.toPath());
        System.out.println("PDF spool: ordered complete bytes/checksum, cancel, incomplete rejection, publication failure, 64MB bound, stale cleanup passed; no Android SAF claim.");
    }
}
