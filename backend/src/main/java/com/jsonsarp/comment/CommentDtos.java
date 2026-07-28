package com.jsonsarp.comment;

import java.time.Instant;
import java.util.List;

record CommentCreateRequest(String path, String author, String body, Long parentId) {
}

/** Olusturma yaniti; editToken yalnizca burada doner ve istemcide saklanir. */
record CommentCreateResponse(CommentView comment, String editToken) {
}

record CommentView(
        Long id,
        String path,
        String author,
        String body,
        Long parentId,
        Instant createdAt
) {
    static CommentView of(Comment comment) {
        return new CommentView(
                comment.getId(),
                comment.getPath(),
                comment.getAuthor(),
                comment.getBody(),
                comment.getParentId(),
                comment.getCreatedAt());
    }
}

/** @param enabled paylasim yorumlara kapaliysa false; istemci formu gizler */
record CommentListResponse(boolean enabled, List<CommentView> comments) {
}
