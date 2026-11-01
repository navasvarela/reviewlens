import { inflateRawSync } from "node:zlib"

export interface ZipEntry {
  readonly name: string
  readonly text: string
}

export interface ZipLimits {
  /** Decides which entries get decompressed, so unrelated files in an archive cost nothing. */
  readonly accept: (name: string) => boolean
  readonly maxEntryBytes: number
}

const END_OF_DIRECTORY_SIGNATURE = 0x06054b50
const DIRECTORY_ENTRY_SIGNATURE = 0x02014b50
const LOCAL_HEADER_SIGNATURE = 0x04034b50
const END_OF_DIRECTORY_SIZE = 22
// The end record is followed by a comment of at most this length, so it is searched for backwards.
const MAX_ZIP_COMMENT_BYTES = 0xffff
const DIRECTORY_ENTRY_SIZE = 46
const LOCAL_HEADER_SIZE = 30
const STORED = 0
const DEFLATED = 8

/**
 * Reads text files from a zip held in memory. Written against `node:zlib` rather than a zip
 * library because only this small part of the format is needed, and `maxOutputLength` stops a
 * decompression bomb however the archive describes its own sizes: an artifact is written by the
 * PR's code, so nothing in it is trusted. Nothing is written to disk, so entry names like
 * `../../x` have no effect. Entries that can't be read are left out.
 */
export function readZipEntries(zip: Buffer, limits: ZipLimits): ZipEntry[] {
  const directory = findDirectory(zip)
  if (directory === undefined) return []
  const entries: ZipEntry[] = []
  let offset = directory.offset
  for (let index = 0; index < directory.count; index++) {
    if (offset + DIRECTORY_ENTRY_SIZE > zip.length || zip.readUInt32LE(offset) !== DIRECTORY_ENTRY_SIGNATURE) break
    const nameLength = zip.readUInt16LE(offset + 28)
    const name = zip.toString("utf8", offset + DIRECTORY_ENTRY_SIZE, offset + DIRECTORY_ENTRY_SIZE + nameLength)
    if (limits.accept(name)) {
      const text = readEntry(zip, zip.readUInt16LE(offset + 10), zip.readUInt32LE(offset + 20), zip.readUInt32LE(offset + 42), limits.maxEntryBytes)
      if (text !== undefined) entries.push({ name, text })
    }
    offset += DIRECTORY_ENTRY_SIZE + nameLength + zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32)
  }
  return entries
}

function findDirectory(zip: Buffer): { readonly offset: number; readonly count: number } | undefined {
  const lowest = Math.max(0, zip.length - END_OF_DIRECTORY_SIZE - MAX_ZIP_COMMENT_BYTES)
  for (let offset = zip.length - END_OF_DIRECTORY_SIZE; offset >= lowest; offset--) {
    if (zip.readUInt32LE(offset) === END_OF_DIRECTORY_SIGNATURE) return { count: zip.readUInt16LE(offset + 10), offset: zip.readUInt32LE(offset + 16) }
  }
  return undefined
}

function readEntry(zip: Buffer, method: number, compressedSize: number, headerOffset: number, maxBytes: number): string | undefined {
  if (headerOffset + LOCAL_HEADER_SIZE > zip.length || zip.readUInt32LE(headerOffset) !== LOCAL_HEADER_SIGNATURE) return undefined
  // The local header's own name and extra lengths can differ from the directory's.
  const start = headerOffset + LOCAL_HEADER_SIZE + zip.readUInt16LE(headerOffset + 26) + zip.readUInt16LE(headerOffset + 28)
  const data = zip.subarray(start, start + compressedSize)
  if (method === STORED) return data.length > maxBytes ? undefined : data.toString("utf8")
  if (method !== DEFLATED) return undefined
  try {
    return inflateRawSync(data, { maxOutputLength: maxBytes }).toString("utf8")
  } catch {
    return undefined
  }
}
