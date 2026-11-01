import type { AiDestination } from "@walkdiff/review-model"
import type { RawAiOutput } from "./output.ts"

export interface TokenUsage {
  readonly inputTokens: number
  readonly outputTokens: number
}

export interface AiCompletion {
  readonly output: RawAiOutput
  /** The model that answered; differs from the requested one when a fallback ran. */
  readonly model: string
  readonly usage: TokenUsage
}

/** A model backend. Implementations map their own failures to `AiUnavailableError`. */
export interface AiProvider {
  readonly model: string
  /** Where prompts go, so a team's rules can allow or forbid it. */
  readonly destination: AiDestination
  complete(system: string, prompt: string): Promise<AiCompletion>
  /** Checks that the provider answers and accepts the credentials, without sending any code. */
  checkConnection(): Promise<void>
}

/** The review could not be produced; the message is shown to the user as the reason. */
export class AiUnavailableError extends Error {
  override readonly name = "AiUnavailableError"
}
