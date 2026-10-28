package io.github.papabolso.menostela;

import android.content.Context;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.Arrays;

/**
 * Cópia automática dos dados do app (o JSON do localStorage) na pasta privada:
 * backups/latest.json a cada salvamento e uma cópia por dia, guardando as últimas 14.
 */
final class Backup {
    private static final int KEEP_DAILY = 14;

    private Backup() {}

    static synchronized void save(Context c, String json) {
        if (json == null || json.length() < 10) return;
        File dir = new File(c.getFilesDir(), "backups");
        if (!dir.exists() && !dir.mkdirs()) return;
        try {
            write(new File(dir, "latest.json"), json);
            File daily = new File(dir, "backup-" + LocalDate.now() + ".json");
            if (!daily.exists()) write(daily, json);
            prune(dir);
        } catch (IOException ignored) {
            // backup é só uma rede de segurança; não deve travar o app
        }
    }

    /** Escreve num arquivo temporário e renomeia, para nunca deixar um backup pela metade. */
    private static void write(File f, String json) throws IOException {
        File tmp = new File(f.getParentFile(), f.getName() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(json.getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        }
        if (!tmp.renameTo(f)) throw new IOException("rename");
    }

    private static void prune(File dir) {
        File[] daily = dir.listFiles((d, name) -> name.startsWith("backup-") && name.endsWith(".json"));
        if (daily == null || daily.length <= KEEP_DAILY) return;
        Arrays.sort(daily, (a, b) -> a.getName().compareTo(b.getName()));
        for (int i = 0; i < daily.length - KEEP_DAILY; i++) daily[i].delete();
    }
}
