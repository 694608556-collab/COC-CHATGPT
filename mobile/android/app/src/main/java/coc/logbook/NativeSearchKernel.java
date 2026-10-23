package coc.logbook;

/** Complete original JSON validation and disposable read-only search projection.
 * No file path, database, network or publication capability crosses this API.
 * Null/false requests the unchanged complete path; budgets never reject content.
 */
final class NativeSearchKernel {
    private static final boolean AVAILABLE;
    static {boolean loaded;try{System.loadLibrary("coc_table_native");loaded=true;}catch(LinkageError unavailable){loaded=false;}AVAILABLE=loaded;}
    static native boolean check(byte[] original,long residentBudget,boolean metadata);
    static native byte[] project(byte[] original,long residentBudget);
    static native byte[] compact(byte[] original,long residentBudget);
    static native byte[] searchable(byte[] original,long residentBudget);
    static native int sealedFile(byte[] complete,long residentBudget);
    static int sealedSource(byte[] complete,long budget){
        try{return AVAILABLE?sealedFile(complete,budget):-1;}catch(LinkageError|OutOfMemoryError unavailable){return -1;}
    }
    static boolean valid(byte[] original,long budget,boolean metadata){
        try{return AVAILABLE&&check(original,budget,metadata);}catch(LinkageError|OutOfMemoryError unavailable){return false;}
    }
    static byte[] projection(byte[] original,long budget){
        try{return AVAILABLE?project(original,budget):null;}catch(LinkageError|OutOfMemoryError unavailable){return null;}
    }
    static byte[] compactProjection(byte[] original,long budget){
        try{return AVAILABLE?compact(original,budget):null;}catch(LinkageError|OutOfMemoryError unavailable){return null;}
    }
    static byte[] searchableProjection(byte[] original,long budget){
        try{return AVAILABLE?searchable(original,budget):null;}catch(LinkageError|OutOfMemoryError unavailable){return null;}
    }
}
