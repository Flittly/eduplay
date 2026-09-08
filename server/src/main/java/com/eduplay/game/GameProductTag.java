package com.eduplay.game;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.io.Serializable;
import java.time.Instant;

@Entity
@Table(name = "game_product_tag")
@IdClass(GameProductTag.GameProductTagId.class)
@Getter
@Setter
@NoArgsConstructor
public class GameProductTag {

    @Id
    @Column(name = "game_id", nullable = false)
    private Long gameId;

    @Id
    @Column(name = "tag_id", nullable = false)
    private Long tagId;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @PrePersist
    void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }

    @Getter
    @Setter
    @NoArgsConstructor
    public static class GameProductTagId implements Serializable {
        private Long gameId;
        private Long tagId;

        public GameProductTagId(Long gameId, Long tagId) {
            this.gameId = gameId;
            this.tagId = tagId;
        }

        @Override
        public boolean equals(Object other) {
            if (!(other instanceof GameProductTagId id)) {
                return false;
            }
            return java.util.Objects.equals(gameId, id.gameId)
                    && java.util.Objects.equals(tagId, id.tagId);
        }

        @Override
        public int hashCode() {
            return java.util.Objects.hash(gameId, tagId);
        }
    }
}
