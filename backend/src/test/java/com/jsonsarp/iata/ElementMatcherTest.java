package com.jsonsarp.iata;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Ad varyasyonlarina dayanikliligi olcer.
 *
 * <p>Elimizde gercek musteri JSON'u yok ve uretimde hangi adlarin geleceği
 * onceden bilinemiyor. Bu yuzden yer gercegi olarak XSD'nin kendisi kullaniliyor:
 * semadan bir JSON iskeleti uretiliyor, <em>kapsayici</em> adlari kasitli bozuluyor
 * (buyuk/kucuk harf, cogul, "List" eki, ayrac, tamamen alakasiz kelime) ve
 * eslestiricinin dogru tipi geri bulup bulamadigina bakiliyor.
 */
class ElementMatcherTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static XsdSchemaService schemaService;
    private static JsonAnnotator annotator;

    @BeforeAll
    static void setUp() {
        schemaService = new XsdSchemaService();
        ReflectionTestUtils.setField(schemaService, "xsdPath", "");
        schemaService.loadSchemas();
        annotator = new JsonAnnotator(
                schemaService,
                new MessageTypeDetector(schemaService),
                new ElementMatcher(schemaService));
    }

    // --- Ad normalizasyonu (Katman 2) ----------------------------------------

    @Test
    void adVaryasyonlariAyniKokeIner() {
        assertThat(SchemaNames.variants("PaxList")).contains("pax");
        assertThat(SchemaNames.variants("pax_list")).contains("pax");
        assertThat(SchemaNames.variants("segments")).contains("segment");
        assertThat(SchemaNames.variants("SegmentList")).contains("segment");
        assertThat(SchemaNames.variants("PAX-LIST")).contains("pax");
    }

    /** `address`, `status` gibi tekil kelimeler cogul sanilip kirpilmamali. */
    @Test
    void tekilKelimelerCogulSanilmaz() {
        assertThat(SchemaNames.variants("Address")).containsExactly("address");
        assertThat(SchemaNames.variants("Status")).containsExactly("status");
    }

    @Test
    void idAlanindanNesneAdiCikarilir() {
        assertThat(SchemaNames.objectNameFromIdField("PaxID")).isEqualTo("Pax");
        assertThat(SchemaNames.objectNameFromIdField("OrderItemID")).isEqualTo("OrderItem");
        // Referans alani hedefin kendisi degildir.
        assertThat(SchemaNames.objectNameFromIdField("PaxRefID")).isNull();
    }

    // --- Yapisal cikarim (Katman 3-4) ----------------------------------------

    /**
     * Kapsayici tamamen farkli adlandirilmis; icindeki `PaxID` sayesinde yine de
     * dogru tipe baglanmali ve altindaki alanlar aciklamasini almali.
     */
    @Test
    void yenidenAdlandirilmisKapsayiciIcindekiIdSayesindeCozulur() {
        AnnotateResponse response = annotate("""
                {
                  "IATA_OrderViewRS": {
                    "Response": {
                      "DataLists": {
                        "passengerList": {
                          "traveler": [
                            { "PaxID": "PAX1", "PTC": "ADT" }
                          ]
                        }
                      }
                    }
                  }
                }
                """);

        Optional<FieldDoc> ptc = response.fields().stream()
                .filter(f -> f.path().endsWith("PTC"))
                .findFirst();

        assertThat(ptc).as("yeniden adlandirilmis kapsayicinin altindaki PTC aciklamasiz kalmamali").isPresent();
        assertThat(ptc.orElseThrow().documentation()).isNotBlank();
    }

    /** Bilinmeyen bir sarmalayici, altindaki bilinen dallari goturmemeli. */
    @Test
    void bilinmeyenSarmalayiciAltAgaciGoturmez() {
        AnnotateResponse response = annotate("""
                {
                  "IATA_OrderViewRS": {
                    "payload": {
                      "Response": { "Order": [ { "OrderID": "ABC123" } ] }
                    }
                  }
                }
                """);

        assertThat(response.fields())
                .as("sarmalayicinin altindaki Order yine aciklanmali")
                .anyMatch(f -> f.path().endsWith("Response.Order"));
    }

    /** Tahmini eslesmeler kesin olanlardan ayrilmali; UI ikisini farkli gosteriyor. */
    @Test
    void tahminiEslesmeIsaretlenirVeKanitTasir() {
        AnnotateResponse response = annotate("""
                {
                  "IATA_OrderViewRS": {
                    "Response": {
                      "DataLists": {
                        "passengerList": { "traveler": [ { "PaxID": "PAX1", "PTC": "ADT" } ] }
                      }
                    }
                  }
                }
                """);

        List<FieldDoc> inferred = response.fields().stream()
                .filter(f -> f.matchKind() == MatchKind.INFERRED)
                .toList();

        assertThat(inferred).isNotEmpty();
        assertThat(inferred).allSatisfy(field -> {
            assertThat(field.evidence()).isNotBlank();
            assertThat(field.confidence()).isBetween(0.0, 1.0);
        });
    }

    @Test
    void adBirebirTutuncaEslesmeKesinSayilir() {
        AnnotateResponse response = annotate("""
                { "IATA_OrderViewRS": { "Response": { "Order": [ { "OrderID": "ABC123" } ] } } }
                """);

        FieldDoc order = response.fields().stream()
                .filter(f -> f.path().equals("Response.Order"))
                .findFirst()
                .orElseThrow();

        assertThat(order.matchKind()).isEqualTo(MatchKind.EXACT);
        assertThat(order.confidence()).isEqualTo(1.0);
        assertThat(order.evidence()).isNull();
    }

    /** Yeniden adlandirilmis referans alani, degeri bir ID'yle tuttugu icin cozulur. */
    @Test
    void yenidenAdlandirilmisReferansAlaniDegerindenTanınir() {
        AnnotateResponse response = annotate("""
                {
                  "IATA_OrderViewRS": {
                    "Response": {
                      "Order": [ { "OrderID": "O1", "travelerRef": "PAX1" } ],
                      "DataLists": { "PaxList": { "Pax": [ { "PaxID": "PAX1" } ] } }
                    }
                  }
                }
                """);

        Optional<FieldDoc> ref = response.fields().stream()
                .filter(f -> f.path().endsWith("travelerRef"))
                .findFirst();

        assertThat(ref).isPresent();
        assertThat(ref.orElseThrow().documentation()).contains("Pax");
        assertThat(ref.orElseThrow().matchKind()).isEqualTo(MatchKind.INFERRED);
    }

    // --- Sentetik mutasyon taramasi ------------------------------------------

    /**
     * XSD'den uretilen iskeletin kapsayici adlari bozulunca yaprak alanlarin ne
     * kadarinin hala aciklandigini olcer. Rakam bir kalite tabani: yeni bir
     * katman eklendiginde ya da bir esik degistiginde gerileme buradan gorulur.
     */
    @Test
    void bozulmusAdlarinAltindakiAlanlarBuyukOrandaKurtarilir() {
        MessageInfo message = schemaService.getMessage("IATA_OrderViewRS");
        assertThat(message).isNotNull();

        ObjectNode body = MAPPER.createObjectNode();
        buildSkeleton(message.rootTypeKey(), body, 0);

        int baseline = countDocumented(wrap(body));
        assertThat(baseline).as("bozulmamis iskelet zaten aciklanmali").isPositive();

        for (Mutation mutation : Mutation.values()) {
            ObjectNode mutated = (ObjectNode) mutate(body.deepCopy(), mutation, 0);
            int documented = countDocumented(wrap(mutated));
            double recall = (double) documented / baseline;

            // Rakam kaliteyi izlemek icin rapora yaziliyor; esik yalnizca gerilemeyi yakalar.
            System.out.printf("[eslestirme] %-18s %3d/%3d alan (%.0f%%)%n",
                    mutation, documented, baseline, recall * 100);

            assertThat(recall)
                    .as("%s mutasyonunda kurtarma orani (%d/%d)", mutation, documented, baseline)
                    .isGreaterThanOrEqualTo(mutation.minRecall);
        }
    }

    /**
     * Adlar dogruyken hicbir tahmin uretilmemeli. Tahmin, ad tutmadiginda basvurulan
     * son caredir; normal JSON'da devreye girerse kesin eslesmeleri golgeler.
     */
    @Test
    void adlarDogruykenTahminUretilmez() {
        MessageInfo message = schemaService.getMessage("IATA_OrderViewRS");
        ObjectNode body = MAPPER.createObjectNode();
        buildSkeleton(message.rootTypeKey(), body, 0);

        List<FieldDoc> inferred = annotator.annotate(wrap(body)).fields().stream()
                .filter(f -> f.matchKind() == MatchKind.INFERRED)
                .toList();

        assertThat(inferred)
                .as("bozulmamis iskelette tahmini eslesme olmamali")
                .isEmpty();
    }

    /**
     * Semayla hicbir ilgisi olmayan bir nesne, "bir seye benzesin" diye zorla
     * eslestirilmemeli. Yanlis aciklama gostermek, hic gostermemekten kotudur.
     */
    @Test
    void alakasizNesneZorlaEslestirilmez() {
        AnnotateResponse response = annotate("""
                {
                  "IATA_OrderViewRS": {
                    "Response": {
                      "muhasebeKaydi": {
                        "fisNo": "F-1",
                        "borc": 100,
                        "alacak": 0,
                        "aciklama": "kayit"
                      }
                    }
                  }
                }
                """);

        assertThat(response.fields())
                .as("alakasiz nesne icin aciklama uretilmemeli")
                .noneMatch(f -> f.path().startsWith("Response.muhasebeKaydi"));
        assertThat(response.unmatchedCount()).isPositive();
    }

    /**
     * Esikler olculen degerlerin biraz altinda: amac hedef koymak degil, ilerideki
     * bir degisiklik eslestirmeyi bozarsa yakalamak.
     */
    private enum Mutation {
        /** paxList -> PAXLIST */
        UPPERCASE(0.95),
        /** PaxList -> paxlists */
        PLURAL(0.95),
        /** PaxList -> pax_list */
        SNAKE_CASE(0.95),
        /** PaxList -> paxCollection */
        COLLECTION_SUFFIX(0.95),
        /**
         * PaxList -> bolum3. Bicimsel hicbir ipucu birakmaz; yalnizca yapisal
         * cikarim (tasidigi ID ve yaprak adlarinin ortusmesi) kurtarabilir.
         * Asil iddiayi sinayan mutasyon budur.
         */
        UNRELATED_WORD(0.55);

        private final double minRecall;

        Mutation(double minRecall) {
            this.minRecall = minRecall;
        }
    }

    /** UNRELATED_WORD icin sayac; her kapsayici farkli bir uydurma ad alsin. */
    private static int renameCounter;

    /** Yalnizca kapsayici (nesne/dizi) adlarini bozar; yapraklar standart kalir. */
    private static JsonNode mutate(JsonNode node, Mutation mutation, int depth) {
        if (node.isArray()) {
            ArrayNode array = (ArrayNode) node;
            for (int i = 0; i < array.size(); i++) {
                array.set(i, mutate(array.get(i), mutation, depth));
            }
            return array;
        }
        if (!node.isObject()) {
            return node;
        }
        ObjectNode object = (ObjectNode) node;
        ObjectNode out = MAPPER.createObjectNode();
        object.fields().forEachRemaining(entry -> {
            JsonNode child = entry.getValue();
            boolean container = child.isObject() || child.isArray();
            String name = container && depth > 0 ? rename(entry.getKey(), mutation) : entry.getKey();
            out.set(name, mutate(child, mutation, depth + 1));
        });
        return out;
    }

    private static String rename(String name, Mutation mutation) {
        return switch (mutation) {
            case UPPERCASE -> name.toUpperCase();
            case PLURAL -> name.toLowerCase() + "s";
            case SNAKE_CASE -> name.replaceAll("(?<!^)([A-Z])", "_$1").toLowerCase();
            case COLLECTION_SUFFIX -> name + "Collection";
            case UNRELATED_WORD -> "bolum" + (renameCounter++);
        };
    }

    /** XSD tipinden birkac seviyelik JSON iskeleti uretir. */
    private void buildSkeleton(String typeKey, ObjectNode target, int depth) {
        if (depth > 3) {
            return;
        }
        TypeInfo type = schemaService.getType(typeKey);
        if (type == null) {
            return;
        }
        int emitted = 0;
        for (ElementInfo child : type.children().values()) {
            if (emitted >= 6) {
                break;
            }
            if (child.typeKey() == null) {
                target.put(child.name(), "x");
                emitted++;
                continue;
            }
            ObjectNode nested = MAPPER.createObjectNode();
            buildSkeleton(child.typeKey(), nested, depth + 1);
            if (nested.isEmpty()) {
                continue;
            }
            if (child.repeatable()) {
                ArrayNode array = MAPPER.createArrayNode();
                array.add(nested);
                target.set(child.name(), array);
            } else {
                target.set(child.name(), nested);
            }
            emitted++;
        }
    }

    private static ObjectNode wrap(ObjectNode body) {
        ObjectNode root = MAPPER.createObjectNode();
        root.set("IATA_OrderViewRS", body);
        return root;
    }

    private static int countDocumented(JsonNode json) {
        return annotator.annotate(json).fields().size();
    }

    private static AnnotateResponse annotate(String json) {
        try {
            return annotator.annotate(MAPPER.readTree(json));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
