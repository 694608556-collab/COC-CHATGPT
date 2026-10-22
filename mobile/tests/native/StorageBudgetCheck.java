package coc.logbook;

public final class StorageBudgetCheck {
    static int count;
    static void require(boolean value) { if (!value) throw new AssertionError("storage budget"); count++; }
    interface Action { void run() throws Exception; }
    static void rejects(Action action) throws Exception { try { action.run(); } catch (Exception expected) { count++; return; } throw new AssertionError("expected rejection"); }
    public static void main(String[] args) throws Exception {
        long MiB = 1024L * 1024;
        require(StorageBudget.remaining(64 * MiB) == 0);
        require(StorageBudget.remaining(128 * MiB) == 64 * MiB);
        require(StorageBudget.remaining(20 * 1024 * MiB) == 19 * 1024 * MiB);
        require(StorageBudget.maximum(() -> 1024 * MiB, 6) == (1024 * MiB - 64 * MiB) / 6);
        StorageBudget.require(() -> 128 * MiB, 64 * MiB); count++;
        StorageBudget.require(() -> 64 * MiB + 1, 0); count++;
        rejects(() -> StorageBudget.require(() -> 64 * MiB, 0));
        rejects(() -> StorageBudget.require(() -> 32 * MiB, 0));
        rejects(() -> StorageBudget.require(() -> 128 * MiB, 64 * MiB + 1));
        rejects(() -> StorageBudget.maximum(() -> 0, 1));
        rejects(() -> StorageBudget.maximum(() -> { throw new java.io.IOException("unavailable"); }, 1));
        rejects(() -> StorageBudget.maximum(() -> 1024 * MiB, 0));
        rejects(() -> StorageBudget.require(() -> 1024 * MiB, -1));
        rejects(() -> StorageBudget.estimate(Long.MAX_VALUE, 6));
        require(StorageBudget.estimate(512 * MiB, 6) == 3076 * MiB);
        long[] free = {1024 * MiB};
        StorageBudget.Available volume = () -> free[0];
        StorageBudget.require(volume, 128 * MiB); free[0] = 100 * MiB;
        rejects(() -> StorageBudget.require(volume, 128 * MiB));
        System.out.println("StorageBudget: " + count + " checks passed");
    }
}
