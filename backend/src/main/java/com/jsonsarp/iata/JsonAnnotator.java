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
 */
@Service
public class JsonAnnotator {

    private final XsdSchemaService schemaService;
    private final MessageTypeDetector detector;

    public JsonAnnotator(XsdSchemaService schemaService, MessageTypeDetector detector) {
        this.schemaService = schemaService;
        this.detector = detector;
    }

    /** Yanitta tasinacak en fazla eslesmeyen alan yolu. */
    private static final int MAX_UNMATCHED_PATHS = 200;

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

        Walk walk = new Walk();
        walk.visit(detection.body(), "", message.rootTypeKey());
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

        void visit(JsonNode node, String path, String typeKey) {
            if (node == null) {
                return;
            }

            if (node.isArray()) {
                // Dizinin butun elemanlari ayni tiptedir; heterojen dizilerde sonraki
                // elemanlarda gecen alanlarin da aciklamasi cikssin diye hepsi gezilir.
                for (JsonNode item : node) {
                    visit(item, path, typeKey);
                }
                return;
            }

            if (!node.isObject()) {
                return;
            }

            TypeInfo type = schemaService.getType(typeKey);
            Map<String, ElementInfo> children = type == null ? Map.of() : type.children();

            Iterator<Map.Entry<String, JsonNode>> it = node.fields();
            while (it.hasNext()) {
                Map.Entry<String, JsonNode> entry = it.next();
                String key = entry.getKey();
                String childPath = path.isEmpty() ? key : path + "." + key;

                ElementInfo info = children.get(normalizeKey(key));
                if (info == null) {
                    unmatched.add(childPath);
                    // Tip zinciri koptu; alt dallarda dogru aciklama uretemeyiz.
                    continue;
                }

                emit(childPath, info);
                visit(entry.getValue(), childPath, info.typeKey());
            }
        }

        private void emit(String path, ElementInfo info) {
            if (info.documentation() == null || info.documentation().isBlank()) {
                return;
            }
            if (!emitted.add(path)) {
                return;
            }
            fields.add(new FieldDoc(path, info.name(), info.typeName(), info.documentation().trim()));
        }
    }

    /** Bazi uretimler XML attribute'larini JSON'a '@' onekiyle tasir. */
    private static String normalizeKey(String key) {
        return key.startsWith("@") ? key.substring(1) : key;
    }
}
