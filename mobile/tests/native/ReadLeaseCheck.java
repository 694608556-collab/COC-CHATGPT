package coc.logbook;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.Arrays;

/** Private read-only source lifecycle; Android CAS/SAF/WebView fetch is separately device-tested. */
public final class ReadLeaseCheck {
    public static void main(String[] args) throws Exception {
        File directory = Files.createTempDirectory("coc-read-lease-check-").toFile();
        byte[] expected = "{\"正文\":\"完整中文😀\\n末尾\"}".getBytes(StandardCharsets.UTF_8);
        try (ReadLease leases = new ReadLease(directory)) {
            ReadLease.Value value = leases.create(new String(expected, StandardCharsets.UTF_8), 19);
            if (value.revision != 19 || value.bytes != expected.length || !Arrays.equals(Files.readAllBytes(value.file.toPath()), expected))
                throw new AssertionError("Read lease changed source or version");
            StringBuilder hash = new StringBuilder();
            for (byte b : MessageDigest.getInstance("SHA-256").digest(expected)) hash.append(String.format("%02x",b&255));
            if (!value.sha256.equals(hash.toString())) throw new AssertionError("Read lease checksum incorrect");
            leases.release("foreign-token");
            if (!value.file.exists()) throw new AssertionError("Foreign token deleted active lease");
            leases.release(value.id); leases.release(value.id);
            if (directory.list().length != 0) throw new AssertionError("Read lease leaked private body");
            // Exercise the real streaming boundary without allocating a library-sized String.
            String block = "x".repeat(8192);
            ReadLease.Value boundary = leases.create(writer -> {
                for (int i = 0; i < 8192; i++) writer.write(block);
            }, 20);
            if (boundary.bytes != 64L * 1024 * 1024 || boundary.revision != 20)
                throw new AssertionError("Exact old read boundary was changed");
            leases.release(boundary.id);
            ReadLease.Value larger=leases.create(writer -> {
                for (int i = 0; i < 8704; i++) writer.write(block);
                writer.write('x');
            }, 21);
            if(larger.bytes!=68L*1024*1024+1)throw new AssertionError("Complete source above 64MiB rejected or truncated");
            leases.release(larger.id);
            if(directory.list().length!=0)throw new AssertionError("Large source leaked private body");
        }
        System.out.println("Read lease: complete bytes/version/hash, token-scoped idempotent cleanup passed");
    }
}
