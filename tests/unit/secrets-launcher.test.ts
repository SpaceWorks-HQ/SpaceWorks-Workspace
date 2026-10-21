import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";

// Compile the real CLI and its launcher for Windows on every test host. Only the
// OS spawn boundary is replaced; PATH/PATHEXT resolution and escaping are real.
describe("Secrets Windows command launcher", () => {
  it.each(["npm.cmd", "tool.bat", "tool.exe"])("launches %s with literal arguments and a scrubbed environment", async filename => {
    const directory = await mkdtemp(join(tmpdir(), "sww-launch-"));
    try {
      const bin = join(directory, "node_modules", ".bin");
      await mkdir(bin, { recursive: true });
      await writeFile(join(bin, filename), "@echo off\n");
      const bundle = join(directory, "cli.cjs");
      await build({
        entryPoints: ["packages/cli/src/cli.ts"], bundle: true, platform: "node", format: "cjs",
        define: { "process.platform": '"win32"', "import.meta.url": '""' }, outfile: bundle,
      });
      const args = ["run", "dev", "--", "two words", 'a"b', "tail\\", "&whoami|more", "%PATH%", "!name!", "(x)^<>"];
      const script = join(directory, "probe.cjs");
      await writeFile(script, `
        const cp = require("node:child_process");
        const { EventEmitter } = require("node:events");
        let invocation;
        cp.spawn = (command, args, options) => {
          invocation = { command, args, shell: options.shell, verbatim: options.windowsVerbatimArguments,
            injected: options.env.INJECTED, hasToken: Object.hasOwn(options.env, "SWW_TOKEN") };
          const child = new EventEmitter(); child.kill = () => true;
          process.nextTick(() => child.emit("exit", 7, null));
          return child;
        };
        require(${JSON.stringify(bundle)}).runChild(${JSON.stringify([filename.replace(/\.[^.]+$/, ""), ...args])}, { INJECTED: "yes" })
          .then(code => process.stdout.write(JSON.stringify({ ...invocation, code })));
      `);
      const result = JSON.parse((await promisify(execFile)(process.execPath, [script], {
        env: { ...process.env, PATH: bin, PATHEXT: ".cmd;.bat;.exe", SWW_TOKEN: "private-test-token", comspec: "cmd.exe" },
      })).stdout);
      expect(result).toMatchObject({ code: 7, shell: false, injected: "yes", hasToken: false });
      if (filename.endsWith(".exe")) {
        expect(result.command).toBe("tool");
        expect(result.args).toEqual(args);
        expect(result.verbatim).toBeUndefined();
      } else {
        expect(result.command).toBe("cmd.exe");
        expect(result.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
        expect(result.verbatim).toBe(true);
        const line = result.args[3];
        expect(line).toMatch(/^".*"$/);
        if (filename.endsWith(".cmd")) {
          // npm-style node_modules/.bin shims need a second cmd expansion escape.
          expect(line).toContain("two^^^ words");
          expect(line).toContain("^^^&whoami^^^|more");
          expect(line).toContain("^^^%PATH^^^%");
          expect(line).toContain("^^^!name^^^!");
        } else {
          expect(line).toContain("two^ words");
          expect(line).toContain("^&whoami^|more");
          expect(line).toContain("^%PATH^%");
          expect(line).toContain("^!name^!");
        }
        expect(line).not.toContain('"two words"');
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
