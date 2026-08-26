package com.jsonsarp.share;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.http.HttpStatus.PAYLOAD_TOO_LARGE;

/**
 * `content` sutunu icin acik bir `length` verilmezse Hibernate H2'de ~32.600
 * karakterlik bir varsayilana dusuyor ve bunu asan her paylasim, `jsonsarp.share.max-bytes`
 * kontrolunden gecse bile veritabanina yazilamadan 500 ile patliyordu. Bu test
 * o boyut araligini (32 KB - max-bytes) kapsayarak regresyona karsi koruyor.
 */
@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:share-service-test;DB_CLOSE_DELAY=-1",
        "jsonsarp.share.max-bytes=1048576"
})
class ShareServiceTest {

    @Autowired
    private ShareService shareService;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void otuzIkiKbUstuIcerikVeritabaninaYaziliyor() throws Exception {
        String id = shareService.createShare(new ShareCreateRequest(bigJson(200_000), "buyuk", true)).id();

        ShareResponse stored = shareService.getShare(id);

        assertThat(objectMapper.writeValueAsString(stored.json())).hasSizeGreaterThan(200_000);
    }

    @Test
    void yapilandirilanSiniriAsanIcerik413Firlatir() {
        assertThatThrownBy(() -> shareService.createShare(new ShareCreateRequest(bigJson(2_000_000), null, true)))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(ex -> ((ResponseStatusException) ex).getStatusCode())
                .isEqualTo(PAYLOAD_TOO_LARGE);
    }

    private ObjectNode bigJson(int approxChars) {
        ObjectNode node = objectMapper.createObjectNode();
        node.put("payload", "x".repeat(approxChars));
        return node;
    }
}
