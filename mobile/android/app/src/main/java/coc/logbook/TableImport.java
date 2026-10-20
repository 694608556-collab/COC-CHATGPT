package coc.logbook;

import java.util.*;
import org.json.*;

/** Additive table candidates never own existing native bodies or unrelated metadata. */
final class TableImport {
    static boolean equal(Object a,Object b)throws Exception {
        if(a==b)return true;
        if(a==null||b==null)return false;
        if(a instanceof JSONObject && b instanceof JSONObject){
            JSONObject x=(JSONObject)a,y=(JSONObject)b;
            if(x.length()!=y.length())return false;
            Iterator<String> keys=x.keys();while(keys.hasNext()){String key=keys.next();if(!y.has(key)||!equal(x.get(key),y.get(key)))return false;}return true;
        }
        if(a instanceof JSONArray && b instanceof JSONArray){JSONArray x=(JSONArray)a,y=(JSONArray)b;if(x.length()!=y.length())return false;for(int i=0;i<x.length();i++)if(!equal(x.get(i),y.get(i)))return false;return true;}
        if(a instanceof Number && b instanceof Number)return Double.compare(((Number)a).doubleValue(),((Number)b).doubleValue())==0;
        return a.equals(b);
    }
    private static JSONObject without(JSONObject value,String... keys)throws Exception {JSONObject copy=new JSONObject(value.toString());for(String key:keys)copy.remove(key);return copy;}
    private static void fail(){throw new IllegalArgumentException("表格候选包含旧数据删除、来源变更或非手动覆盖；未保存。");}
    static void validate(JSONObject candidate,Map<String,String> previous)throws Exception {
        JSONArray records=candidate.getJSONArray("records");
        for(int i=0;i<records.length();i++){JSONObject row=records.getJSONObject(i);if(row.has("rawContent")||row.has("manualContent")&&!(row.get("manualContent") instanceof String))fail();}
        if(previous==null||!previous.containsKey("settings"))return;
        if(!equal(candidate.get("settings"),new JSONObject(previous.get("settings"))))fail();
        for(String kind:new String[]{"modules","characters","records"}){
            JSONArray before=new JSONArray(previous.get(kind)),after=candidate.getJSONArray(kind);
            if(after.length()<before.length())fail();
            for(int i=0;i<before.length();i++){
                JSONObject old=before.getJSONObject(i),next=after.getJSONObject(i);
                if(!old.getString("id").equals(next.getString("id")))fail();
                if(kind.equals("modules")){if(!equal(without(old,"kps","pairs"),without(next,"kps","pairs")))fail();}
                else if(kind.equals("characters")){if(!equal(old,next))fail();}
                else {
                    boolean touched=next.has("manualContent");
                    if(touched&&!"manual".equals(old.optString("sourceType")))fail();
                    String[] ignored=touched?new String[]{"manualContent","updatedAt","playDate","dateSource"}:new String[]{};
                    if(!equal(without(old,ignored),without(next,ignored)))fail();
                }
            }
        }
    }
}
