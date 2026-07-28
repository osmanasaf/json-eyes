package com.jsonsarp.share;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;

public interface JsonShareRepository extends JpaRepository<JsonShare, String> {

    /**
     * Saklama suresi dolmus paylasimlarin kimlikleri.
     *
     * <p>Kayitlarin kendisi degil yalnizca kimlikleri cekiliyor: govde 2 MB'a kadar
     * cikabildigi icin binlerce kaydi bellege almak gereksiz yere pahali olurdu.
     */
    @Query("select s.id from JsonShare s where s.createdAt < :cutoff")
    List<String> findExpiredIds(@Param("cutoff") Instant cutoff, Pageable pageable);

    long countByCreatedAtBefore(Instant cutoff);
}
