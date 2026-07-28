package com.jsonsarp.iata;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Service;

import java.util.HashSet;
import java.util.Set;

@Service
public class MessageTypeDetector {

    private final XsdSchemaService schemaService;

    public MessageTypeDetector(XsdSchemaService schemaService) {
        this.schemaService = schemaService;
    }

    public DetectionResult detect(JsonNode json) {
        if (json == null || !json.isObject()) {
            return DetectionResult.unknown();
        }

        Set<String> rootKeys = new HashSet<>();
        json.fieldNames().forEachRemaining(rootKeys::add);

        for (String key : rootKeys) {
            if (schemaService.hasMessage(key)) {
                JsonNode body = json.get(key);
                return new DetectionResult(key, body != null ? body : json, 1.0, true);
            }
        }

        String bestType = null;
        double bestScore = 0;
        for (String messageType : schemaService.listMessages()) {
            Set<String> topLevel = schemaService.getTopLevelElements(messageType);
            if (topLevel.isEmpty()) {
                continue;
            }
            long matches = rootKeys.stream().filter(topLevel::contains).count();
            if (matches == 0) {
                continue;
            }
            // Hem eksik hem fazla alani cezalandiran F1 benzeri skor: yalnizca
            // "eslesen / semadaki alan" oranina bakmak, az alanli semalari haksiz
            // sekilde one cikariyordu.
            double score = (2.0 * matches) / (topLevel.size() + rootKeys.size());
            if (score > bestScore) {
                bestScore = score;
                bestType = messageType;
            }
        }

        if (bestType == null || bestScore <= 0) {
            return DetectionResult.unknown();
        }

        return new DetectionResult(bestType, json, bestScore, false);
    }

    public record DetectionResult(
            String messageType,
            JsonNode body,
            double confidence,
            boolean wrapped
    ) {
        static DetectionResult unknown() {
            return new DetectionResult(null, null, 0, false);
        }

        boolean isKnown() {
            return messageType != null;
        }
    }
}
