-- Jobs can now end the shift finished but not yet picked up (next-day and late pickups).
ALTER TABLE jobs DROP CONSTRAINT jobs_outcome_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_outcome_check CHECK (outcome IN ('picked_up', 'abandoned', 'ready', 'unfinished'));
