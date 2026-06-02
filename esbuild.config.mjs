import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const banner = `/*
 * Calibre Bridge — built bundle. Source: https://github.com/caioniehues/obsidian-calibre-bridge
 */`;

const prod = process.argv[2] === "production";

const ctx = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", ...builtins],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
});

if (prod) {
  await ctx.rebuild();
  process.exit(0);
} else {
  await ctx.watch();
}
