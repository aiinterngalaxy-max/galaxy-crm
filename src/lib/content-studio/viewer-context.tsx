import { createContext, useContext } from 'react'
import type { TeamMember } from '@/types/content-studio'

interface ViewerCtx {
  viewer: TeamMember | null
  setViewer: (m: TeamMember | null) => void
  team: TeamMember[]
}

export const ViewerContext = createContext<ViewerCtx>({
  viewer: null,
  setViewer: () => {},
  team: [],
})

export function useViewer() {
  return useContext(ViewerContext)
}
