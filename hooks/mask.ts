import { type Ctx, digitsOf, PII_RULES, PROPAGATE_MIN, type Rule, SECRET, SECRET_RULES } from './rules.ts'

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// replace 콜백 인자에서 캡처 그룹만 추린다 (offset 숫자 앞까지, 빠진 그룹은 '')
const groupsOf = (rest: unknown[]) => {
  const end = rest.findIndex(x => typeof x === 'number')
  return rest.slice(0, end).map(x => (typeof x === 'string' ? x : ''))
}

// 번호는 프롬프트마다 1부터. 호출이 끝나면 상태를 남기지 않는다.
export const maskText = (text: string) => {
  const counts: Record<string, number> = {}
  const ids = new Map<string, number>()
  const last: Record<string, number> = {}
  // 키로 찾은 비밀값 → 자리표시자 (같은 값이 여러 키에 걸리면 처음 키 이름으로 통일)
  const keyedValues = new Map<string, string>()

  const placeholder = (label: string, norm: string) => {
    const key = `${label}\u0000${norm}`
    let id = ids.get(key)
    if (id === undefined) {
      id = (last[label] ?? 0) + 1
      last[label] = id
      ids.set(key, id)
    }
    return `[${label}#${id}]`
  }

  const ctx: Ctx = {
    count: label => {
      counts[label] = (counts[label] ?? 0) + 1
    },
    tag: (label, value) => {
      ctx.count(label)
      // 개인정보는 구분자 차이(010-1234-5678 / 01012345678)를 같은 값으로 본다. 비밀값은 그대로 비교
      const norm = label === SECRET ? value : label === '이메일' ? value.toLowerCase() : digitsOf(value)
      return placeholder(label, norm)
    },
    keyed: (key, value) => {
      // <entry key="password"> 뒤의 줄바꿈·들여쓰기 같은 공백뿐인 값은 비밀값이 아니다
      if (!value.trim()) return value
      ctx.count(SECRET)
      const known = keyedValues.get(value)
      if (known !== undefined) return known
      const ph = placeholder(key, value)
      // 공백이 낀 값은 전체 치환하지 않는다 (줄바꿈·들여쓰기가 프롬프트 곳곳에서 바뀌는 것 방지)
      if (value.length >= PROPAGATE_MIN && !/\s/.test(value)) keyedValues.set(value, ph)
      return ph
    },
  }

  let out = text
  const run = (rules: Rule[]) => {
    for (const rule of rules) {
      out = out.replace(rule.re, (m: string, ...rest: unknown[]) => rule.apply(ctx, m, groupsOf(rest)) ?? m)
    }
  }

  run(SECRET_RULES)
  // 키 없이 다시 나온 같은 값(요청 URL·다른 로그 줄)도 가린다. 긴 값부터 치환해 부분 겹침 방지.
  // 앞뒤가 영숫자로 이어지면 다른 숫자·단어의 일부(ts=1760123456000)로, [..#n] 안이면 이미 넣은
  // 자리표시자로 보고 건드리지 않는다. 키 자리(password=), 태그 이름(<password>),
  // 키 이름 속성(key="password" · name="password")도 값이 아니다
  for (const [value, ph] of [...keyedValues].sort((a, b) => b[0].length - a[0].length)) {
    const re = new RegExp(
      `(?<![\\w\\[#<])(?<!<\\/)(?<!(?:key|name)\\s*=\\s*["'])${escapeRegExp(value)}(?![\\w#\\]])(?!["']?\\s*[:=])`,
      'g',
    )
    out = out.replace(re, () => {
      ctx.count(SECRET)
      return ph
    })
  }
  run(PII_RULES)
  return { text: out, counts }
}
