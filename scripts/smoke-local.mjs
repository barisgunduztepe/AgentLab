import ts from "typescript";
import { mkdtemp, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, relative, isAbsolute, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage: npm run smoke:local [-- --check | [--scenario <document-chain-v1|document-conflict-v1|document-calculation-v1>] [--record]]\nSet OPENAI_COMPATIBLE_BASE_URL and OPENAI_COMPATIBLE_MODEL for an already running loopback server with an installed model. Optional OPENAI_COMPATIBLE_API_KEY. --check only lists installed models; no generation. --record saves sanitized real responses under src/agent/providers/fixtures/local. No downloads and no user history writes.");
} else {
  // Compile the existing extensionless TS imports using the already installed TypeScript.
  // CommonJS resolves dependencies from the repository via NODE_PATH in this child only.
  const directory = await mkdtemp(join(tmpdir(), "agentlab-local-smoke-"));
  try {
    const program = ts.createProgram([join(root, "scripts/local-smoke-runner.ts")], {
      rootDir: root, outDir: directory, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Node10, strict: true, esModuleInterop: true,
      skipLibCheck: true, types: ["node"], typeRoots: [join(root, "node_modules/@types")],
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    if (diagnostics.length) {
      console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCurrentDirectory: () => root, getCanonicalFileName: (file) => file, getNewLine: () => "\n",
      })); process.exitCode = 1;
    } else {
      const emitted = program.emit();
      if (emitted.emitSkipped) throw new Error("Smoke compilation failed.");
      const result = spawnSync(process.execPath, [join(directory, "scripts/local-smoke-runner.js"), ...args], {
        cwd: root, stdio: "inherit", windowsHide: true,
        env: { ...process.env, LOCALAPPDATA: directory, XDG_DATA_HOME: directory,
          NODE_PATH: [join(root, "node_modules"), process.env.NODE_PATH].filter(Boolean).join(delimiter) },
      });
      process.exitCode = result.status ?? 1;
    }
  } catch {
    console.error("Local smoke could not start. No user history was written."); process.exitCode = 1;
  } finally {
    // Delete only the fresh temporary directory owned by this invocation.
    const target = await realpath(directory);
    const parent = await realpath(tmpdir());
    const inside = relative(parent, target);
    if (!inside.startsWith("..") && !isAbsolute(inside) && inside.startsWith("agentlab-local-smoke-")) {
      await rm(resolve(target), { recursive: true, force: true });
    }
  }
}
