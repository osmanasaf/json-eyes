package com.jsonsarp.share;

import com.fasterxml.jackson.databind.JsonNode;

import java.time.Instant;

record ShareResponse(String id, String title, boolean commentsEnabled, JsonNode json, Instant createdAt) {
}
