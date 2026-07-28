import type { ComputedRef, InjectionKey, Ref } from 'vue'
import type { Comment } from '../types'

/**
 * Goruntuleyicide uzerine gelinen alanin yolunu bildirir; IATA paneli bu alanin
 * XSD karsiligini gosterir. Derin agacta prop/emit zinciri kurmamak icin inject.
 */
export const SELECT_FIELD: InjectionKey<(path: string | null) => void> = Symbol('selectField')

/**
 * Yorum katmani. Agac ve tablo satirlari yorum rozetini ve satir altindaki zinciri
 * buradan besler; derin agacta prop zinciri kurmamak icin inject ediliyor.
 */
export interface CommentsApi {
  /** Yalnizca paylasilan bir JSON goruntulenirken true. */
  available: ComputedRef<boolean>
  /** Paylasim yorumlara acik mi. */
  enabled: Ref<boolean>
  /** Zinciri acik olan alanin yolu. */
  openPath: Ref<string | null>
  author: Ref<string>
  commentsFor: (path: string) => Comment[]
  countFor: (path: string) => number
  toggle: (path: string) => void
  add: (payload: { path: string; body: string; parentId: number | null }) => void
  remove: (id: number) => void
  canDelete: (id: number) => boolean
}

export const COMMENTS: InjectionKey<CommentsApi> = Symbol('comments')
