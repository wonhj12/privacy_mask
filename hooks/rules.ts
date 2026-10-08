// 설정 키는 enable_<id>. 규칙을 추가하면 여기와 plugin.json의 userConfig에 함께 넣는다
export const RULE_IDS = [
  'rrn',
  'phone',
  'driver_license',
  'email',
  'card',
  'biz_no',
  'account',
  'ip',
  'private_key',
  'jwt',
  'service_token',
  'jasypt',
  'auth_header',
  'connection_string',
  'secret_key',
] as const

export type RuleId = (typeof RULE_IDS)[number]

export type Ctx = {
  // 같은 프롬프트 안에서 같은 norm → 같은 번호. norm은 호출부가 정한다 (전화는 숫자만, 이메일은 소문자 등)
  tag: (label: string, norm: string) => string
  // 일부 노출 "앞뒤 N자"의 N
  keep: number
  // 키 이름으로 찾은 비밀값: 키 이름을 라벨로 쓰고, 같은 값은 프롬프트 전체에서 가린다
  keyed: (key: string, value: string) => string
  // 가릴 키인가 (켜진 키 규칙 기준)
  isKey: (key: string) => boolean
  count: (label: string) => void
}

export type Rule = {
  // null이면 항상 실행한다. 키 규칙은 켜고 끄기를 ctx.isKey가 판단한다
  id: RuleId | null
  re: RegExp
  // null이면 오탐으로 보고 원문 유지
  apply: (ctx: Ctx, m: string, g: string[]) => string | null
}

export const SECRET = '비밀값'

export const digitsOf = (s: string) => s.replace(/\D/g, '')

const SEP = /[-. ]/

// 구분자는 남기고, 구분자를 뺀 글자 중 앞 n자·뒤 n자만 보인다. 2n자 이하면 전부 가린다
export const keepEnds = (s: string, n: number) => {
  const chars = [...s]
  const total = chars.filter(c => !SEP.test(c)).length
  let i = 0
  return chars
    .map(c => {
      if (SEP.test(c)) return c
      const idx = i++
      return total > n * 2 && (idx < n || idx >= total - n) ? c : '*'
    })
    .join('')
}

// 접두어로 서비스를 구분한다. sk-ant- 가 sk- 보다 먼저 와야 한다
const SERVICE_LABELS: [RegExp, string][] = [
  [/^(AKIA|ASIA)/, 'AWS키'],
  [/^(gh[pousr]_|github_pat_)/, 'GitHub토큰'],
  [/^sk-ant-/, 'Anthropic키'],
  [/^sk-/, 'OpenAI키'],
  [/^xox/, 'Slack토큰'],
]

export const serviceLabel = (token: string) => SERVICE_LABELS.find(([re]) => re.test(token))?.[1] ?? '토큰'

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

// 사업자등록번호 검증: 앞 9자리 × 1,3,7,1,3,7,1,3,5 + ⌊9번째 × 5 / 10⌋, (10 − 합 mod 10) mod 10 = 끝자리
const BIZ_WEIGHTS = [1, 3, 7, 1, 3, 7, 1, 3, 5]

export const isBizNo = (d: string) => {
  if (d.length !== 10) return false
  let sum = 0
  for (let i = 0; i < 9; i++) sum += Number(d[i]) * (BIZ_WEIGHTS[i] ?? 0)
  sum += Math.floor((Number(d[8]) * 5) / 10)
  return (10 - (sum % 10)) % 10 === Number(d[9])
}

// 2014년 이전 면허증의 지역명 표기
const LICENSE_REGIONS = '서울|부산|경기|강원|충북|충남|전북|전남|경북|경남|제주|대구|인천|광주|대전|울산'

// username류는 계정 식별용이라 제외 (사용자 ID로 로그 추적이 필요함)
const SECRET_KEY =
  /pass(word|wd)?|pwd|pw$|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credential|auth(?!or)|jsessionid|session[_-]?id|client[_-]?id|비밀번호|비번/

export const isSecretKey = (key: string) => {
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

// 순서가 중요하다: 비밀값 → (키로 찾은 값 전체 치환) → 개인정보 → IP. 앞 단계가 남긴 [..] 자리표시자는 뒤 규칙이 건드리지 않는다
export const SECRET_RULES: Rule[] = [
  // ---- 비밀값: 형식만으로 잡히는 것 ----
  {
    id: 'private_key',
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    apply: (ctx, m) => ctx.tag('개인키', m),
  },
  {
    id: 'jwt',
    re: /\beyJ[\w-]{5,}\.eyJ[\w-]{5,}\.[\w-]+/g,
    apply: (ctx, m) => ctx.tag('JWT', m),
  },
  {
    id: 'service_token',
    re: /\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|sk-ant-[\w-]{20,}|sk-[A-Za-z0-9]{20,}|xox[abprs]-[\w-]{10,})\b/g,
    apply: (ctx, m) => ctx.tag(serviceLabel(m), m),
  },
  {
    id: 'jasypt',
    // Jasypt 암호문
    re: /ENC\([^)\s]+\)/g,
    apply: (ctx, m) => ctx.tag('암호문', m),
  },
  {
    id: 'auth_header',
    re: /(authorization["']?\s*[:=]\s*["']?(?:bearer|basic)\s+)([\w\-.~+/]+=*)/gi,
    apply: (ctx, _m, g) => g[0] + ctx.tag('인증토큰', g[1]),
  },
  {
    id: 'auth_header',
    re: /(\bbearer\s+)([\w\-.~+/]{20,}=*)/gi,
    apply: (ctx, _m, g) => g[0] + ctx.tag('인증토큰', g[1]),
  },
  {
    id: 'connection_string',
    // jdbc:oracle:thin:user/password@host
    re: /(jdbc:oracle:\w+:[^/\s@:]+\/)([^@\s]+)(@)/gi,
    apply: (ctx, _m, g) => g[0] + ctx.tag('접속비밀번호', g[1]) + g[2],
  },
  {
    id: 'connection_string',
    // scheme://user:password@host
    re: /(:\/\/[^/\s:@]+:)([^@\s/]+)(@)/g,
    apply: (ctx, _m, g) => g[0] + ctx.tag('접속비밀번호', g[1]) + g[2],
  },
  // ---- 비밀값: 키 이름으로 잡는 것 ----
  {
    id: null,
    // <property name="password" value="..."/>
    re: /((?:name|key)\s*=\s*"([^"]+)"\s+value\s*=\s*")([^"]*)(")/g,
    apply: (ctx, _m, g) => (ctx.isKey(g[1]) && g[2] ? g[0] + ctx.keyed(g[1], g[2]) + g[3] : null),
  },
  {
    id: null,
    // <entry key="password">...</entry>
    re: /(key\s*=\s*"([^"]+)"[^>]*>)([^<]+)(<)/g,
    apply: (ctx, _m, g) => (ctx.isKey(g[1]) ? g[0] + ctx.keyed(g[1], g[2]) + g[3] : null),
  },
  {
    id: null,
    // <password>...</password>
    re: /(<([A-Za-z0-9_.-]+)(?:\s[^>]*)?>)([^<]+)(<\/\2>)/g,
    apply: (ctx, _m, g) => (ctx.isKey(g[1]) ? g[0] + ctx.keyed(g[1], g[2]) + g[3] : null),
  },
  {
    id: null,
    // key=value · key: value · "key": "value"
    re: /(["']?)([A-Za-z0-9_.\-가-힣]+)\1(\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s,;&)}\]<>"']+)/g,
    apply: (ctx, _m, g) => {
      const [q, key, sep, v] = g
      if (!ctx.isKey(key) || v.startsWith('[') || /^(bearer|basic)$/i.test(v)) return null
      const masked = maskValue(ctx, key, v)
      return masked === null ? null : q + key + q + sep + masked
    },
  },
]

export const PII_RULES: Rule[] = [
  // ---- 개인정보 ----
  {
    id: 'email',
    re: /([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
    apply: (ctx, m, g) => `${ctx.tag('이메일', m.toLowerCase())} ${keepEnds(g[0], ctx.keep)}@${g[1]}`,
  },
  {
    id: 'card',
    re: /(?<!\d)(?:\d{4}[- ]?){3}\d{4}(?!\d)/g,
    apply: (ctx, m) => {
      const d = digitsOf(m)
      return isCardBin(d) && luhn(d) ? `${ctx.tag('카드번호', d)} ****-${d.slice(-4)}` : null
    },
  },
  {
    id: 'rrn',
    // 13자리 epoch ms 오탐은 앞 6자리 월·일 검사로 거른다
    re: /(?<!\d)\d{2}(\d{2})(\d{2})[- ]?[1-8]\d{6}(?!\d)/g,
    apply: (ctx, m, g) => {
      const month = Number(g[0])
      const day = Number(g[1])
      return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? ctx.tag('주민번호', digitsOf(m)) : null
    },
  },
  {
    id: 'phone',
    re: /(?<!\d)01[016789][- .]?\d{3,4}[- .]?\d{4}(?!\d)/g,
    apply: (ctx, m) => {
      const d = digitsOf(m)
      return `${ctx.tag('전화번호', d)} ${d.slice(0, 3)}-****-${d.slice(-4)}`
    },
  },
  {
    id: 'phone',
    // 지역번호는 구분자가 있을 때만 (숫자열 오탐 방지)
    re: /(?<!\d)(0(?:2|[3-6][1-5]|70))[-)]\d{3,4}-\d{4}(?!\d)/g,
    apply: (ctx, m, g) => `${ctx.tag('전화번호', digitsOf(m))} ${g[0]}-****-${digitsOf(m).slice(-4)}`,
  },
  {
    // 지역 코드(11~26, 28)-연도-일련번호-검증 / 2014년 이전: 지역명 연도-일련번호-검증
    id: 'driver_license',
    re: new RegExp(
      `(?<![\\w-])(?:(?:${LICENSE_REGIONS})\\s?\\d{2}-\\d{6}-\\d{2}|(?:1[1-9]|2[0-6]|28)-\\d{2}-\\d{6}-\\d{2})(?![\\w-])`,
      'g',
    ),
    apply: (ctx, m) => ctx.tag('운전면허', digitsOf(m)),
  },
  {
    // 체크섬이 틀리면 null → 계좌 규칙이 다시 본다
    id: 'biz_no',
    re: /(?<![\w-])\d{3}-\d{2}-\d{5}(?![\w-])/g,
    apply: (ctx, m) => {
      const d = digitsOf(m)
      return isBizNo(d) ? `${ctx.tag('사업자번호', d)} ${keepEnds(m, ctx.keep)}` : null
    },
  },
  {
    id: 'account',
    // 하이픈 구분 계좌번호, 숫자 합계 10~14자리 (날짜·시각은 자릿수로 제외)
    // 앞뒤가 영숫자·하이픈으로 이어지면 파일명·문서번호의 일부로 보고 제외
    re: /(?<![\w-])\d{2,6}(?:-\d{2,7}){2,3}(?![\w-])/g,
    apply: (ctx, m) => {
      const d = digitsOf(m)
      return d.length >= 10 && d.length <= 14 ? `${ctx.tag('계좌번호', d)} ${keepEnds(m, ctx.keep)}` : null
    },
  },
  // ---- IP: 첫·끝 옥텟만 남겨 서버 구분은 가능하게 ----
  {
    id: 'ip',
    re: /(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?!\d|\.\d)/g,
    apply: (ctx, m, g) => {
      if (g.some(o => Number(o) > 255) || m === '127.0.0.1' || m === '0.0.0.0') return null
      return `${ctx.tag('IP', m)} ${g[0]}.***.***.${g[3]}`
    },
  },
]
