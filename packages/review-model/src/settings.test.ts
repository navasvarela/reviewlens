import { describe, expect, it } from "vitest"
import { aiSettingsSchema, appSettingsSchema, baseUrlProblem, DEFAULT_APP_SETTINGS } from "./settings.ts"

const compatible = (baseUrl: string | null): unknown => ({ provider: "openaiCompatible", model: "m", baseUrl, maxInputTokens: 1000, enabledByDefault: false })

describe("AI provider addresses", () => {
  it.each(["https://api.openai.com/v1", "http://localhost:11434/v1", "http://127.0.0.1:8080", "http://[::1]:8080/v1"])("accepts %s", (url) => {
    expect(baseUrlProblem(url)).toBeUndefined()
    expect(aiSettingsSchema.safeParse(compatible(url)).success).toBe(true)
  })

  it.each(["http://api.example.com/v1", "http://localhost.evil.example/v1", "ftp://localhost", "not a url"])("refuses %s, as it would expose code and the key", (url) => {
    expect(baseUrlProblem(url)).toBeDefined()
    expect(aiSettingsSchema.safeParse(compatible(url)).success).toBe(false)
  })

  it("needs an address for an OpenAI-compatible provider, but not for Anthropic", () => {
    expect(aiSettingsSchema.safeParse(compatible(null)).success).toBe(false)
    expect(aiSettingsSchema.safeParse(DEFAULT_APP_SETTINGS.ai).success).toBe(true)
  })
})

describe("settings", () => {
  it("keeps AI off by default, with every check on", () => {
    expect(DEFAULT_APP_SETTINGS.ai.enabledByDefault).toBe(false)
    expect(DEFAULT_APP_SETTINGS.disabledChecks).toEqual([])
  })

  it("has nowhere to put an API key", () => {
    const parsed = appSettingsSchema.parse({ ...DEFAULT_APP_SETTINGS, ai: { ...DEFAULT_APP_SETTINGS.ai, apiKey: "secret" }, apiKey: "secret" })
    expect(JSON.stringify(parsed)).not.toContain("secret")
  })

  it("refuses unknown checks and an empty model", () => {
    expect(appSettingsSchema.safeParse({ ...DEFAULT_APP_SETTINGS, disabledChecks: ["secrets"] }).success).toBe(false)
    expect(aiSettingsSchema.safeParse({ ...DEFAULT_APP_SETTINGS.ai, model: "  " }).success).toBe(false)
  })
})
