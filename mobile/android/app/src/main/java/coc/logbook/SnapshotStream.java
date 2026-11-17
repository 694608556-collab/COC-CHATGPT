package coc.logbook;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import org.json.JSONArray;

/** Existing native snapshot checks, retaining identifiers rather than body strings. */
final class SnapshotStream {
    interface Field {void accept(String name)throws Exception;}
    interface Element {void accept()throws Exception;}
    interface Cursor extends AutoCloseable {
        void object(Field field)throws Exception;
        void array(Element element)throws Exception;
        String string()throws Exception;
        void discardString()throws Exception;
        void skip()throws Exception;
        void versionTwo()throws Exception;
        void end()throws Exception;
        void close()throws IOException;
    }
    /** Strict byte grammar is already proved on the very same immutable array; schema/graph rules remain shared. */
    private static final class ProvedCursor implements Cursor {
        private final Reader input;private final RawJson raw;
        ProvedCursor(Reader input){this.input=input;raw=new RawJson(input);}
        public void object(Field field)throws Exception{raw.object((name,value)->field.accept(name));}
        public void array(Element element)throws Exception{raw.array(value->element.accept());}
        public String string()throws Exception {
            Object value=new JSONArray("["+raw.take()+"]").get(0);
            if(!(value instanceof String))throw new IllegalArgumentException("快照字符串类型无效。");return (String)value;
        }
        public void discardString()throws Exception{string();}
        public void skip()throws Exception{raw.skip();}
        public void versionTwo()throws Exception{if(Double.parseDouble(raw.take())!=2)throw new IllegalArgumentException("备份版本不兼容。");}
        public void end()throws Exception{raw.end();}
        public void close()throws IOException{input.close();}
    }
    private static Reader bytesReader(byte[] bytes) {
        return new InputStreamReader(new ByteArrayInputStream(bytes),StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT));
    }
    /** Memory controls only optional acceleration; larger candidates always use the complete streaming path. */
    static Reader openValidated(File file)throws Exception {
        Runtime runtime=Runtime.getRuntime();long available=runtime.maxMemory()-runtime.totalMemory()+runtime.freeMemory();
        return openValidated(file,Math.max(0,available/8));
    }
    static Reader openValidated(File file,long residentBudget)throws Exception {
        byte[] proved=null;long length=file.length();
        if(NativeSearchKernel.isAvailable()&&length>0&&length<Integer.MAX_VALUE&&length<=residentBudget/2) {
            try {
                byte[] bytes=Files.readAllBytes(file.toPath());
                if(NativeSearchKernel.valid(bytes,residentBudget,false))proved=bytes;
            }catch(OutOfMemoryError unavailable){proved=null;}
        }
        if(proved!=null) {
            try {
                try(Cursor cursor=new ProvedCursor(bytesReader(proved))){validate(cursor);}
                return bytesReader(proved);
            }catch(OutOfMemoryError unavailable){proved=null;}
        }
        validate(Files.newBufferedReader(file.toPath(),StandardCharsets.UTF_8));
        return Files.newBufferedReader(file.toPath(),StandardCharsets.UTF_8);
    }
    static void validate(Reader input) throws Exception {
        try (SnapshotJson reader = new SnapshotJson(input)) {
            validate(reader);
        }
    }
    private static void validate(Cursor reader)throws Exception {
            Set<String> required = new HashSet<>(Arrays.asList("schemaVersion","exportedAt","modules","records","characters","settings"));
            Set<String> seen = new HashSet<>(), modules = new HashSet<>(), references = new HashSet<>();
            reader.object(key -> {
                if (!required.contains(key) || !seen.add(key)) throw new IllegalArgumentException("备份字段无效或重复。");
                switch (key) {
                    case "schemaVersion": reader.versionTwo(); break;
                    case "exportedAt": reader.discardString(); break;
                    case "settings": reader.object(name -> reader.skip()); break;
                    default: entities(reader, key.equals("modules") ? modules : new HashSet<>(), key.equals("records") ? references : null);
                }
            });
            reader.end();
            if (!seen.equals(required)) throw new IllegalArgumentException("快照结构不完整或包含多余内容。");
            if (!modules.containsAll(references)) throw new IllegalArgumentException("场次关联失效。");
    }
    private static void entities(Cursor reader, Set<String> ids, Set<String> references) throws Exception {
        reader.array(() -> {
            String[] identity = new String[2];
            reader.object(key -> {
                if (key.equals("id") || references != null && key.equals("moduleId")) {
                    identity[key.equals("id") ? 0 : 1] = reader.string();
                } else reader.skip();
            });
            String id = identity[0], module = identity[1];
            if (id == null || id.isEmpty() || !ids.add(id)) throw new IllegalArgumentException("备份实体标识无效或重复。");
            if (references != null) { if(module == null) throw new IllegalArgumentException("场次关联失效。"); references.add(module); }
        });
    }
}
