import { createServer } from "node:http"
import type { IncomingMessage, Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AI_API_KEY_VARIABLE, OpenAiCompatibleProvider } from "./openAiCompatibleProvider.ts"
import { createAiProvider } from "./createAiProvider.ts"
import { AiUnavailableError } from "./provider.ts"

const OUTPUT = { chapters: [], intent: [], questions: [] }

interface Seen {
  path: string
  authorization: string | undefined
  body: unknown
}

describe("OpenAiCompatibleProvider against a local stand-in", () => {
  let server: Server
  let baseUrl = ""
  let seen: Seen = { path: "", authorization: undefined, body: undefined }
  let reply: { status: number; body: unknown; location?: string } = { status: 200, body: {} }

  beforeAll(async () => {
    server = createServer((request, response) => {
      void readBody(request).then((text) => {
        seen = { path: request.url ?? "", authorization: request.headers.authorization, body: text === "" ? undefined : JSON.parse(text) }
        response.writeHead(reply.status, { "Content-Type": "application/json", ...(reply.location === undefined ? {} : { Location: reply.location }) })
        response.end(JSON.stringify(reply.body))
      })
    })
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
    const address: AddressInfo | string | null = server.address()
    baseUrl = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}/v1/`
  })
  afterAll(() => new Promise<void>((done) => server.close(() => done())))

  const provider = (apiKey?: string): OpenAiCompatibleProvider => new OpenAiCompatibleProvider({ model: "llama3.2", baseUrl, apiKey })

  it("sends the prompt and key, and reads a structured answer", async () => {
    reply = { status: 200, body: { model: "llama3.2:latest", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(OUTPUT) } }], usage: { prompt_tokens: 7, completion_tokens: 3 } } }
    const completion = await provider("secret").complete("system text", "prompt text")
    expect(completion).toEqual({ output: OUTPUT, model: "llama3.2:latest", usage: { inputTokens: 7, outputTokens: 3 } })
    expect(seen.path).toBe("/v1/chat/completions")
    expect(seen.authorization).toBe("Bearer secret")
    expect(JSON.stringify(seen.body)).toContain("prompt text")
    expect(JSON.stringify(seen.body)).toContain("json_schema")
  })

  it("sends no authorization header without a key, and copes without usage figures", async () => {
    reply = { status: 200, body: { choices: [{ message: { content: JSON.stringify(OUTPUT) } }] } }
    const completion = await provider().complete("s", "p")
    expect(seen.authorization).toBeUndefined()
    expect(completion.usage).toEqual({ inputTokens: 0, outputTokens: 0 })
    expect(completion.model).toBe("llama3.2")
  })

  it.each([
    ["an error status", { status: 500, body: { error: "boom" } }, "answered 500"],
    ["a rejected key", { status: 401, body: {} }, AI_API_KEY_VARIABLE],
    ["an unexpected shape", { status: 200, body: { nope: true } }, "unexpected format"],
    ["answer text that isn't JSON", { status: 200, body: { choices: [{ message: { content: "Sure!" } }] } }, "expected review format"],
    ["JSON of the wrong shape", { status: 200, body: { choices: [{ message: { content: "{}" } }] } }, "expected review format"],
    ["a cut-off answer", { status: 200, body: { choices: [{ finish_reason: "length", message: { content: "{" } }] } }, "cut off"],
  ])("reports %s as unavailable", async (_name, answer, message) => {
    reply = answer
    const attempt = provider().complete("s", "p")
    await expect(attempt).rejects.toThrow(AiUnavailableError)
    await expect(attempt).rejects.toThrow(message)
  })

  it("refuses a redirect, which would send code and the key elsewhere", async () => {
    reply = { status: 302, body: {}, location: "http://127.0.0.1:1/steal" }
    await expect(provider("secret").complete("s", "p")).rejects.toThrow(AiUnavailableError)
  })

  it("checks the connection without sending code", async () => {
    reply = { status: 200, body: { data: [] } }
    await provider().checkConnection()
    expect(seen.path).toBe("/v1/models")
    expect(seen.body).toBeUndefined()
  })

  it("reports an unreachable provider", async () => {
    const closed = new OpenAiCompatibleProvider({ model: "m", baseUrl: "http://127.0.0.1:1/v1", apiKey: undefined })
    await expect(closed.checkConnection()).rejects.toThrow("could not reach a model on this machine")
  })
})

describe("createAiProvider", () => {
  const compatible = { provider: "openaiCompatible", model: "m", maxInputTokens: 1, enabledByDefault: false } as const

  it("describes where the code goes", () => {
    expect(createAiProvider({ provider: "anthropic", model: "m", baseUrl: null, maxInputTokens: 1, enabledByDefault: false }, {}).destination.label).toBe("Anthropic")
    expect(createAiProvider({ ...compatible, baseUrl: "https://api.openai.com/v1" }, {}).destination).toEqual({ label: "api.openai.com", isLocal: false, ids: ["api.openai.com"] })
    expect(createAiProvider({ ...compatible, baseUrl: "http://localhost:11434/v1" }, {}).destination).toEqual({ label: "a model on this machine", isLocal: true, ids: ["localhost:11434", "local"] })
  })
})

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((done) => {
    let text = ""
    request.on("data", (chunk: Buffer) => (text += chunk.toString()))
    request.on("end", () => done(text))
  })
}
