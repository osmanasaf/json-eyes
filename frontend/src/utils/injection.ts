import type { ComputedRef, InjectionKey, Ref } from 'vue'

/**
 * Goruntuleyicide uzerine gelinen alanin yolunu bildirir; IATA paneli bu alanin
 * XSD karsiligini gosterir. Derin agacta prop/emit zinciri kurmamak icin inject.
 */
export const SELECT_FIELD: InjectionKey<(path: string | null) => void> = Symbol('selectField')

/**
 * Yorum katmani. Agac satirlari yorum *sayisini* buradan okur; yorumun kendisi
 * sag panelde, secili alanin dokumantasyonunun altinda yasiyor — tasarim
 * yorumlara tek bir yer veriyor.
 */
export interface CommentsApi {
  /** Yalnizca paylasilan bir JSON goruntulenirken true. */
  available: ComputedRef<boolean>
  /** Paylasim yorumlara acik mi. */
  enabled: Ref<boolean>
  author: Ref<string>
  countFor: (path: string) => number
  add: (payload: { path: string; body: string; parentId: number | null }) => void
  remove: (id: number) => void
  canDelete: (id: number) => boolean
}

export const COMMENTS: InjectionKey<CommentsApi> = Symbol('comments')
