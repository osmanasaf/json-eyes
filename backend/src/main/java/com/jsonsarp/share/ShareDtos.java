package com.jsonsarp.share;

import com.fasterxml.jackson.databind.JsonNode;

import java.time.Instant;

/** @param title istege bagli, paylasimi tanimlayan kisa etiket */
record ShareCreateRequest(JsonNode json, String title) {
}

record ShareCreateResponse(String id, String url) {
}

record ShareResponse(String id, String title, JsonNode json, Instant createdAt) {
}
