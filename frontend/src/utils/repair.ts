/**
 * Elle duzenlenmis JSON'larda en sik gorulen uc hatayi onarir: yorum satirlari,
 * sondaki fazla virgul ve tek tirnakli metinler.
 *
 * Metin bir tarayici gibi karakter karakter taranir; duzeltmeler yalnizca dize
 * disinda uygulanir, yoksa icinde virgul veya `//` gecen degerler bozulurdu.
 * Onarim "denenir": sonuc yine ayristirilamiyorsa cagiran taraf metni uygulamaz.
 */
export function repairJson(input: string): string {
  const out: string[] = []
  let i = 0

  /** Son yazilan anlamli karakteri geri alarak sondaki virgulu siler. */
  function dropTrailingComma() {
    for (let k = out.length - 1; k >= 0; k--) {
      const chunk = out[k]
      if (/^\s*$/.test(chunk)) continue
      if (chunk === ',') out[k] = ''
      return
    }
  }

  while (i < input.length) {
    const ch = input[i]

    // Cift tirnakli dize: kacislariyla birlikte oldugu gibi tasinir.
    if (ch === '"') {
      let j = i + 1
      while (j < input.length) {
        if (input[j] === '\\') { j += 2; continue }
        if (input[j] === '"') break
        j++
      }
      out.push(input.slice(i, Math.min(j + 1, input.length)))
      i = j + 1
      continue
    }

    // Tek tirnakli dize: icinde cift tirnak yoksa cift tirnaga cevrilir.
    if (ch === "'") {
      let j = i + 1
      let body = ''
      while (j < input.length) {
        if (input[j] === '\\') { body += input.slice(j, j + 2); j += 2; continue }
        if (input[j] === "'") break
        body += input[j]
        j++
      }
      out.push(body.includes('"') ? `'${body}'` : `"${body}"`)
      i = j + 1
      continue
    }

    if (ch === '/' && input[i + 1] === '/') {
      const end = input.indexOf('\n', i)
      i = end === -1 ? input.length : end
      continue
    }

    if (ch === '/' && input[i + 1] === '*') {
      const end = input.indexOf('*/', i + 2)
      i = end === -1 ? input.length : end + 2
      continue
    }

    if (ch === '}' || ch === ']') dropTrailingComma()

    out.push(ch)
    i++
  }

  return out.join('')
}

/** Onarilmis metni dondurur; onarim da ayristirilamiyorsa null. */
export function tryRepair(input: string): string | null {
  const repaired = repairJson(input)
  if (repaired === input) return null
  try {
    JSON.parse(repaired)
    return repaired
  } catch {
    return null
  }
}
