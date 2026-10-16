package coc.logbook;

import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/** Match desktop collision numbering without ever opening an existing document for overwrite. */
final class DocumentNames {
    static String available(Iterable<String> existing, String requested) {
        Set<String> used = new HashSet<>();
        for (String name : existing) used.add(name.toLowerCase(Locale.ROOT));
        if (!used.contains(requested.toLowerCase(Locale.ROOT))) return requested;
        int dot = requested.lastIndexOf('.');
        String stem = dot > 0 ? requested.substring(0,dot) : requested;
        String extension = dot > 0 ? requested.substring(dot) : "";
        int index = 2;
        while (used.contains((stem + " (" + index + ")" + extension).toLowerCase(Locale.ROOT))) index++;
        return stem + " (" + index + ")" + extension;
    }
}
