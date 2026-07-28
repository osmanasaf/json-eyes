package com.jsonsarp.comment;

import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.Collection;
import java.util.List;

public interface CommentRepository extends JpaRepository<Comment, Long> {

    List<Comment> findByShareIdOrderByCreatedAtAsc(String shareId);

    /** Paylasim silinince yorumlari da gider; aralarinda yabanci anahtar yok. */
    void deleteByShareIdIn(Collection<String> shareIds);

    long countByShareId(String shareId);

    long countByShareIdAndCreatedAtAfter(String shareId, Instant since);
}
