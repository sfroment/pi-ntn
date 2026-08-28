import { assertSafeCommand, buildArgv, formatOutput, runNtn, NTN_GUIDANCE, NTN_CALL_EXAMPLE, NTN_ARGS_DESCRIPTION, NTN_SUBCOMMAND_DESCRIPTION, type ExecResult, type NtnExec, type NtnParams } from "./index.ts";
import { describe, expect, mock, test } from "bun:test";

describe("buildArgv", () => {
	test("1. subcommand split on spaces", () => {
		expect(buildArgv({ subcommand: "pages get" })).toEqual(["pages", "get"]);
	});

	test("2. args become --flag value token pairs", () => {
		expect(
			buildArgv({ subcommand: "pages get", args: { json: true, parent: "page:abc" } }),
		).toEqual(["pages", "get", "--json", "--parent", "page:abc"]);
	});

	test("3. boolean true becomes a bare --flag", () => {
		const argv = buildArgv({ subcommand: "pages get", args: { json: true } });
		expect(argv).toContain("--json");
		expect(argv).not.toContain("--json=true");
		expect(argv).not.toContain("json=true");
	});

	test("4. boolean false is omitted", () => {
		const argv = buildArgv({ subcommand: "pages get", args: { json: false } });
		expect(argv).not.toContain("--json");
		expect(argv).not.toContain("json");
		expect(argv).not.toContain("json=false");
	});

	test("5. array values become repeated --flag value pairs", () => {
		expect(
			buildArgv({ subcommand: "pages create", args: { label: ["bug", "urgent"] } }),
		).toEqual(["pages", "create", "--label", "bug", "--label", "urgent"]);
	});

	test("6. data produces --data with the value", () => {
		const argv = buildArgv({
			subcommand: "api /v1/search",
			data: '{"query":"meeting notes"}',
		});
		expect(argv).toContain("--data");
		expect(argv).toContain('{"query":"meeting notes"}');
	});

	test("7. method produces --method with the value", () => {
		const argv = buildArgv({ subcommand: "api /v1/pages", method: "POST" });
		expect(argv).toContain("--method");
		expect(argv).toContain("POST");
	});

	test("8. null and undefined args values are skipped", () => {
		expect(
			buildArgv({
				subcommand: "pages get",
				args: { json: true, parent: undefined, content: null },
			}),
		).toEqual(["pages", "get", "--json"]);
	});

	test("9. data appears after subcommand and args", () => {
		const argv = buildArgv({
			subcommand: "api /v1/search",
			args: { verbose: true },
			data: '{"query":"test"}',
		});
		expect(argv.indexOf("--data")).toBeGreaterThan(argv.indexOf("search"));
		expect(argv.indexOf("--data")).toBeGreaterThan(argv.indexOf("--verbose"));
	});

	test("10. --data precedes --method", () => {
		const argv = buildArgv({
			subcommand: "api /v1/pages",
			data: '{"title":"test"}',
			method: "POST",
		});
		expect(argv.indexOf("--data")).toBeLessThan(argv.indexOf("--method"));
	});

	test("11a. empty subcommand throws", () => {
		expect(() => buildArgv({ subcommand: "" })).toThrow(/subcommand/i);
	});

	test("11b. whitespace-only subcommand throws", () => {
		expect(() => buildArgv({ subcommand: "   " })).toThrow(/subcommand/i);
	});
});

describe("buildArgv mode#1 (array args)", () => {
	test("A1.1 real payload: subcommand + array args with --data, top-level data wins", () => {
		expect(
			buildArgv({
				subcommand: "api",
				args: ["/v1/search", "--data", '{"query":"meeting notes"}'],
				data: '{"query":"meeting notes"}',
			}),
		).toEqual(["api", "/v1/search", "--data", '{"query":"meeting notes"}']);
	});

	test("A1.2 array args alone with --data (no top-level data) — promoted from array", () => {
		expect(
			buildArgv({ subcommand: "api", args: ["/v1/search", "--data", '{"query":"test"}'] }),
		).toEqual(["api", "/v1/search", "--data", '{"query":"test"}']);
	});

	test("A1.3 array args with boolean flag", () => {
		expect(
			buildArgv({ subcommand: "pages", args: ["get", "--json"] }),
		).toEqual(["pages", "get", "--json"]);
	});

	test("A1.4 array args with --method promoted", () => {
		expect(
			buildArgv({ subcommand: "api", args: ["/v1/pages", "--method", "POST"] }),
		).toEqual(["api", "/v1/pages", "--method", "POST"]);
	});
});

describe("buildArgv mode#2 (nested args)", () => {
	test("A2.1 real payload: subcommand+data nested inside args", () => {
		expect(
			buildArgv({
				args: {
					subcommand: "api /v1/search",
					data: '{"query":"meeting notes"}',
				},
			}),
		).toEqual(["api", "/v1/search", "--data", '{"query":"meeting notes"}']);
	});

	test("A2.2 nested data+method in args are harvested to top-level", () => {
		expect(
			buildArgv({
				args: { subcommand: "api /v1/pages", data: '{"title":"x"}', method: "POST" },
			}),
		).toEqual(["api", "/v1/pages", "--data", '{"title":"x"}', "--method", "POST"]);
	});

	test("A2.3 top-level value wins over nested duplicate", () => {
		expect(
			buildArgv({
				subcommand: "api /v1/search",
				data: '{"query":"top"}',
				args: { data: '{"query":"nested"}', verbose: true },
			}),
		).toEqual(["api", "/v1/search", "--verbose", "--data", '{"query":"top"}']);
	});

	test("A2.4 mis-typed known key nested in args becomes a flag, not dropped", () => {
		// data as a number (type mismatch) should fall through to a --data flag
		// rather than being silently dropped by the harvest branch.
		expect(
			buildArgv({ args: { subcommand: "api /v1/search", data: 42, verbose: true } }),
		).toEqual(["api", "/v1/search", "--data", "42", "--verbose"]);
	});
});

describe("assertSafeCommand", () => {
	test("1. pages trash refused without opt-in", () => {
		expect(() => assertSafeCommand({ subcommand: "pages trash" })).toThrow(/pages trash/);
	});

	test("2. pages trash with args is refused as unrecoverable", () => {
		expect(() =>
			assertSafeCommand({ subcommand: "pages trash <page-id>", args: { yes: true } }),
		).toThrow(/unrecoverable/);
	});

	test("3. pages trash with forceDangerous is allowed", () => {
		expect(() =>
			assertSafeCommand({ subcommand: "pages trash <page-id>", forceDangerous: true }),
		).not.toThrow();
	});

	test("4. pages get is allowed", () => {
		expect(() =>
			assertSafeCommand({ subcommand: "pages get <page-id>" }),
		).not.toThrow();
	});

	test("5. datasources query is allowed", () => {
		expect(() =>
			assertSafeCommand({ subcommand: "datasources query <ds-id>" }),
		).not.toThrow();
	});

	test("6. api /v1/search is allowed", () => {
		expect(() =>
			assertSafeCommand({ subcommand: "api /v1/search" }),
		).not.toThrow();
	});

	test("7. whoami is allowed", () => {
		expect(() =>
			assertSafeCommand({ subcommand: "whoami" }),
		).not.toThrow();
	});

	test("8. safe commands are allowed", () => {
		expect(() => assertSafeCommand({ subcommand: "pages get" })).not.toThrow();
		expect(() => assertSafeCommand({ subcommand: "datasources resolve" })).not.toThrow();
	});

	test("9. dangerous command embedded in longer subcommand is caught (bypass fix)", () => {
		expect(() =>
			assertSafeCommand({ subcommand: "run pages trash" }),
		).toThrow(/pages trash/);
	});

	test("10. whitespace-padded dangerous command is caught", () => {
		expect(() =>
			assertSafeCommand({ subcommand: "  pages trash  " }),
		).toThrow(/pages trash/);
	});

	test("11. safe command with extra words is allowed", () => {
		expect(() =>
			assertSafeCommand({ subcommand: "pages get <page-id>" }),
		).not.toThrow();
	});

	test("12. pages create is allowed (not destructive)", () => {
		expect(() =>
			assertSafeCommand({ subcommand: "pages create" }),
		).not.toThrow();
	});

	test("13. pages edit is allowed (not destructive)", () => {
		expect(() =>
			assertSafeCommand({ subcommand: "pages edit <page-id>" }),
		).not.toThrow();
	});

	test("14. logout is allowed (not guarded)", () => {
		expect(() =>
			assertSafeCommand({ subcommand: "logout" }),
		).not.toThrow();
	});
});

describe("formatOutput", () => {
	test("1. stdout only", () => {
		expect(formatOutput("hello", "")).toBe("hello");
	});

	test("2. stderr appended with label", () => {
		expect(formatOutput("out", "err")).toBe("out\n\nstderr:\nerr");
	});

	test("3. empty produces placeholder", () => {
		expect(formatOutput("", "")).toBe("(no output)");
	});

	test("4. whitespace-only is treated as empty", () => {
		expect(formatOutput("   \n  ", "  ")).toBe("(no output)");
	});
});

describe("NTN_GUIDANCE", () => {
	test("1. does not contain stale key=value format", () => {
		expect(NTN_GUIDANCE).not.toContain("key=value");
	});
});

describe("NTN_CALL_EXAMPLE", () => {
	test("A4.1 structure: has subcommand and args; args is non-array object", () => {
		const keys = Object.keys(NTN_CALL_EXAMPLE);
		expect(keys).toContain("subcommand");
		expect(keys).toContain("args");
		expect(Array.isArray(NTN_CALL_EXAMPLE.args)).toBe(false);
		expect(typeof NTN_CALL_EXAMPLE.args).toBe("object");
	});
});

describe("NTN_ARGS_DESCRIPTION", () => {
	test("A4.2 says object-not-array", () => {
		expect(NTN_ARGS_DESCRIPTION).toMatch(/not an array|never an array|must be an object/i);
	});

	test("A4.3 prohibits nesting with literal names", () => {
		expect(NTN_ARGS_DESCRIPTION).toMatch(/never[^.]*subcommand[^.]*data|top-level params, not nested/i);
		expect(NTN_ARGS_DESCRIPTION).toContain("subcommand");
		expect(NTN_ARGS_DESCRIPTION).toContain("data");
	});
});

describe("NTN_SUBCOMMAND_DESCRIPTION", () => {
	test("A4.4 says top-level, never in args, has command path", () => {
		expect(NTN_SUBCOMMAND_DESCRIPTION).toMatch(/top-level/i);
		expect(NTN_SUBCOMMAND_DESCRIPTION).toMatch(/never[^.]*args/i);
		expect(NTN_SUBCOMMAND_DESCRIPTION).toContain("pages get");
	});
});

describe("NTN_GUIDANCE content", () => {
	test("A4.5 embeds the flat example", () => {
		expect(NTN_GUIDANCE).toContain(JSON.stringify(NTN_CALL_EXAMPLE, null, 2));
	});
});

/**
 * Fake exec: returns a canned ExecResult, recording the call so tests can
 * assert on the argv that was built. This is the only system boundary mocked
 * (per the TDD mocking skill — mock at boundaries, never internal collaborators).
 */
function makeFakeExec(result: ExecResult): NtnExec & { calls: Parameters<NtnExec>[] } {
	const calls: Parameters<NtnExec>[] = [];
	const fn = mock(async (_cmd: string, args: string[], opts) => {
		calls.push([_cmd, args, opts]);
		return result;
	}) as unknown as NtnExec & { calls: Parameters<NtnExec>[] };
	fn.calls = calls;
	return fn;
}

describe("runNtn", () => {
	test("1. builds argv from params and passes it to exec", async () => {
		const exec = makeFakeExec({ stdout: "ok", code: 0 });
		await runNtn({ subcommand: "pages get", args: { json: true } }, exec);
		expect(exec.calls[0][0]).toBe("ntn");
		expect(exec.calls[0][1]).toEqual(["pages", "get", "--json"]);
	});

	test("2. success echoes command, exit code, and output", async () => {
		const exec = makeFakeExec({ stdout: "page-output", code: 0 });
		const res = await runNtn({ subcommand: "pages get" }, exec);
		expect(res.isError).toBe(false);
		expect(res.content[0].text).toContain("Command: ntn pages get");
		expect(res.content[0].text).toContain("Exit code: 0");
		expect(res.content[0].text).toContain("page-output");
	});

	test("3. non-zero exit sets isError true and includes exit code + stderr", async () => {
		const exec = makeFakeExec({ stdout: "", stderr: "not found", code: 1 });
		const res = await runNtn({ subcommand: "pages get" }, exec);
		expect(res.isError).toBe(true);
		expect(res.content[0].text).toContain("Exit code: 1");
		expect(res.content[0].text).toContain("not found");
	});

	test("4. exec rejection (ENOENT) is wrapped with install hint", async () => {
		const failing: NtnExec = async () => {
			throw new Error("spawn ENOENT");
		};
		await expect(runNtn({ subcommand: "pages get" }, failing)).rejects.toThrow(/installed and on PATH/);
	});

	test("5. not-authed returns isError with notAuthed detail and ntn login guidance", async () => {
		const exec = makeFakeExec({
			stdout: "",
			stderr: "You are not authenticated. Run ntn login to authenticate.",
			code: 4,
		});
		const res = await runNtn({ subcommand: "pages get" }, exec);
		expect(res.isError).toBe(true);
		expect(res.details).toMatchObject({ notAuthed: true });
		expect(res.content[0].text).toContain("ntn login");
	});

	test("6. pages trash refused before exec is called", async () => {
		const exec = makeFakeExec({ stdout: "", code: 0 });
		await expect(
			runNtn({ subcommand: "pages trash" }, exec),
		).rejects.toThrow(/pages trash/);
		expect(exec.calls).toHaveLength(0);
	});

	test("7. missing subcommand throws", async () => {
		const exec = makeFakeExec({ stdout: "", code: 0 });
		await expect(runNtn({} as NtnParams, exec)).rejects.toThrow(/subcommand/);
	});

	test("8. large output is truncated and flagged", async () => {
		const huge = Array.from({ length: 5000 }, () => "line of content").join("\n");
		const exec = makeFakeExec({ stdout: huge, code: 0 });
		const res = await runNtn({ subcommand: "pages get" }, exec);
		expect(res.details).toMatchObject({ truncated: true });
		expect(res.content[0].text).toContain("Output truncated");
	});

	test("9. timeout 9999 is clamped to 120s", async () => {
		const exec = makeFakeExec({ stdout: "ok", code: 0 });
		await runNtn({ subcommand: "pages get", timeoutSeconds: 9999 }, exec);
		expect(exec.calls[0][2].timeout).toBe(120000);
	});

	test("10. no timeoutSeconds defaults to 30s", async () => {
		const exec = makeFakeExec({ stdout: "ok", code: 0 });
		await runNtn({ subcommand: "pages get" }, exec);
		expect(exec.calls[0][2].timeout).toBe(30000);
	});

	test("11. timeoutSeconds 0 is clamped to min 1s", async () => {
		const exec = makeFakeExec({ stdout: "ok", code: 0 });
		await runNtn({ subcommand: "pages get", timeoutSeconds: 0 }, exec);
		expect(exec.calls[0][2].timeout).toBe(1000);
	});

	test("12. data appears in argv", async () => {
		const exec = makeFakeExec({ stdout: "ok", code: 0 });
		await runNtn({ subcommand: "api /v1/search", data: '{"query":"meeting notes"}' }, exec);
		expect(exec.calls[0][1]).toContain("--data");
		expect(exec.calls[0][1]).toContain('{"query":"meeting notes"}');
	});

	test("13. method appears in argv", async () => {
		const exec = makeFakeExec({ stdout: "ok", code: 0 });
		await runNtn({ subcommand: "api /v1/pages", method: "POST" }, exec);
		expect(exec.calls[0][1]).toContain("--method");
		expect(exec.calls[0][1]).toContain("POST");
	});
});

describe("runNtn tolerance", () => {
	test("A3.1 mode#1 array args → correct argv passed to exec, isError false", async () => {
		const exec = makeFakeExec({ stdout: "ok", code: 0 });
		const res = await runNtn({
			subcommand: "api",
			args: ["/v1/search", "--data", '{"query":"meeting notes"}'],
			data: '{"query":"meeting notes"}',
		}, exec);
		expect(res.isError).toBe(false);
		expect(exec.calls[0][1]).toEqual(["api", "/v1/search", "--data", '{"query":"meeting notes"}']);
	});

	test("A3.2 mode#2 nested args → correct argv passed to exec, isError false", async () => {
		const exec = makeFakeExec({ stdout: "ok", code: 0 });
		const res = await runNtn({
			args: {
				subcommand: "api /v1/search",
				data: '{"query":"meeting notes"}',
			},
		}, exec);
		expect(res.isError).toBe(false);
		expect(exec.calls[0][1]).toEqual(["api", "/v1/search", "--data", '{"query":"meeting notes"}']);
	});

	test("A3.3 dangerous command nested in args is still refused", async () => {
		const exec = makeFakeExec({ stdout: "", code: 0 });
		await expect(
			runNtn({ args: { subcommand: "pages trash" } }, exec),
		).rejects.toThrow(/pages trash/);
		expect(exec.calls).toHaveLength(0);
	});
});

// --- Integration tests (opt-in) ---
// Gated by TEST_INTEGRATION=1. Skipped by default so CI runs don't need ntn.
// When enabled + ntn authed, these validate the full buildArgv→exec→formatOutput
// pipeline against the real ntn binary's flag parser.

const realExec: NtnExec = async (cmd, args, opts) => {
	const proc = Bun.spawn([cmd, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		signal: opts.signal,
	});
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const code = await proc.exited;
	return { stdout, stderr, code };
};

describe("integration (real ntn)", () => {
	test.skipIf(!process.env.TEST_INTEGRATION)("1. ntn whoami succeeds", async () => {
		const res = await runNtn({ subcommand: "whoami" }, realExec);
		expect(res.isError).toBe(false);
	});

	test("2. ntn whoami --plain serialization (always runs, no auth needed for flag parsing)", async () => {
		// This is a unit test that builds argv but does NOT exec — kept here for visibility.
		expect(buildArgv({ subcommand: "whoami", args: { plain: true } })).toEqual(["whoami", "--plain"]);
	});

	test.skipIf(!process.env.TEST_INTEGRATION)("3. ntn api /v1/search --data serialization", async () => {
		const res = await runNtn({
			subcommand: "api /v1/search",
			data: '{"query":"test"}',
		}, realExec);
		// May return results or error, but should not throw
		expect(res).toBeDefined();
	});
});
