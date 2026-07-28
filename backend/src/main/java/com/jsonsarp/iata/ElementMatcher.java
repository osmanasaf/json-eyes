package com.jsonsarp.iata;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Bir JSON anahtarini, icinde bulundugu XSD tipinin cocuklarindan biriyle eslestirir.
 *
 * <p>Amac, uretimde karsilasilacak ad varyasyonlarini onceden sayma zorunlulugundan
 * kurtulmak. Yeniden adlandirma pratikte <em>kapsayicilarda</em> olur
 * (`PaxList` &rarr; `passengerList` &rarr; `travelers`); veriyi tasiyan yaprak adlari
 * (`PTC`, `PaxRefID`, `CurCode`) standart kalir. Bu yuzden kapsayici, adindan degil
 * <em>icindekilerden</em> taninir.
 *
 * <p>Katmanlar sirayla denenir, ilk saglam sonuc kazanir:
 * <ol>
 *   <li>ad birebir,</li>
 *   <li>ad bicimsel normalizasyondan sonra (buyuk/kucuk harf, ayrac, cogul, "List" eki),</li>
 *   <li>nesnenin tasidigi <code>&lt;X&gt;ID</code> alanindan tip cikarimi,</li>
 *   <li>cocuk adlarinin nadirlik agirlikli ortusmesi (asil is burada),</li>
 * </ol>
 * her adayda kardinalite ve skaler/kompleks uyumu ceza olarak isler.
 */
@Service
public class ElementMatcher {

    /** Tahmini eslesmenin kabul esigi. */
    private static final double MIN_SCORE = 0.34;
    /** Derin yaprak kanitinin esigi; birinci seviyeden zayif oldugu icin daha yuksek. */
    private static final double MIN_DEEP_SCORE = 0.22;
    /** Derin yaprak taramasinin inecegi en fazla seviye. */
    private static final int DEEP_LEAF_DEPTH = 3;
    /** Ikinci adayla arasindaki en az fark; kararsizsa eslestirmemek daha dogru. */
    private static final double MIN_MARGIN = 0.08;
    /** Dizide kac elemanin anahtarlari birlestirilsin. */
    private static final int ARRAY_SAMPLE = 20;

    private final XsdSchemaService schemaService;

    /** Tip anahtari -> (normalize cocuk adi -> cocuk). Ilk kullanimda kurulur. */
    private final Map<String, Map<String, ElementInfo>> normalizedChildren = new HashMap<>();

    /** Tip anahtari -> altindaki basit tipli torun adlari. Derin kanit icin. */
    private final Map<String, Set<String>> deepLeafNames = new HashMap<>();

    public ElementMatcher(XsdSchemaService schemaService) {
        this.schemaService = schemaService;
    }

    /**
     * @param element  bulunan XSD elemani
     * @param kind     ad mi tuttu yoksa yapidan mi cikarildi
     * @param score    tahmini eslesmenin puani (kesinde 1)
     * @param evidence tahmini eslesmenin dayanagi; kullaniciya gosterilir
     */
    public record Match(ElementInfo element, MatchKind kind, double score, String evidence) {
        static Match exact(ElementInfo element) {
            return new Match(element, MatchKind.EXACT, 1.0, null);
        }
    }

    /**
     * @param parentTypeKey JSON anahtarinin icinde bulundugu tipin anahtari
     * @param key           JSON anahtari
     * @param value         anahtarin degeri; yapisal cikarim buna bakar
     * @return eslesme, yoksa null
     */
    public Match match(String parentTypeKey, String key, JsonNode value) {
        TypeInfo parent = schemaService.getType(parentTypeKey);
        if (parent == null || parent.children().isEmpty()) {
            return null;
        }

        // 1 — ad birebir.
        ElementInfo direct = parent.children().get(SchemaNames.stripAttributePrefix(key));
        if (direct != null) {
            return Match.exact(direct);
        }

        // 2 — bicimsel normalizasyon: paxList / pax_list / Paxes hepsi ayni koke iner.
        Map<String, ElementInfo> byNormalized = normalizedChildrenOf(parentTypeKey, parent);
        for (String variant : SchemaNames.variants(key)) {
            ElementInfo hit = byNormalized.get(variant);
            if (hit != null) {
                return Match.exact(hit);
            }
        }

        // 3/4 — yapiya bak. Skaler degerlerde bakilacak yapi yok.
        Set<String> childKeys = objectKeysOf(value);
        if (childKeys.isEmpty()) {
            return null;
        }
        return inferFromStructure(parent, key, value, childKeys, byNormalized);
    }

    /**
     * Butun kapsayicilarin yeniden adlandirildigi durumda birinci seviye anahtarlar
     * da anlamsizdir; o zaman derindeki yaprak adlarina bakilir. Yapraklar veriyi
     * tasidigi icin pratikte standart kalir, asil dayanak noktasi onlardir.
     */
    private Match inferFromDeepLeaves(TypeInfo parent, String key, JsonNode value) {
        Set<String> leafKeys = deepLeafKeys(value, 0);
        if (leafKeys.size() < 2) {
            return null;
        }

        List<Scored> ranked = new ArrayList<>();
        for (ElementInfo candidate : parent.children().values()) {
            if (candidate.typeKey() == null) {
                continue;
            }
            Set<String> candidateLeaves = deepLeafNamesOf(candidate.typeKey());
            if (candidateLeaves.size() < 2) {
                continue;
            }
            Scored scored = scoreSets(leafKeys, candidateLeaves, candidate, value);
            if (scored != null) {
                ranked.add(scored);
            }
        }
        if (ranked.isEmpty()) {
            return null;
        }

        ranked.sort(Comparator.comparingDouble((Scored s) -> s.score).reversed());
        Scored best = ranked.get(0);
        double runnerUp = ranked.size() > 1 ? ranked.get(1).score : 0;
        // Derin kanit daha zayif oldugu icin esik ve marj yukseltiliyor.
        if (best.score < MIN_DEEP_SCORE || best.score - runnerUp < MIN_MARGIN) {
            return null;
        }
        return new Match(best.element, MatchKind.INFERRED, best.score,
                "alt alanlarından: " + String.join(", ", best.matched)
                        + (key.equals(best.element.name()) ? "" : " (JSON'da: " + key + ")"));
    }

    // --- Yapisal cikarim ------------------------------------------------------

    private Match inferFromStructure(
            TypeInfo parent,
            String key,
            JsonNode value,
            Set<String> childKeys,
            Map<String, ElementInfo> byNormalized) {

        // 3 — nesne bir <X>ID tasiyorsa <X> tipindedir. NDC'nin kendi adlandirma
        // kurali oldugu icin sifir yapilandirmayla calisir ve cok guclu bir isarettir.
        //
        // ID her zaman bir seviye asagida olmaz: `PaxList -> Pax[] -> PaxID` zincirinde
        // kapsayicinin ikisi birden yeniden adlandirilmis olabilir (`passengerList ->
        // traveler[]`), o yuzden birkac seviye asagi bakiliyor. `Pax` adinin varyantlari
        // `PaxList`i de karsiladigi icin iki seviye de ayni ID'den cozulur.
        for (IdHint hint : idHints(value, 0)) {
            for (String variant : SchemaNames.variants(hint.owner())) {
                ElementInfo hit = byNormalized.get(variant);
                if (hit != null) {
                    // Derinde bulunan ipucu daha zayif kanittir.
                    double score = hint.depth() == 0 ? 0.95 : 0.85;
                    return new Match(hit, MatchKind.INFERRED, score,
                            "içindeki " + hint.field() + " alanından");
                }
            }
        }

        // 4 — cocuk adlarinin nadirlik agirlikli ortusmesi.
        List<Scored> ranked = new ArrayList<>();
        for (ElementInfo candidate : parent.children().values()) {
            if (candidate.typeKey() == null) {
                // Basit tipli aday; icinde alan olan bir JSON dugumunu karsilayamaz.
                continue;
            }
            TypeInfo candidateType = schemaService.getType(candidate.typeKey());
            if (candidateType == null || candidateType.children().isEmpty()) {
                continue;
            }
            Scored scored = score(childKeys, candidate, candidateType, value);
            if (scored != null) {
                ranked.add(scored);
            }
        }
        if (ranked.isEmpty()) {
            return null;
        }

        ranked.sort(Comparator.comparingDouble((Scored s) -> s.score).reversed());
        Scored best = ranked.get(0);
        double runnerUp = ranked.size() > 1 ? ranked.get(1).score : 0;

        // Esigi gecmeyen ya da ikinciden belirgin ayrilmayan aday kabul edilmez:
        // kararsiz kalmak, kendinden emin yanlis aciklama gostermekten iyidir.
        if (best.score < MIN_SCORE || best.score - runnerUp < MIN_MARGIN) {
            // Birinci seviye anahtarlar karar verdirmedi; derindeki yapraklara bak.
            return inferFromDeepLeaves(parent, key, value);
        }
        return new Match(best.element, MatchKind.INFERRED, best.score,
                "yapı benzerliği: " + String.join(", ", best.matched) + " eşleşti"
                        + (key.equals(best.element.name()) ? "" : " (JSON'da: " + key + ")"));
    }

    private record Scored(ElementInfo element, double score, List<String> matched) {
    }

    /**
     * Aday tipin cocuk adlariyla JSON anahtarlarinin F1 benzeri ortusmesi; her ad
     * semada ne kadar nadirse o kadar agir sayilir.
     */
    private Scored score(Set<String> childKeys, ElementInfo candidate, TypeInfo candidateType, JsonNode value) {
        return scoreSets(childKeys, normalizedChildrenOf(candidate.typeKey(), candidateType).keySet(), candidate, value);
    }

    /**
     * Iki ad kumesinin F1 benzeri ortusmesi; her ad semada ne kadar nadirse o kadar
     * agir sayilir. `ID`, `TypeCode` gibi her yerde gecen adlar neredeyse bilgi
     * tasimaz, `PTC` gibi nadir adlar teshis edicidir.
     */
    private Scored scoreSets(
            Set<String> jsonKeys,
            Set<String> candidateNames,
            ElementInfo candidate,
            JsonNode value) {

        double intersection = 0;
        double jsonWeight = 0;
        List<String> matched = new ArrayList<>();

        for (String jsonKey : jsonKeys) {
            double weight = weightOf(jsonKey);
            jsonWeight += weight;
            for (String variant : SchemaNames.variants(jsonKey)) {
                if (candidateNames.contains(variant)) {
                    intersection += weight;
                    if (matched.size() < 4) {
                        matched.add(jsonKey);
                    }
                    break;
                }
            }
        }
        if (matched.isEmpty()) {
            return null;
        }

        double candidateWeight = 0;
        for (String name : candidateNames) {
            candidateWeight += weightOfNormalized(name);
        }
        if (jsonWeight + candidateWeight == 0) {
            return null;
        }

        double score = (2 * intersection) / (jsonWeight + candidateWeight);
        return new Scored(candidate, score * shapePenalty(candidate, value), matched);
    }

    /**
     * Kardinalite ve sekil uyumu. Semada tekil olan bir elemana cok elemanli dizi
     * gelmisse aday zayiflar; tekrarlanabilir elemana dizi gelmesi ise dogrular.
     */
    private double shapePenalty(ElementInfo candidate, JsonNode value) {
        boolean isArray = value.isArray();
        if (isArray && value.size() > 1 && !candidate.repeatable()) {
            return 0.6;
        }
        if (isArray && candidate.repeatable()) {
            return 1.1;
        }
        return 1.0;
    }

    /** Nadir ad = agir kanit. Semada hic gecmeyen adlar da ayirt edici sayilir. */
    private double weightOf(String key) {
        return weightOfNormalized(SchemaNames.normalize(key));
    }

    private double weightOfNormalized(String normalized) {
        int total = Math.max(schemaService.indexedTypeCount(), 1);
        int seen = schemaService.typesContainingElement(normalized);
        return Math.log((double) total / (1 + seen)) + 1;
    }

    // --- Yardimcilar ----------------------------------------------------------

    /**
     * Bir <code>&lt;X&gt;ID</code> alanindan cikan tip ipucu.
     *
     * @param owner ID'nin isaret ettigi nesne adi (`PaxID` &rarr; `Pax`)
     * @param field ipucunu veren alan adi; kullaniciya kanit olarak gosterilir
     * @param depth kac seviye asagida bulundugu; sig olan daha guclu kanittir
     */
    private record IdHint(String owner, String field, int depth) {
    }

    /** Dugumun altindaki ID alanlarini sig olandan derine dogru toplar. */
    private List<IdHint> idHints(JsonNode value, int depth) {
        List<IdHint> hints = new ArrayList<>();
        if (value == null || depth > 2) {
            return hints;
        }
        if (value.isArray()) {
            int seen = 0;
            for (JsonNode item : value) {
                if (seen++ >= 3) {
                    break;
                }
                hints.addAll(idHints(item, depth));
            }
            return hints;
        }
        if (!value.isObject()) {
            return hints;
        }

        List<JsonNode> nested = new ArrayList<>();
        Iterator<Map.Entry<String, JsonNode>> it = value.fields();
        while (it.hasNext()) {
            Map.Entry<String, JsonNode> entry = it.next();
            String owner = SchemaNames.objectNameFromIdField(entry.getKey());
            if (owner != null && entry.getValue().isValueNode()) {
                hints.add(new IdHint(owner, entry.getKey(), depth));
            } else if (!entry.getValue().isValueNode()) {
                nested.add(entry.getValue());
            }
        }
        // Sig ipuclari once denensin diye derine ancak bu seviye bittikten sonra inilir.
        for (JsonNode child : nested) {
            hints.addAll(idHints(child, depth + 1));
        }
        return hints;
    }

    /** Nesnenin (ya da dizideki nesnelerin) birinci seviye anahtarlari. */
    private Set<String> objectKeysOf(JsonNode value) {
        Set<String> keys = new LinkedHashSet<>();
        if (value == null) {
            return keys;
        }
        if (value.isArray()) {
            int seen = 0;
            for (JsonNode item : value) {
                if (seen++ >= ARRAY_SAMPLE) {
                    break;
                }
                if (item.isObject()) {
                    item.fieldNames().forEachRemaining(keys::add);
                }
            }
            return keys;
        }
        if (value.isObject()) {
            value.fieldNames().forEachRemaining(keys::add);
        }
        return keys;
    }

    /** JSON'da belirli bir derinlige kadar skaler degerli alan adlari. */
    private Set<String> deepLeafKeys(JsonNode value, int depth) {
        Set<String> leaves = new LinkedHashSet<>();
        if (value == null || depth > DEEP_LEAF_DEPTH) {
            return leaves;
        }
        if (value.isArray()) {
            int seen = 0;
            for (JsonNode item : value) {
                if (seen++ >= ARRAY_SAMPLE) {
                    break;
                }
                leaves.addAll(deepLeafKeys(item, depth));
            }
            return leaves;
        }
        if (!value.isObject()) {
            return leaves;
        }
        Iterator<Map.Entry<String, JsonNode>> it = value.fields();
        while (it.hasNext()) {
            Map.Entry<String, JsonNode> entry = it.next();
            if (entry.getValue().isValueNode()) {
                leaves.add(SchemaNames.normalize(entry.getKey()));
            } else {
                leaves.addAll(deepLeafKeys(entry.getValue(), depth + 1));
            }
        }
        return leaves;
    }

    /** XSD tarafinin karsiligi: bir tipin altindaki basit tipli torun adlari. */
    private Set<String> deepLeafNamesOf(String typeKey) {
        return deepLeafNames.computeIfAbsent(typeKey, key -> {
            Set<String> names = new LinkedHashSet<>();
            collectDeepLeafNames(key, names, new HashSet<>(), 0);
            return names;
        });
    }

    private void collectDeepLeafNames(String typeKey, Set<String> out, Set<String> visited, int depth) {
        if (typeKey == null || depth > DEEP_LEAF_DEPTH || !visited.add(typeKey)) {
            return;
        }
        TypeInfo type = schemaService.getType(typeKey);
        if (type == null) {
            return;
        }
        for (ElementInfo child : type.children().values()) {
            if (child.typeKey() == null) {
                out.add(SchemaNames.normalize(child.name()));
            } else {
                collectDeepLeafNames(child.typeKey(), out, visited, depth + 1);
            }
        }
    }

    private Map<String, ElementInfo> normalizedChildrenOf(String typeKey, TypeInfo type) {
        return normalizedChildren.computeIfAbsent(typeKey, key -> {
            Map<String, ElementInfo> map = new HashMap<>();
            for (ElementInfo child : type.children().values()) {
                for (String variant : SchemaNames.variants(child.name())) {
                    map.putIfAbsent(variant, child);
                }
            }
            return map;
        });
    }

    /** Test ve yeniden yukleme icin onbellegi bosaltir. */
    void clearCache() {
        normalizedChildren.clear();
        deepLeafNames.clear();
    }

    /** Bir dugumun altindaki butun ID degerlerini toplar; referans cozumlemede kullanilir. */
    static Map<String, String> collectIdValues(JsonNode root) {
        Map<String, String> byValue = new HashMap<>();
        collectIds(root, byValue, new HashSet<>());
        return byValue;
    }

    private static void collectIds(JsonNode node, Map<String, String> out, Set<JsonNode> seen) {
        if (node == null || !seen.add(node)) {
            return;
        }
        if (node.isArray()) {
            for (JsonNode item : node) {
                collectIds(item, out, seen);
            }
            return;
        }
        if (!node.isObject()) {
            return;
        }
        node.fields().forEachRemaining(entry -> {
            JsonNode child = entry.getValue();
            if (child.isValueNode()) {
                String owner = SchemaNames.objectNameFromIdField(entry.getKey());
                if (owner != null && !child.asText().isBlank()) {
                    out.putIfAbsent(child.asText(), owner);
                }
            } else {
                collectIds(child, out, seen);
            }
        });
    }
}
