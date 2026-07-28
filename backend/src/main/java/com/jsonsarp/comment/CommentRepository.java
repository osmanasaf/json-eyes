package com.jsonsarp.comment;

import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.List;

public interface CommentRepository extends JpaRepository<Comment, Long> {

    List<Comment> findByShareIdOrderByCreatedAtAsc(String shareId);

    long countByShareId(String shareId);

    long countByShareIdAndCreatedAtAfter(String shareId, Instant since);
}
