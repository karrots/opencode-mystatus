import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

for (const existing of [false, true]) {
  test(`local installer registers a V2 plugin directory (${existing ? "migration" : "fresh"})`, async () => {
    const home = await mkdtemp(join(tmpdir(), "mystatus-install-"));
    try {
      const configDir = join(home, ".config/opencode");
      await mkdir(configDir, { recursive: true });
      if (existing) {
        await writeFile(
          join(configDir, "cli.json"),
          JSON.stringify({
            plugins: ["other-plugin", "./plugins/mystatus-tui.tsx"],
            session: { sidebar: "auto" },
          }),
        );
      }
      const install = () =>
        execFileSync("bash", [join(repo, "load-local-plugin.sh")], {
          env: { ...process.env, HOME: home },
          stdio: "pipe",
        });
      install();
      const config = JSON.parse(
        await readFile(join(configDir, "cli.json"), "utf8"),
      );
      const entries = config.plugins.filter((entry) =>
        entry.includes("mystatus"),
      );
      assert.equal(entries.length, 1);
      const target = join(configDir, entries[0]);
      // V2's reconciliation skips isFile() targets and resolves <directory>/tui.
      assert.equal(
        (await stat(target)).isDirectory(),
        true,
        "opencode2 skips file entries, leaving sidebar.content unregistered",
      );
      assert.equal(
        await readFile(join(target, "tui.tsx"), "utf8"),
        await readFile(join(repo, "plugin/mystatus-tui.tsx"), "utf8"),
      );
      assert.equal((await stat(join(target, "lib/status.ts"))).isFile(), true);

      if (existing) {
        assert.ok(config.plugins.includes("other-plugin"));
        assert.deepEqual(config.session, { sidebar: "auto" });
      }
      const v1 = JSON.parse(
        await readFile(join(configDir, "tui.json"), "utf8"),
      );
      assert.ok(v1.plugin.includes("./plugins/mystatus-tui.tsx"));
      install();
      assert.deepEqual(
        JSON.parse(await readFile(join(configDir, "cli.json"), "utf8")),
        config,
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
}
