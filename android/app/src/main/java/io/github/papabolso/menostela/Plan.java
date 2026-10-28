package io.github.papabolso.menostela;

import android.content.Context;

import org.json.JSONObject;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;

/**
 * Configurações do plano salvas pelo app (SharedPreferences "menostela"/"settings") e a meta do dia,
 * com a mesma regra do app.js.
 */
final class Plan {
    static final String PREFS = "menostela";
    static final String KEY_SETTINGS = "settings";
    private static final int MAX_FIRST_CUT = 120;

    final int baseline, target, step, wake, sleep;
    final LocalDate start;

    private Plan(JSONObject o) throws Exception {
        baseline = o.getInt("baseline");
        target = o.getInt("target");
        step = o.getInt("step");
        wake = toMin(o.getString("wake"));
        sleep = toMin(o.getString("sleep"));
        start = LocalDate.parse(o.getString("startDate"));
    }

    static Plan load(Context c) {
        String json = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_SETTINGS, null);
        if (json == null) return null;
        try {
            return new Plan(new JSONObject(json));
        } catch (Exception e) {
            return null;
        }
    }

    long goalFor(LocalDate d) {
        long days = Math.max(0, ChronoUnit.DAYS.between(start, d));
        return Math.max(target, round5(startGoal() - (double) step * days));
    }

    /** Fim do dia para a projeção: a hora de dormir; se for depois da meia-noite, 24h (o dia vira à meia-noite). */
    int dayEnd() {
        return sleep > wake ? sleep : 1440;
    }

    private long startGoal() {
        int gap = baseline - target;
        if (gap <= 0) return target;
        return round5(baseline - Math.min(gap / 2.0, MAX_FIRST_CUT));
    }

    static long round5(double x) { return Math.round(x / 5.0) * 5; }

    static int toMin(String hhmm) {
        String[] p = hhmm.split(":");
        return Integer.parseInt(p[0]) * 60 + Integer.parseInt(p[1]);
    }

    static String fmt(double minutes) {
        long min = Math.max(0, Math.round(minutes));
        long h = min / 60, m = min % 60;
        if (h == 0) return m + "min";
        return m == 0 ? h + "h" : String.format("%dh%02d", h, m);
    }
}
