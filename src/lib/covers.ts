export interface Cover {
  name: string
  css: string
}

/** Alpine light, bottled: layered gradients, no image assets. */
export const COVERS: Record<string, Cover> = {
  alpenglow: {
    name: 'Alpenglow',
    css: `radial-gradient(120% 95% at 12% 0%, rgba(255,226,196,0.95) 0%, rgba(255,226,196,0) 55%),
          radial-gradient(95% 90% at 85% 8%, rgba(244,158,116,0.85) 0%, rgba(244,158,116,0) 60%),
          linear-gradient(165deg, #EBA98E 0%, #D08596 45%, #8B7BA8 82%, #6B6F9C 100%)`,
  },
  glacier: {
    name: 'Glacier',
    css: `radial-gradient(110% 90% at 18% 5%, rgba(235,248,250,0.95) 0%, rgba(235,248,250,0) 55%),
          radial-gradient(90% 85% at 88% 15%, rgba(148,205,213,0.8) 0%, rgba(148,205,213,0) 60%),
          linear-gradient(160deg, #BFE0E4 0%, #8FB8C9 55%, #5F7F9E 100%)`,
  },
  spruce: {
    name: 'Spruce',
    css: `radial-gradient(100% 90% at 15% 0%, rgba(122,168,150,0.75) 0%, rgba(122,168,150,0) 55%),
          radial-gradient(90% 80% at 85% 10%, rgba(56,96,82,0.6) 0%, rgba(56,96,82,0) 60%),
          linear-gradient(165deg, #4E7D6C 0%, #35594E 55%, #22392F 100%)`,
  },
  midnight: {
    name: 'Midnight',
    css: `radial-gradient(100% 95% at 80% 0%, rgba(96,110,158,0.75) 0%, rgba(96,110,158,0) 55%),
          radial-gradient(80% 75% at 15% 15%, rgba(58,68,108,0.85) 0%, rgba(58,68,108,0) 60%),
          linear-gradient(170deg, #2B3252 0%, #1D2238 55%, #121523 100%)`,
  },
  snowfield: {
    name: 'Snowfield',
    css: `radial-gradient(110% 90% at 20% 0%, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0) 60%),
          radial-gradient(90% 80% at 85% 20%, rgba(196,214,228,0.85) 0%, rgba(196,214,228,0) 60%),
          linear-gradient(165deg, #EDF3F7 0%, #D4E0EA 55%, #AFC3D4 100%)`,
  },
  granite: {
    name: 'Granite',
    css: `radial-gradient(110% 90% at 15% 0%, rgba(214,216,214,0.9) 0%, rgba(214,216,214,0) 55%),
          radial-gradient(85% 80% at 85% 12%, rgba(148,152,150,0.75) 0%, rgba(148,152,150,0) 60%),
          linear-gradient(165deg, #B9BDBB 0%, #8E9492 55%, #62696B 100%)`,
  },
  moraine: {
    name: 'Moraine',
    css: `radial-gradient(110% 90% at 18% 0%, rgba(233,220,203,0.9) 0%, rgba(233,220,203,0) 55%),
          radial-gradient(85% 80% at 85% 12%, rgba(190,164,138,0.8) 0%, rgba(190,164,138,0) 60%),
          linear-gradient(165deg, #C8B39C 0%, #A08B76 55%, #6F6156 100%)`,
  },
  aurora: {
    name: 'Aurora',
    css: `radial-gradient(100% 110% at 25% 0%, rgba(110,214,180,0.8) 0%, rgba(110,214,180,0) 55%),
          radial-gradient(90% 90% at 80% 10%, rgba(120,140,220,0.7) 0%, rgba(120,140,220,0) 60%),
          linear-gradient(165deg, #3E8F7C 0%, #35608C 55%, #23294A 100%)`,
  },
}

export const COVER_KEYS = Object.keys(COVERS)

export const randomCover = () => COVER_KEYS[Math.floor(Math.random() * COVER_KEYS.length)]
