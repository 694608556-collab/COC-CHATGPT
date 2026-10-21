package coc.logbook;

import org.json.JSONObject;

/** Opt-in monotonic durations only: no snapshot values, identifiers or directory paths. */
final class TableTiming {
    private final long started=System.nanoTime();
    private long previous=started;
    private final java.util.Map<String,Double> phases=new java.util.LinkedHashMap<>();
    void mark(String phase){long now=System.nanoTime();phases.put(phase,phases.getOrDefault(phase,0.0)+(now-previous)/1_000_000.0);previous=now;}
    JSONObject result()throws Exception{
        JSONObject value=new JSONObject();value.put("clock","native-monotonic");value.put("totalMs",(System.nanoTime()-started)/1_000_000.0);value.put("phasesMs",new JSONObject(phases));return value;
    }
    static void mark(TableTiming timing,String phase){if(timing!=null)timing.mark(phase);}
}
