export type JsonPrimitive = string | number | boolean | null
export type JsonObject = { [key: string]: JsonValue }
export type JsonArray = JsonValue[]
export type JsonValue = JsonPrimitive | JsonObject | JsonArray

export type ViewMode = 'tree' | 'grid'

export interface ParseResult {
  data: JsonValue | null
  error: string | null
}

export interface FieldDoc {
  path: string
  name: string
  /** Alanin XSD tip adi (or. ID_Type); null olabilir. */
  type: string | null
  documentation: string
}

export interface AnnotateResponse {
  messageType: string | null
  confidence: number
  /** false ise sunucuda XSD yok; bos alan listesi "eslesme yok" anlamina gelmez. */
  schemaLoaded: boolean
  /** XSD'de karsiligi bulunamayan JSON alani sayisi. */
  unmatchedCount: number
  fields: FieldDoc[]
}

export interface ShareCreateResponse {
  id: string
  url: string
}

export interface ShareResponse {
  id: string
  title: string | null
  json: JsonValue
  createdAt: string
}
