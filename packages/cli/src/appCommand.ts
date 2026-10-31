import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { findInstalledScanners } from "@lens/engine"
import { DEFAULT_AI_MAX_INPUT_TOKENS, DEFAULT_AI_MODEL } from "./args.ts"
import type { AppOptions } from "./args.ts"
import { startAppServer } from "./app/appServer.ts"
import { ReviewService } from "./app/reviewService.ts"
import { ReviewStore } from "./app/reviewStore.ts"
import { defaultCacheDir, defaultDataDir, hostTokensFor, runCommand } from "./environment.ts"
import { writeReport } from "./report.ts"
import { analyzePullRequest, defaultReportDir } from "./reviewCommand.ts"

const DATABASE_FILE = "lens.db"

export interface AppDependencies {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly now: () => Date
  readonly log: (message: string) => void
}

/** Runs the local app until the process is stopped. */
export async function runApp(options: AppOptions, deps: AppDependencies): Promise<void> {
  const cacheDir = options.cacheDir ?? defaultCacheDir(deps.env)
  const dataDir = options.dataDir ?? defaultDataDir(deps.env)
  await mkdir(dataDir, { recursive: true })

  const store = new ReviewStore(join(dataDir, DATABASE_FILE), deps.now)
  store.markInterrupted()
  const service = new ReviewService(
    store,
    async (ref, ai) => {
      const model = await analyzePullRequest(
        ref,
        { network: options.network, ai: ai ? { model: DEFAULT_AI_MODEL, maxInputTokens: DEFAULT_AI_MAX_INPUT_TOKENS } : undefined },
        // Looked up per PR, so a token is only ever asked for the host it belongs to.
        { tokens: await hostTokensFor(ref, deps.env, runCommand), cacheDir, now: deps.now, log: deps.log },
      )
      const reportDir = defaultReportDir(cacheDir, ref)
      await writeReport(model, reportDir)
      return { model, reportDir }
    },
    deps.log,
  )
  const server = await startAppServer(store, service, options.port)
  deps.log(`Lens is running at ${server.url} (Ctrl+C to stop)`)
  const scanners = await findInstalledScanners()
  deps.log(`Security scanners: ${scanners.installed.join(", ") || "none"} installed${scanners.missing.length > 0 ? `; not found: ${scanners.missing.join(", ")}` : ""}`)
}
