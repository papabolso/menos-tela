package io.github.papabolso.menostela;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.time.LocalDate;
import java.time.temporal.IsoFields;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Sequência de dias fechados dentro da meta, desde o início do plano. Um escudo por semana salva um
 * dia que passou por pouco. O dia de hoje ainda não conta: só entra quando fecha.
 */
final class Streak {
    static final class Result {
        int current, best, shieldsLeft, milestone;
        boolean todayWithin, todayShieldable;
        double todayGoal, shieldLimit;
        final List<String> shielded = new ArrayList<>();

        JSONObject toJson() throws JSONException {
            JSONObject o = new JSONObject();
            o.put("current", current);
            o.put("best", best);
            o.put("shieldsLeft", shieldsLeft);
            o.put("milestone", milestone);
            o.put("todayWithin", todayWithin);
            o.put("todayShieldable", todayShieldable);
            o.put("todayGoal", todayGoal);
            o.put("shieldLimit", shieldLimit);
            o.put("shielded", new JSONArray(shielded));
            return o;
        }
    }

    private Streak() {}

    static Result compute(Context c, Plan p, LocalDate today, double todayUsed) {
        Result r = new Result();
        Map<String, double[]> days = HistoryDb.get(c).totalsSince(p.start);
        Map<Integer, Integer> usedShields = new HashMap<>();

        for (LocalDate d = p.start; d.isBefore(today); d = d.plusDays(1)) {
            double[] v = days.get(d.toString());
            if (v == null) continue; // sem dados do dia: não conta nem quebra
            double goal = v[1] > 0 ? v[1] : p.goalFor(d);
            int week = week(d);
            if (v[0] <= goal) {
                r.current++;
            } else if (v[0] <= goal * Tuning.SHIELD_TOLERANCE && usedShields.getOrDefault(week, 0) < Tuning.SHIELDS_PER_WEEK) {
                usedShields.merge(week, 1, Integer::sum);
                r.shielded.add(d.toString());
                r.current++;
            } else {
                r.current = 0;
            }
            r.best = Math.max(r.best, r.current);
        }

        r.todayGoal = p.goalFor(today);
        r.shieldLimit = r.todayGoal * Tuning.SHIELD_TOLERANCE;
        r.shieldsLeft = Math.max(0, Tuning.SHIELDS_PER_WEEK - usedShields.getOrDefault(week(today), 0));
        r.todayWithin = todayUsed <= r.todayGoal;
        r.todayShieldable = !r.todayWithin && todayUsed <= r.shieldLimit && r.shieldsLeft > 0;
        if (isMilestone(r.current)) r.milestone = r.current;
        return r;
    }

    static boolean isMilestone(int n) {
        for (int m : Tuning.STREAK_MILESTONES) if (n == m) return true;
        int last = Tuning.STREAK_MILESTONES[Tuning.STREAK_MILESTONES.length - 1];
        return n > last && n % last == 0;
    }

    private static int week(LocalDate d) {
        return d.get(IsoFields.WEEK_BASED_YEAR) * 100 + d.get(IsoFields.WEEK_OF_WEEK_BASED_YEAR);
    }
}
