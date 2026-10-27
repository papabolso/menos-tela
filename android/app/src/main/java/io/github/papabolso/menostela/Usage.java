package io.github.papabolso.menostela;

import android.app.AppOpsManager;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Process;

import java.util.HashSet;
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
