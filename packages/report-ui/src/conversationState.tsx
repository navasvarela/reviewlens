import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import type { ReactElement, ReactNode } from "react"
import type { Conversation } from "@walkdiff/review-model"
import { isConnectedToApp, loadConversation } from "./appApi.ts"

export type ConversationLoad =
  | { readonly status: "unavailable" }
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly conversation: Conversation }
  | { readonly status: "failed"; readonly message: string }

interface ConversationState {
  readonly load: ConversationLoad
  readonly reload: () => Promise<void>
}

const ConversationContext = createContext<ConversationState>({ load: { status: "unavailable" }, reload: () => Promise.resolve() })

export function useConversation(): ConversationLoad {
  return useContext(ConversationContext).load
}

export function useReloadConversation(): () => Promise<void> {
  return useContext(ConversationContext).reload
}

/** Reads the discussion from the host once a page opens. The host stays the record, so none of it is kept. */
export function ConversationProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const [load, setLoad] = useState<ConversationLoad>(isConnectedToApp() ? { status: "loading" } : { status: "unavailable" })
  const reload = useCallback(async (): Promise<void> => {
    if (!isConnectedToApp()) return
    try {
      setLoad({ status: "loaded", conversation: await loadConversation() })
    } catch (error: unknown) {
      setLoad({ status: "failed", message: error instanceof Error ? error.message : String(error) })
    }
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])
  const value = useMemo(() => ({ load, reload }), [load, reload])
  return <ConversationContext.Provider value={value}>{children}</ConversationContext.Provider>
}
