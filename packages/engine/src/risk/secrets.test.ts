import { describe, expect, it } from "vitest"
import { isSecretFile, redactSecrets, redactSecretsInText } from "./secrets.ts"

// Built from parts so secret scanners do not flag these fake values in the repository.
const AWS_KEY = ["AKIA", "Q3EGUJKLMNOPQRST"].join("")
const GITHUB_TOKEN = ["ghp", "_", "a1B2c3D4".repeat(4), "e5F6"].join("")
const PRIVATE_KEY_LABEL = ["PRIVATE", "KEY"].join(" ")

describe("redactSecrets", () => {
  it("hides every credential on a line", () => {
    const line = redactSecrets(`a="${AWS_KEY}" b="${AWS_KEY}" c="${GITHUB_TOKEN}"`)
    expect(line).not.toContain(AWS_KEY)
    expect(line).not.toContain(GITHUB_TOKEN)
  })

  it("leaves ordinary code and placeholders alone", () => {
    expect(redactSecrets("const total = price * 2")).toBe("const total = price * 2")
    expect(redactSecrets('password = "changeme"')).toBe('password = "changeme"')
  })
})

describe("redactSecretsInText", () => {
  it("hides a private key's body and keeps every line in place", () => {
    const text = ["before", `-----BEGIN RSA ${PRIVATE_KEY_LABEL}-----`, "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC", `-----END RSA ${PRIVATE_KEY_LABEL}-----`, "after"].join("\n")
    const lines = redactSecretsInText(text).split("\n")
    expect(lines).toHaveLength(5)
    expect(lines.at(0)).toBe("before")
    expect(lines.at(4)).toBe("after")
    expect(lines.join("\n")).not.toContain("MIIEvQ")
  })
})

describe("isSecretFile", () => {
  it.each([".env", ".env.production", "config/.env.local", "certs/server.pem", "tls.key", "id_ed25519", "credentials.json", "k8s/secrets.yaml", ".npmrc"])("treats %s as holding credentials", (path) => {
    expect(isSecretFile(path)).toBe(true)
  })

  it.each([".env.example", ".env.sample", "src/env.ts", "keyboard.ts", "docs/secrets.md", "src/key.tsx"])("does not treat %s as holding credentials", (path) => {
    expect(isSecretFile(path)).toBe(false)
  })
})
