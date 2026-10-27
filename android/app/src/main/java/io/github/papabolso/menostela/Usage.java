package io.github.papabolso.menostela;

import android.app.AppOpsManager;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.os.Process;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Leitura do tempo de tela pelo UsageStatsManager (usada pelo app e pelos widgets). */
final class Usage {
    private Usage() {}

    static boolean hasPermission(Context c) {
        AppOpsManager ops = (AppOpsManager) c.getSystemService(Context.APP_OPS_SERVICE);
        int mode = ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), c.getPackageName());
        return mode == AppOpsManager.MODE_ALLOWED;
    }

    /**
     * Soma os intervalos em que algum app (exceto o launcher e a barra do sistema) estava em primeiro
     * plano, como o Bem-estar digital faz. Começa a ler 3h antes para saber o que já estava aberto.
     */
    static long between(Context c, long start, long end) {
        if (end <= start) return 0;
        UsageStatsManager usm = (UsageStatsManager) c.getSystemService(Context.USAGE_STATS_SERVICE);
        UsageEvents events = usm.queryEvents(start - 3 * 3600_000L, end);
        Set<String> ignored = ignoredPackages(c);

        Set<String> resumed = new HashSet<>();
        long since = -1, total = 0;
        UsageEvents.Event e = new UsageEvents.Event();
        while (events.hasNextEvent()) {
            events.getNextEvent(e);
            long t = e.getTimeStamp();
            int type = e.getEventType();
            boolean wasActive = !resumed.isEmpty();

            if (type == UsageEvents.Event.ACTIVITY_RESUMED) {
                if (ignored.contains(e.getPackageName())) continue;
                resumed.add(e.getPackageName() + "/" + e.getClassName());
            } else if (type == UsageEvents.Event.ACTIVITY_PAUSED || type == UsageEvents.Event.ACTIVITY_STOPPED) {
                resumed.remove(e.getPackageName() + "/" + e.getClassName());
            } else if (type == UsageEvents.Event.SCREEN_NON_INTERACTIVE || type == UsageEvents.Event.DEVICE_SHUTDOWN) {
                resumed.clear();
            } else {
                continue;
            }

            boolean active = !resumed.isEmpty();
            if (!wasActive && active) since = t;
            if (wasActive && !active) total += overlap(since, t, start, end);
        }
        if (!resumed.isEmpty() && since >= 0) total += overlap(since, Math.min(end, System.currentTimeMillis()), start, end);
        return total;
    }

    /**
     * Relatório de um dia (start = meia-noite): minutos por hora, por app (com aberturas e minutos por
     * hora de cada app) e desbloqueios. O total é a união dos intervalos; por app, cada um conta o seu.
     */
    static JSONObject report(Context c, long start, long end) throws JSONException {
        end = Math.min(end, System.currentTimeMillis());
        double[] hours = new double[24];
        int unlocks = 0;
        Map<String, Set<String>> resumed = new HashMap<>();
        Map<String, Long> since = new HashMap<>();
        Map<String, double[]> appHours = new HashMap<>();
        Map<String, Integer> opens = new HashMap<>();
        long[] totalSince = {-1};
        int[] active = {0};

        if (end > start) {
            UsageStatsManager usm = (UsageStatsManager) c.getSystemService(Context.USAGE_STATS_SERVICE);
            UsageEvents events = usm.queryEvents(start - 3 * 3600_000L, end);
            Set<String> ignored = ignoredPackages(c);
            UsageEvents.Event e = new UsageEvents.Event();
            while (events.hasNextEvent()) {
                events.getNextEvent(e);
                long t = e.getTimeStamp();
                String pkg = e.getPackageName();
                switch (e.getEventType()) {
                    case UsageEvents.Event.KEYGUARD_HIDDEN:
                        if (t >= start) unlocks++;
                        break;
                    case UsageEvents.Event.ACTIVITY_RESUMED: {
                        if (ignored.contains(pkg)) break;
                        Set<String> s = resumed.computeIfAbsent(pkg, k -> new HashSet<>());
                        boolean wasEmpty = s.isEmpty();
                        s.add(e.getClassName());
                        if (wasEmpty) {
                            if (active[0]++ == 0) totalSince[0] = t;
                            since.put(pkg, t);
                            if (t >= start) opens.merge(pkg, 1, Integer::sum);
                        }
                        break;
                    }
                    case UsageEvents.Event.ACTIVITY_PAUSED:
                    case UsageEvents.Event.ACTIVITY_STOPPED: {
                        Set<String> s = resumed.get(pkg);
                        if (s == null || s.isEmpty()) break;
                        s.remove(e.getClassName());
                        if (s.isEmpty()) endApp(pkg, t, since, appHours, hours, totalSince, active, start, end);
                        break;
                    }
                    case UsageEvents.Event.SCREEN_NON_INTERACTIVE:
                    case UsageEvents.Event.DEVICE_SHUTDOWN:
                        for (Map.Entry<String, Set<String>> en : resumed.entrySet()) {
                            if (en.getValue().isEmpty()) continue;
                            en.getValue().clear();
                            endApp(en.getKey(), t, since, appHours, hours, totalSince, active, start, end);
                        }
                        break;
                    default:
                        break;
                }
            }
            for (Map.Entry<String, Set<String>> en : resumed.entrySet()) {
                if (!en.getValue().isEmpty()) endApp(en.getKey(), end, since, appHours, hours, totalSince, active, start, end);
            }
        }

        List<JSONObject> apps = new ArrayList<>();
        for (Map.Entry<String, double[]> en : appHours.entrySet()) {
            double min = 0;
            for (double h : en.getValue()) min += h;
            if (min < 0.5) continue;
            JSONObject a = new JSONObject();
            a.put("pkg", en.getKey());
            a.put("name", label(c, en.getKey()));
            a.put("min", round1(min));
            a.put("opens", opens.getOrDefault(en.getKey(), 0));
            a.put("hours", toJson(en.getValue()));
            apps.add(a);
        }
        apps.sort((x, y) -> Double.compare(y.optDouble("min"), x.optDouble("min")));

        double total = 0;
        for (double h : hours) total += h;
        JSONObject out = new JSONObject();
        out.put("total", round1(total));
        out.put("unlocks", unlocks);
        out.put("hours", toJson(hours));
        out.put("apps", new JSONArray(apps));
        return out;
    }

    private static void endApp(String pkg, long t, Map<String, Long> since, Map<String, double[]> appHours,
                               double[] hours, long[] totalSince, int[] active, long start, long end) {
        Long s = since.remove(pkg);
        if (s != null) addInterval(appHours.computeIfAbsent(pkg, k -> new double[24]), s, t, start, end);
        if (--active[0] == 0) addInterval(hours, totalSince[0], t, start, end);
        if (active[0] < 0) active[0] = 0;
    }

    /** Soma o intervalo [a, b] (recortado ao dia) nas horas correspondentes, em minutos. */
    private static void addInterval(double[] h, long a, long b, long start, long end) {
        a = Math.max(a, start);
        b = Math.min(b, end);
        while (a < b) {
            int idx = (int) ((a - start) / 3600_000L);
            if (idx >= h.length) break;
            long e = Math.min(b, start + (idx + 1) * 3600_000L);
            h[idx] += (e - a) / 60000.0;
            a = e;
        }
    }

    private static JSONArray toJson(double[] v) throws JSONException {
        JSONArray a = new JSONArray();
        for (double x : v) a.put(round1(x));
        return a;
    }

    private static double round1(double x) { return Math.round(x * 10) / 10.0; }

    private static final Map<String, String> LABELS = new HashMap<>();

    static synchronized String label(Context c, String pkg) {
        String l = LABELS.get(pkg);
        if (l != null) return l;
        PackageManager pm = c.getPackageManager();
        try {
            l = pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString();
        } catch (PackageManager.NameNotFoundException e) {
            l = pkg;
        }
        LABELS.put(pkg, l);
        return l;
    }

    /** Ícone do app como data URL PNG (96px), ou "" se não existir. */
    static String icon(Context c, String pkg) {
        try {
            Drawable d = c.getPackageManager().getApplicationIcon(pkg);
            Bitmap bmp = Bitmap.createBitmap(96, 96, Bitmap.Config.ARGB_8888);
            Canvas cv = new Canvas(bmp);
            d.setBounds(0, 0, 96, 96);
            d.draw(cv);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.PNG, 100, out);
            return "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        } catch (Exception e) {
            return "";
        }
    }

    private static long overlap(long a, long b, long start, long end) {
        return Math.max(0, Math.min(b, end) - Math.max(a, start));
    }

    private static Set<String> ignoredPackages(Context c) {
        Set<String> out = new HashSet<>();
        out.add("com.android.systemui");
        Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
        for (ResolveInfo ri : c.getPackageManager().queryIntentActivities(home, PackageManager.MATCH_DEFAULT_ONLY)) {
            out.add(ri.activityInfo.packageName);
        }
        return out;
    }
}
