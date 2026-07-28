package com.jsonsarp.iata;

import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Alan adlarini karsilastirilabilir hale getirir.
 *
 * <p>Elle bakilan bir es anlamli sozlugu yok — bilerek. Uretimde karsilasilacak
 * adlari onceden saymak mumkun degil; burada yalnizca dilden bagimsiz bicimsel
 * farklar (buyuk/kucuk harf, ayrac, cogul, "List" gibi koleksiyon ekleri)
 * temizlenir. Anlamsal fark (passenger &harr; pax) yapiya bakan
 * {@link ElementMatcher} tarafindan cozulur.
 */
final class SchemaNames {

    private SchemaNames() {
    }

    /** Koleksiyon bildiren ekler; `PaxList`, `Segments`, `OrderItems` hep ayni koke iner. */
    private static final String[] COLLECTION_SUFFIXES = {"list", "collection", "array", "items", "item", "set"};

    /** Bazi uretimler XML attribute'larini JSON'a '@' onekiyle tasir. */
    static String stripAttributePrefix(String key) {
        return key.startsWith("@") ? key.substring(1) : key;
    }

    /** Kucuk harf + harf/rakam disi her sey atilir: `pax_list`, `Pax-List`, `PAXLIST` &rarr; `paxlist`. */
    static String normalize(String key) {
        String stripped = stripAttributePrefix(key);
        StringBuilder out = new StringBuilder(stripped.length());
        for (int i = 0; i < stripped.length(); i++) {
            char ch = stripped.charAt(i);
            if (Character.isLetterOrDigit(ch)) {
                out.append(Character.toLowerCase(ch));
            }
        }
        return out.toString();
    }

    /**
     * Bir adin esdeger sayilabilecek butun bicimleri.
     *
     * <p>Iki ad, kume kesisimleri bos degilse ayni kabul edilir. Ornegin
     * `segments` &rarr; {segments, segment}, `SegmentList` &rarr; {segmentlist, segment};
     * ikisi de `segment` uzerinden bulusur.
     */
    static Set<String> variants(String key) {
        Set<String> forms = new LinkedHashSet<>();
        String base = normalize(key);
        if (base.isEmpty()) {
            return forms;
        }
        forms.add(base);

        String reduced = base;
        // Ekler ust uste gelebilir: `PaxSegmentList` -> `paxsegment`, `Items` -> tekil.
        for (int round = 0; round < 2; round++) {
            String next = stripCollectionSuffix(reduced);
            next = stripPlural(next);
            if (next.equals(reduced)) {
                break;
            }
            reduced = next;
            forms.add(reduced);
        }
        return forms;
    }

    private static String stripCollectionSuffix(String name) {
        for (String suffix : COLLECTION_SUFFIXES) {
            if (name.length() > suffix.length() + 2 && name.endsWith(suffix)) {
                return name.substring(0, name.length() - suffix.length());
            }
        }
        return name;
    }

    /**
     * Cogul eki. Ingilizce'de `-ss`/`-us`/`-is` ile biten tekil kelimeler
     * (address, status, basis) cok yaygin oldugu icin onlar korunur.
     */
    private static String stripPlural(String name) {
        if (name.length() <= 4 || !name.endsWith("s")) {
            return name;
        }
        if (name.endsWith("ss") || name.endsWith("us") || name.endsWith("is")) {
            return name;
        }
        if (name.endsWith("ies")) {
            return name.substring(0, name.length() - 3) + "y";
        }
        if (name.endsWith("es") && name.length() > 5) {
            String withoutEs = name.substring(0, name.length() - 2);
            if (withoutEs.endsWith("x") || withoutEs.endsWith("ch") || withoutEs.endsWith("sh")) {
                return withoutEs;
            }
        }
        return name.substring(0, name.length() - 1);
    }

    /** `PaxID`, `OrderItemId` &rarr; tasidigi nesnenin adi (`Pax`, `OrderItem`); degilse null. */
    static String objectNameFromIdField(String key) {
        String name = stripAttributePrefix(key);
        if (isRefField(name)) {
            return null;
        }
        if (name.length() > 2 && (name.endsWith("ID") || name.endsWith("Id") || name.endsWith("id"))) {
            String owner = name.substring(0, name.length() - 2);
            return owner.isEmpty() ? null : owner;
        }
        return null;
    }

    /** `PaxRefID`, `ServiceDefinitionRefID` — hedefi degil, hedefe atifi tasir. */
    static boolean isRefField(String key) {
        String name = normalize(key);
        return name.endsWith("refid") || name.endsWith("reference") || name.endsWith("ref");
    }
}
