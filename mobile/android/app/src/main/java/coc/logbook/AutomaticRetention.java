package coc.logbook;
import java.util.*;
import org.json.*;

/** Rotation is per authorized location; switching folders cannot consume another folder's ten slots. */
final class AutomaticRetention {
    static Set<Integer> candidates(JSONArray registry,String tree,int keep)throws JSONException{
        if(keep<1)throw new IllegalArgumentException("备份保留数量无效。");
        Set<Integer> result=new HashSet<>();int seen=0;
        for(int index=registry.length()-1;index>=0;index--)
            if(tree.equals(registry.getJSONObject(index).getString("tree"))&&++seen>keep)result.add(index);
        return result;
    }
}
