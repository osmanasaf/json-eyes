package com.jsonsarp.share;

import com.jsonsarp.comment.Comment;
import com.jsonsarp.comment.CommentRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Duration;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Saklama temizligi gercekten siliyor mu.
 *
 * <p>Sessiz basarisizliga acik bir yer: islem yonetimi yanlis kurulursa gorev
 * hicbir sey silmeden "temizlendi" diye loglar ve veritabani buyumeye devam eder.
 */
@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:retention;DB_CLOSE_DELAY=-1",
        "jsonsarp.share.retention-days=60"
})
class ShareRetentionServiceTest {

    @Autowired
    private ShareRetentionService retentionService;

    @Autowired
    private JsonShareRepository shareRepository;

    @Autowired
    private CommentRepository commentRepository;

    @BeforeEach
    void reset() {
        commentRepository.deleteAll();
        shareRepository.deleteAll();
    }

    @Test
    void suresiDolanPaylasimVeYorumlariSilinir() {
        String expired = save("eski", Instant.now().minus(Duration.ofDays(90)));
        String fresh = save("yeni", Instant.now().minus(Duration.ofDays(10)));
        commentRepository.save(comment(expired));
        commentRepository.save(comment(fresh));

        retentionService.purgeExpiredShares();

        assertThat(shareRepository.findById(expired)).as("suresi dolan silinmeli").isEmpty();
        assertThat(shareRepository.findById(fresh)).as("suresi dolmayan durmali").isPresent();
        assertThat(commentRepository.findByShareIdOrderByCreatedAtAsc(expired))
                .as("silinen paylasimin yorumlari da gitmeli").isEmpty();
        assertThat(commentRepository.findByShareIdOrderByCreatedAtAsc(fresh))
                .as("duran paylasimin yorumlari korunmali").hasSize(1);
    }

    @Test
    void sifirGunVerilirseTemizlikKapanir() {
        String expired = save("eski", Instant.now().minus(Duration.ofDays(400)));
        ReflectionTestUtils.setField(retentionService, "retentionDays", 0);

        retentionService.purgeExpiredShares();

        assertThat(shareRepository.findById(expired)).isPresent();
        ReflectionTestUtils.setField(retentionService, "retentionDays", 60);
    }

    /** Tek turda silinenden fazla kayit varsa dongu devam etmeli. */
    @Test
    void gruptanFazlaKayitVarsaHepsiSilinir() {
        Instant old = Instant.now().minus(Duration.ofDays(120));
        for (int i = 0; i < 12; i++) {
            save("eski" + i, old);
        }

        retentionService.purgeExpiredShares();

        assertThat(shareRepository.count()).isZero();
    }

    private String save(String id, Instant createdAt) {
        JsonShare share = new JsonShare(id, "{\"a\":1}", null, true);
        ReflectionTestUtils.setField(share, "createdAt", createdAt);
        shareRepository.save(share);
        return id;
    }

    private static Comment comment(String shareId) {
        return new Comment(shareId, "json.a", "Sarp", "not", null, "token");
    }
}
