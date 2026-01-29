import esbuild from "esbuild";
import process from "process";

const prod = process.argv[2] === "production";

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: ["obsidian"],
	format: "cjs",
	target: "es2018",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
	// Production: minify and strip debug logs
	minify: prod,
	drop: prod ? ["debugger"] : [],
	// Mark console.log/debug/info as pure (no side effects) so minifier removes them
	pure: prod ? ["console.log", "console.debug", "console.info"] : [],
});

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
