package com.jsonsarp.comment;

import com.jsonsarp.share.JsonShare;
import com.jsonsarp.share.JsonShareRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;

import static org.springframework.http.HttpStatus.BAD_REQUEST;
import static org.springframework.http.HttpStatus.FORBIDDEN;
import static org.springframework.http.HttpStatus.NOT_FOUND;
import static org.springframework.http.HttpStatus.TOO_MANY_REQUESTS;

@Service
public class CommentService {

    private static final int MAX_AUTHOR_LENGTH = 60;
    private static final int MAX_BODY_LENGTH = 4000;
    private static final int MAX_PATH_LENGTH = 1000;

    private final CommentRepository repository;
    private final JsonShareRepository shareRepository;
    private final SecureRandom random = new SecureRandom();

    /** Bir paylasimda toplam yorum siniri; sinirsiz buyumeyi engeller. */
    @Value("${jsonsarp.comments.max-per-share:500}")
    private int maxPerShare;

    /** Dakikada eklenebilecek yorum sayisi; basit spam korumasi. */
    @Value("${jsonsarp.comments.max-per-minute:20}")
    private int maxPerMinute;

    public CommentService(CommentRepository repository, JsonShareRepository shareRepository) {
        this.repository = repository;
        this.shareRepository = shareRepository;
    }

    public CommentListResponse list(String shareId) {
        JsonShare share = requireShare(shareId);
        List<CommentView> comments = repository.findByShareIdOrderByCreatedAtAsc(shareId).stream()
                .map(CommentView::of)
                .toList();
        return new CommentListResponse(share.isCommentsEnabled(), comments);
    }

    public CommentCreateResponse create(String shareId, CommentCreateRequest request) {
        JsonShare share = requireShare(shareId);
        if (!share.isCommentsEnabled()) {
            throw new ResponseStatusException(FORBIDDEN, "Bu paylasim yorumlara kapali");
        }

        String path = requireText(request.path(), MAX_PATH_LENGTH, "Alan yolu");
        String author = requireText(request.author(), MAX_AUTHOR_LENGTH, "Isim");
        String body = requireText(request.body(), MAX_BODY_LENGTH, "Yorum");

        if (request.parentId() != null && !isReplyableParent(shareId, request.parentId())) {
            throw new ResponseStatusException(BAD_REQUEST, "Yanitlanan yorum bulunamadi");
        }
        if (repository.countByShareId(shareId) >= maxPerShare) {
            throw new ResponseStatusException(FORBIDDEN, "Bu paylasim icin yorum siniri doldu");
        }
        if (repository.countByShareIdAndCreatedAtAfter(shareId, Instant.now().minus(Duration.ofMinutes(1))) >= maxPerMinute) {
            throw new ResponseStatusException(TOO_MANY_REQUESTS, "Cok hizli yorum eklendi, biraz bekleyin");
        }

        String editToken = randomToken();
        Comment saved = repository.save(new Comment(shareId, path, author, body, request.parentId(), editToken));
        return new CommentCreateResponse(CommentView.of(saved), editToken);
    }

    /** Yorum yalnizca dogru editToken ile silinebilir; giris sistemi olmadan sahiplik bu sekilde saglanir. */
    public void delete(String shareId, Long commentId, String editToken) {
        Comment comment = repository.findById(commentId)
                .filter(c -> c.getShareId().equals(shareId))
                .orElseThrow(() -> new ResponseStatusException(NOT_FOUND, "Yorum bulunamadi"));

        if (editToken == null || !comment.getEditToken().equals(editToken)) {
            throw new ResponseStatusException(FORBIDDEN, "Bu yorumu silme yetkiniz yok");
        }
        // Yanitlari da birlikte gider; sahipsiz yanit kalmasin.
        repository.findByShareIdOrderByCreatedAtAsc(shareId).stream()
                .filter(c -> commentId.equals(c.getParentId()))
                .forEach(repository::delete);
        repository.delete(comment);
    }

    private boolean isReplyableParent(String shareId, Long parentId) {
        Optional<Comment> parent = repository.findById(parentId);
        // Tek seviyeli zincir: yanita yanit verilemez.
        return parent.isPresent()
                && parent.get().getShareId().equals(shareId)
                && parent.get().getParentId() == null;
    }

    private JsonShare requireShare(String shareId) {
        return shareRepository.findById(shareId)
                .orElseThrow(() -> new ResponseStatusException(NOT_FOUND, "Paylasim bulunamadi"));
    }

    private String requireText(String value, int maxLength, String label) {
        if (value == null || value.isBlank()) {
            throw new ResponseStatusException(BAD_REQUEST, label + " bos olamaz");
        }
        String trimmed = value.trim();
        if (trimmed.length() > maxLength) {
            throw new ResponseStatusException(BAD_REQUEST, label + " en fazla " + maxLength + " karakter olabilir");
        }
        return trimmed;
    }

    private String randomToken() {
        byte[] bytes = new byte[16];
        random.nextBytes(bytes);
        return HexFormat.of().formatHex(bytes);
    }
}
