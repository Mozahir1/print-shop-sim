package com.printshop.server.shift;

import java.time.OffsetDateTime;

public record LeaderboardRow(
        long rank,
        String playerName,
        int score,
        int cashCents,
        int satisfaction,
        OffsetDateTime createdAt
) {}
