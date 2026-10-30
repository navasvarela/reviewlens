import { afterEach, describe, expect, it, vi } from "vitest"
import { findVulnerabilities } from "./osv.ts"
import { Ecosystem, lockfileFormatFor, manifestFormatFor } from "./packages.ts"

describe("manifest parsing", () => {
  it.each([
    ["package.json", '{"dependencies":{"left-pad":"^1.3.0"},"devDependencies":{"vitest":"^5.0.0"}}', [["left-pad", "^1.3.0"], ["vitest", "^5.0.0"]]],
    ["crates/x/Cargo.toml", '[dependencies]\nserde = "1"\ntokio = { version = "1.40", features = ["full"] }\n[dev-dependencies]\ninsta = "1"\n', [["serde", "1"], ["tokio", "1.40"], ["insta", "1"]]],
    ["pyproject.toml", '[project]\ndependencies = ["Requests[socks]>=2.31", "pydantic"]\n', [["requests", ">=2.31"], ["pydantic", "*"]]],
    ["requirements-dev.txt", "# tools\n-r requirements.txt\nblack==24.8.0\nruff>=0.6 ; python_version > '3.9'\n", [["black", "==24.8.0"], ["ruff", ">=0.6"]]],
  ])("reads declared dependencies from %s", (path, text, expected) => {
    expect([...(manifestFormatFor(path)?.parse(text) ?? [])]).toEqual(expected)
  })
})

describe("lockfile parsing", () => {
  it("reads exact versions from package-lock.json, including nested installs", () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: { "": { name: "app" }, "node_modules/lodash": { version: "4.17.20" }, "node_modules/a/node_modules/@scope/b": { version: "2.0.0" } },
    })
    expect(lockfileFormatFor("package-lock.json")?.parse(lock)).toEqual([
      { ecosystem: Ecosystem.Npm, name: "lodash", version: "4.17.20" },
      { ecosystem: Ecosystem.Npm, name: "@scope/b", version: "2.0.0" },
    ])
  })

  it("reads Cargo.lock and normalizes Python names in uv.lock", () => {
    expect(lockfileFormatFor("Cargo.lock")?.parse('[[package]]\nname = "time"\nversion = "0.1.45"\n')).toEqual([
      { ecosystem: Ecosystem.Crates, name: "time", version: "0.1.45" },
    ])
    expect(lockfileFormatFor("uv.lock")?.parse('[[package]]\nname = "PyYAML"\nversion = "5.3"\n')).toEqual([
      { ecosystem: Ecosystem.PyPI, name: "pyyaml", version: "5.3" },
    ])
  })
})

describe("findVulnerabilities", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("queries OSV in a batch and reads severity and the fixed version", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/querybatch")) {
        return Response.json({ results: [{ vulns: [{ id: "GHSA-1234" }] }, {}] })
      }
      return Response.json({
        id: "GHSA-1234",
        summary: "Prototype pollution",
        aliases: ["CVE-2020-8203"],
        database_specific: { severity: "HIGH" },
        affected: [{ package: { name: "lodash", ecosystem: "npm" }, ranges: [{ events: [{ introduced: "0" }, { fixed: "4.17.21" }] }] }],
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    const found = await findVulnerabilities([
      { ecosystem: Ecosystem.Npm, name: "lodash", version: "4.17.20" },
      { ecosystem: Ecosystem.Npm, name: "safe", version: "1.0.0" },
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(found).toEqual([
      {
        package: { ecosystem: "npm", name: "lodash", version: "4.17.20" },
        vulnerability: { id: "GHSA-1234", aliases: ["CVE-2020-8203"], summary: "Prototype pollution", severity: "high", fixedIn: "4.17.21" },
      },
    ])
  })
})
