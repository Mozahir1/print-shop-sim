package com.printshop.server.shift;

import java.util.List;

// JSON body for POST /api/shifts. Matches ShiftSummary in client/src/sim/summary.ts.
public record ShiftRequest(
        String playerName,
        String source,
        long seed,
        int score,
        int cashCents,
        int satisfaction,
        int customersServed,
        int customersLost,
        int jams,
        List<JobRequest> jobs
) {
    public record JobRequest(
            String customerType,
            String kind,
            int pages,
            int priceCents,
            String outcome,
            double waitSeconds
    ) {}

    private static final List<String> SOURCES = List.of("human", "bot");
    private static final List<String> OUTCOMES = List.of("picked_up", "abandoned", "ready", "unfinished");

    // Returns an error message, or null if the request is fine.
    public String validate() {
        if (playerName == null || playerName.isBlank()) return "playerName is required";
        if (playerName.length() > 50) return "playerName is too long";
        if (!SOURCES.contains(source)) return "source must be human or bot";
        if (cashCents < 0) return "cashCents can't be negative";
        if (satisfaction < 0 || satisfaction > 100) return "satisfaction must be 0..100";
        if (jobs == null) return "jobs is required";
        if (jobs.size() > 1000) return "too many jobs";
        for (JobRequest j : jobs) {
            if (j.customerType() == null || j.kind() == null) return "job is missing fields";
            if (!OUTCOMES.contains(j.outcome())) return "bad job outcome: " + j.outcome();
        }
        return null;
    }
}
