package coc.logbook;

import java.io.File;
import java.io.IOException;

/** Native-owned available-volume budget. A preflight is not a reservation:
 * callers must recheck during staging/before commit and retain I/O rollback.
 * Never apply this private-volume result to an unrelated SAF provider.
 */
final class StorageBudget {
    static final long MINIMUM_RESERVE = 64L * 1024 * 1024;
    static final long JS_SAFE_INTEGER = 9007199254740991L;
    interface Available { long bytes() throws Exception; }
    private StorageBudget() {}
    static long remaining(long available) throws IOException {
        if (available <= 0) throw new IOException("无法确认本机可用空间；未写入数据。");
        return Math.max(0, available - Math.max(MINIMUM_RESERVE, available / 20));
    }
    static long maximum(Available available, int copies) throws Exception {
        if (copies < 1) throw new IllegalArgumentException("空间估算参数无效。");
        long result = Math.min(JS_SAFE_INTEGER, remaining(available.bytes()) / copies);
        if (result < 1) throw new IOException("本机可用空间不足，请释放空间后重试；原数据保留。");
        return result;
    }
    static void require(Available available, long additional) throws Exception {
        long budget=remaining(available.bytes());
        if (budget < 1 || additional < 0 || additional > budget)
            throw new IOException("本机可用空间不足，操作未完成；原数据保留。");
    }
    static Available volume(File directory) {
        return () -> {
            if (!directory.isDirectory()) throw new IOException("暂存卷不可用；未写入数据。");
            return directory.getUsableSpace();
        };
    }
    static long estimate(long bytes, int copies) throws IOException {
        if (bytes < 0 || copies < 1) throw new IOException("空间估算参数无效。");
        try { return Math.addExact(Math.multiplyExact(bytes, copies), 4L * 1024 * 1024); }
        catch (ArithmeticException error) { throw new IOException("空间需求超出系统计量范围。", error); }
    }
}
