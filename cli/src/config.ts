import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { UserError } from './output'

/**
 * Adres cozumu. Backend adresi tek bir yerde durmali: her cagrida `--api`
 * yazdirmak paylasim komutunu kullanilmaz kilar, sabit gomulu bir adres de
 * herkesin kendi kurulumunu imkansiz kilar. Sira: bayrak > ortam degiskeni >
 * yapilandirma dosyasi > yerel gelistirme varsayilani.
 */

export interface CliConfig {
  /** Backend API tabani, or. https://api.ornek.com/api */
  api?: string
  /** Paylasim linklerinin on yuz tabani, or. https://json-eyes.vercel.app */
  web?: string
}

/**
 * Uretim backend'i: `frontend/vercel.json`'daki rewrite hedefiyle ayni adres.
 * Boylece CLI kurulur kurulmaz `jse share` calisir, kullanicinin yapilandirma
 * yapmasi gerekmez.
 *
 * Adres duz HTTP: Coolify'in verdigi `*.sslip.io` alan adinda HTTPS calismiyor
 * (Let's Encrypt bu ortak alan adina rate limit uyguluyor — bkz. depo README'si,
 * "Alan adi ve HTTPS"). Bu yuzden paylasilan JSON bu hopta acik metin gidiyor;
 * CLI bunu her istekte kullaniciya soyluyor (asagidaki `insecureNotice`).
 * Backend kendi alan adina tasindiginda burasi ve vercel.json birlikte
 * `https://` yapilmali.
 */
const DEFAULT_API = 'http://t78qo9weypgend50er2jx07z.178.104.138.59.sslip.io/api'

const LOCAL_HOSTS = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/

export function configPath(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(base, 'json-eyes', 'config.json')
}

export function readConfig(): CliConfig {
  try {
    const raw = readFileSync(configPath(), 'utf8')
    const parsed = JSON.parse(raw) as CliConfig
    return { api: parsed.api, web: parsed.web }
  } catch {
    // Dosya yoksa ya da bozuksa varsayilanlarla devam: yapilandirma zorunlu degil.
    return {}
  }
}

export function writeConfig(config: CliConfig): string {
  const path = configPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  return path
}

/** Sondaki egik cizgiyi atar; adres birlestirmede cift cizgi olmasin. */
function trimSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

export interface Resolved {
  api: string
  web?: string
  /** Adresin nereden geldigi; `jse config show` ve hata mesajlari icin. */
  source: 'flag' | 'env' | 'config' | 'default'
}

export function resolveApi(flag?: string): Resolved {
  const config = readConfig()
  const web = process.env.JSON_EYES_WEB ?? config.web
  if (flag) return { api: normalizeApi(flag), web, source: 'flag' }
  if (process.env.JSON_EYES_API) return { api: normalizeApi(process.env.JSON_EYES_API), web, source: 'env' }
  if (config.api) return { api: normalizeApi(config.api), web, source: 'config' }
  return { api: DEFAULT_API, web, source: 'default' }
}

/**
 * Kullanicilar adresi "https://ornek.com" ya da "https://ornek.com/api" olarak
 * verebiliyor; ikisi de calissin diye eksik olan `/api` eklenir.
 */
export function normalizeApi(raw: string): string {
  const trimmed = trimSlash(raw.trim())
  if (!/^https?:\/\//.test(trimmed)) {
    throw new UserError(
      `Geçersiz API adresi: ${raw}`,
      'Adres http:// veya https:// ile başlamalı, örnek: https://api.ornek.com/api',
    )
  }
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`
}

/**
 * Duz HTTP ile konusuluyorsa uyari metni. Sessizce sifresiz gondermek, kullanici
 * "salt okunur link" alirken verisinin yolda acik gittigini bilmemesi demek.
 * Yerel adresler icin uyarilmiyor (kendi makinesi).
 */
export function insecureNotice(api: string): string | null {
  if (!api.startsWith('http://') || LOCAL_HOSTS.test(api)) return null
  return `Bağlantı şifresiz (${new URL(api).host}): gönderilen JSON yolda açık metin gider.`
}

/** Paylasim linkini on yuz tabanina gore yeniden kurar. */
export function shareUrl(serverUrl: string, id: string, web?: string): string {
  if (!web) return serverUrl
  return `${trimSlash(web)}/?s=${id}`
}
