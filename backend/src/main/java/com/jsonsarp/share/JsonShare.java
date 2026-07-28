package com.jsonsarp.share;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;

import java.time.Instant;

@Entity
@Table(name = "json_shares")
public class JsonShare {

    @Id
    @Column(length = 12)
    private String id;

    @Column(length = 120)
    private String title;

    /**
     * Wrapper tip: bu sutun eklenmeden once olusturulmus paylasimlarda null kalir ve
     * onlarda yorum acik kabul edilir.
     */
    private Boolean commentsEnabled;

    @Lob
    @Column(nullable = false, columnDefinition = "CLOB")
    private String content;

    @Column(nullable = false)
    private Instant createdAt;

    protected JsonShare() {
    }

    public JsonShare(String id, String content, String title, boolean commentsEnabled) {
        this.id = id;
        this.content = content;
        this.title = title;
        this.commentsEnabled = commentsEnabled;
    }

    @PrePersist
    void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }

    public String getId() {
        return id;
    }

    public String getTitle() {
        return title;
    }

    public boolean isCommentsEnabled() {
        return commentsEnabled == null || commentsEnabled;
    }

    public String getContent() {
        return content;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
