package io.github.papabolso.menostela;

import android.content.Context;

import org.json.JSONException;
import org.json.JSONObject;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;

/**
 * Tendência do dia: compara o uso de hoje com a curva média de uso acumulado dos últimos dias e
 * projeta o total até a hora de dormir. Usado pelo widget, pelo app e pelas notificações.
 */
final class Trend {
    static final int NEUTRAL = -1, CALM = 0, NEAR = 1, OVER = 2;

    static final class Result {
        boolean ready;        // há configurações e acesso ao uso
        boolean valid;        // há dados suficientes para afirmar tendência
        double used, goal, projected, expectedNow, diff, pace;
        int histDays, nowMin, endMin, idx;
        int level = NEUTRAL;
        double[] hours = new double[24];
        double[] per = new double[3];
        String shortMsg = "Abra o app", msg = "Abra o app para configurar.", diffText = "";
        LocalDate date;

        JSONObject toJson() throws JSONException {
            JSONObject o = new JSONObject();
            o.put("ready", ready);
            o.put("valid", valid);
            o.put("used", used);
            o.put("goal", goal);
            o.put("projected", projected);
            o.put("expectedNow", expectedNow);
            o.put("diff", diff);
            o.put("pace", pace);
            o.put("histDays", histDays);
            o.put("level", level);
            o.put("shortMsg", shortMsg);
            o.put("msg", msg);
            o.put("diffText", diffText);
            o.put("minHistDays", Tuning.HISTORY_MIN_DAYS);
            return o;
        }
    }

    private Trend() {}

    static Result compute(Context c) {
        Result r = new Result();
        Plan p = Plan.load(c);
        if (p == null) return r;
        if (!Usage.hasPermission(c)) {
            r.shortMsg = "Sem acesso";
            r.msg = "Libere o acesso ao uso no app.";
            return r;
        }

        ZoneId z = ZoneId.systemDefault();
        ZonedDateTime now = ZonedDateTime.now(z);
        LocalDate today = now.toLocalDate();
        r.date = today;
        try {
            r.hours = HistoryDb.hoursOf(Usage.report(c, HistoryDb.ms(today, z), HistoryDb.ms(today.plusDays(1), z)));
        } catch (JSONException e) {
            r.msg = "Não deu para ler o uso agora.";
            return r;
        }
        HistoryDb db = HistoryDb.get(c);
        db.sync(c, today, r.hours, z);
        List<double[]> hist = db.recentDays(today, Tuning.HISTORY_MAX_DAYS, Tuning.MIN_DAY_TOTAL_MIN);

        r.ready = true;
        for (int h = 0; h < 24; h++) {
            r.used += r.hours[h];
            r.per[h < 12 ? 0 : h < 18 ? 1 : 2] += r.hours[h];
        }
        r.goal = p.goalFor(today);
        r.nowMin = now.getHour() * 60 + now.getMinute();
        r.idx = r.nowMin < 720 ? 0 : r.nowMin < 1080 ? 1 : 2;
        r.endMin = Math.max(p.dayEnd(), r.nowMin);
        r.histDays = hist.size();

        double expectedEnd = 0;
        if (!hist.isEmpty()) {
            r.expectedNow = avgCumulative(hist, r.nowMin);
            expectedEnd = avgCumulative(hist, r.endMin);
        }
        r.diff = r.used - r.expectedNow;
        r.valid = r.histDays >= Tuning.HISTORY_MIN_DAYS
                && r.expectedNow >= Tuning.MIN_EXPECTED_SO_FAR_MIN
                && r.nowMin >= p.wake + Tuning.MIN_AWAKE_MIN;

        if (r.valid) {
            r.pace = clamp(r.used / r.expectedNow, Tuning.PACE_MIN, Tuning.PACE_MAX);
            r.projected = r.used + Math.max(0, expectedEnd - r.expectedNow) * r.pace;
            r.diffText = Math.abs(r.diff) < Tuning.NORMAL_TOLERANCE_MIN ? "no seu normal"
                    : Plan.fmt(Math.abs(r.diff)) + (r.diff < 0 ? " abaixo" : " acima") + " do seu normal";
        }
        describe(r);
        return r;
    }

    private static void describe(Result r) {
        if (r.used > r.goal) {
            r.level = OVER;
            r.shortMsg = "Meta passou";
            r.msg = "Meta do dia já passou em " + Plan.fmt(r.used - r.goal) + ".";
            return;
        }
        if (!r.valid) {
            r.level = NEUTRAL;
            if (r.histDays < Tuning.HISTORY_MIN_DAYS) {
                r.shortMsg = "Aprendendo";
                r.msg = "Juntando histórico (" + r.histDays + " de " + Tuning.HISTORY_MIN_DAYS + " dias) para prever.";
            } else {
                r.shortMsg = "Cedo p/ prever";
                r.msg = "Ainda cedo para prever o dia.";
            }
            return;
        }
        double ratio = r.projected / r.goal;
        if (ratio < Tuning.CALM_BELOW) {
            r.level = CALM;
            r.shortMsg = "Tranquilo";
            r.msg = "Tranquilo · " + r.diffText;
        } else if (ratio <= Tuning.NEAR_UP_TO) {
            r.level = NEAR;
            r.shortMsg = "Perto do limite";
            r.msg = "Perto do limite · previsão " + Plan.fmt(r.projected);
        } else {
            r.level = OVER;
            r.shortMsg = "Nesse ritmo passa";
            r.msg = "Nesse ritmo passa ~" + Plan.fmt(r.projected - r.goal) + " da meta";
        }
    }

    /** Média, entre os dias do histórico, do uso acumulado até o minuto t (interpolado dentro da hora). */
    static double avgCumulative(List<double[]> days, int t) {
        double total = 0;
        for (double[] h : days) total += cumulative(h, t);
        return total / days.size();
    }

    static double cumulative(double[] h, int t) {
        int hour = Math.min(24, t / 60);
        double s = 0;
        for (int i = 0; i < hour; i++) s += h[i];
        if (hour < 24) s += h[hour] * (t % 60) / 60.0;
        return s;
    }

    private static double clamp(double x, double a, double b) { return Math.max(a, Math.min(b, x)); }

    static JSONObject toJson(Result r) {
        try {
            return r.toJson();
        } catch (JSONException e) {
            return new JSONObject();
        }
    }
}
