package com.jsonsarp.share;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

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

    /**
     * Paylasilan JSON metni.
     *
     * <p>Sutun tipi veritabanina birakiliyor: `columnDefinition = "CLOB"` H2'ye
     * ozeldi ve baska bir veritabanina gecisi kilitliyordu. `@Lob String` de
     * PostgreSQL'de metni ayri bir "buyuk nesne" tablosuna tasiyor. LONGVARCHAR
     * soyut tipi ise her surucude dogru karsiligi buluyor (H2 clob, PostgreSQL text).
     */
    @JdbcTypeCode(SqlTypes.LONGVARCHAR)
    @Column(nullable = false)
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
