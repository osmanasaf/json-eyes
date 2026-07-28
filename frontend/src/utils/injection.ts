import type { InjectionKey } from 'vue'

/**
 * Goruntuleyicide uzerine gelinen alanin yolunu bildirir; IATA paneli bu alanin
 * XSD karsiligini gosterir. Derin agacta prop/emit zinciri kurmamak icin inject.
 */
export const SELECT_FIELD: InjectionKey<(path: string | null) => void> = Symbol('selectField')
