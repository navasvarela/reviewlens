import { describe, expect, it } from "vitest"
import { lensConfigSchema } from "./lensConfig.ts"

const parseLensConfig = (text: string) => lensConfigSchema.parse(JSON.parse(text))

describe("scanner settings in .lens.json", () => {
  it.each([
    ["{}", ["p/default"]],
    ['{"scanners":{}}', ["p/default"]],
    ['{"scanners":{"semgrep":{"rules":[]}}}', []],
    ['{"scanners":{"semgrep":{"rules":["p/owasp-top-ten","r/python.lang.x"]}}}', ["p/owasp-top-ten", "r/python.lang.x"]],
  ])("reads %s", (text, rules) => {
    expect(parseLensConfig(text).scanners.semgrep.rules).toEqual(rules)
  })

  it.each(["./rules.yml", "https://evil.example/rules.yml", "--dump-engine-path"])("rejects %s, which is not a registry rule pack", (rule) => {
    expect(() => parseLensConfig(JSON.stringify({ scanners: { semgrep: { rules: [rule] } } }))).toThrow()
  })
})
