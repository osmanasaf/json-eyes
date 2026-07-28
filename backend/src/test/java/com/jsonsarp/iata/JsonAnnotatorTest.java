package com.jsonsarp.iata;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

class JsonAnnotatorTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static JsonAnnotator annotator;

    @BeforeAll
    static void setUp() {
        XsdSchemaService schemaService = new XsdSchemaService();
        ReflectionTestUtils.setField(schemaService, "xsdPath", "");
        schemaService.loadSchemas();
        annotator = new JsonAnnotator(
                schemaService,
                new MessageTypeDetector(schemaService),
                new ElementMatcher(schemaService));
    }

    @Test
    void sarmalanmisMesajTipiKesinOlarakTespitEdilir() {
        AnnotateResponse response = annotate("""
                { "IATA_OrderViewRS": { "Response": { "Order": [ { "OrderID": "ABC123" } ] } } }
                """);

        assertThat(response.messageType()).isEqualTo("IATA_OrderViewRS");
        assertThat(response.confidence()).isEqualTo(1.0);
        assertThat(response.schemaLoaded()).isTrue();
    }

    @Test
    void alanlarAciklamaVeXsdTipAdiyleDoner() {
        AnnotateResponse response = annotate("""
                { "IATA_OrderViewRS": { "Response": { "Order": [ { "OrderID": "ABC123" } ] } } }
                """);

        FieldDoc order = field(response, "Response.Order").orElseThrow();
        assertThat(order.documentation()).isNotBlank();
        assertThat(order.type()).isEqualTo("OrderedOrderType");
    }

    /** Onceki surum dizinin yalnizca ilk elemanini geziyordu. */
    @Test
    void dizininSonrakiElemanlarindakiAlanlarDaAciklanir() {
        AnnotateResponse response = annotate("""
                {
                  "IATA_OrderViewRS": {
                    "Response": {
                      "Order": [
                        { "OrderID": "FIRST" },
                        { "OwnerCode": "TK" }
                      ]
                    }
                  }
                }
                """);

        assertThat(field(response, "Response.Order.OwnerCode")).isPresent();
    }

    /**
     * NDC'de DescText/TypeCode/RefID gibi adlar onlarca tipte farkli anlamlarla gecer.
     * Onceki duz yol indeksi ilk buldugu aciklamayi her baglamda kullaniyordu.
     */
    @Test
    void ayniAlanFarkliDallardaKendiAciklamasiniAlir() {
        AnnotateResponse response = annotate("""
                {
                  "IATA_OrderViewRS": {
                    "Error": [ { "DescText": "hata" } ],
                    "Response": { "Warning": [ { "DescText": "uyari" } ] }
                  }
                }
                """);

        String errorDoc = field(response, "Error.DescText").orElseThrow().documentation();
        String warningDoc = field(response, "Response.Warning.DescText").orElseThrow().documentation();

        assertThat(errorDoc).isNotBlank();
        assertThat(warningDoc).isNotBlank();
        assertThat(errorDoc).isNotEqualTo(warningDoc);
    }

    @Test
    void semadaOlmayanAlanlarSayilirVeAciklamaUretilmez() {
        AnnotateResponse response = annotate("""
                { "IATA_OrderViewRS": { "Response": { "BoyleBirAlanYok": "x" } } }
                """);

        assertThat(response.unmatchedCount()).isPositive();
        assertThat(field(response, "Response.BoyleBirAlanYok")).isEmpty();
    }

    @Test
    void iataOlmayanJsonIcinMesajTipiBulunmaz() {
        AnnotateResponse response = annotate("""
                { "siparis": { "musteri": "Ayse", "tutar": 100 } }
                """);

        assertThat(response.messageType()).isNull();
        assertThat(response.fields()).isEmpty();
        // Sema yuklu; bos liste "IATA mesaji degil" demek, "sema yok" demek degil.
        assertThat(response.schemaLoaded()).isTrue();
    }

    private static Optional<FieldDoc> field(AnnotateResponse response, String path) {
        List<FieldDoc> fields = response.fields();
        return fields.stream().filter(f -> f.path().equals(path)).findFirst();
    }

    private static AnnotateResponse annotate(String json) {
        try {
            JsonNode node = MAPPER.readTree(json);
            return annotator.annotate(node);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
