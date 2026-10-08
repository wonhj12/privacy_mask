import type { Register } from 'claude-code'
import { configFromOptions } from './config.ts'
import { isAllBypass, joinSegments, maskText, splitBypass } from './mask.ts'

export const register: Register = (on, options) => {
  // 설정을 바꾸면 엔진이 모듈을 다시 불러 register가 새 options로 다시 돈다
  const config = configFromOptions(options)
  on('prompt.submit', async ($, e, next) => {
    // 전부 제외 구간이면 설정을 읽지 않는다 (설정 오류로 막힌 상황에서도 보낼 수 있게)
    const segments = splitBypass(e.text)
    if (isAllBypass(segments)) return next({ ...e, text: joinSegments(segments) })

    const { text, counts } = maskText(e.text, config)
    const labels = Object.keys(counts)
    if (labels.length === 0) return next({ ...e, text })

    const result = await next({ ...e, text })
    const total = labels.reduce((s, k) => s + (counts[k] ?? 0), 0)
    $.ui.toast(`민감정보 ${total}건 마스킹 (${labels.map(k => `${k} ${counts[k] ?? 0}`).join(', ')})`)
    return result
  }).catch(($, e, next) =>
    // 마스킹 전에 실패하면 원문이 나가지 않도록 전송을 막는다
    next.called ? next(e) : { drop: 'privacy-mask 오류로 전송을 막았습니다. 내용 확인 후 다시 보내주세요.' },
  )
}
