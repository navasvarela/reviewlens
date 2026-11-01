import { execFile } from "node:child_process"

type Environment = Readonly<Record<string, string | undefined>>

export interface BrowserCommand {
  readonly command: string
  readonly args: readonly string[]
}

const WINDOWS_PLATFORM = "win32"
const MAC_PLATFORM = "darwin"

/** The system's own way to open a link in the default browser. */
export function browserCommand(platform: string, url: string): BrowserCommand {
  if (platform === MAC_PLATFORM) return { command: "open", args: [url] }
  // `start` is built into cmd, and its first quoted argument is a window title, hence the empty one.
  if (platform === WINDOWS_PLATFORM) return { command: "cmd", args: ["/c", "start", "", url] }
  return { command: "xdg-open", args: [url] }
}

/** Opening a browser only helps someone sitting at this machine, so CI and SSH sessions skip it. */
export function canOpenBrowser(platform: string, env: Environment): boolean {
  if (isSet(env.CI) || isSet(env.SSH_CONNECTION) || isSet(env.SSH_TTY)) return false
  if (platform === MAC_PLATFORM || platform === WINDOWS_PLATFORM) return true
  return isSet(env.DISPLAY) || isSet(env.WAYLAND_DISPLAY)
}

function isSet(value: string | undefined): boolean {
  return value !== undefined && value !== ""
}

/** A failure is only worth a mention: the address is already printed, so nothing is lost. */
export function openBrowser(url: string, log: (message: string) => void): void {
  const { command, args } = browserCommand(process.platform, url)
  execFile(command, [...args], (error) => {
    if (error !== null) log(`Couldn't open your browser, so open ${url} yourself.`)
  })
}
