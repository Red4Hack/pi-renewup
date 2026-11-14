import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const FILE = join(homedir(), ".pi/agent/cache/renewup.json");
const EVERY_MS = 10 * 60_000; // minimum interval between update checks, shared by all pi instances
const TICK_MS = 60_000; // how often an open pi asks whether a check is due

type State = { last: number; msg?: string };
type Paint = (theme: { fg(color: string, text: string): string }, text: string) => string;

const read = (): State => {
	try {
		return { last: 0, ...JSON.parse(readFileSync(FILE, "utf8")) };
	} catch {
		return { last: 0 };
	}
};
const write = (s: State) => {
	mkdirSync(dirname(FILE), { recursive: true });
	writeFileSync(FILE, JSON.stringify(s));
};

export const due = (last: number, now: number) => now - last >= EVERY_MS;

/** Parses `pi update --all` output; undefined = nothing changed. */
export function outcome(out: string): string | undefined {
	if (/Updated \S+ from \S+ to /.test(out)) return "✔ Update installed · Restart to apply"; // /reload does not swap the binary
	if (/Updated \d+ package/.test(out)) return "✔ Update installed · /reload to apply";
}

const REGISTRY = "https://registry.npmjs.org/@earendil-works/pi-coding-agent/latest";

// shortcut: numeric compare, a prerelease sorts above its release; use semver if pi's "latest" tag ever carries prereleases
export const newer = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true }) > 0;

/** What has an update available: "pi" and/or package names. Only asks the network, installs nothing. */
async function detect(cwd: string): Promise<string[]> {
	// dynamic import: resolved by pi at runtime, not needed by the unit tests
	const { DefaultPackageManager, SettingsManager, getAgentDir, VERSION } = await import("@earendil-works/pi-coding-agent");
	const agentDir = getAgentDir();
	const [pkgs, latest] = await Promise.all([
		new DefaultPackageManager({ cwd, agentDir, settingsManager: SettingsManager.create(cwd, agentDir) }).checkForAvailableUpdates(),
		fetch(REGISTRY, { signal: AbortSignal.timeout(15_000) })
			.then((r) => r.json() as Promise<{ version?: string }>)
			.catch(() => undefined),
	]);
	const found = pkgs.map((p) => p.displayName);
	if (latest?.version && newer(latest.version, VERSION)) found.unshift("pi");
	return found;
}

const dim: Paint = (t, s) => t.fg("dim", s);
const green: Paint = (t, s) => t.fg("success", s);
const red: Paint = (t, s) => t.fg("error", s);

export default function (pi: ExtensionAPI) {
	let running = false;
	let timer: ReturnType<typeof setInterval> | undefined;

	// Right-aligned line just above the editor, like Claude Code.
	const show = (ctx: ExtensionContext, text: string | undefined, paint: Paint) => {
		try {
			ctx.ui.setWidget(
				"renewup",
				text
					? (_tui, theme) => ({
							render: (w: number) => [" ".repeat(Math.max(0, w - text.length - 1)) + paint(theme, text)],
							invalidate() {},
						})
					: undefined,
			);
		} catch {
			// stale ctx after a session switch: state is in the file and reappears on the next session_start
		}
	};

	// quiet = background tick: only speaks up when an update was detected
	const run = async (ctx: ExtensionContext, force: boolean, quiet = false) => {
		const st = read();
		if (running || (!force && !due(st.last, Date.now()))) return;
		running = true;
		const last = Date.now();
		write({ ...st, last }); // write first: other pi instances do not repeat the check
		let updating = false;
		// transient notice in the same spot; then back to the saved state
		const flash = (text: string, paint: Paint) => {
			if (quiet && !updating) return;
			show(ctx, text, paint);
			setTimeout(() => running || show(ctx, read().msg, green), 6000);
		};
		try {
			if (!(await detect(ctx.cwd)).length) return flash("✔ Up to date", green);
			updating = true;
			show(ctx, "Auto-updating…", dim);
			const r = await pi.exec("pi", ["update", "--all"], { timeout: 600_000 });
			if (r.code !== 0) return flash("✘ Auto-update failed · /renewup to retry", red);
			const msg = outcome(r.stdout) ?? st.msg;
			write({ last, msg });
			show(ctx, msg, green);
		} catch {
			flash("✘ Auto-update failed · /renewup to retry", red);
		} finally {
			running = false;
		}
	};

	pi.on("session_start", async (event, ctx) => {
		if (!ctx.hasUI || process.env.PI_OFFLINE) return;
		const st = read();
		// on startup the new pi is already running; /reload only reloads extensions
		if (st.msg && (event.reason === "startup" || (event.reason === "reload" && st.msg.includes("/reload")))) {
			st.msg = undefined;
			write(st);
		}
		show(ctx, st.msg, green);
		void run(ctx, false); // in the background, does not block startup
		clearInterval(timer);
		timer = setInterval(() => void run(ctx, false, true), TICK_MS);
		timer.unref();
	});

	pi.on("session_shutdown", async () => clearInterval(timer));

	pi.registerCommand("renewup", {
		description: "Update pi and extensions now (without waiting for the next check)",
		handler: async (_args, ctx) => run(ctx, true),
	});
}
