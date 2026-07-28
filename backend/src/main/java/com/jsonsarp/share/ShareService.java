package com.jsonsarp.share;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Optional;

import static org.springframework.http.HttpStatus.BAD_REQUEST;
import static org.springframework.http.HttpStatus.INTERNAL_SERVER_ERROR;
import static org.springframework.http.HttpStatus.NOT_FOUND;
import static org.springframework.http.HttpStatus.PAYLOAD_TOO_LARGE;

@Service
public class ShareService {

    private static final char[] BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz".toCharArray();
    private static final int ID_LENGTH = 8;

    private final JsonShareRepository repository;
    private final ObjectMapper objectMapper;
    private final SecureRandom random = new SecureRandom();

    @Value("${jsonsarp.public-base-url:http://localhost:5173}")
    private String publicBaseUrl;

    @Value("${jsonsarp.share.max-bytes:2097152}")
    private int maxShareBytes;

    public ShareService(JsonShareRepository repository, ObjectMapper objectMapper) {
        this.repository = repository;
        this.objectMapper = objectMapper;
    }

    public ShareCreateResponse createShare(ShareCreateRequest request) {
        if (request.json() == null || request.json().isNull()) {
            throw new ResponseStatusException(BAD_REQUEST, "JSON bos olamaz");
        }

        String content;
        try {
            content = objectMapper.writeValueAsString(request.json());
        } catch (JsonProcessingException e) {
            throw new ResponseStatusException(BAD_REQUEST, "Gecersiz JSON");
        }

        int size = content.getBytes(StandardCharsets.UTF_8).length;
        if (size > maxShareBytes) {
            throw new ResponseStatusException(PAYLOAD_TOO_LARGE,
                    "JSON cok buyuk: " + size + " byte (ust sinir " + maxShareBytes + " byte)");
        }

        String id = generateUniqueId();
        repository.save(new JsonShare(id, content, normalizeTitle(request.title())));
        return new ShareCreateResponse(id, publicBaseUrl + "/?s=" + id);
    }

    public ShareResponse getShare(String id) {
        Optional<JsonShare> share = repository.findById(id);
        if (share.isEmpty()) {
            throw new ResponseStatusException(NOT_FOUND, "Paylasim bulunamadi");
        }

        JsonShare entity = share.get();
        try {
            return new ShareResponse(
                    entity.getId(),
                    entity.getTitle(),
                    objectMapper.readTree(entity.getContent()),
                    entity.getCreatedAt()
            );
        } catch (JsonProcessingException e) {
            throw new ResponseStatusException(INTERNAL_SERVER_ERROR, "Kayitli JSON okunamadi", e);
        }
    }

    private static final int MAX_TITLE_LENGTH = 120;

    /** Bos basliklari null'a cevirir ve sutun sinirina kirpar. */
    private String normalizeTitle(String title) {
        if (title == null || title.isBlank()) {
            return null;
        }
        String trimmed = title.trim();
        return trimmed.length() > MAX_TITLE_LENGTH ? trimmed.substring(0, MAX_TITLE_LENGTH) : trimmed;
    }

    private String generateUniqueId() {
        for (int attempt = 0; attempt < 10; attempt++) {
            String id = randomBase62(ID_LENGTH);
            if (!repository.existsById(id)) {
                return id;
            }
        }
        throw new IllegalStateException("Benzersiz paylasim ID uretilemedi");
    }

    private String randomBase62(int length) {
        char[] buf = new char[length];
        for (int i = 0; i < length; i++) {
            buf[i] = BASE62[random.nextInt(BASE62.length)];
        }
        return new String(buf);
    }
}
