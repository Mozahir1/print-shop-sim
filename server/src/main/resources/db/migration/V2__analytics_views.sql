-- Analytics lives in SQL views, so the API just selects from them.

-- All-time leaderboard, humans only.
CREATE VIEW leaderboard AS
SELECT RANK() OVER (ORDER BY score DESC) AS rank,
       player_name,
       score,
       cash_cents,
       satisfaction,
       created_at
FROM shifts
WHERE source = 'human';

-- Leaderboard reset every week. RANK restarts inside each week's partition.
CREATE VIEW weekly_leaderboard AS
SELECT date_trunc('week', created_at)::date                                        AS week_start,
       RANK() OVER (PARTITION BY date_trunc('week', created_at) ORDER BY score DESC) AS rank,
       player_name,
       score
FROM shifts
WHERE source = 'human';

-- Which customers are the problem? Used for balancing.
CREATE VIEW customer_type_stats AS
SELECT j.customer_type,
       COUNT(*)                                                                      AS jobs,
       ROUND(AVG(CASE WHEN j.outcome = 'abandoned' THEN 1.0 ELSE 0 END) * 100, 1)    AS abandon_pct,
       ROUND(AVG(j.wait_seconds) FILTER (WHERE j.outcome = 'picked_up'), 1)          AS avg_wait_seconds,
       ROUND(SUM(j.price_cents) FILTER (WHERE j.outcome = 'picked_up') / 100.0, 2)   AS revenue_dollars
FROM jobs j
GROUP BY j.customer_type;

-- Compare bot "employees" with different reaction times (player_name is like 'bot-r1.5').
CREATE VIEW bot_balance AS
SELECT player_name                       AS bot,
       COUNT(*)                          AS shifts,
       ROUND(AVG(score), 1)              AS avg_score,
       ROUND(AVG(satisfaction), 1)       AS avg_satisfaction,
       ROUND(AVG(customers_lost), 1)     AS avg_lost,
       ROUND(AVG(jams), 1)               AS avg_jams,
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY score) AS median_score
FROM shifts
WHERE source = 'bot'
GROUP BY player_name;
