import type { ReactElement } from "react"

/** Shows text marked as `code`, such as a finding's title. React escapes it, so it's safe from a PR. */
export function InlineCode({ text }: { readonly text: string }): ReactElement {
  return (
    <>
      {text.split("`").map((part, index) => (index % 2 === 1 ? <code key={index}>{part}</code> : <span key={index}>{part}</span>))}
    </>
  )
}
