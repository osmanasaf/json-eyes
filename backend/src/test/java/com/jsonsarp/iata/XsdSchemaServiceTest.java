package com.jsonsarp.iata;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class XsdSchemaServiceTest {

    private static XsdSchemaService service;

    @BeforeAll
    static void loadSchemas() {
        service = new XsdSchemaService();
        ReflectionTestUtils.setField(service, "xsdPath", "");
        service.loadSchemas();
    }

    @Test
    void semalarYuklenir() {
        assertThat(service.isSchemaLoaded()).isTrue();
    }

    /**
     * xmldsig-core-schema.xsd'deki DOCTYPE bir zamanlar ortak tip dosyalarini da
     * dusuruyordu; ortak tipler olmadan indekste yalnizca ~49 tip kaliyordu.
     */
    @Test
    void ortakTipDosyalariDaIndekslenir() {
        assertThat(typeCount()).isGreaterThan(400);
    }

    @Test
    void yalnizcaGercekIataMesajlariListelenir() {
        List<String> messages = service.listMessages();

        assertThat(messages).isNotEmpty();
        assertThat(messages).allSatisfy(name -> assertThat(name).startsWith("IATA_"));
        // Ortak tiplerdeki PaymentCard/PaymentMethod gibi elemanlar mesaj degildir.
        assertThat(messages).doesNotContain("PaymentCard", "PaymentMethod", "PaymentInfo");
        assertThat(messages).contains("IATA_OrderViewRS", "IATA_AirShoppingRQ");
    }

    @Test
    void mesajGovdesininUstDuzeyElemanlariCikarilir() {
        assertThat(service.getTopLevelElements("IATA_OrderViewRS")).contains("Response");
    }

    /**
     * Ayni ad farkli tiplerde farkli anlama gelir. Onceki duz "yol -> aciklama"
     * indeksinde ilk bulunan aciklama butun baglamlar icin kullaniliyordu.
     */
    @Test
    void ayniAdFarkliTiplerdeKendiAciklamasiniKorur() {
        List<String> distinctDocs = service.listMessages().stream()
                .map(service::getMessage)
                .map(MessageInfo::rootTypeKey)
                .map(service::getType)
                .filter(java.util.Objects::nonNull)
                .flatMap(type -> type.children().values().stream())
                .map(ElementInfo::documentation)
                .filter(java.util.Objects::nonNull)
                .distinct()
                .toList();

        assertThat(distinctDocs).isNotEmpty();
        assertThat(descTextDocumentations()).hasSizeGreaterThan(1);
    }

    @Test
    void elemanlarXsdTipAdiniTasir() {
        TypeInfo root = service.getType(service.getMessage("IATA_OrderViewRS").rootTypeKey());
        ElementInfo response = root.children().get("Response");

        assertThat(response).isNotNull();
        assertThat(response.typeName()).isNotBlank();
        assertThat(response.typeKey()).isNotNull();
    }

    private static int typeCount() {
        @SuppressWarnings("unchecked")
        Map<String, TypeInfo> types = (Map<String, TypeInfo>) ReflectionTestUtils.getField(service, "types");
        return types == null ? 0 : types.size();
    }

    /** Indeksteki butun tipleri tarayip DescText icin farkli aciklamalari toplar. */
    private static List<String> descTextDocumentations() {
        @SuppressWarnings("unchecked")
        Map<String, TypeInfo> types = (Map<String, TypeInfo>) ReflectionTestUtils.getField(service, "types");
        return types.values().stream()
                .map(type -> type.children().get("DescText"))
                .filter(java.util.Objects::nonNull)
                .map(ElementInfo::documentation)
                .filter(java.util.Objects::nonNull)
                .distinct()
                .toList();
    }
}
