export type JsonPrimitive = string | number | boolean | null
export type JsonObject = { [key: string]: JsonValue }
export type JsonArray = JsonValue[]
export type JsonValue = JsonPrimitive | JsonObject | JsonArray

/**
 * Gorunum: ayni belgeye nasil bakildigi. Karsilastirma ve XML burada yok —
 * biri ikinci bir girdi, digeri bir girdi bicimi; ikisi de girdi tarafinda.
 */
export type ViewMode = 'tree' | 'grid' | 'columns'

export interface ParseResult {
  data: JsonValue | null
  error: string | null
}

/**
 * Alanin XSD karsiligina nasil baglandigi. `INFERRED` olanlar ad tutmadigi icin
 * yapidan cikarilmistir; aciklama yanlis olabilecegi icin UI'da ayri gosterilir.
 */
export type MatchKind = 'EXACT' | 'INFERRED'

export interface FieldDoc {
  path: string
  name: string
  /** Alanin XSD tip adi (or. ID_Type); null olabilir. */
  type: string | null
  documentation: string
  matchKind: MatchKind
  /** Tahmini eslesmenin puani (0-1); kesin eslesmede 1. */
  confidence: number
  /** Tahminin dayanagi, kullaniciya gosterilir; kesin eslesmede null. */
  evidence: string | null
}

export interface AnnotateResponse {
  messageType: string | null
  confidence: number
  /** false ise sunucuda XSD yok; bos alan listesi "eslesme yok" anlamina gelmez. */
  schemaLoaded: boolean
  /** XSD'de karsiligi bulunamayan JSON alani sayisi. */
  unmatchedCount: number
  /** Bu alanlarin yollari; uzun listelerde kirpilir. */
  unmatchedPaths: string[]
  fields: FieldDoc[]
}

export interface ShareCreateResponse {
  id: string
  url: string
}

export interface ShareResponse {
  id: string
  title: string | null
  commentsEnabled: boolean
  json: JsonValue
  createdAt: string
}

export interface Comment {
  id: number
  /** Yorumun bagli oldugu dugum yolu. */
  path: string
  author: string
  body: string
  parentId: number | null
  createdAt: string
}

export interface CommentListResponse {
  enabled: boolean
  comments: Comment[]
}

export interface CommentCreateResponse {
  comment: Comment
  /** Yalnizca olusturma aninda doner; silme yetkisi icin saklanir. */
  editToken: string
}
