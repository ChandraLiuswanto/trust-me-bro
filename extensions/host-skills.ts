// Load host-specific skills only when Pi runs under that host.
//
//   Paseo  (PASEO_AGENT_ID set) -> skills-paseo/ + Paseo's own ~/.agents/skills/paseo
//   Orca   (ORCA_PANE_KEY, ORCA_AGENT_SESSION_ID or ORCA_CLI_BIN_DIR set) -> skills-orca/
//          Terminal panes set ORCA_PANE_KEY; Orca's chat view resumes sessions as
//          `pi --mode rpc` with ORCA_AGENT_SESSION_ID/ORCA_CLI_BIN_DIR but no pane key.
//
// Shared skills in skills/ load everywhere through the package manifest.
// Override detection with PI_HOST_SKILLS=paseo,orca or PI_HOST_SKILLS=none.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const repoDir = dirname(dirname(fileURLToPath(import.meta.url)));

type Host = "paseo" | "orca";

const HOSTS: Record<Host, { detect: () => boolean; paths: () => string[] }> = {
	paseo: {
		detect: () => Boolean(process.env.PASEO_AGENT_ID),
		paths: () => [join(repoDir, "skills-paseo"), join(homedir(), ".agents", "skills", "paseo")],
	},
	orca: {
		detect: () =>
			Boolean(process.env.ORCA_PANE_KEY || process.env.ORCA_AGENT_SESSION_ID || process.env.ORCA_CLI_BIN_DIR),
		paths: () => [join(repoDir, "skills-orca")],
	},
};

export function activeHosts(): Host[] {
	const override = process.env.PI_HOST_SKILLS?.trim();
	if (override) {
		if (override === "none") return [];
		return override
			.split(",")
			.map((h) => h.trim())
			.filter((h): h is Host => h in HOSTS);
	}
	return (Object.keys(HOSTS) as Host[]).filter((h) => HOSTS[h].detect());
}

export default function (pi: ExtensionAPI) {
	pi.on("resources_discover", () => {
		const skillPaths = activeHosts()
			.flatMap((h) => HOSTS[h].paths())
			.filter((p) => existsSync(p));
		return skillPaths.length ? { skillPaths } : undefined;
	});
}
