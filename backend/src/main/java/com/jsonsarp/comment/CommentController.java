package com.jsonsarp.comment;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/shares/{shareId}/comments")
public class CommentController {

    private final CommentService service;

    public CommentController(CommentService service) {
        this.service = service;
    }

    @GetMapping
    public CommentListResponse list(@PathVariable String shareId) {
        return service.list(shareId);
    }

    @PostMapping
    public CommentCreateResponse create(
            @PathVariable String shareId,
            @RequestBody CommentCreateRequest request
    ) {
        return service.create(shareId, request);
    }

    @DeleteMapping("/{commentId}")
    public ResponseEntity<Void> delete(
            @PathVariable String shareId,
            @PathVariable Long commentId,
            @RequestHeader(value = "X-Edit-Token", required = false) String editToken
    ) {
        service.delete(shareId, commentId, editToken);
        return ResponseEntity.noContent().build();
    }
}
