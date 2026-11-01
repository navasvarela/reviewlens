import { describe, expect, it } from "vitest"
import { walkdiffConfigSchema } from "./walkdiffConfig.ts"

const parseWalkdiffConfig = (text: string) => walkdiffConfigSchema.parse(JSON.parse(text))

describe("scanner settings in .walkdiff.json", () => {
  it.each([
    ["{}", ["p/default"]],
    ['{"scanners":{}}', ["p/default"]],
    ['{"scanners":{"semgrep":{"rules":[]}}}', []],
    ['{"scanners":{"semgrep":{"rules":["p/owasp-top-ten","r/python.lang.x"]}}}', ["p/owasp-top-ten", "r/python.lang.x"]],
  ])("reads %s", (text, rules) => {
    expect(parseWalkdiffConfig(text).scanners.semgrep.rules).toEqual(rules)
  })

  it.each(["./rules.yml", "https://evil.example/rules.yml", "--dump-engine-path"])("rejects %s, which is not a registry rule pack", (rule) => {
    expect(() => parseWalkdiffConfig(JSON.stringify({ scanners: { semgrep: { rules: [rule] } } }))).toThrow()
  })
})
