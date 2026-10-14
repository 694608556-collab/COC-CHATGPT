package coc.logbook;

/** Standalone JDK check for slicing trusted JSON while preserving log bytes/number precision. */
public final class JsonFieldsCheck {
    public static void main(String[] args) {
        String records = "[{\"id\":\"a\\\"b\",\"order\":0,\"rawContent\":{\"messages\":[{\"text\":\"括号 } ] , 和 \\\"引号\\\"、😀\",\"raw\":9007199254740993}]}},{\"id\":\"second\",\"order\":1}]";
        String original = " {\"schemaVersion\":2, \"exportedAt\":\"date\",\"modules\":[],\"records\":"+records+",\"characters\":[],\"settings\":{\"theme\":\"light\"}} ";
        java.util.Map<String,String> fields = JsonFields.split(original);
        if (!records.equals(fields.get("records"))) throw new AssertionError("Body bytes changed");
        java.util.List<String> rows = JsonFields.elements(records);
        if (rows.size() != 2) throw new AssertionError("Array boundaries changed");
        java.util.Map<String,String> first = JsonFields.split(rows.get(0));
        String body = first.get("rawContent"); first.put("order", "1");
        if (!JsonFields.split(JsonFields.join(first)).get("rawContent").equals(body)) throw new AssertionError("Precision/body changed");
        fields.put("modules", "[{\"id\":\"m\"}]");
        if (!JsonFields.split(JsonFields.join(fields)).get("records").equals(records)) throw new AssertionError("Metadata changed records");
        if (!JsonFields.split("{\"expo\\u0072tedAt\":\"date\"}").containsKey("exportedAt")) throw new AssertionError("Escaped key lost");
        boolean duplicate = false;
        try { JsonFields.split("{\"records\":[],\"records\":[]}"); } catch (IllegalArgumentException expected) { duplicate = true; }
        if (!duplicate) throw new AssertionError("Duplicate field accepted");
        System.out.println("JsonFields: arrays, escapes, Unicode, raw numbers, unchanged bodies and duplicate guard passed");
    }
}
