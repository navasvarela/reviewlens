import { deflateRawSync } from "node:zlib"
import type { FileDiff } from "@walkdiff/review-model"
import { describe, expect, it } from "vitest"
import { coverageFromArchives } from "./findCoverage.ts"
import { coverageFromReports } from "./readCoverage.ts"
import { readZipEntries } from "./readZip.ts"

const DIFF: FileDiff = {
  status: "modified",
  path: "src/a.ts",
  additions: 2,
  deletions: 0,
  content: {
    kind: "text",
    hunks: [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 2, section: "", lines: [{ kind: "added", content: "x", newLine: 1 }, { kind: "added", content: "y", newLine: 2 }] }],
  },
}
const LCOV = "SF:src/a.ts\nDA:1,3\nDA:2,0\nend_of_record\n"

interface ZipFile {
  readonly name: string
  readonly text: string
  readonly deflate?: boolean
}

/** A minimal archive, as the zip format lays one out. */
function zipOf(files: readonly ZipFile[]): Buffer {
  const locals: Buffer[] = []
  const directory: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name)
    const raw = Buffer.from(file.text)
    const data = file.deflate === false ? raw : deflateRawSync(raw)
    const method = file.deflate === false ? 0 : 8
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(method, 10)
    entry.writeUInt32LE(data.length, 20)
    entry.writeUInt32LE(raw.length, 24)
    entry.writeUInt16LE(name.length, 28)
    entry.writeUInt32LE(offset, 42)
    locals.push(local, name, data)
    directory.push(entry, name)
    offset += local.length + name.length + data.length
  }
  const directoryBytes = Buffer.concat(directory)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directoryBytes.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directoryBytes, end])
}

const everything = { accept: (): boolean => true, maxEntryBytes: 1024 }

describe("readZipEntries", () => {
  it("reads stored and deflated files, leaving out what isn't accepted", () => {
    const zip = zipOf([{ name: "a.txt", text: "one", deflate: false }, { name: "dir/b.txt", text: "two" }, { name: "c.bin", text: "three" }])
    expect(readZipEntries(zip, { ...everything, accept: (name) => name.endsWith(".txt") })).toEqual([{ name: "a.txt", text: "one" }, { name: "dir/b.txt", text: "two" }])
  })

  it("leaves out a file that inflates past the limit, whatever the archive claims", () => {
    expect(readZipEntries(zipOf([{ name: "bomb", text: "0".repeat(100_000) }]), everything)).toEqual([])
  })

  it.each([
    ["not a zip", Buffer.from("this is not an archive, only some text long enough")],
    ["empty", Buffer.alloc(0)],
    ["cut short", zipOf([{ name: "a", text: "one" }]).subarray(0, 12)],
  ])("reads nothing from %s", (_name, zip) => {
    expect(readZipEntries(zip, everything)).toEqual([])
  })
})

describe("coverageFromArchives", () => {
  it("uses the first archive with a report covering this PR, skipping other files", () => {
    const unrelated = { name: "unit-coverage", zip: zipOf([{ name: "index.html", text: "<html>" }, { name: "coverage.xml", text: "<testsuite/>" }]) }
    const useful = { name: "coverage", zip: zipOf([{ name: "deep/folder/lcov.info", text: LCOV }]) }
    expect(coverageFromArchives([unrelated, useful], [DIFF], [])).toEqual({ source: "the coverage artifact in CI", files: [{ path: "src/a.ts", coveredLines: [1], uncoveredLines: [2] }] })
  })

  it("recognizes a report name only through the repository's own pattern", () => {
    const archive = { name: "cov", zip: zipOf([{ name: "out/unit.txt", text: LCOV }]) }
    expect(coverageFromArchives([archive], [DIFF], [])).toBeUndefined()
    expect(coverageFromArchives([archive], [DIFF], ["out/*.txt"])?.files).toHaveLength(1)
  })
})

describe("coverageFromReports", () => {
  it("merges shards, so a line ran if any of them ran it", () => {
    const other = "SF:src/a.ts\nDA:2,1\nend_of_record\n"
    expect(coverageFromReports([{ name: "a", text: LCOV }, { name: "b", text: other }], [DIFF], "s")?.files).toEqual([{ path: "src/a.ts", coveredLines: [1, 2], uncoveredLines: [] }])
  })

  it("finds nothing when reports don't mention a changed file or aren't coverage", () => {
    expect(coverageFromReports([{ name: "a", text: "SF:other.ts\nDA:1,1\nend_of_record\n" }], [DIFF], "s")).toBeUndefined()
    expect(coverageFromReports([{ name: "a", text: "hello" }], [DIFF], "s")).toBeUndefined()
  })
})
