package com.jsonsarp.share;

import com.jsonsarp.comment.CommentRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

/**
 * Saklama suresi dolan paylasimlari ve yorumlarini siler.
 *
 * <p>Paylasimlarin omru olmasaydi veritabani yalnizca buyurdu: hicbir kayit
 * silinmedigi icin gunde birkac yuz paylasim bile yil icinde on GB'lari bulur.
 * Sinir gun cinsinden ayarlanabilir; 0 veya negatif verilirse temizlik kapanir.
 */
@Service
public class ShareRetentionService {

    private static final Logger log = LoggerFactory.getLogger(ShareRetentionService.class);

    /** Tek turda silinecek kayit sayisi; IN listesini ve islem suresini sinirlar. */
    private static final int BATCH_SIZE = 500;
    /** Sonsuz donguye karsi ust sinir; normalde asla ulasilmaz. */
    private static final int MAX_BATCHES = 200;

    private final JsonShareRepository shareRepository;
    private final CommentRepository commentRepository;
    /**
     * Islem yonetimi acikca yapiliyor: @Transactional'i ayni sinif icinden cagirmak
     * Spring proxy'sini atlar ve annotation sessizce etkisiz kalirdi.
     */
    private final TransactionTemplate transactions;

    @Value("${jsonsarp.share.retention-days:60}")
    private int retentionDays;

    public ShareRetentionService(
            JsonShareRepository shareRepository,
            CommentRepository commentRepository,
            PlatformTransactionManager transactionManager) {
        this.shareRepository = shareRepository;
        this.commentRepository = commentRepository;
        this.transactions = new TransactionTemplate(transactionManager);
    }

    /**
     * Acilistan 5 dakika sonra, sonra gunde bir calisir.
     *
     * <p>Sabit gecikme kullaniliyor: cron'dan farkli olarak sunucu ne zaman yeniden
     * baslarsa baslasin temizligin bir sonraki turu garanti calisir.
     */
    @Scheduled(initialDelay = 5 * 60 * 1000L, fixedDelay = 24 * 60 * 60 * 1000L)
    public void purgeExpiredShares() {
        if (retentionDays <= 0) {
            return;
        }
        Instant cutoff = Instant.now().minus(Duration.ofDays(retentionDays));
        long expected = shareRepository.countByCreatedAtBefore(cutoff);
        if (expected == 0) {
            return;
        }

        int deleted = 0;
        for (int batch = 0; batch < MAX_BATCHES; batch++) {
            int removed = purgeBatch(cutoff);
            if (removed == 0) {
                break;
            }
            deleted += removed;
        }
        log.info("Saklama suresi dolan {} paylasim silindi ({} gunden eski)", deleted, retentionDays);
    }

    /**
     * Tek bir grup siler ve kac kayit gittigini doner.
     *
     * <p>Her grup kendi islemi icinde: cok sayida kaydi tek islemde silmek uzun suren
     * bir kilit anlamina gelirdi ve yarida kesilirse hicbiri silinmezdi.
     */
    private int purgeBatch(Instant cutoff) {
        Integer removed = transactions.execute(status -> {
            List<String> ids = shareRepository.findExpiredIds(cutoff, PageRequest.of(0, BATCH_SIZE));
            if (ids.isEmpty()) {
                return 0;
            }
            commentRepository.deleteByShareIdIn(ids);
            shareRepository.deleteAllByIdInBatch(ids);
            return ids.size();
        });
        return removed == null ? 0 : removed;
    }
}
