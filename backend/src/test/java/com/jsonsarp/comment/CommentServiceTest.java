package com.jsonsarp.comment;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jsonsarp.share.JsonShareRepository;
import com.jsonsarp.share.ShareCreateRequest;
import com.jsonsarp.share.ShareService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.web.server.ResponseStatusException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest
class CommentServiceTest {

    @Autowired
    private CommentService commentService;

    @Autowired
    private ShareService shareService;

    @Autowired
    private CommentRepository commentRepository;

    @Autowired
    private JsonShareRepository shareRepository;

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @BeforeEach
    void clean() {
        commentRepository.deleteAll();
        shareRepository.deleteAll();
    }

    @Test
    void yorumEklenirVeListelenir() {
        String shareId = createShare(true);

        CommentCreateResponse created = commentService.create(shareId, request("Response.Order.0.OrderID", "Ayse", "Bu ID nereden geliyor?"));

        assertThat(created.editToken()).isNotBlank();
        assertThat(created.comment().author()).isEqualTo("Ayse");

        CommentListResponse list = commentService.list(shareId);
        assertThat(list.enabled()).isTrue();
        assertThat(list.comments()).hasSize(1);
        assertThat(list.comments().get(0).path()).isEqualTo("Response.Order.0.OrderID");
    }

    @Test
    void yorumaYanitVerilebilirAmaYanitaYanitVerilemez() {
        String shareId = createShare(true);
        Long rootId = commentService.create(shareId, request("a.b", "Ayse", "soru")).comment().id();

        CommentCreateResponse reply = commentService.create(shareId, reply("a.b", "Mehmet", "cevap", rootId));
        assertThat(reply.comment().parentId()).isEqualTo(rootId);

        Long replyId = reply.comment().id();
        assertThatThrownBy(() -> commentService.create(shareId, reply("a.b", "Can", "cevaba cevap", replyId)))
                .isInstanceOf(ResponseStatusException.class);
    }

    @Test
    void yorumlaraKapaliPaylasimdaYorumEklenemez() {
        String shareId = createShare(false);

        assertThat(commentService.list(shareId).enabled()).isFalse();
        assertThatThrownBy(() -> commentService.create(shareId, request("a", "Ayse", "deneme")))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("403");
    }

    @Test
    void yorumYalnizcaDogruTokenIleSilinir() {
        String shareId = createShare(true);
        CommentCreateResponse created = commentService.create(shareId, request("a", "Ayse", "silinecek"));
        Long id = created.comment().id();

        assertThatThrownBy(() -> commentService.delete(shareId, id, "yanlis-token"))
                .isInstanceOf(ResponseStatusException.class);
        assertThat(commentService.list(shareId).comments()).hasSize(1);

        commentService.delete(shareId, id, created.editToken());
        assertThat(commentService.list(shareId).comments()).isEmpty();
    }

    @Test
    void kokYorumSilinincYanitlariDaSilinir() {
        String shareId = createShare(true);
        CommentCreateResponse root = commentService.create(shareId, request("a", "Ayse", "soru"));
        commentService.create(shareId, reply("a", "Mehmet", "cevap", root.comment().id()));
        assertThat(commentService.list(shareId).comments()).hasSize(2);

        commentService.delete(shareId, root.comment().id(), root.editToken());

        assertThat(commentService.list(shareId).comments()).isEmpty();
    }

    @Test
    void bosYorumVeCokUzunMetinReddedilir() {
        String shareId = createShare(true);

        assertThatThrownBy(() -> commentService.create(shareId, request("a", "Ayse", "   ")))
                .isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> commentService.create(shareId, request("a", "Ayse", "x".repeat(5000))))
                .isInstanceOf(ResponseStatusException.class);
    }

    @Test
    void olmayanPaylasimaYorumEklenemez() {
        assertThatThrownBy(() -> commentService.list("YOKBOYLE"))
                .isInstanceOf(ResponseStatusException.class);
    }

    private static CommentCreateRequest request(String path, String author, String body) {
        return new CommentCreateRequest(path, author, body, null);
    }

    private static CommentCreateRequest reply(String path, String author, String body, Long parentId) {
        return new CommentCreateRequest(path, author, body, parentId);
    }

    private String createShare(boolean commentsEnabled) {
        try {
            return shareService.createShare(
                    new ShareCreateRequest(MAPPER.readTree("{\"a\":1}"), "test", commentsEnabled)).id();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
