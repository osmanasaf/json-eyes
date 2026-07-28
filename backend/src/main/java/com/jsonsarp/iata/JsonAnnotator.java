package com.jsonsarp.iata;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * JSON agacinda yururken XSD tip agacinda da paralel ilerler; her alanin aciklamasi
 * bulundugu baglamin tipinden gelir.
 *
 * <p>Ad tutmadiginda {@link ElementMatcher} devreye girer ve alan yapisindan
 * cikarilmaya calisilir; o da bulamazsa dal terk edilmez, ayni tiple devam edilir.
 * Boylece bilinmeyen bir sarmalayici (`{"data": {...}}`) altindaki torunlar
 * aciklamasiz kalmaz.
 */
@Service
public class JsonAnnotator {

    private final XsdSchemaService schemaService;
    private final MessageTypeDetector detector;
    private final ElementMatcher matcher;

    public JsonAnnotator(XsdSchemaService schemaService, MessageTypeDetector detector, ElementMatcher matcher) {
        this.schemaService = schemaService;
        this.detector = detector;
        this.matcher = matcher;
    }

    /** Yanitta tasinacak en fazla eslesmeyen alan yolu. */
    private static final int MAX_UNMATCHED_PATHS = 200;

    /**
     * Bilinmeyen bir sarmalayicidan sonra ayni tiple kac seviye daha denenecegi.
     * Sinirsiz olsaydi tamamen alakasiz derin agaclarda bosuna is yapardik.
     */
    private static final int MAX_UNANCHORED_DEPTH = 2;

    public AnnotateResponse annotate(JsonNode json) {
        boolean schemaLoaded = schemaService.isSchemaLoaded();
        MessageTypeDetector.DetectionResult detection = detector.detect(json);
        if (!detection.isKnown()) {
            return new AnnotateResponse(null, 0, schemaLoaded, 0, List.of(), List.of());
        }

        MessageInfo message = schemaService.getMessage(detection.messageType());
        if (message == null) {
            return new AnnotateResponse(
                    detection.messageType(), detection.confidence(), schemaLoaded, 0, List.of(), List.of());
        }

        Walk walk = new Walk(ElementMatcher.collectIdValues(detection.body()));
        walk.visit(detection.body(), "", message.rootTypeKey(), 0);
        List<String> unmatchedPaths = walk.unmatched.stream().sorted().limit(MAX_UNMATCHED_PATHS).toList();
        return new AnnotateResponse(
                detection.messageType(),
                detection.confidence(),
                schemaLoaded,
                walk.unmatched.size(),
                unmatchedPaths,
                walk.fields);
    }

    /** Tek bir annotate cagrisinin gezinme durumu. */
    private final class Walk {
        private final List<FieldDoc> fields = new ArrayList<>();
        private final Set<String> emitted = new HashSet<>();
        private final Set<String> unmatched = new HashSet<>();
        /** Belgedeki butun ID degerleri; yeniden adlandirilmis referans alanlarini cozer. */
        private final Map<String, String> idValues;

        Walk(Map<String, String> idValues) {
            this.idValues = idValues;
        }

        void visit(JsonNode node, String path, String typeKey, int unanchored) {
            if (node == null) {
                return;
            }

            if (node.isArray()) {
                // Dizinin butun elemanlari ayni tiptedir; heterojen dizilerde sonraki
                // elemanlarda gecen alanlarin da aciklamasi cikssin diye hepsi gezilir.
                for (JsonNode item : node) {
                    visit(item, path, typeKey, unanchored);
                }
                return;
            }

            if (!node.isObject()) {
                return;
            }

            Iterator<Map.Entry<String, JsonNode>> it = node.fields();
            while (it.hasNext()) {
                Map.Entry<String, JsonNode> entry = it.next();
                String key = entry.getKey();
                JsonNode value = entry.getValue();
                String childPath = path.isEmpty() ? key : path + "." + key;

                ElementMatcher.Match match = matcher.match(typeKey, key, value);
                if (match != null) {
                    emit(childPath, match);
                    visit(value, childPath, match.element().typeKey(), 0);
                    continue;
                }

                unmatched.add(childPath);
                emitReference(childPath, key, value);

                // Ad tutmadi ama dal terk edilmiyor: bilinmeyen sarmalayicilarin
                // altindaki torunlar ayni tiple hala eslesebilir.
                if (unanchored < MAX_UNANCHORED_DEPTH) {
                    visit(value, childPath, typeKey, unanchored + 1);
                }
            }
        }

        /**
         * Semada karsiligi olmayan skaler bir alan, belgedeki bir ID degerini tasiyorsa
         * yeniden adlandirilmis bir referans alanidir (`PaxRefID` -> `passengerRef`).
         */
        private void emitReference(String path, String key, JsonNode value) {
            if (!value.isValueNode() || !SchemaNames.isRefField(key)) {
                return;
            }
            String owner = idValues.get(value.asText());
            if (owner == null || !emitted.add(path)) {
                return;
            }
            fields.add(new FieldDoc(
                    path,
                    key,
                    null,
                    "Şemada karşılığı bulunamadı, ancak değeri belgedeki bir " + owner
                            + " kaydının kimliğiyle eşleşiyor; bu alan bir " + owner + " referansı gibi görünüyor.",
                    MatchKind.INFERRED,
                    0.7,
                    "referans değeri " + owner + "ID ile eşleşti"));
        }

        private void emit(String path, ElementMatcher.Match match) {
            ElementInfo info = match.element();
            if (info.documentation() == null || info.documentation().isBlank()) {
                return;
            }
            if (!emitted.add(path)) {
                return;
            }
            fields.add(new FieldDoc(
                    path,
                    info.name(),
                    info.typeName(),
                    info.documentation().trim(),
                    match.kind(),
                    match.score(),
                    match.evidence()));
        }
    }
}
