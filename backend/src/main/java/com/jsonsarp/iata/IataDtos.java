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
 * @param matchKind     eslesme kesin mi tahmini mi; tahmini olanlar UI'da ayri gosterilir
 * @param confidence    tahmini eslesmenin puani (0-1); kesin eslesmede 1
 * @param evidence      tahmini eslesmenin neye dayandigi, kullaniciya gosterilir; kesinde null
 */
record FieldDoc(
        String path,
        String name,
        String type,
        String documentation,
        MatchKind matchKind,
        double confidence,
        String evidence
) {
    static FieldDoc exact(String path, ElementInfo info) {
        return new FieldDoc(path, info.name(), info.typeName(), info.documentation().trim(),
                MatchKind.EXACT, 1.0, null);
    }
}

/**
 * Bir JSON alaninin XSD karsiligina nasil baglandigi.
 *
 * <p>Ayrim onemli: NDC'de ayni ad farkli tiplerde farkli anlam tasidigi icin tahmini
 * bir eslesmenin aciklamasi yanlis olabilir; kullanici hangisine baktigini bilmeli.
 */
enum MatchKind {
    /** Ad birebir (ya da yalnizca buyuk/kucuk harf, ayrac, cogul farkiyla) tuttu. */
    EXACT,
    /** Ad tutmadi; yapi, tasidigi ID veya referanslar uzerinden cikarildi. */
    INFERRED
}

/** Bir XSD kompleks tipinin dogrudan cocuklari. Ayni tip her baglamda ayni cocuklari verir. */
record TypeInfo(String key, String displayName, Map<String, ElementInfo> children) {
}

/**
 * Bir kompleks tipin tek bir cocugu.
 *
 * @param typeKey    cocugun kendi tipinin anahtari; null ise basit tip (daha derine inilmez)
 * @param repeatable semada maxOccurs > 1; JSON'da dizi bekleniyor demektir
 */
record ElementInfo(
        String name,
        String typeName,
        String typeKey,
        String documentation,
        boolean attribute,
        boolean repeatable
) {
}

/** Indekslenmis bir IATA mesaji. */
record MessageInfo(String messageType, String rootTypeKey, String documentation) {
}

record AnnotateRequest(com.fasterxml.jackson.databind.JsonNode json) {
}

/**
 * @param schemaLoaded   false ise sunucuda hic XSD yok; bos alan listesi "eslesme yok" anlamina gelmez
 * @param unmatchedCount XSD'de karsiligi bulunamayan JSON alani sayisi
 * @param unmatchedPaths bu alanlarin yollari (uzun listelerde kirpilir)
 */
record AnnotateResponse(
        String messageType,
        double confidence,
        boolean schemaLoaded,
        int unmatchedCount,
        List<String> unmatchedPaths,
        List<FieldDoc> fields
) {
}

record MessagesResponse(List<String> messages) {
}
