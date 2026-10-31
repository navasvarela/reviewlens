import { execFile } from "node:child_process"

export interface ProcessResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

/** Runs a scanner; undefined means its binary is not installed. Injected so tests need no scanners. */
export type ScannerProcessRunner = (binary: string, args: readonly string[], cwd: string) => Promise<ProcessResult | undefined>

// Semgrep's first run downloads rules, and large PRs take a while; past this, report it as not run.
const SCANNER_TIMEOUT_MS = 5 * 60 * 1000
const MAX_SCANNER_OUTPUT_BYTES = 256 * 1024 * 1024
// A scanner reads untrusted code and has no need for the user's tokens, so it gets only these.
const INHERITED_VARIABLES: readonly string[] = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "SSL_CERT_FILE"]

export const runScannerProcess: ScannerProcessRunner = (binary, args, cwd) =>
  new Promise((resolve) => {
    const env: Record<string, string> = { SEMGREP_SEND_METRICS: "off" }
    for (const name of INHERITED_VARIABLES) {
      const value = process.env[name]
      if (value !== undefined) env[name] = value
    }
    execFile(binary, [...args], { cwd, env, timeout: SCANNER_TIMEOUT_MS, maxBuffer: MAX_SCANNER_OUTPUT_BYTES, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error === null) {
        resolve({ exitCode: 0, stdout, stderr })
        return
      }
      if (error.code === "ENOENT") {
        resolve(undefined)
        return
      }
      // A timeout or signal has no numeric code; -1 lands in each scanner's failure path.
      resolve({ exitCode: typeof error.code === "number" ? error.code : -1, stdout, stderr: stderr || error.message })
    })
  })

/** The first line of a scanner's error output, for showing why it did not run. */
export function firstErrorLine(result: ProcessResult): string {
  return result.stderr.split("\n").find((line) => line.trim() !== "")?.trim().slice(0, 200) ?? `exit code ${result.exitCode}`
}
