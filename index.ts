import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateTail,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";

/** Commands that are destructive/unrecoverable — refused unless forceDangerous is set. */
const DANGEROUS_COMMANDS = ["pages trash"];

/** Regex matching ntn's not-authenticated error messages. */
const NOT_AUTHED = /unauthorized|not authenticated|auth.*fail|token.*invalid|login.*required/i;

export type NtnParams = {
	subcommand: string;
	args?: Record<string, string | number | boolean | string[] | null | undefined>;
	data?: string;
	method?: string;
	timeoutSeconds?: number;
	forceDangerous?: boolean;
};

export type RawNtnParams = Omit<NtnParams, "subcommand" | "args"> & {
	subcommand?: string;
	args?: NtnParams["args"] | string[];
};

/** Flags in array-args that promote to typed top-level fields when unset. */
const PROMOTABLE_FLAGS = new Set(["data", "method"]);

/**
 * Normalize raw tool params into canonical NtnParams. Tolerates two mis-shaped
 * calls the model produces: args as a JSON array (mode #1) and known top-level
 * keys nested inside an object args (mode #2). Top-level fields always win.
 */
function normalizeParams(raw: RawNtnParams): NtnParams {
	const { args: rawArgs, ...rest } = raw;
	const subcommand = rest.subcommand ?? "";

	// Mode #1: args is an array of positional/flag tokens.
	if (Array.isArray(rawArgs)) {
		const parts: string[] = subcommand.trim().split(/\s+/).filter(Boolean);
		const flags: NonNullable<NtnParams["args"]> = {};
		let data = rest.data;
		let method = rest.method;

		for (let i = 0; i < rawArgs.length; i++) {
			const token = rawArgs[i];
			if (token.startsWith("--")) {
				let name: string;
				let value: string | undefined;

				const eq = token.indexOf("=");
				if (eq >= 0) {
					name = token.slice(2, eq);
					value = token.slice(eq + 1);
				} else {
					name = token.slice(2);
					if (i + 1 < rawArgs.length && !rawArgs[i + 1].startsWith("--")) {
						value = rawArgs[++i];
					}
				}

				if (PROMOTABLE_FLAGS.has(name)) {
					if (name === "data" && data === undefined && value !== undefined) {
						data = value;
					} else if (name === "method" && method === undefined && value !== undefined) {
						method = value;
					}
					// If top-level is already set, the parsed duplicate is dropped.
				} else {
					flags[name] = value === undefined ? true : value;
				}
			} else {
				parts.push(token);
			}
		}

		return {
			...rest,
			subcommand: parts.join(" "),
			args: Object.keys(flags).length > 0 ? flags : undefined,
			data,
			method,
		};
	}

	// Object args or no args — harvest known top-level keys from nested args (mode #2).
	if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
		const knownKeys: (keyof RawNtnParams)[] = [
			"subcommand", "data", "method", "timeoutSeconds", "forceDangerous",
		];
		const harvested: Partial<NtnParams> = {};
		const remaining: NonNullable<NtnParams["args"]> = {};

		for (const [key, value] of Object.entries(rawArgs)) {
			if (knownKeys.includes(key as keyof RawNtnParams)) {
				// Top-level wins — only harvest when unset AND the type matches.
				// When top-level is already set, the nested duplicate is dropped entirely.
				// When top-level is unset but the type mismatches, fall through to a flag
				// so a mis-typed knownKey (e.g. {args:{data:42}}) becomes --data 42
				// instead of being silently dropped.
				if (key === "subcommand") {
					if (!subcommand && typeof value === "string") harvested.subcommand = value;
					else if (!subcommand) remaining[key] = value as string | number | boolean | string[];
				} else if (key === "data") {
					if (rest.data === undefined && typeof value === "string") harvested.data = value;
					else if (rest.data === undefined) remaining[key] = value as string | number | boolean | string[];
				} else if (key === "method") {
					if (rest.method === undefined && typeof value === "string") harvested.method = value;
					else if (rest.method === undefined) remaining[key] = value as string | number | boolean | string[];
				} else if (key === "timeoutSeconds") {
					if (rest.timeoutSeconds === undefined && typeof value === "number") harvested.timeoutSeconds = value;
					else if (rest.timeoutSeconds === undefined) remaining[key] = value as string | number | boolean | string[];
				} else if (key === "forceDangerous") {
					if (rest.forceDangerous === undefined && typeof value === "boolean") harvested.forceDangerous = value;
					else if (rest.forceDangerous === undefined) remaining[key] = value as string | number | boolean | string[];
				}
			} else if (key === "args" && Array.isArray(value)) {
				// Nested args inside args (array form) — recurse via mode #1.
				const inner = normalizeParams({ ...rest, subcommand, args: value });
				if (inner.subcommand && !subcommand) harvested.subcommand = inner.subcommand;
				if (inner.data !== undefined && rest.data === undefined) harvested.data = inner.data;
				if (inner.method !== undefined && rest.method === undefined) harvested.method = inner.method;
				if (inner.args) Object.assign(remaining, inner.args);
			} else if (key === "args" && typeof value === "object" && value !== null && !Array.isArray(value)) {
				// Nested args inside args (object form) — merge remaining flags.
				Object.assign(remaining, value as Record<string, string | number | boolean | string[]>);
			} else {
				remaining[key] = value as string | number | boolean | string[];
			}
		}

		return {
			...rest,
			subcommand: harvested.subcommand ?? subcommand,
			args: Object.keys(remaining).length > 0 ? remaining : undefined,
			data: harvested.data ?? rest.data,
			method: harvested.method ?? rest.method,
			timeoutSeconds: harvested.timeoutSeconds ?? rest.timeoutSeconds,
			forceDangerous: harvested.forceDangerous ?? rest.forceDangerous,
		};
	}

	return { ...rest, subcommand, args: rawArgs };
}

/**
 * Serialize params into the ntn CLI's argv format.
 *
 * The subcommand is split on whitespace (e.g. "pages get <id>" → ["pages", "get", "<id>"]).
 * Args are serialized as `--flag value` token pairs; booleans become bare
 * `--flag` tokens; arrays become repeated `--flag value` pairs;
 * false/null/undefined are skipped. Keys without a `--` prefix are prefixed.
 * Global flags (--data, --method) are appended after subcommand and args,
 * in that order (--data before --method).
 */
export function buildArgv(params: RawNtnParams): string[] {
	const normalized = normalizeParams(params);
	const trimmed = normalized.subcommand.trim();
	if (trimmed.length === 0) {
		throw new Error("subcommand is required and must not be empty or whitespace");
	}

	const argv: string[] = trimmed.split(/\s+/);
	const args = normalized.args ?? {};
	for (const [key, value] of Object.entries(args)) {
		if (value === false || value === null || value === undefined) continue;
		const flag = key.startsWith("--") ? key : `--${key}`;
		if (value === true) {
			argv.push(flag);
		} else if (Array.isArray(value)) {
			for (const v of value) {
				argv.push(flag, String(v));
			}
		} else {
			argv.push(flag, String(value));
		}
	}

	if (normalized.data) {
		argv.push("--data", normalized.data);
	}
	if (normalized.method) {
		argv.push("--method", normalized.method);
	}

	return argv;
}

/**
 * Guard against destructive ntn operations that are hard or impossible to
 * reverse. The tool refuses these unless the caller explicitly sets
 * `forceDangerous: true`, which keeps the LLM from trashing a page
 * by accident.
 */
export function assertSafeCommand(params: NtnParams): void {
	const words = params.subcommand.trim().toLowerCase().split(/\s+/);
	for (let i = 0; i < words.length - 1; i++) {
		const pair = `${words[i]} ${words[i + 1]}`;
		if (DANGEROUS_COMMANDS.includes(pair)) {
			if (params.forceDangerous === true) return;
			throw new Error(
				`Refusing \`${pair}\` from the ntn tool — this operation is unrecoverable. ` +
					"To override, set `forceDangerous: true` and confirm with the user first.",
			);
		}
	}
}

/**
 * Format stdout/stderr into a single human-readable string.
 * If both are empty/whitespace, returns a placeholder.
 */
export function formatOutput(stdout: string, stderr: string): string {
	const chunks: string[] = [];
	if (stdout.trim().length > 0) chunks.push(stdout.trimEnd());
	if (stderr.trim().length > 0) chunks.push(`stderr:\n${stderr.trimEnd()}`);
	return chunks.join("\n\n") || "(no output)";
}

/** Result shape returned by the injected exec boundary (compatible with pi.exec). */
export type ExecResult = { stdout?: string; stderr?: string; code?: number | null; killed?: boolean };

/** System boundary: spawns the ntn CLI. Injected for testing. */
export type NtnExec = (
	command: string,
	args: string[],
	options: { signal?: AbortSignal; timeout?: number },
) => Promise<ExecResult>;

/**
 * Core execution logic, separated from the Pi tool wiring so it can be tested
 * with an injected `exec` (the only system boundary). Returns the same shape
 * as a Pi tool result.
 */
export async function runNtn(
	rawParams: RawNtnParams,
	exec: NtnExec,
	signal?: AbortSignal,
): Promise<{
	content: { type: "text"; text: string }[];
	details: Record<string, unknown>;
	isError: boolean;
}> {
	// Normalize before guard: the model may nest subcommand inside args,
	// so we must harvest it before assertSafeCommand can see it.
	const params = normalizeParams(rawParams);

	if (!params.subcommand || params.subcommand.trim().length === 0) {
		throw new Error("Pass an ntn subcommand, for example `subcommand: 'pages get <page-id>'` or `subcommand: 'api /v1/search'`.");
	}
	assertSafeCommand(params);

	const argv = buildArgv(params);
	const timeoutSeconds = Math.min(Math.max(params.timeoutSeconds ?? 30, 1), 120);

	let result: ExecResult;
	try {
		result = await exec("ntn", argv, { signal, timeout: timeoutSeconds * 1000 });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to run ntn CLI. Is it installed and on PATH? ${message}`);
	}

	const stdout = result.stdout ?? "";
	const stderr = result.stderr ?? "";
	const code = result.code;

	// Detect the common "not authenticated" failure and give actionable guidance.
	if (code !== 0 && (NOT_AUTHED.test(stdout) || NOT_AUTHED.test(stderr))) {
		return {
			content: [
				{
					type: "text",
					text:
						"You are not authenticated with the Notion CLI. Run `ntn login` to authenticate, " +
						"then retry the command.",
				},
			],
			details: { subcommand: params.subcommand, code, notAuthed: true },
			isError: true,
		};
	}

	const output = formatOutput(stdout, stderr);
	const truncation = truncateTail(output, {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	});
	const commandLine = `ntn ${argv.join(" ")}`;
	const codeText = code === null || code === undefined ? "unknown" : String(code);
	let text = `Command: ${commandLine}\nExit code: ${codeText}${result.killed ? " (killed)" : ""}\n\n${truncation.content}`;
	if (truncation.truncated) {
		text += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).]`;
	}

	return {
		content: [{ type: "text", text }],
		details: {
			subcommand: params.subcommand,
			argv,
			code,
			killed: result.killed,
			truncated: truncation.truncated,
		},
		isError: code !== 0,
	};
}

const baseDir = dirname(fileURLToPath(import.meta.url));
const skillPath = join(baseDir, "skill", "SKILL.md");

const RELEVANT_PROMPT = /\b(notion|ntn|page|database|data source|workspace)\b/i;

/** Canonical flat call-shape example — single source of truth for all prompt surfaces. */
export const NTN_CALL_EXAMPLE = {
	subcommand: "pages get <page-id>",
	args: { json: true },
} as const;

export const NTN_ARGS_DESCRIPTION =
	"Command flags as a key/value object map (e.g. {json: true}). " +
	"Must be an object, not an array. " +
	"Never put subcommand, data, or method inside args — " +
	"those are top-level params, not nested inside args.";

export const NTN_SUBCOMMAND_DESCRIPTION =
	"The ntn CLI subcommand as a top-level param, e.g. 'pages get <page-id>' or 'api /v1/search'. " +
	"Split on spaces into the command path. " +
	"This is a top-level param — never nest it inside args.";

const NTN_CALL_EXAMPLE_JSON = JSON.stringify(NTN_CALL_EXAMPLE, null, 2);

/**
 * Guidance injected into the system prompt when the user's message looks
 * Notion-related. Kept short — the full reference lives in the SKILL.md.
 */
export const NTN_GUIDANCE = `## Notion CLI (ntn) guidance

The \`ntn\` tool wraps the Notion CLI (\`ntn\`) as a single typed tool. All params are top-level siblings — never nest subcommand, data, or method inside args.

Call shape (all params flat at top level):
\`\`\`json
${NTN_CALL_EXAMPLE_JSON}
\`\`\`

- \`subcommand\` (top-level): the ntn command, e.g. "pages get <page-id>" or "api /v1/search".
- \`args\` (top-level): key/value object map of flags only, e.g. {json: true}. Must be an object, not an array.
- \`data\` (top-level): request body for API calls (translates to --data '...').
- \`method\` (top-level): HTTP method override for API calls (translates to --method GET|POST|PATCH|DELETE).

Key patterns:
- Get a page: \`subcommand: "pages get <page-id>"\`.
- Create a page: \`subcommand: "pages create"\`, \`args: { parent: "page:<id>" }\`, \`data: "# Title\\n\\nBody"\`.
- Search workspace: \`subcommand: "api /v1/search"\`, \`data: '{"query":"meeting notes"}'\`.
- Query a database: \`subcommand: "datasources query <data-source-id>"\`.
- Destructive ops (\`pages trash\`) require \`forceDangerous: true\` and explicit user confirmation.

If the tool reports you are not authenticated, run \`ntn login\` via bash.`;

export default function ntnExtension(pi: ExtensionAPI) {
	// Make the bundled SKILL.md discoverable as a skill.
	pi.on("resources_discover", () => ({
		skillPaths: [skillPath],
	}));

	// Inject concise guidance when the prompt looks Notion-related.
	pi.on("before_agent_start", (event) => {
		if (!RELEVANT_PROMPT.test(event.prompt)) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n${NTN_GUIDANCE}\n`,
		};
	});

	pi.registerTool({
		name: "ntn",
		label: "Notion CLI",
		description:
			"Call the Notion CLI (ntn) to interact with pages, databases, data sources, and the public Notion API. " +
			"All params are top-level siblings: subcommand (e.g. 'pages get <id>'), args (object of flags), data, method. " +
			"Never nest subcommand/data/method inside args — args is a flat key/value object of flags only.\n" +
			"Example call shape:\n" + NTN_CALL_EXAMPLE_JSON + "\n" +
			"Destructive operations (pages trash) require `forceDangerous: true`.",
		promptSnippet:
			"Interact with Notion (pages, databases, data sources, API) via the ntn CLI.",
		promptGuidelines: [
			"Use the `ntn` tool when the user asks about Notion — pages, databases, data sources, or the API. It calls the ntn CLI directly.",
			"All params are top-level siblings: subcommand, args, data, method, timeoutSeconds, forceDangerous. Never nest one inside another.",
			"`args` is a key/value object of flags only (e.g. {json: true}), never an array, and never contains subcommand/data/method.",
			"Use `data` for API request bodies (e.g. data: '{\"query\":\"meeting notes\"}' for search) and `method` for HTTP method override.",
			"Destructive operations (`pages trash`) require `forceDangerous: true`. Always confirm with the user before using it.",
			"If the tool reports you are not authenticated, tell the user to run `ntn login`.",
		],
		parameters: Type.Object({
			subcommand: Type.Optional(
				Type.String({
					description: NTN_SUBCOMMAND_DESCRIPTION,
				}),
			),
			args: Type.Optional(
				Type.Union([
					Type.Record(
						Type.String(),
						Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Array(Type.String())]),
					),
					Type.Array(Type.String()),
				], {
					description: NTN_ARGS_DESCRIPTION,
				}),
			),
			data: Type.Optional(
				Type.String({
					description: "Request body for API calls (translates to --data '<body>'). Use a JSON string for ntn api endpoints.",
				}),
			),
			method: Type.Optional(
				Type.String({ description: "HTTP method override for API calls (translates to --method GET|POST|PATCH|DELETE)." }),
			),
			timeoutSeconds: Type.Optional(
				Type.Integer({
					minimum: 1,
					maximum: 120,
					default: 30,
					description: "Command timeout in seconds (default 30, max 120).",
				}),
			),
			forceDangerous: Type.Optional(
				Type.Boolean({
					description: "Opt-in flag to allow destructive commands (pages trash). Requires explicit user confirmation.",
				}),
			),
		}),
		async execute(_toolCallId, params: RawNtnParams, signal) {
			return runNtn(params, (cmd, args, opts) => pi.exec(cmd, args, opts), signal);
		},
	});
}
