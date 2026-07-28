package com.jsonsarp.comment;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;

import java.time.Instant;

/**
 * Paylasilan bir JSON'un tek bir alanina birakilan yorum.
 *
 * <p>Yorum, JSON yoluna (dizi indeksleri dahil) baglanir. Paylasilan JSON hicbir
 * zaman degismedigi icin bu bag kalicidir; GitHub'daki "satir kaydi, yorum yanlis
 * yere dustu" sorunu burada olusmaz.
 */
@Entity
@Table(name = "comments", indexes = @Index(name = "idx_comment_share", columnList = "shareId"))
public class Comment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 12)
    private String shareId;

    /** Goruntuleyicideki dugum yolu, or. json.IATA_OrderViewRS.Response.Order.0.OrderID */
    @Column(nullable = false, length = 1000)
    private String path;

    @Column(nullable = false, length = 60)
    private String author;

    @Column(nullable = false, length = 4000)
    private String body;

    /** Yanit zinciri; kok yorumlarda null. */
    private Long parentId;

    /** Yalnizca yorumu birakan kisinin silebilmesi icin; istemcide saklanir, listede donmez. */
    @Column(nullable = false, length = 32)
    private String editToken;

    @Column(nullable = false)
    private Instant createdAt;

    protected Comment() {
    }

    public Comment(String shareId, String path, String author, String body, Long parentId, String editToken) {
        this.shareId = shareId;
        this.path = path;
        this.author = author;
        this.body = body;
        this.parentId = parentId;
        this.editToken = editToken;
    }

    @PrePersist
    void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }

    public Long getId() {
        return id;
    }

    public String getShareId() {
        return shareId;
    }

    public String getPath() {
        return path;
    }

    public String getAuthor() {
        return author;
    }

    public String getBody() {
        return body;
    }

    public Long getParentId() {
        return parentId;
    }

    public String getEditToken() {
        return editToken;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
