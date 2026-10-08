import type { PluginOptions } from 'claude-code'
import { normKey, RULE_IDS, type RuleId } from './rules.ts'

export type UserPattern = { label: string; source: string; partial: boolean }

export type Loaded = { ok: true; patterns: UserPattern[] } | { ok: false; reason: string }

export type MaskConfig = {
  enabled: ReadonlySet<RuleId>
  // 키로 찾은 값을 프롬프트 전체에서 치환하는 최소 길이 (Y·1 같은 값이 로그 곳곳을 가리는 것 방지)
  propagateMin: number
  partialKeep: number
  // 개인정보 키·사용자 키의 문자 값 전체 치환 최소 길이 (이름은 2~4자)
  propagateMinText: number
  // 사용자 키 이름 (normKey로 정규화)
  customKeys: readonly string[]
  patterns: readonly UserPattern[]
}

export const DEFAULT_CONFIG: MaskConfig = {
  enabled: new Set(RULE_IDS),
  propagateMin: 6,
  partialKeep: 2,
  propagateMinText: 2,
  customKeys: [],
  patterns: [],
}

// 음수·소수·누락은 기본값으로
export const intOption = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback

export const configFromOptions = (options: PluginOptions): MaskConfig & { patternsFile: string } => ({
  // 설정에 없는 항목은 켠 것으로 본다 (새 규칙이 추가돼도 기본으로 가린다)
  enabled: new Set(RULE_IDS.filter(id => options[`enable_${id}`] !== false)),
  propagateMin: intOption(options.propagate_min, DEFAULT_CONFIG.propagateMin),
  partialKeep: intOption(options.partial_keep, DEFAULT_CONFIG.partialKeep),
  propagateMinText: intOption(options.propagate_min_text, DEFAULT_CONFIG.propagateMinText),
  customKeys: Array.isArray(options.custom_keys) ? options.custom_keys.map(normKey).filter(Boolean) : [],
  patterns: [],
  patternsFile: typeof options.patterns_file === 'string' ? options.patterns_file.trim() : '',
})

const fail = (reason: string): Loaded => ({ ok: false, reason })

// 차단 메시지에 프롬프트 내용은 넣지 않는다. 항목 번호만 알린다
export const parsePatterns = (text: string): Loaded => {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return fail('정규식 파일이 올바른 JSON이 아닙니다')
  }
  if (!Array.isArray(data)) return fail('정규식 파일은 배열이어야 합니다')
  const patterns: UserPattern[] = []
  for (const [i, item] of data.entries()) {
    const at = `정규식 파일 ${i + 1}번째 항목: `
    if (typeof item !== 'object' || item === null) return fail(`${at}객체가 아닙니다`)
    const { label, regex, partial } = item as Record<string, unknown>
    if (typeof label !== 'string' || !label.trim()) return fail(`${at}label이 없습니다`)
    // 자리표시자 [라벨#n] 판별이 깨진다
    if (/[[\]#\n]/.test(label)) return fail(`${at}label에 [ ] # 줄바꿈은 쓸 수 없습니다`)
    if (typeof regex !== 'string' || !regex) return fail(`${at}regex가 없습니다`)
    if (partial !== undefined && typeof partial !== 'boolean') return fail(`${at}partial은 true 또는 false여야 합니다`)
    try {
      new RegExp(regex, 'g')
    } catch {
      return fail(`${at}regex 문법 오류`)
    }
    patterns.push({ label, source: regex, partial: partial === true })
  }
  return { ok: true, patterns }
}

// 프롬프트마다 다시 읽는다: 고친 정규식이 /reload-plugins 없이 반영된다
export const loadPatterns = async (fs: { read: (path: string) => Promise<unknown> }, path: string): Promise<Loaded> => {
  if (!path) return { ok: true, patterns: [] }
  let text: unknown
  try {
    text = await fs.read(path)
  } catch {
    return fail(`정규식 파일을 읽을 수 없습니다 (${path})`)
  }
  return typeof text === 'string' ? parsePatterns(text) : fail(`정규식 파일을 읽을 수 없습니다 (${path})`)
}
