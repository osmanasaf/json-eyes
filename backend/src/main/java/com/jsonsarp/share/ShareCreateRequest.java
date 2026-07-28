package com.jsonsarp.share;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * @param title           istege bagli, paylasimi tanimlayan kisa etiket
 * @param commentsEnabled null ise yorumlar aciktir
 */
public record ShareCreateRequest(JsonNode json, String title, Boolean commentsEnabled) {
}
