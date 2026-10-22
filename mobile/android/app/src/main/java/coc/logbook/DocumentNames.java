package coc.logbook;

import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.regex.Matcher;

/** Match desktop collision numbering without ever opening an existing document for overwrite. */
final class DocumentNames {
    static String available(Iterable<String> existing, String requested) {
        Set<String> used = new HashSet<>();
        for (String name : existing) used.add(name.toLowerCase(Locale.ROOT));
        Matcher backup=Pattern.compile("^(\\d{8}COC跑团记录簿)\\.(json|zip)$",Pattern.CASE_INSENSITIVE).matcher(requested);
        if(backup.matches()){
            java.math.BigInteger maximum=java.math.BigInteger.valueOf(-1);
            Pattern names=Pattern.compile(Pattern.quote(backup.group(1))+"(\\d*)\\.(?:json|zip)",Pattern.CASE_INSENSITIVE);
            for(String name:used){Matcher match=names.matcher(name);if(match.matches()){java.math.BigInteger number=new java.math.BigInteger(match.group(1).isEmpty()?"0":match.group(1));maximum=maximum.max(number);}}
            return backup.group(1)+(maximum.signum()<0?"":maximum.add(java.math.BigInteger.ONE).toString())+"."+backup.group(2);
        }
        if (!used.contains(requested.toLowerCase(Locale.ROOT))) return requested;
        int dot = requested.lastIndexOf('.');
        String stem = dot > 0 ? requested.substring(0,dot) : requested;
        String extension = dot > 0 ? requested.substring(dot) : "";
        int index = 2;
        while (used.contains((stem + " (" + index + ")" + extension).toLowerCase(Locale.ROOT))) index++;
        return stem + " (" + index + ")" + extension;
    }
    static String backup(java.time.LocalDate date,String extension){return date.format(java.time.format.DateTimeFormatter.BASIC_ISO_DATE)+"COC跑团记录簿."+extension;}
}
