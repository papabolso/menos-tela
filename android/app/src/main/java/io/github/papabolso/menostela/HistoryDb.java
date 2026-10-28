package io.github.papabolso.menostela;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

/**
 * Banco nativo novo (menostela.db). Não substitui nada: os dados do app continuam no localStorage.
 * Guarda o uso por hora de cada dia (o Android apaga os eventos depois de ~10 dias), a projeção
 * registrada para calibragem e as notificações enviadas.
 *
 * Migrações futuras: só ALTER/CREATE em onUpgrade. Nunca apagar tabelas nem dados.
 */
final class HistoryDb extends SQLiteOpenHelper {
    private static final String NAME = "menostela.db";
    private static final int VERSION = 1;
    private static HistoryDb instance;

    static synchronized HistoryDb get(Context c) {
        if (instance == null) instance = new HistoryDb(c.getApplicationContext());
        return instance;
    }

    private HistoryDb(Context c) {
        super(c, NAME, null, VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE day_hours (date TEXT PRIMARY KEY, hours TEXT NOT NULL, total REAL NOT NULL, final INTEGER NOT NULL, updated INTEGER NOT NULL)");
        db.execSQL("CREATE TABLE projection_log (date TEXT NOT NULL, slot INTEGER NOT NULL, at INTEGER NOT NULL, used REAL NOT NULL, "
                + "expected_now REAL NOT NULL, projected REAL NOT NULL, goal REAL NOT NULL, hist_days INTEGER NOT NULL, actual REAL, PRIMARY KEY (date, slot))");
        db.execSQL("CREATE TABLE notification_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, date TEXT NOT NULL, "
                + "used REAL NOT NULL, projected REAL NOT NULL, goal REAL NOT NULL, last_hour REAL NOT NULL, eta TEXT NOT NULL)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        // Versão 1 é a primeira. Próximas versões: migrações aditivas aqui, uma por versão.
    }

    /* ---------- Uso por hora ---------- */

    /**
     * Grava o dia de hoje e completa os dias anteriores que ainda não estão fechados (lendo do Android
     * enquanto os eventos existem). Dias fechados nunca são reescritos.
     */
    synchronized void sync(Context c, LocalDate today, double[] todayHours, ZoneId z) {
        put(today, todayHours, false);
        for (int i = 1; i <= Tuning.HISTORY_MAX_DAYS; i++) {
            LocalDate d = today.minusDays(i);
            if (isFinal(d)) continue;
            try {
                JSONObject r = Usage.report(c, ms(d, z), ms(d.plusDays(1), z));
                put(d, hoursOf(r), true);
            } catch (JSONException ignored) {
                // tenta de novo na próxima checagem
            }
        }
    }

    private boolean isFinal(LocalDate d) {
        try (Cursor cur = getReadableDatabase().rawQuery("SELECT final FROM day_hours WHERE date = ?", new String[]{d.toString()})) {
            return cur.moveToFirst() && cur.getInt(0) == 1;
        }
    }

    private void put(LocalDate d, double[] hours, boolean fin) {
        double total = 0;
        JSONArray a = new JSONArray();
        for (double h : hours) { total += h; a.put(Math.round(h * 10) / 10.0); }
        ContentValues v = new ContentValues();
        v.put("date", d.toString());
        v.put("hours", a.toString());
        v.put("total", total);
        v.put("final", fin ? 1 : 0);
        v.put("updated", System.currentTimeMillis());
        getWritableDatabase().insertWithOnConflict("day_hours", null, v, SQLiteDatabase.CONFLICT_REPLACE);
    }

    /** Dias anteriores a hoje com uso registrado, do mais recente para o mais antigo. */
    synchronized List<double[]> recentDays(LocalDate today, int max, double minTotal) {
        List<double[]> out = new ArrayList<>();
        try (Cursor cur = getReadableDatabase().rawQuery(
                "SELECT hours FROM day_hours WHERE date < ? AND total >= ? ORDER BY date DESC LIMIT ?",
                new String[]{today.toString(), String.valueOf(minTotal), String.valueOf(max)})) {
            while (cur.moveToNext()) {
                JSONArray a = new JSONArray(cur.getString(0));
                double[] h = new double[24];
                for (int i = 0; i < 24 && i < a.length(); i++) h[i] = a.getDouble(i);
                out.add(h);
            }
        } catch (JSONException ignored) {
        }
        return out;
    }

    /* ---------- Calibragem ---------- */

    synchronized boolean hasProjection(LocalDate d, int slot) {
        try (Cursor cur = getReadableDatabase().rawQuery("SELECT 1 FROM projection_log WHERE date = ? AND slot = ?",
                new String[]{d.toString(), String.valueOf(slot)})) {
            return cur.moveToFirst();
        }
    }

    synchronized void logProjection(LocalDate d, int slot, Trend.Result r) {
        ContentValues v = new ContentValues();
        v.put("date", d.toString());
        v.put("slot", slot);
        v.put("at", System.currentTimeMillis());
        v.put("used", r.used);
        v.put("expected_now", r.expectedNow);
        v.put("projected", r.projected);
        v.put("goal", r.goal);
        v.put("hist_days", r.histDays);
        getWritableDatabase().insertWithOnConflict("projection_log", null, v, SQLiteDatabase.CONFLICT_IGNORE);
    }

    /** Preenche o uso real dos dias já fechados nas projeções registradas. */
    synchronized void fillActuals(LocalDate today) {
        getWritableDatabase().execSQL("UPDATE projection_log SET actual = (SELECT total FROM day_hours d "
                + "WHERE d.date = projection_log.date AND d.final = 1) WHERE actual IS NULL AND date < ?", new Object[]{today.toString()});
    }

    synchronized void logNotification(LocalDate d, Trend.Result r, double lastHour, String eta) {
        ContentValues v = new ContentValues();
        v.put("at", System.currentTimeMillis());
        v.put("date", d.toString());
        v.put("used", r.used);
        v.put("projected", r.projected);
        v.put("goal", r.goal);
        v.put("last_hour", lastHour);
        v.put("eta", eta);
        getWritableDatabase().insert("notification_log", null, v);
    }

    /** Resumo para a tela de Ajustes: erro médio por horário e últimos registros. */
    synchronized JSONObject calibration() throws JSONException {
        JSONObject out = new JSONObject();
        JSONArray slots = new JSONArray();
        for (int slot : Tuning.CALIBRATION_HOURS) {
            try (Cursor cur = getReadableDatabase().rawQuery(
                    "SELECT COUNT(*), AVG(ABS(projected - actual)), AVG(projected - actual) FROM projection_log WHERE slot = ? AND actual IS NOT NULL",
                    new String[]{String.valueOf(slot)})) {
                cur.moveToFirst();
                JSONObject s = new JSONObject();
                s.put("slot", slot);
                s.put("n", cur.getInt(0));
                s.put("mae", cur.isNull(1) ? JSONObject.NULL : cur.getDouble(1));
                s.put("bias", cur.isNull(2) ? JSONObject.NULL : cur.getDouble(2));
                slots.put(s);
            }
        }
        out.put("slots", slots);

        JSONArray proj = new JSONArray();
        try (Cursor cur = getReadableDatabase().rawQuery(
                "SELECT date, slot, used, projected, goal, actual FROM projection_log ORDER BY date DESC, slot DESC LIMIT 10", null)) {
            while (cur.moveToNext()) {
                JSONObject p = new JSONObject();
                p.put("date", cur.getString(0));
                p.put("slot", cur.getInt(1));
                p.put("used", cur.getDouble(2));
                p.put("projected", cur.getDouble(3));
                p.put("goal", cur.getDouble(4));
                p.put("actual", cur.isNull(5) ? JSONObject.NULL : cur.getDouble(5));
                proj.put(p);
            }
        }
        out.put("projections", proj);

        JSONArray notes = new JSONArray();
        try (Cursor cur = getReadableDatabase().rawQuery(
                "SELECT at, used, projected, goal, eta FROM notification_log ORDER BY at DESC LIMIT 10", null)) {
            while (cur.moveToNext()) {
                JSONObject n = new JSONObject();
                n.put("at", cur.getLong(0));
                n.put("used", cur.getDouble(1));
                n.put("projected", cur.getDouble(2));
                n.put("goal", cur.getDouble(3));
                n.put("eta", cur.getString(4));
                notes.put(n);
            }
        }
        out.put("notifications", notes);
        return out;
    }

    /* ---------- Utilidades ---------- */

    static long ms(LocalDate d, ZoneId z) {
        return d.atStartOfDay(z).toInstant().toEpochMilli();
    }

    static double[] hoursOf(JSONObject report) throws JSONException {
        double[] h = new double[24];
        JSONArray a = report.getJSONArray("hours");
        for (int i = 0; i < 24 && i < a.length(); i++) h[i] = a.getDouble(i);
        return h;
    }
}
