package com.printshop.server.shift;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

// All SQL for shifts lives here. Plain JdbcTemplate, no ORM, so you can see every query.
@Repository
public class ShiftRepository {

    private final JdbcTemplate jdbc;

    public ShiftRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // Shift + all its jobs in one transaction: either everything saves or nothing does.
    @Transactional
    public long save(ShiftRequest s) {
        Long shiftId = jdbc.queryForObject("""
                INSERT INTO shifts (player_name, source, seed, score, cash_cents, satisfaction,
                                    customers_served, customers_lost, jams)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                RETURNING id
                """, Long.class,
                s.playerName().trim(), s.source(), s.seed(), s.score(), s.cashCents(), s.satisfaction(),
                s.customersServed(), s.customersLost(), s.jams());

        List<Object[]> rows = s.jobs().stream()
                .map(j -> new Object[]{shiftId, j.customerType(), j.kind(), j.pages(), j.priceCents(),
                        j.outcome(), j.waitSeconds()})
                .toList();
        jdbc.batchUpdate("""
                INSERT INTO jobs (shift_id, customer_type, kind, pages, price_cents, outcome, wait_seconds)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """, rows);

        return shiftId;
    }

    public List<LeaderboardRow> leaderboard(int limit) {
        return jdbc.query("""
                SELECT rank, player_name, score, cash_cents, satisfaction, created_at
                FROM leaderboard
                ORDER BY rank, created_at
                LIMIT ?
                """, (rs, i) -> new LeaderboardRow(
                rs.getLong("rank"),
                rs.getString("player_name"),
                rs.getInt("score"),
                rs.getInt("cash_cents"),
                rs.getInt("satisfaction"),
                rs.getObject("created_at", OffsetDateTime.class)
        ), limit);
    }

    public List<Map<String, Object>> customerTypeStats() {
        return jdbc.queryForList("SELECT * FROM customer_type_stats ORDER BY abandon_pct DESC");
    }

    public List<Map<String, Object>> botBalance() {
        return jdbc.queryForList("SELECT * FROM bot_balance ORDER BY avg_score DESC");
    }
}
