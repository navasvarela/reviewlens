import { Component } from "react"
import type { ReactElement, ReactNode } from "react"

interface ErrorBoundaryProps {
  readonly children: ReactNode
}

interface ErrorBoundaryState {
  readonly message: string | undefined
}

/**
 * Without this, an error while rendering makes React clear the page, leaving a blank
 * screen with nothing to report. React only offers this hook on class components.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { message: undefined }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { message: error instanceof Error ? error.message : String(error) }
  }

  override render(): ReactNode {
    return this.state.message === undefined ? this.props.children : <RenderFailure message={this.state.message} />
  }
}

function RenderFailure({ message }: { readonly message: string }): ReactElement {
  return <p className="notice notice-error">This report could not be displayed: {message}</p>
}
