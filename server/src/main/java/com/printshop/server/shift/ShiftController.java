package com.printshop.server.shift;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class ShiftController {

    private final ShiftRepository repo;

    public ShiftController(ShiftRepository repo) {
        this.repo = repo;
    }

    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of("status", "ok");
    }

    @PostMapping("/shifts")
    public ResponseEntity<?> saveShift(@RequestBody ShiftRequest body) {
        String error = body.validate();
        if (error != null) return ResponseEntity.badRequest().body(Map.of("error", error));
        long id = repo.save(body);
        return ResponseEntity.ok(Map.of("id", id));
    }

    @GetMapping("/leaderboard")
    public List<LeaderboardRow> leaderboard(@RequestParam(defaultValue = "10") int limit) {
        return repo.leaderboard(Math.max(1, Math.min(limit, 100)));
    }

    // Everyone gets the same shift today. Changes at midnight New York time.
    @GetMapping("/daily-seed")
    public Map<String, Object> dailySeed() {
        LocalDate today = LocalDate.now(ZoneId.of("America/New_York"));
        int seed = Math.floorMod(("printshop-" + today).hashCode(), 1_000_000_000);
        return Map.of("date", today.toString(), "seed", seed);
    }

    @GetMapping("/stats/customer-types")
    public List<Map<String, Object>> customerTypeStats() {
        return repo.customerTypeStats();
    }

    @GetMapping("/stats/bots")
    public List<Map<String, Object>> botBalance() {
        return repo.botBalance();
    }
}
