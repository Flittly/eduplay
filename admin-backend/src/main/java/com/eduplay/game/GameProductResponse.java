package com.eduplay.game;

public record GameProductResponse(
        Long id,
        String gameCode,
        String name,
        String description,
        String coverUrl,
        Integer priceCents,
        String status,
        String version,
        String entry
) {
    public static GameProductResponse from(GameProduct game) {
        return new GameProductResponse(
                game.getId(),
                game.getGameCode(),
                game.getName(),
                game.getDescription(),
                game.getCoverUrl(),
                game.getPriceCents(),
                game.getStatus(),
                game.getVersion(),
                game.getEntry()
        );
    }
}

