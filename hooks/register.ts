import type { Register } from 'claude-code'

type Ctx = {
  // 같은 프롬프트 안에서 같은 값 → 같은 번호
  tag: (label: string, value: string) => string
  // 키 이름으로 찾은 비밀값: 키 이름을 라벨로 쓰고, 같은 값은 프롬프트 전체에서 가린다
  keyed: (key: string, value: string) => string
  count: (label: string) => void
}

type Rule = {
  re: RegExp
  // null이면 오탐으로 보고 원문 유지
  apply: (ctx: Ctx, m: string, g: string[]) => string | null
}

const SECRET = '비밀값'

const digitsOf = (s: string) => s.replace(/\D/g, '')

const luhn = (digits: string) => {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum % 10 === 0
}

// 카드사 번호 대역(BIN). 16자리 ID가 우연히 Luhn을 통과하는 오탐(약 10%)을 줄인다
// Visa 4 · Master 51~55, 2221~2720 · Amex 34/37 · JCB 35 · Diners 36/38 · Discover/UnionPay 6 · 국내 전용 9
const isCardBin = (digits: string) => {
  if (/^(4|5[1-5]|3[4-8]|6|9)/.test(digits)) return true
  const head = Number(digits.slice(0, 4))
  return head >= 2221 && head <= 2720
}

// username류는 계정 식별용이라 제외 (사용자 ID로 로그 추적이 필요함)
const SECRET_KEY =
  /pass(word|wd)?|pwd|pw$|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credential|auth(?!or)|jsessionid|session[_-]?id|client[_-]?id|비밀번호|비번/

const isSecretKey = (key: string) => {
  const k = key.toLowerCase()
  return !/user(name)?$/.test(k) && SECRET_KEY.test(k)
}

// 따옴표는 남기고 안쪽만 가린다
const maskValue = (ctx: Ctx, key: string, v: string) => {
  const q = v[0]
  if ((q === '"' || q === "'") && v.length >= 2 && v.endsWith(q)) {
    const inner = v.slice(1, -1)
    return inner ? `${q}${ctx.keyed(key, inner)}${q}` : null
  }
  return ctx.keyed(key, v)
}

// 이보다 짧은 비밀값은 전체 치환하지 않는다 (Y·1 같은 값이 로그 곳곳을 가리는 것 방지)
const PROPAGATE_MIN = 6

// 순서가 중요하다: 비밀값 → (키로 찾은 값 전체 치환) → 개인정보 → IP. 앞 단계가 남긴 [..] 자리표시자는 뒤 규칙이 건드리지 않는다
const SECRET_RULES: Rule[] = [
  // ---- 비밀값: 형식만으로 잡히는 것 ----
  {
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    apply: (ctx, m) => ctx.tag(SECRET, m),
  },
  {
    re: /\beyJ[\w-]{5,}\.eyJ[\w-]{5,}\.[\w-]+/g,
    apply: (ctx, m) => ctx.tag(SECRET, m),
  },
  {
    re: /\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|sk-ant-[\w-]{20,}|sk-[A-Za-z0-9]{20,}|xox[abprs]-[\w-]{10,})\b/g,
    apply: (ctx, m) => ctx.tag(SECRET, m),
  },
  {
    // Jasypt 암호문
    re: /ENC\([^)\s]+\)/g,
    apply: (ctx, m) => ctx.tag(SECRET, m),
  },
  {
    re: /(authorization["']?\s*[:=]\s*["']?(?:bearer|basic)\s+)([\w\-.~+/]+=*)/gi,
    apply: (ctx, _m, g) => g[0] + ctx.tag(SECRET, g[1]),
  },
  {
    re: /(\bbearer\s+)([\w\-.~+/]{20,}=*)/gi,
    apply: (ctx, _m, g) => g[0] + ctx.tag(SECRET, g[1]),
  },
  {
    // jdbc:oracle:thin:user/password@host
    re: /(jdbc:oracle:\w+:[^/\s@:]+\/)([^@\s]+)(@)/gi,
    apply: (ctx, _m, g) => g[0] + ctx.tag(SECRET, g[1]) + g[2],
  },
  {
    // scheme://user:password@host
    re: /(:\/\/[^/\s:@]+:)([^@\s/]+)(@)/g,
    apply: (ctx, _m, g) => g[0] + ctx.tag(SECRET, g[1]) + g[2],
  },
  // ---- 비밀값: 키 이름으로 잡는 것 ----
  {
    // <property name="password" value="..."/>
    re: /((?:name|key)\s*=\s*"([^"]+)"\s+value\s*=\s*")([^"]*)(")/g,
    apply: (ctx, _m, g) => (isSecretKey(g[1]) && g[2] ? g[0] + ctx.keyed(g[1], g[2]) + g[3] : null),
  },
  {
    // <entry key="password">...</entry>
    re: /(key\s*=\s*"([^"]+)"[^>]*>)([^<]+)(<)/g,
    apply: (ctx, _m, g) => (isSecretKey(g[1]) ? g[0] + ctx.keyed(g[1], g[2]) + g[3] : null),
  },
  {
    // <password>...</password>
    re: /(<([A-Za-z0-9_.-]+)(?:\s[^>]*)?>)([^<]+)(<\/\2>)/g,
    apply: (ctx, _m, g) => (isSecretKey(g[1]) ? g[0] + ctx.keyed(g[1], g[2]) + g[3] : null),
  },
  {
    // key=value · key: value · "key": "value"
    re: /(["']?)([A-Za-z0-9_.\-가-힣]+)\1(\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s,;&)}\]<>"']+)/g,
    apply: (ctx, _m, g) => {
      const [q, key, sep, v] = g
      if (!isSecretKey(key) || v.startsWith('[') || /^(bearer|basic)$/i.test(v)) return null
      const masked = maskValue(ctx, key, v)
      return masked === null ? null : q + key + q + sep + masked
    },
  },
]

const PII_RULES: Rule[] = [
  // ---- 개인정보 ----
  {
    re: /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
    apply: (ctx, m, g) => `${ctx.tag('이메일', m)} ***@${g[0]}`,
  },
  {
    re: /(?<!\d)(?:\d{4}[- ]?){3}\d{4}(?!\d)/g,
    apply: (ctx, m) => {
      const d = digitsOf(m)
      return isCardBin(d) && luhn(d) ? `${ctx.tag('카드번호', m)} ****-${d.slice(-4)}` : null
    },
  },
  {
    // 13자리 epoch ms 오탐은 앞 6자리 월·일 검사로 거른다
    re: /(?<!\d)\d{2}(\d{2})(\d{2})[- ]?[1-8]\d{6}(?!\d)/g,
    apply: (ctx, m, g) => {
      const month = Number(g[0])
      const day = Number(g[1])
      return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? ctx.tag('주민번호', m) : null
    },
  },
  {
    re: /(?<!\d)01[016789][- .]?\d{3,4}[- .]?\d{4}(?!\d)/g,
    apply: (ctx, m) => {
      const d = digitsOf(m)
      return `${ctx.tag('전화번호', m)} ${d.slice(0, 3)}-****-${d.slice(-4)}`
    },
  },
  {
    // 지역번호는 구분자가 있을 때만 (숫자열 오탐 방지)
    re: /(?<!\d)(0(?:2|[3-6][1-5]|70))[-)]\d{3,4}-\d{4}(?!\d)/g,
    apply: (ctx, m, g) => `${ctx.tag('전화번호', m)} ${g[0]}-****-${digitsOf(m).slice(-4)}`,
  },
  {
    // 하이픈 구분 계좌번호, 숫자 합계 10~14자리 (날짜·시각은 자릿수로 제외)
    // 앞뒤가 영숫자·하이픈으로 이어지면 파일명·문서번호의 일부로 보고 제외
    re: /(?<![\w-])\d{2,6}(?:-\d{2,7}){2,3}(?![\w-])/g,
    apply: (ctx, m) => {
      const d = digitsOf(m)
      return d.length >= 10 && d.length <= 14 ? `${ctx.tag('계좌번호', m)} ****${d.slice(-4)}` : null
    },
  },
  // ---- IP: 첫·끝 옥텟만 남겨 서버 구분은 가능하게 ----
  {
    re: /(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?!\d|\.\d)/g,
    apply: (ctx, m, g) => {
      if (g.some(o => Number(o) > 255) || m === '127.0.0.1' || m === '0.0.0.0') return null
      ctx.count('IP')
      return `${g[0]}.***.***.${g[3]}`
    },
  },
]

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

export const register: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    const { text, counts } = maskText(e.text)
    const labels = Object.keys(counts)
    if (labels.length === 0) return next(e)

    const result = await next({ ...e, text })
    const total = labels.reduce((s, k) => s + (counts[k] ?? 0), 0)
    $.ui.toast(`민감정보 ${total}건 마스킹 (${labels.map(k => `${k} ${counts[k] ?? 0}`).join(', ')})`)
    return result
  }).catch(($, e, next) =>
    // 마스킹 전에 실패하면 원문이 나가지 않도록 전송을 막는다
    next.called ? next(e) : { drop: 'privacy-mask 오류로 전송을 막았습니다. 내용 확인 후 다시 보내주세요.' },
  )
}
