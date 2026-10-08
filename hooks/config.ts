import type { PluginOptions } from 'claude-code'
import { normKey, RULE_IDS, type RuleId } from './rules.ts'

export type MaskConfig = {
  enabled: ReadonlySet<RuleId>
  // 키로 찾은 값을 프롬프트 전체에서 치환하는 최소 길이 (Y·1 같은 값이 로그 곳곳을 가리는 것 방지)
  propagateMin: number
  partialKeep: number
  // 개인정보 키·사용자 키의 문자 값 전체 치환 최소 길이 (이름은 2~4자)
  propagateMinText: number
  // 사용자 키 이름 (normKey로 정규화)
  customKeys: readonly string[]
}

export const DEFAULT_CONFIG: MaskConfig = {
  enabled: new Set(RULE_IDS),
  propagateMin: 6,
  partialKeep: 2,
  propagateMinText: 2,
  customKeys: [],
}

// 음수·소수·누락은 기본값으로
export const intOption = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback

export const configFromOptions = (options: PluginOptions): MaskConfig => ({
  // 설정에 없는 항목은 켠 것으로 본다 (새 규칙이 추가돼도 기본으로 가린다)
  enabled: new Set(RULE_IDS.filter(id => options[`enable_${id}`] !== false)),
  propagateMin: intOption(options.propagate_min, DEFAULT_CONFIG.propagateMin),
  partialKeep: intOption(options.partial_keep, DEFAULT_CONFIG.partialKeep),
  propagateMinText: intOption(options.propagate_min_text, DEFAULT_CONFIG.propagateMinText),
  customKeys: Array.isArray(options.custom_keys) ? options.custom_keys.map(normKey).filter(Boolean) : [],
})
