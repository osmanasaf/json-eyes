package com.jsonsarp.iata;

import java.util.List;
import java.util.Map;

/**
 * Bir XSD alaninin JSON'daki karsiligi.
 *
 * @param path          JSON icindeki yol (dizi indeksleri atlanir)
 * @param name          alan adi
 * @param type          alanin XSD tip adi; ITN XSD Viewer'a donmeden karsiligi gormek icin
 * @param documentation XSD annotation metni
 */
record FieldDoc(String path, String name, String type, String documentation) {
}

/** Bir XSD kompleks tipinin dogrudan cocuklari. Ayni tip her baglamda ayni cocuklari verir. */
record TypeInfo(String key, String displayName, Map<String, ElementInfo> children) {
}

/**
 * Bir kompleks tipin tek bir cocugu.
 *
 * @param typeKey cocugun kendi tipinin anahtari; null ise basit tip (daha derine inilmez)
 */
record ElementInfo(String name, String typeName, String typeKey, String documentation, boolean attribute) {
}

/** Indekslenmis bir IATA mesaji. */
record MessageInfo(String messageType, String rootTypeKey, String documentation) {
}

record AnnotateRequest(com.fasterxml.jackson.databind.JsonNode json) {
}

/**
 * @param schemaLoaded  false ise sunucuda hic XSD yok; bos alan listesi "eslesme yok" anlamina gelmez
 * @param unmatchedCount XSD'de karsiligi bulunamayan JSON alani sayisi
 */
record AnnotateResponse(
        String messageType,
        double confidence,
        boolean schemaLoaded,
        int unmatchedCount,
        List<FieldDoc> fields
) {
}

record MessagesResponse(List<String> messages) {
}
