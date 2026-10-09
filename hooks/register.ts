import { atom, read, update } from 'claude-code'
import type { Register, Timer } from 'claude-code'
import { configFromOptions, loadPatterns } from './config.ts'
import { isAllBypass, joinSegments, maskText, splitBypass } from './mask.ts'

// 입력창 바로 위(AbovePrompt)에 한 줄로 띄웠다가 이 시간이 지나면 지운다
const NOTICE_MS = 5000
const notice = atom({ plugin: 'privacy-mask', key: 'notice' } as const, null)

export const register: Register = (on, options) => {
  let hideTimer: Timer | undefined
  // 설정을 바꾸면 엔진이 모듈을 다시 불러 register가 새 options로 다시 돈다
  const { patternsFile, ...base } = configFromOptions(options)
  on('prompt.submit', async ($, e, next) => {
    // 전부 제외 구간이면 설정을 읽지 않는다 (설정 오류로 막힌 상황에서도 보낼 수 있게)
    const segments = splitBypass(e.text)
    if (isAllBypass(segments)) return next({ ...e, text: joinSegments(segments) })

    // 사용자 정의가 빠진 채 보내면 가장 민감한 값이 그대로 나가므로 막는다
    // $.fs는 값으로 넘길 수 없다 (엔진이 $.noun.event(...) 호출 형태만 허용)
    const loaded = await loadPatterns({ read: path => $.fs.read(path) }, patternsFile)
    if (!loaded.ok) return { drop: `privacy-mask: ${loaded.reason}` }

    const { text, counts } = maskText(e.text, { ...base, patterns: loaded.patterns })
    const labels = Object.keys(counts)
    if (labels.length === 0) return next({ ...e, text })

    const result = await next({ ...e, text })
    const total = labels.reduce((s, k) => s + (counts[k] ?? 0), 0)
    const message = `민감정보 ${total}건 마스킹 (${labels.map(k => `${k} ${counts[k] ?? 0}`).join(', ')})`
    await update($, notice, () => message)
    // 연달아 보내면 앞 타이머가 새 알림을 일찍 지우지 않도록 다시 건다
    hideTimer?.cancel()
    hideTimer = $.clock.after(NOTICE_MS, () => void update($, notice, () => null))
    return result
  }).catch(($, e, next) =>
    // 마스킹 전에 실패하면 원문이 나가지 않도록 전송을 막는다
    next.called ? next(e) : { drop: 'privacy-mask 오류로 전송을 막았습니다. 내용 확인 후 다시 보내주세요.' },
  )

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const message = await read($, notice)
    if (message === null || e.props.hasSurvey) return next(e)
    const { Text } = $.ui.resolve(e)
    return h(Text, { dimColor: true }, message)
  })
}
