import { create } from 'zustand'

/**
 * Coarse app clock, deliberately NOT persisted and NOT in the main store:
 * zustand's persist middleware rewrites localStorage on every set, so a
 * periodic tick inside a persisted store would let an idle background tab
 * clobber fresher state written by another tab.
 */
interface ClockState {
  nowTick: number
  tick: () => void
}

export const useClock = create<ClockState>(set => ({
  nowTick: Date.now(),
  tick: () => set({ nowTick: Date.now() }),
}))
