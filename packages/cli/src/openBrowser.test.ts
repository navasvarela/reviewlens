import { describe, expect, it } from "vitest"
import { browserCommand, canOpenBrowser } from "./openBrowser.ts"

const URL = "http://127.0.0.1:4317/"

describe("browserCommand", () => {
  it.each([
    ["darwin", { command: "open", args: [URL] }],
    ["linux", { command: "xdg-open", args: [URL] }],
    ["win32", { command: "cmd", args: ["/c", "start", "", URL] }],
  ])("uses the system's opener on %s", (platform, command) => {
    expect(browserCommand(platform, URL)).toEqual(command)
  })
})

describe("canOpenBrowser", () => {
  it.each([
    ["a Mac", "darwin", {}, true],
    ["Windows", "win32", {}, true],
    ["Linux with a display", "linux", { DISPLAY: ":0" }, true],
    ["Linux with Wayland", "linux", { WAYLAND_DISPLAY: "wayland-0" }, true],
    ["Linux without a display", "linux", {}, false],
    ["CI", "darwin", { CI: "true" }, false],
    ["an SSH session", "darwin", { SSH_CONNECTION: "1.2.3.4 1 5.6.7.8 22" }, false],
    ["an SSH terminal", "linux", { DISPLAY: ":0", SSH_TTY: "/dev/pts/0" }, false],
  ])("on %s", (_name, platform, env, expected) => {
    expect(canOpenBrowser(platform, env)).toBe(expected)
  })
})
