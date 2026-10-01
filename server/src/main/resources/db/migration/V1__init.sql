-- Flyway runs migrations in order, once each, when the server starts.
-- Never edit a migration after it has run on a database. Add V3__whatever.sql instead.

CREATE TABLE shifts (
    id               BIGSERIAL PRIMARY KEY,
    player_name      VARCHAR(50)  NOT NULL,
    source           VARCHAR(10)  NOT NULL CHECK (source IN ('human', 'bot')),
    seed             BIGINT       NOT NULL,
    score            INTEGER      NOT NULL,
    cash_cents       INTEGER      NOT NULL CHECK (cash_cents >= 0),
    satisfaction     INTEGER      NOT NULL CHECK (satisfaction BETWEEN 0 AND 100),
    customers_served INTEGER      NOT NULL,
    customers_lost   INTEGER      NOT NULL,
    jams             INTEGER      NOT NULL,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_shifts_source_score ON shifts (source, score DESC);

-- One row per print job in a shift.
CREATE TABLE jobs (
    id            BIGSERIAL PRIMARY KEY,
    shift_id      BIGINT       NOT NULL REFERENCES shifts (id) ON DELETE CASCADE,
    customer_type VARCHAR(40)  NOT NULL,
    kind          VARCHAR(10)  NOT NULL,
    pages         INTEGER      NOT NULL,
    price_cents   INTEGER      NOT NULL,
    outcome       VARCHAR(12)  NOT NULL CHECK (outcome IN ('picked_up', 'abandoned', 'unfinished')),
    wait_seconds  NUMERIC(7,1) NOT NULL
);

CREATE INDEX idx_jobs_shift ON jobs (shift_id);
CREATE INDEX idx_jobs_customer_type ON jobs (customer_type);
