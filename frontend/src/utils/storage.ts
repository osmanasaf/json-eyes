import type { ViewMode } from '../types'

/**
 * Tarayici depolamasi. Urun "JSON Sarp" adiyla yayina girdigi icin eski anahtarlar
 * hala kullanicilarin tarayicisinda duruyor; yeni anahtar bossa oradan tasiniyor
 * (yorum silme jetonlari kaybolursa kullanici kendi yorumunu silemez).
 */
const PREFIX = 'json-eyes:'
const LEGACY_PREFIX = 'json-sarp:'

export function readStored(key: string): string | null {
  try {
    const current = localStorage.getItem(PREFIX + key)
    if (current !== null) return current
    const legacy = localStorage.getItem(LEGACY_PREFIX + key)
    if (legacy !== null) localStorage.setItem(PREFIX + key, legacy)
    return legacy
  } catch {
    return null
  }
}

export function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(PREFIX + key, value)
  } catch {
    // localStorage kapali olabilir; kayip yalnizca konforu etkiler.
  }
}

/** Bos durumdaki "Son açılanlar" listesi. */
export interface RecentFile {
  name: string
  /** Ham JSON metninin uzunlugu (byte degil, karakter). */
  size: number
  /** ISO tarih. */
  openedAt: string
  /**
   * Metnin kendisi. Buyuk dosyalar localStorage kotasini doldurdugu icin
   * yalnizca esigin altindakiler saklanir; digerlerinde kullanici dosyayi
   * yeniden secer.
   */
  content?: string
}

const RECENTS_KEY = 'recents'
const RECENTS_LIMIT = 6
/** Bu boyutun ustundeki dosyalarin icerigi saklanmaz (yaklasik 512 KB). */
export const RECENT_CONTENT_LIMIT = 512 * 1024

export function readRecents(): RecentFile[] {
  const raw = readStored(RECENTS_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as RecentFile[]
    return Array.isArray(parsed) ? parsed.slice(0, RECENTS_LIMIT) : []
  } catch {
    return []
  }
}

/** Ayni ad tekrar acildiginda listede yukari tasinir, cogaltilmaz. */
export function pushRecent(name: string, text: string): RecentFile[] {
  const entry: RecentFile = {
    name,
    size: text.length,
    openedAt: new Date().toISOString(),
    content: text.length <= RECENT_CONTENT_LIMIT ? text : undefined,
  }
  const next = [entry, ...readRecents().filter(item => item.name !== name)].slice(0, RECENTS_LIMIT)
  writeStored(RECENTS_KEY, JSON.stringify(next))
  return next
}

export type Theme = 'dark' | 'light'

const THEME_KEY = 'theme'

/**
 * Kayitli tema. Varsayilan **aydinlik**: tasarimin kendi paleti o — sicak
 * kagit zemin, tek font. Karanlik tema ayni token setinden uretiliyor.
 */
export function readTheme(): Theme {
  return readStored(THEME_KEY) === 'dark' ? 'dark' : 'light'
}

export function writeTheme(theme: Theme) {
  writeStored(THEME_KEY, theme)
}

const VIEW_KEY = 'view'

/**
 * Kayitli gorunum. Varsayilan **Grid**: tasarimin ana ekrani o. Anahtarin
 * sirasi da tasarimda kesin — Tree · Grid · Kolon.
 */
export function readViewMode(): ViewMode {
  const stored = readStored(VIEW_KEY)
  return stored === 'tree' || stored === 'columns' ? stored : 'grid'
}

export function writeViewMode(mode: ViewMode) {
  writeStored(VIEW_KEY, mode)
}

export function formatSize(chars: number): string {
  if (chars < 1024) return `${chars} B`
  if (chars < 1024 * 1024) return `${(chars / 1024).toFixed(0)} KB`
  return `${(chars / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

/** "dün", "3 gün önce" gibi kaba goreli zaman; tam tarih tooltip'te kalir. */
export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const days = Math.floor((Date.now() - then) / 86_400_000)
  if (days <= 0) return 'bugün'
  if (days === 1) return 'dün'
  if (days < 7) return `${days} gün önce`
  if (days < 30) return `${Math.floor(days / 7)} hafta önce`
  return `${Math.floor(days / 30)} ay önce`
}

const PANEL_W_KEY = 'editor-width'

/** Girdi panelinin tasarimdaki varsayilan ve sinir genislikleri. */
export const PANEL_W_DEFAULT = 344
export const PANEL_W_MIN = 210
export const PANEL_W_MAX = 760

/**
 * Kayitli girdi paneli genisligi; kayit yoksa ya da bozuksa varsayilan.
 * `Number(null)` sifir oldugu icin once *kayit var mi* diye bakiliyor —
 * yoksa hic kaydi olmayan kullanici paneli en dar halinde bulurdu.
 */
export function readPanelWidth(): number {
  const stored = readStored(PANEL_W_KEY)
  if (stored === null || stored.trim() === '') return PANEL_W_DEFAULT
  const raw = Number(stored)
  if (!Number.isFinite(raw) || raw <= 0) return PANEL_W_DEFAULT
  return Math.min(PANEL_W_MAX, Math.max(PANEL_W_MIN, Math.round(raw)))
}

export function writePanelWidth(width: number) {
  writeStored(PANEL_W_KEY, String(Math.round(width)))
}
