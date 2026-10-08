# 마스킹 설정·사용자 정의 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기본 마스킹 규칙을 항목별로 켜고 끌 수 있게 하고, 사용자 키·정규식·`###` 제외 구간을 추가한다.

**Architecture:** `hooks/register.ts` 한 파일을 `rules.ts`(규칙 목록)·`config.ts`(설정)·`mask.ts`(엔진)·`register.ts`(훅)로 나눈다. 규칙마다 `id`를 붙여 설정으로 켜고 끄며, 엔진은 설정 객체를 받는 순수 함수다.

**Tech Stack:** Claude Code 함수 훅 플러그인(TypeScript, Node 아님), `claude-code/testing`

**Spec:** `docs/superpowers/specs/2026-10-08-mask-config-design.md`

## Global Constraints

- 공개 레포다. 테스트 데이터는 범용 키 이름과 직접 만든 값만 쓴다. 토큰류는 `'x'.repeat(35)`처럼 코드로 만들어 실제 키처럼 보이지 않게 한다.
- 규칙 순서: `###` 분리 → 비밀값 형식 → 키 규칙 → 키 값 전체 치환 → 개인정보 형식(… 운전면허 → 사업자번호 → 계좌 → IP) → 사용자 정규식. 앞 단계가 넣은 `[..#n]`을 뒤 단계가 건드리지 않는다.
- 파일·프로세스 접근은 `$.fs`·`$.process`로만 한다. 테스트 환경에는 fs가 없다.
- 기본값: `propagate_min_text` 2, `propagate_min` 6, `partial_keep` 2, 규칙 전부 켬.
- `userConfig` 필드는 `type`·`title`·`description` 필수, 키는 영문·숫자·`_`만.
- 커밋 메시지: 한국어 + conventional prefix, 마침표 없음, `Co-Authored-By` 없음. **각 태스크의 커밋은 사용자 확인 후** 한다.
- 검증 명령: `claude plugin validate .` · `claude plugin test .`

## Review Focus

1. 한 줄에 `###…###` 구간이 여러 개 → 각각 따로 제외 (Task 7 테스트)
2. 빈 문자열에 매치되는 사용자 정규식(`a*`) → 무한 반복 없이 원문 유지 (Task 8 테스트)
3. 사용자 정규식 라벨에 `[` `]` `#` → 자리표시자 판별이 깨지므로 설정 오류로 차단 (Task 8 테스트)
4. CRLF 줄바꿈의 `Cookie:` 헤더 → `\r` 앞에서 끊고 다음 헤더는 그대로 (Task 5 테스트)
5. `#### 소제목`·`##########`처럼 `#`이 4개 이상인 줄 → 구분자로 보지 않음 (Task 7 테스트)

---

### Task 1: 엔진을 rules.ts·mask.ts로 분리 (동작 변화 없음)

**Files:**
- Create: `hooks/rules.ts`, `hooks/mask.ts`, `hooks/mask.test.ts`
- Modify: `hooks/register.ts`

**Interfaces:**
- Produces: `rules.ts` — `Ctx`, `Rule`, `SECRET`, `digitsOf`, `luhn`, `isCardBin`, `isSecretKey`, `maskValue`, `SECRET_RULES`, `PII_RULES` (모두 export). `mask.ts` — `maskText(text: string): { text: string; counts: Record<string, number> }`

- [ ] **Step 1: 테스트 파일에서 엔진을 직접 import하는 테스트 작성**

`hooks/mask.test.ts`:

```ts
import { expect, test } from 'claude-code/testing'
import { maskText } from './mask.ts'

test('maskText: 훅을 거치지 않고 직접 호출할 수 있다', () => {
  expect(maskText('tel=010-1234-5678').text).toBe('tel=[전화번호#1] 010-****-5678')
})
```

- [ ] **Step 2: 실패 확인**

Run: `claude plugin test .`
Expected: `mask.test.ts`가 `./mask.ts`를 찾지 못해 FAIL

- [ ] **Step 3: 코드 이동**

`hooks/register.ts`의 내용을 그대로 옮긴다 (로직 수정 금지):
- `rules.ts`로: `type Ctx`, `type Rule`, `SECRET`, `digitsOf`, `luhn`, `isCardBin`, `SECRET_KEY`, `isSecretKey`, `maskValue`, `PROPAGATE_MIN`, `SECRET_RULES`, `PII_RULES`. 다른 파일이 쓰는 것에 `export`를 붙인다 (`Ctx`, `Rule`, `SECRET`, `digitsOf`, `PROPAGATE_MIN`, `SECRET_RULES`, `PII_RULES`, `isSecretKey`). 순서 주석(`// 순서가 중요하다 …`)도 함께 옮긴다.
- `mask.ts`로: `escapeRegExp`, `groupsOf`, `maskText`(export 유지). 맨 위에 import:

```ts
import { type Ctx, digitsOf, PII_RULES, PROPAGATE_MIN, type Rule, SECRET, SECRET_RULES } from './rules.ts'
```

- `register.ts`에는 `register`만 남기고 맨 위를 이렇게:

```ts
import type { Register } from 'claude-code'
import { maskText } from './mask.ts'
```

- [ ] **Step 4: 검증**

Run: `claude plugin validate . && claude plugin test .`
Expected: validate 통과, 테스트 15개 PASS (기존 14 + 신규 1)

`.ts` 확장자 import를 엔진이 거부하면 세 파일의 import를 `'./rules'`·`'./mask'`로 바꿔 다시 돌린다.

- [ ] **Step 5: 커밋 (사용자 확인 후)**

```bash
git add hooks/
git commit -m "refactor: 마스킹 엔진을 규칙·엔진 파일로 분리"
```

---

### Task 2: 설정 연결 — 규칙별 켜기/끄기, 전체 치환 최소 길이

**Files:**
- Create: `hooks/config.ts`
- Modify: `hooks/rules.ts`, `hooks/mask.ts`, `hooks/register.ts`, `.claude-plugin/plugin.json`
- Test: `hooks/register.test.ts`

**Interfaces:**
- Consumes: Task 1의 `rules.ts`·`mask.ts`
- Produces:
  - `rules.ts`: `RULE_IDS` (readonly 배열), `type RuleId`, `Rule.id: RuleId | null`, `Ctx.isKey: (key: string) => boolean`
  - `config.ts`: `type MaskConfig = { enabled: ReadonlySet<RuleId>; propagateMin: number }`, `DEFAULT_CONFIG: MaskConfig`, `configFromOptions(options: PluginOptions): MaskConfig`, `intOption(v: unknown, fallback: number): number`
  - `mask.ts`: `maskText(text: string, config?: MaskConfig)`

- [ ] **Step 1: 실패하는 테스트 작성**

`hooks/register.test.ts` 끝에 추가:

```ts
test('설정: 끈 항목은 가리지 않는다', { options: { enable_phone: false, enable_secret_key: false } }, async ($, on) => {
  const [seen] = await submitAll($, on, ['tel=010-1234-5678 db.password=abc123 card=4111-1111-1111-1111'])
  expect(seen).toBe('tel=010-1234-5678 db.password=abc123 card=[카드번호#1] ****-1111')
})

test('설정: 전체 치환 최소 길이를 바꿀 수 있다', { options: { propagate_min: 3 } }, async ($, on) => {
  const [seen] = await submitAll($, on, ['pw=abc url=/x?t=abc'])
  expect(seen).toBe('pw=[pw#1] url=/x?t=[pw#1]')
})
```

- [ ] **Step 2: 실패 확인**

Run: `claude plugin test .`
Expected: 두 테스트 FAIL (설정이 무시돼 전화·비밀값이 가려지고, `abc`는 6자 미만이라 전체 치환 안 됨)

- [ ] **Step 3: rules.ts에 id 추가**

`rules.ts` 맨 위에 추가:

```ts
// 설정 키는 enable_<id>. 규칙을 추가하면 여기와 plugin.json의 userConfig에 함께 넣는다
export const RULE_IDS = [
  'rrn',
  'phone',
  'email',
  'card',
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
```

`Ctx`에 `isKey`를 추가하고, `Rule`에 `id`를 추가:

```ts
export type Ctx = {
  // 같은 프롬프트 안에서 같은 값 → 같은 번호
  tag: (label: string, value: string) => string
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
```

`SECRET_RULES`·`PII_RULES`의 각 규칙 객체 맨 앞에 `id`를 넣는다:

| 규칙 | id |
|---|---|
| PEM | `'private_key'` |
| JWT | `'jwt'` |
| AKIA·gh·sk-ant·sk-·xox | `'service_token'` |
| `ENC(` | `'jasypt'` |
| authorization, bearer | `'auth_header'` |
| jdbc:oracle, `://user:pw@` | `'connection_string'` |
| 키 규칙 4개 (property·entry·태그·key=value) | `null` |
| 이메일 | `'email'` |
| 카드 | `'card'` |
| 주민번호 | `'rrn'` |
| 휴대폰, 유선 전화 | `'phone'` |
| 계좌 | `'account'` |
| IP | `'ip'` |

키 규칙 4개 안의 `isSecretKey(g[1])`·`isSecretKey(key)`를 `ctx.isKey(g[1])`·`ctx.isKey(key)`로 바꾼다. `PROPAGATE_MIN` 상수와 그 주석은 지운다 (설정으로 옮김).

- [ ] **Step 4: config.ts 작성**

`hooks/config.ts`:

```ts
import type { PluginOptions } from 'claude-code'
import { RULE_IDS, type RuleId } from './rules.ts'

export type MaskConfig = {
  enabled: ReadonlySet<RuleId>
  // 키로 찾은 값을 프롬프트 전체에서 치환하는 최소 길이 (Y·1 같은 값이 로그 곳곳을 가리는 것 방지)
  propagateMin: number
}

export const DEFAULT_CONFIG: MaskConfig = {
  enabled: new Set(RULE_IDS),
  propagateMin: 6,
}

// 음수·소수·누락은 기본값으로
export const intOption = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback

export const configFromOptions = (options: PluginOptions): MaskConfig => ({
  // 설정에 없는 항목은 켠 것으로 본다 (새 규칙이 추가돼도 기본으로 가린다)
  enabled: new Set(RULE_IDS.filter(id => options[`enable_${id}`] !== false)),
  propagateMin: intOption(options.propagate_min, DEFAULT_CONFIG.propagateMin),
})
```

- [ ] **Step 5: mask.ts가 설정을 받게 수정**

import를 바꾼다:

```ts
import { DEFAULT_CONFIG, type MaskConfig } from './config.ts'
import { type Ctx, digitsOf, isSecretKey, PII_RULES, type Rule, SECRET, SECRET_RULES } from './rules.ts'
```

`maskText` 시그니처와 내부 세 곳:

```ts
export const maskText = (text: string, config: MaskConfig = DEFAULT_CONFIG) => {
```

`ctx` 객체에 추가:

```ts
    isKey: key => config.enabled.has('secret_key') && isSecretKey(key),
```

`keyed` 안의 `PROPAGATE_MIN`을 `config.propagateMin`으로 바꾼다.

`run`이 꺼진 규칙을 건너뛰게:

```ts
  const run = (rules: Rule[]) => {
    for (const rule of rules) {
      if (rule.id !== null && !config.enabled.has(rule.id)) continue
      out = out.replace(rule.re, (m: string, ...rest: unknown[]) => rule.apply(ctx, m, groupsOf(rest)) ?? m)
    }
  }
```

- [ ] **Step 6: register.ts가 options를 넘기게 수정**

```ts
import type { Register } from 'claude-code'
import { configFromOptions } from './config.ts'
import { maskText } from './mask.ts'

export const register: Register = (on, options) => {
  // 설정을 바꾸면 엔진이 모듈을 다시 불러 register가 새 options로 다시 돈다
  const config = configFromOptions(options)
  on('prompt.submit', async ($, e, next) => {
    const { text, counts } = maskText(e.text, config)
```

(이하 기존 본문 그대로)

- [ ] **Step 7: plugin.json에 userConfig 추가**

`.claude-plugin/plugin.json` 전체:

```json
{
  "name": "privacy-mask",
  "version": "0.1.0",
  "description": "프롬프트 전송 전 로컬에서 개인정보(주민번호·전화·이메일·카드·계좌) 마스킹",
  "userConfig": {
    "enable_rrn": { "type": "boolean", "title": "주민·외국인등록번호", "description": "[주민번호#n]으로 전체 가림", "default": true },
    "enable_phone": { "type": "boolean", "title": "전화번호", "description": "[전화번호#n] 010-****-5678 (끝 4자리 노출)", "default": true },
    "enable_email": { "type": "boolean", "title": "이메일", "description": "[이메일#n] 뒤에 아이디 일부와 도메인 노출", "default": true },
    "enable_card": { "type": "boolean", "title": "카드번호", "description": "[카드번호#n] ****-1111 (끝 4자리 노출)", "default": true },
    "enable_account": { "type": "boolean", "title": "계좌번호", "description": "하이픈으로 구분된 10~14자리 숫자", "default": true },
    "enable_ip": { "type": "boolean", "title": "IP", "description": "IPv4 첫·끝 옥텟만 노출", "default": true },
    "enable_private_key": { "type": "boolean", "title": "개인키(PEM)", "description": "-----BEGIN … PRIVATE KEY----- 블록 전체 가림", "default": true },
    "enable_jwt": { "type": "boolean", "title": "JWT", "description": "eyJ…로 시작하는 JWT 전체 가림", "default": true },
    "enable_service_token": { "type": "boolean", "title": "서비스 토큰", "description": "AWS·GitHub·Anthropic·OpenAI·Slack 등 접두어로 알 수 있는 토큰", "default": true },
    "enable_jasypt": { "type": "boolean", "title": "Jasypt 암호문", "description": "ENC(...) 전체 가림", "default": true },
    "enable_auth_header": { "type": "boolean", "title": "Authorization·Bearer", "description": "인증 헤더의 토큰 값", "default": true },
    "enable_connection_string": { "type": "boolean", "title": "접속 문자열 비밀번호", "description": "scheme://user:비밀번호@host, jdbc:oracle 비밀번호", "default": true },
    "enable_secret_key": { "type": "boolean", "title": "비밀값 키", "description": "password·token·secret 등 키 이름에 붙은 값을 [키이름#n]으로", "default": true },
    "propagate_min": { "type": "number", "title": "전체 치환 최소 길이 (숫자·비밀값)", "description": "키로 찾은 값이 이 길이 이상이면 프롬프트의 다른 곳에서도 가린다", "default": 6, "min": 1 }
  }
}
```

- [ ] **Step 8: 검증**

Run: `claude plugin validate . && claude plugin test .`
Expected: validate 통과, 테스트 17개 PASS

- [ ] **Step 9: 커밋 (사용자 확인 후)**

```bash
git add hooks/ .claude-plugin/plugin.json
git commit -m "feat: 규칙별 켜기/끄기와 전체 치환 최소 길이 설정 추가"
```

---

### Task 3: 출력 형식 정리 — 비밀값 종류별 라벨, `[IP#n]`, 앞뒤 N자 노출

**Files:**
- Modify: `hooks/rules.ts`, `hooks/mask.ts`, `hooks/config.ts`, `.claude-plugin/plugin.json`
- Test: `hooks/register.test.ts`

**Interfaces:**
- Consumes: Task 2의 `Ctx`, `MaskConfig`, `intOption`
- Produces:
  - `rules.ts`: `keepEnds(s: string, n: number): string`, `serviceLabel(token: string): string`, `Ctx.tag(label: string, norm: string)` (호출부가 비교 기준값을 넘김), `Ctx.keep: number`
  - `config.ts`: `MaskConfig.partialKeep: number` (기본 2)

- [ ] **Step 1: 기존 테스트 기대값을 새 형식으로 바꾸고 새 테스트 추가**

`hooks/register.test.ts`에서:

첫 테스트 기대값:
```ts
    'rrn=[주민번호#1] tel=[전화번호#1] 010-****-5678 mail=[이메일#1] ****@test.co.kr card=[카드번호#1] ****-1111 acct=[계좌번호#1] 11*-***-****89',
```

`비밀값: Authorization 헤더 · JDBC 접속 문자열 · Jasypt ENC · JWT` 기대값:
```ts
    'Authorization: Bearer [인증토큰#1] jdbc:oracle:thin:scott/[접속비밀번호#1]@[IP#1] 10.***.***.40:1521:ORCL pw=[암호문#1] jwt [JWT#1]',
```

`IP는 첫·끝 옥텟만 …` 기대값:
```ts
  expect(seen).toBe('from [IP#1] 192.***.***.1 to 127.0.0.1 at 2026-10-08')
```

`하이픈으로 이어지는 파일명 …` 기대값:
```ts
    'fileName: 10000-0001-0002-1-1-2026-report-final.pdf, doc-110-123-456789 acct=[계좌번호#1] 11*-***-****89.',
```

새 테스트:

```ts
test('일부 노출: 이메일 아이디·계좌는 앞뒤 2자, 같은 IP는 같은 번호', async ($, on) => {
  const [seen] = await submitAll($, on, ['gildong.hong@test.co.kr 10.1.2.3 10.1.2.3 10.1.2.4'])
  expect(seen).toBe(
    '[이메일#1] gi*****.**ng@test.co.kr [IP#1] 10.***.***.3 [IP#1] 10.***.***.3 [IP#2] 10.***.***.4',
  )
})

test('설정: 일부 노출 글자 수', { options: { partial_keep: 1 } }, async ($, on) => {
  const [seen] = await submitAll($, on, ['acct=110-123-456789'])
  expect(seen).toBe('acct=[계좌번호#1] 1**-***-*****9')
})

test('비밀값: 서비스 토큰은 종류별 라벨', async ($, on) => {
  const aws = 'AKIA' + 'A'.repeat(16)
  const gh = 'ghp_' + 'a'.repeat(36)
  const [seen] = await submitAll($, on, [`k1=${aws} k2=${gh} k3=${aws}`])
  expect(seen).toBe('k1=[AWS키#1] k2=[GitHub토큰#1] k3=[AWS키#1]')
})
```

- [ ] **Step 2: 실패 확인**

Run: `claude plugin test .`
Expected: 위에서 바꾼·추가한 테스트 FAIL (`[비밀값#n]`, `***@`, `****6789`, 번호 없는 IP가 나옴)

- [ ] **Step 3: rules.ts — 헬퍼 추가**

`digitsOf` 아래에 추가:

```ts
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
```

`Ctx`에 `keep`을 추가하고 `tag` 주석을 바꾼다:

```ts
  // 같은 프롬프트 안에서 같은 norm → 같은 번호. norm은 호출부가 정한다 (전화는 숫자만, 이메일은 소문자 등)
  tag: (label: string, norm: string) => string
  // 일부 노출 "앞뒤 N자"의 N
  keep: number
```

- [ ] **Step 4: rules.ts — 비밀값 형식 규칙의 라벨·norm 변경**

`SECRET_RULES`의 형식 규칙 apply를 아래처럼 바꾼다 (정규식은 그대로):

```ts
  // PEM
    apply: (ctx, m) => ctx.tag('개인키', m),
  // JWT
    apply: (ctx, m) => ctx.tag('JWT', m),
  // 서비스 토큰
    apply: (ctx, m) => ctx.tag(serviceLabel(m), m),
  // ENC(
    apply: (ctx, m) => ctx.tag('암호문', m),
  // authorization, bearer
    apply: (ctx, _m, g) => g[0] + ctx.tag('인증토큰', g[1]),
  // jdbc:oracle
    apply: (ctx, _m, g) => g[0] + ctx.tag('접속비밀번호', g[1]) + g[2],
  // scheme://user:pw@
    apply: (ctx, _m, g) => g[0] + ctx.tag('접속비밀번호', g[1]) + g[2],
```

- [ ] **Step 5: rules.ts — 개인정보 규칙의 출력 변경**

이메일 규칙 전체:

```ts
  {
    id: 'email',
    re: /([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
    apply: (ctx, m, g) => `${ctx.tag('이메일', m.toLowerCase())} ${keepEnds(g[0], ctx.keep)}@${g[1]}`,
  },
```

카드: `ctx.tag('카드번호', m)` → `ctx.tag('카드번호', d)`
주민번호: `ctx.tag('주민번호', m)` → `ctx.tag('주민번호', digitsOf(m))`
휴대폰: `ctx.tag('전화번호', m)` → `ctx.tag('전화번호', d)`
유선 전화: `ctx.tag('전화번호', m)` → `ctx.tag('전화번호', digitsOf(m))`

계좌 apply:

```ts
    apply: (ctx, m) => {
      const d = digitsOf(m)
      return d.length >= 10 && d.length <= 14 ? `${ctx.tag('계좌번호', d)} ${keepEnds(m, ctx.keep)}` : null
    },
```

IP apply:

```ts
    apply: (ctx, m, g) => {
      if (g.some(o => Number(o) > 255) || m === '127.0.0.1' || m === '0.0.0.0') return null
      return `${ctx.tag('IP', m)} ${g[0]}.***.***.${g[3]}`
    },
```

- [ ] **Step 6: mask.ts — tag가 norm을 그대로 쓰게**

`ctx.tag`를 아래로 바꾸고 `ctx`에 `keep`을 추가한다:

```ts
    tag: (label, norm) => {
      ctx.count(label)
      return placeholder(label, norm)
    },
    keep: config.partialKeep,
```

이제 안 쓰는 import(`digitsOf`)를 지운다.

- [ ] **Step 7: config.ts·plugin.json에 partial_keep 추가**

`MaskConfig`에 `partialKeep: number` 추가, `DEFAULT_CONFIG`에 `partialKeep: 2`, `configFromOptions`에:

```ts
  partialKeep: intOption(options.partial_keep, DEFAULT_CONFIG.partialKeep),
```

`plugin.json`의 `userConfig`에:

```json
    "partial_keep": { "type": "number", "title": "일부 노출 글자 수", "description": "계좌·사업자번호·이메일 아이디 등에서 앞뒤로 보여 줄 글자 수", "default": 2, "min": 0 }
```

- [ ] **Step 8: 검증**

Run: `claude plugin validate . && claude plugin test .`
Expected: 테스트 20개 PASS

- [ ] **Step 9: 커밋 (사용자 확인 후)**

```bash
git add hooks/ .claude-plugin/plugin.json
git commit -m "feat: 비밀값 종류별 라벨과 일부 노출 형식 정리"
```

---

### Task 4: 운전면허·사업자번호 규칙

**Files:**
- Modify: `hooks/rules.ts`, `.claude-plugin/plugin.json`
- Test: `hooks/register.test.ts`

**Interfaces:**
- Consumes: `keepEnds`, `digitsOf`, `Ctx.keep`
- Produces: `rules.ts`: `isBizNo(digits: string): boolean`, `RULE_IDS`에 `'driver_license'`, `'biz_no'`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('운전면허·사업자번호는 계좌보다 먼저 구분하고, 체크섬이 틀리면 계좌로 본다', async ($, on) => {
  const [seen] = await submitAll($, on, [
    'lic=11-23-456789-01 old=서울 89-123456-78 biz=123-45-67891 bad=123-45-67890 other=99-23-456789-01',
  ])
  expect(seen).toBe(
    'lic=[운전면허#1] old=[운전면허#2] biz=[사업자번호#1] 12*-**-***91 bad=[계좌번호#1] 12*-**-***90 other=[계좌번호#2] 99-**-******-01',
  )
})

test('설정: 운전면허를 끄면 계좌 규칙이 잡는다', { options: { enable_driver_license: false } }, async ($, on) => {
  const [seen] = await submitAll($, on, ['lic=11-23-456789-01'])
  expect(seen).toBe('lic=[계좌번호#1] 11-**-******-01')
})
```

`123-45-67891`은 체크섬을 통과하도록 계산한 값이다: 1·1+2·3+3·7+4·1+5·3+6·7+7·1+8·3+9·5 = 165, ⌊9·5/10⌋ = 4, 합 169, (10 − 9) mod 10 = 1.

- [ ] **Step 2: 실패 확인**

Run: `claude plugin test .`
Expected: 두 테스트 FAIL (면허·사업자번호가 계좌로 나옴)

- [ ] **Step 3: 구현**

`RULE_IDS`에서 `'phone'` 뒤에 `'driver_license'`, `'card'` 뒤에 `'biz_no'`를 넣는다.

`isCardBin` 아래에 추가:

```ts
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
```

`PII_RULES`에서 계좌 규칙 **바로 앞**에 두 규칙을 넣는다 (엄격한 형식부터 봐야 계좌로 잘못 잡히지 않는다):

```ts
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
```

`plugin.json`의 `userConfig`에:

```json
    "enable_driver_license": { "type": "boolean", "title": "운전면허번호", "description": "[운전면허#n]으로 전체 가림 (지역 코드 11~26·28)", "default": true },
    "enable_biz_no": { "type": "boolean", "title": "사업자등록번호", "description": "체크섬이 맞는 000-00-00000, 앞뒤 일부 노출", "default": true }
```

- [ ] **Step 4: 검증**

Run: `claude plugin validate . && claude plugin test .`
Expected: 테스트 22개 PASS

- [ ] **Step 5: 커밋 (사용자 확인 후)**

```bash
git add hooks/ .claude-plugin/plugin.json
git commit -m "feat: 운전면허·사업자등록번호 마스킹 추가"
```

---

### Task 5: 비밀값 형식 추가 — 서비스 토큰·웹훅·Azure·쿠키

**Files:**
- Modify: `hooks/rules.ts`, `.claude-plugin/plugin.json`
- Test: `hooks/register.test.ts`

**Interfaces:**
- Consumes: `serviceLabel`, `SERVICE_LABELS`
- Produces: `RULE_IDS`에 `'cookie'`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('비밀값: 추가 서비스 토큰', async ($, on) => {
  const t = {
    google: 'AIza' + 'x'.repeat(35),
    ghPat: 'github_pat_' + 'a'.repeat(22),
    gitlab: 'glpat-' + 'b'.repeat(20),
    stripe: 'sk_live_' + 'c'.repeat(24),
    stripeR: 'rk_test_' + 'd'.repeat(24),
    npm: 'npm_' + 'e'.repeat(36),
    awsTmp: 'ASIA' + 'F'.repeat(16),
    openaiProj: 'sk-proj-' + 'g'.repeat(20),
  }
  const [seen] = await submitAll($, on, [Object.values(t).join(' ')])
  expect(seen).toBe(
    '[Google키#1] [GitHub토큰#1] [GitLab토큰#1] [Stripe키#1] [Stripe키#2] [npm토큰#1] [AWS키#1] [OpenAI키#1]',
  )
})

test('비밀값: 하이픈이 이어지는 sk- 단어는 토큰으로 보지 않는다', async ($, on) => {
  const text = 'pip install sk-learn-model-training-pipeline'
  const [seen] = await submitAll($, on, [text])
  expect(seen).toBe(text)
})

test('비밀값: 웹훅 URL · Azure AccountKey', async ($, on) => {
  const key = 'k'.repeat(20) + '=='
  const [seen] = await submitAll($, on, [
    `slack https://hooks.slack.com/services/T000/B000/XXXX discord https://discord.com/api/webhooks/123/abc-def az AccountName=demo;AccountKey=${key};EndpointSuffix=core.windows.net`,
  ])
  expect(seen).toBe(
    'slack [웹훅URL#1] discord [웹훅URL#2] az AccountName=demo;AccountKey=[접속비밀번호#1];EndpointSuffix=core.windows.net',
  )
})

test('비밀값: Cookie 헤더는 값 전체, CRLF 다음 줄은 그대로', async ($, on) => {
  const [seen] = await submitAll($, on, ['Cookie: SESSION=abc123; theme=dark\r\nHost: x\n"set-cookie": "a=1"'])
  expect(seen).toBe('Cookie: [쿠키#1]\r\nHost: x\n"set-cookie": "[쿠키#2]"')
})
```

- [ ] **Step 2: 실패 확인**

Run: `claude plugin test .`
Expected: 세 테스트 FAIL, `sk-learn` 테스트는 PASS (현재 동작 고정용)

- [ ] **Step 3: 구현**

`RULE_IDS`에서 `'connection_string'` 뒤에 `'cookie'`를 넣는다.

`SERVICE_LABELS` 전체를 바꾼다:

```ts
const SERVICE_LABELS: [RegExp, string][] = [
  [/^(AKIA|ASIA)/, 'AWS키'],
  [/^(gh[pousr]_|github_pat_)/, 'GitHub토큰'],
  [/^glpat-/, 'GitLab토큰'],
  [/^sk-ant-/, 'Anthropic키'],
  [/^sk-/, 'OpenAI키'],
  [/^xox/, 'Slack토큰'],
  [/^AIza/, 'Google키'],
  [/^[sr]k_(live|test)_/, 'Stripe키'],
  [/^npm_/, 'npm토큰'],
]
```

서비스 토큰 규칙의 정규식을 바꾼다 (sk-proj- 는 하이픈을 허용하지만 일반 sk- 는 허용하지 않아 `sk-learn-…` 같은 단어를 피한다):

```ts
    re: /\b(?:(?:AKIA|ASIA)[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{22,}|glpat-[\w-]{20,}|sk-ant-[\w-]{20,}|sk-proj-[\w-]{20,}|sk-[A-Za-z0-9]{20,}|xox[abprs]-[\w-]{10,}|AIza[\w-]{35}|[sr]k_(?:live|test)_[0-9A-Za-z]{24,}|npm_[A-Za-z0-9]{36})\b/g,
```

서비스 토큰 규칙 **바로 앞**에 추가:

```ts
  {
    id: 'service_token',
    re: /https:\/\/(?:hooks\.slack\.com\/services\/[\w/-]+|(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+)/g,
    apply: (ctx, m) => ctx.tag('웹훅URL', m),
  },
```

`scheme://user:password@host` 규칙 뒤에 추가:

```ts
  {
    // Azure 접속 문자열
    id: 'connection_string',
    re: /(\b(?:AccountKey|SharedAccessKey)=)([A-Za-z0-9+/]+=*)/g,
    apply: (ctx, _m, g) => g[0] + ctx.tag('접속비밀번호', g[1]),
  },
  {
    // Cookie·Set-Cookie 헤더: 값 안의 이름=값 쌍을 하나하나 보지 않고 통째로 가린다
    id: 'cookie',
    re: /(["']?\b(?:set-)?cookie["']?\s*:\s*)("[^"\n]*"|'[^'\n]*'|[^\r\n]+)/gi,
    apply: (ctx, _m, g) => {
      const [head, v] = g
      const q = v[0]
      if ((q === '"' || q === "'") && v.length >= 2 && v.endsWith(q)) {
        return v.length > 2 ? `${head}${q}${ctx.tag('쿠키', v.slice(1, -1))}${q}` : null
      }
      return head + ctx.tag('쿠키', v)
    },
  },
```

`plugin.json`의 `userConfig`에:

```json
    "enable_cookie": { "type": "boolean", "title": "쿠키", "description": "Cookie·Set-Cookie 헤더 값 전체", "default": true }
```

`enable_service_token`의 description을 `"AWS·GitHub·GitLab·Anthropic·OpenAI·Slack·Google·Stripe·npm 토큰, Slack·Discord 웹훅 URL"`로, `enable_connection_string`의 description 끝에 `", Azure AccountKey"`를 붙인다.

- [ ] **Step 4: 검증**

Run: `claude plugin validate . && claude plugin test .`
Expected: 테스트 26개 PASS

- [ ] **Step 5: 커밋 (사용자 확인 후)**

```bash
git add hooks/ .claude-plugin/plugin.json
git commit -m "feat: 서비스 토큰·웹훅·Azure·쿠키 비밀값 형식 추가"
```

---

### Task 6: 개인정보 키·사용자 키

**Files:**
- Modify: `hooks/rules.ts`, `hooks/config.ts`, `hooks/mask.ts`, `.claude-plugin/plugin.json`
- Test: `hooks/register.test.ts`

**Interfaces:**
- Consumes: Task 2의 `Ctx.isKey`
- Produces:
  - `rules.ts`: `type KeyKind = 'secret' | 'pii'`, `keyTokens(key: string): string[]`, `PII_KEY_IDS`, `PII_KEY_MATCHERS: Record<PiiKeyId, (key: string) => boolean>`, `normKey(key: string): string`, `isCustomKey(custom: readonly string[], key: string): boolean`. `Ctx.isKey` → `Ctx.keyKind: (key: string) => KeyKind | null`, `Ctx.keyed(key, value, kind: KeyKind)`
  - `config.ts`: `MaskConfig.propagateMinText: number`(기본 2), `MaskConfig.customKeys: readonly string[]`(정규화된 값)

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('개인정보 키: 이름은 다른 곳에 나와도 가리고, 기술 이름·userName은 건드리지 않는다', async ($, on) => {
  const [seen] = await submitAll($, on, [
    'custName=홍길동 주문자 홍길동 결제 cust_nm=김철수 fileName=a.txt tempName=x userName=hong',
  ])
  expect(seen).toBe(
    'custName=[custName#1] 주문자 [custName#1] 결제 cust_nm=[cust_nm#1] fileName=a.txt tempName=x userName=hong',
  )
})

test('개인정보 키: 생년월일·카드 부가정보, 짧은 숫자는 전체 치환하지 않는다', async ($, on) => {
  const [seen] = await submitAll($, on, [
    'birthDate=19900101 dob=1990-01-01 cvc=123 cardExpiry=12/29 rebirth=yes again 19900101 123',
  ])
  expect(seen).toBe(
    'birthDate=[birthDate#1] dob=[dob#1] cvc=[cvc#1] cardExpiry=[cardExpiry#1] rebirth=yes again [birthDate#1] 123',
  )
})

test('사용자 키: 대소문자·_·- 무시, 마지막 . 뒤 이름도 비교', { options: { custom_keys: ['signKey', 'orderMemo'] } }, async ($, on) => {
  const [seen] = await submitAll($, on, ['sign_key=abcdefgh order.orderMemo=부재시연락 note=부재시연락'])
  expect(seen).toBe('sign_key=[sign_key#1] order.orderMemo=[order.orderMemo#1] note=[order.orderMemo#1]')
})

test('설정: 개인정보 문자 값 최소 길이 · 생년월일 키 끄기', { options: { propagate_min_text: 4, enable_birth_key: false } }, async ($, on) => {
  const [seen] = await submitAll($, on, ['custName=홍길동 주문자 홍길동 birth=19900101'])
  expect(seen).toBe('custName=[custName#1] 주문자 홍길동 birth=19900101')
})
```

- [ ] **Step 2: 실패 확인**

Run: `claude plugin test .`
Expected: 네 테스트 FAIL

- [ ] **Step 3: rules.ts — 키 판별 추가**

`RULE_IDS`에서 `'ip'` 뒤에 `'name_key'`, `'birth_key'`, `'card_extra_key'`를 넣는다.

`isSecretKey` 아래에 추가:

```ts
export type KeyKind = 'secret' | 'pii'

// 마지막 . 뒤 이름을 _ - 공백·camelCase 경계로 나눈다: order.custName → [cust, name]
export const keyTokens = (key: string) =>
  (key.split('.').pop() ?? '')
    .split(/[_\-\s]+|(?<=[a-z0-9])(?=[A-Z])/)
    .filter(Boolean)
    .map(t => t.toLowerCase())

const NAME_OWNERS = new Set(['cust', 'customer', 'member', 'mbr', 'buyer', 'receiver', 'recipient', 'holder', 'owner', 'emp', 'employee', 'real', 'full'])
const BIRTH = new Set(['birth', 'birthday', 'birthdate', 'birthdt', 'birthymd', 'brthdy', 'dob'])

export const PII_KEY_IDS = ['name_key', 'birth_key', 'card_extra_key'] as const
export type PiiKeyId = (typeof PII_KEY_IDS)[number]

// "name"은 기술 용어(fileName·hostName)에도 쓰여서 앞에 붙는 말로 거른다. 놓친 키는 사용자 키로 보완한다
export const PII_KEY_MATCHERS: Record<PiiKeyId, (key: string) => boolean> = {
  name_key: key => {
    const t = keyTokens(key)
    const last = t.at(-1) ?? ''
    const prev = t.at(-2) ?? ''
    return (
      ((last === 'name' || last === 'nm') && NAME_OWNERS.has(prev)) ||
      new RegExp(`^(${[...NAME_OWNERS].join('|')})(name|nm)$`).test(last) ||
      /^(성명|이름|고객명)$/.test(last)
    )
  },
  birth_key: key => {
    const t = keyTokens(key)
    const last = t.at(-1) ?? ''
    const prev = t.at(-2) ?? ''
    return BIRTH.has(last) || (prev === 'birth' && /^(date|dt|day|ymd)$/.test(last)) || /생년월일$/.test(last)
  },
  card_extra_key: key => {
    const t = keyTokens(key)
    const last = t.at(-1) ?? ''
    return /^(cvc|cvv)2?$/.test(last) || /card(exp|expiry|expdate|expiration)$/.test(t.slice(-3).join(''))
  },
}

export const normKey = (key: string) => key.toLowerCase().replace(/[_-]/g, '')

// 사용자 키는 키 전체 또는 마지막 . 뒤 이름과 비교한다 (custom은 normKey로 정규화된 값)
export const isCustomKey = (custom: readonly string[], key: string) => {
  const full = normKey(key)
  const last = full.split('.').pop() ?? full
  return custom.some(c => c === full || c === last)
}
```

`Ctx`의 `isKey`·`keyed`를 바꾼다:

```ts
  // 키로 찾은 값: 키 이름을 라벨로 쓰고, 같은 값은 프롬프트 전체에서 가린다
  keyed: (key: string, value: string, kind: KeyKind) => string
  // 가릴 키인가, 어떤 종류인가 (켜진 키 규칙 기준). null이면 가리지 않는다
  keyKind: (key: string) => KeyKind | null
```

키 규칙 4개를 `keyKind`로 바꾼다:

```ts
  {
    // <property name="password" value="..."/>
    id: null,
    re: /((?:name|key)\s*=\s*"([^"]+)"\s+value\s*=\s*")([^"]*)(")/g,
    apply: (ctx, _m, g) => {
      const kind = ctx.keyKind(g[1])
      return kind && g[2] ? g[0] + ctx.keyed(g[1], g[2], kind) + g[3] : null
    },
  },
  {
    // <entry key="password">...</entry>
    id: null,
    re: /(key\s*=\s*"([^"]+)"[^>]*>)([^<]+)(<)/g,
    apply: (ctx, _m, g) => {
      const kind = ctx.keyKind(g[1])
      return kind ? g[0] + ctx.keyed(g[1], g[2], kind) + g[3] : null
    },
  },
  {
    // <password>...</password>
    id: null,
    re: /(<([A-Za-z0-9_.-]+)(?:\s[^>]*)?>)([^<]+)(<\/\2>)/g,
    apply: (ctx, _m, g) => {
      const kind = ctx.keyKind(g[1])
      return kind ? g[0] + ctx.keyed(g[1], g[2], kind) + g[3] : null
    },
  },
  {
    // key=value · key: value · "key": "value"
    id: null,
    re: /(["']?)([A-Za-z0-9_.\-가-힣]+)\1(\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s,;&)}\]<>"']+)/g,
    apply: (ctx, _m, g) => {
      const [q, key, sep, v] = g
      const kind = ctx.keyKind(key)
      if (!kind || v.startsWith('[') || /^(bearer|basic)$/i.test(v)) return null
      const masked = maskValue(ctx, key, v, kind)
      return masked === null ? null : q + key + q + sep + masked
    },
  },
```

`maskValue`에 `kind`를 넘긴다:

```ts
const maskValue = (ctx: Ctx, key: string, v: string, kind: KeyKind) => {
  const q = v[0]
  if ((q === '"' || q === "'") && v.length >= 2 && v.endsWith(q)) {
    const inner = v.slice(1, -1)
    return inner ? `${q}${ctx.keyed(key, inner, kind)}${q}` : null
  }
  return ctx.keyed(key, v, kind)
}
```

- [ ] **Step 4: config.ts**

`MaskConfig`에 추가:

```ts
  // 개인정보 키·사용자 키의 문자 값 전체 치환 최소 길이 (이름은 2~4자)
  propagateMinText: number
  // 사용자 키 이름 (normKey로 정규화)
  customKeys: readonly string[]
```

`DEFAULT_CONFIG`에 `propagateMinText: 2, customKeys: []`, `configFromOptions`에:

```ts
  propagateMinText: intOption(options.propagate_min_text, DEFAULT_CONFIG.propagateMinText),
  customKeys: Array.isArray(options.custom_keys) ? options.custom_keys.map(normKey).filter(Boolean) : [],
```

import에 `normKey` 추가: `import { normKey, RULE_IDS, type RuleId } from './rules.ts'`

- [ ] **Step 5: mask.ts**

import에 `isCustomKey, type KeyKind, PII_KEY_IDS, PII_KEY_MATCHERS` 추가.

`ctx`의 `isKey`를 지우고 `keyKind`로:

```ts
    keyKind: key => {
      if (config.enabled.has('secret_key') && isSecretKey(key)) return 'secret'
      if (isCustomKey(config.customKeys, key)) return 'pii'
      return PII_KEY_IDS.some(id => config.enabled.has(id) && PII_KEY_MATCHERS[id](key)) ? 'pii' : null
    },
```

`keyed` 전체:

```ts
    keyed: (key, value, kind) => {
      // <entry key="password"> 뒤의 줄바꿈·들여쓰기 같은 공백뿐인 값은 비밀값이 아니다
      if (!value.trim()) return value
      ctx.count(kind === 'secret' ? SECRET : '개인정보')
      const known = keyedValues.get(value)
      if (known !== undefined) return known
      const ph = placeholder(key, value)
      // 숫자로만 된 값과 비밀값은 짧으면 다른 뜻으로 흔히 쓰여(cvc=123, flag_pw=Y) 기준을 높게 둔다
      const min = kind === 'secret' || /^[\d.-]+$/.test(value) ? config.propagateMin : config.propagateMinText
      // 공백이 낀 값은 전체 치환하지 않는다 (줄바꿈·들여쓰기가 프롬프트 곳곳에서 바뀌는 것 방지)
      if (value.length >= min && !/\s/.test(value)) keyedValues.set(value, ph)
      return ph
    },
```

전체 치환 루프 안의 `ctx.count(SECRET)`는 그대로 둔다.

- [ ] **Step 6: plugin.json**

`userConfig`에:

```json
    "enable_name_key": { "type": "boolean", "title": "이름 키", "description": "custName·memberNm·성명 등 이름 키의 값 (userName은 제외)", "default": true },
    "enable_birth_key": { "type": "boolean", "title": "생년월일 키", "description": "birth·birthDate·dob·생년월일 키의 값", "default": true },
    "enable_card_extra_key": { "type": "boolean", "title": "카드 부가정보 키", "description": "cvc·cvv·cardExpiry 키의 값", "default": true },
    "propagate_min_text": { "type": "number", "title": "전체 치환 최소 길이 (개인정보 문자 값)", "description": "이름 등 개인정보 키로 찾은 문자 값이 이 길이 이상이면 다른 곳에서도 가린다", "default": 2, "min": 1 },
    "custom_keys": { "type": "string", "multiple": true, "title": "추가로 가릴 키 이름", "description": "대소문자·_·-는 무시한다. 값은 [키이름#n]으로 가린다", "default": [] }
```

- [ ] **Step 7: 검증**

Run: `claude plugin validate . && claude plugin test .`
Expected: 테스트 30개 PASS

- [ ] **Step 8: 커밋 (사용자 확인 후)**

```bash
git add hooks/ .claude-plugin/plugin.json
git commit -m "feat: 개인정보 키와 사용자 키 마스킹 추가"
```

---

### Task 7: `###…###` 마스킹 제외 구간

**Files:**
- Modify: `hooks/mask.ts`, `hooks/register.ts`
- Test: `hooks/register.test.ts`, `hooks/mask.test.ts`

**Interfaces:**
- Consumes: Task 6까지의 `maskText`
- Produces: `mask.ts`: `type Segment = { text: string; raw: boolean }`, `splitBypass(text: string): Segment[]`, `isAllBypass(segments: Segment[]): boolean`, `joinSegments(segments: Segment[]): string`

- [ ] **Step 1: 실패하는 테스트 작성**

`hooks/register.test.ts`:

```ts
test('제외 구간: ###…### 안은 원문, 구분자는 지운다', async ($, on) => {
  const [seen] = await submitAll($, on, ['###password=abc123### tel=010-1234-5678 ###a b### ###c###'])
  expect(seen).toBe('password=abc123 tel=[전화번호#1] 010-****-5678 a b c')
})

test('제외 구간: 안의 키 값은 수집하지 않는다', async ($, on) => {
  const [seen] = await submitAll($, on, ['###pw=abcdefg### other abcdefg'])
  expect(seen).toBe('pw=abcdefg other abcdefg')
})

test('제외 구간: 제목·장식선·닫히지 않은 ###은 구분자가 아니다', async ($, on) => {
  const text = '### 제목\npw=abcdef\n#### 소제목\n##########\n###열린'
  const [seen] = await submitAll($, on, [text])
  expect(seen).toBe('### 제목\npw=[pw#1]\n#### 소제목\n##########\n###열린')
})

test('제외 구간: 여러 줄', async ($, on) => {
  const [seen] = await submitAll($, on, ['###line1\npw=abcdef###'])
  expect(seen).toBe('line1\npw=abcdef')
})
```

`hooks/mask.test.ts`:

```ts
import { isAllBypass, maskText, splitBypass } from './mask.ts'

test('isAllBypass: 구간 밖이 공백뿐이면 전체 제외', () => {
  expect(isAllBypass(splitBypass('  ###a=1###\n'))).toBe(true)
  expect(isAllBypass(splitBypass('###a=1### b'))).toBe(false)
  expect(isAllBypass(splitBypass('plain'))).toBe(false)
})
```

(기존 import 줄을 위 import로 바꾼다)

- [ ] **Step 2: 실패 확인**

Run: `claude plugin test .`
Expected: 제외 구간 테스트 FAIL, `splitBypass` import 실패

- [ ] **Step 3: mask.ts — 조각 단위로 처리**

`groupsOf` 아래에 추가:

```ts
export type Segment = { text: string; raw: boolean }

// ### 바로 안쪽 양 끝이 공백·#이 아닐 때만 구분자 (### 제목, ##########와 구분). 여러 줄 가능
const BYPASS = /(?<!#)###(?=[^\s#])([\s\S]*?[^\s#])###(?!#)/g

export const splitBypass = (text: string): Segment[] => {
  const out: Segment[] = []
  let last = 0
  for (const m of text.matchAll(BYPASS)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), raw: false })
    out.push({ text: m[1] ?? '', raw: true })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last), raw: false })
  return out
}

export const isAllBypass = (segments: Segment[]) =>
  segments.some(s => s.raw) && segments.every(s => s.raw || !s.text.trim())

export const joinSegments = (segments: Segment[]) => segments.map(s => s.text).join('')
```

`maskText` 안에서 `let out = text`를 지우고 조각 배열로 바꾼다:

```ts
  const segments = splitBypass(text)
  // 제외 구간은 어떤 단계에도 들어가지 않는다 (키 값 수집 포함)
  const each = (fn: (s: string) => string) => {
    for (const seg of segments) if (!seg.raw) seg.text = fn(seg.text)
  }

  const run = (rules: Rule[]) => {
    for (const rule of rules) {
      if (rule.id !== null && !config.enabled.has(rule.id)) continue
      each(s => s.replace(rule.re, (m: string, ...rest: unknown[]) => rule.apply(ctx, m, groupsOf(rest)) ?? m))
    }
  }
```

전체 치환 루프의 `out = out.replace(re, …)`를 `each(s => s.replace(re, …))`로 바꾸고, 마지막 반환을:

```ts
  return { text: joinSegments(segments), counts }
```

- [ ] **Step 4: register.ts — 전체 제외면 설정·마스킹 없이 보낸다**

```ts
import { isAllBypass, joinSegments, maskText, splitBypass } from './mask.ts'
```

훅 본문 맨 앞:

```ts
    // 전부 제외 구간이면 설정을 읽지 않는다 (설정 오류로 막힌 상황에서도 보낼 수 있게)
    const segments = splitBypass(e.text)
    if (isAllBypass(segments)) return next({ ...e, text: joinSegments(segments) })
```

마스킹 결과가 없을 때도 구분자를 지운 텍스트를 보내야 하므로:

```ts
    const { text, counts } = maskText(e.text, config)
    const labels = Object.keys(counts)
    if (labels.length === 0) return next({ ...e, text })
```

- [ ] **Step 5: 검증**

Run: `claude plugin validate . && claude plugin test .`
Expected: 테스트 35개 PASS

- [ ] **Step 6: 커밋 (사용자 확인 후)**

```bash
git add hooks/
git commit -m "feat: ###으로 감싼 구간 마스킹 제외"
```

---

### Task 8: 사용자 정규식 파일과 설정 오류 시 전송 차단

**Files:**
- Modify: `hooks/config.ts`, `hooks/mask.ts`, `hooks/register.ts`, `.claude-plugin/plugin.json`
- Test: `hooks/config.test.ts`(신규), `hooks/mask.test.ts`, `hooks/register.test.ts`

**Interfaces:**
- Consumes: `keepEnds`, `splitBypass`
- Produces:
  - `config.ts`: `type UserPattern = { label: string; source: string; partial: boolean }`, `MaskConfig.patterns: readonly UserPattern[]`, `type Loaded = { ok: true; patterns: UserPattern[] } | { ok: false; reason: string }`, `parsePatterns(text: string): Loaded`, `loadPatterns(fs: { read: (path: string) => Promise<unknown> }, path: string): Promise<Loaded>`, `configFromOptions`가 `MaskConfig & { patternsFile: string }` 반환

- [ ] **Step 1: 실패하는 테스트 작성**

`hooks/config.test.ts`:

```ts
import { expect, test } from 'claude-code/testing'
import { loadPatterns, parsePatterns } from './config.ts'

test('parsePatterns: 정상', () => {
  expect(parsePatterns('[{"label":"사번","regex":"EMP\\\\d{6}"},{"label":"여권","regex":"[A-Z]\\\\d{8}","partial":true}]')).toEqual({
    ok: true,
    patterns: [
      { label: '사번', source: 'EMP\\d{6}', partial: false },
      { label: '여권', source: '[A-Z]\\d{8}', partial: true },
    ],
  })
})

test('parsePatterns: 오류는 몇 번째 항목인지 알린다', () => {
  expect(parsePatterns('{')).toEqual({ ok: false, reason: '정규식 파일이 올바른 JSON이 아닙니다' })
  expect(parsePatterns('{}')).toEqual({ ok: false, reason: '정규식 파일은 배열이어야 합니다' })
  expect(parsePatterns('[{"regex":"a"}]')).toEqual({ ok: false, reason: '정규식 파일 1번째 항목: label이 없습니다' })
  expect(parsePatterns('[{"label":"a","regex":"a"},{"label":"b","regex":"("}]')).toEqual({
    ok: false,
    reason: '정규식 파일 2번째 항목: regex 문법 오류',
  })
  expect(parsePatterns('[{"label":"a#1","regex":"a"}]')).toEqual({
    ok: false,
    reason: '정규식 파일 1번째 항목: label에 [ ] # 줄바꿈은 쓸 수 없습니다',
  })
  expect(parsePatterns('[{"label":"a","regex":"a","partial":"yes"}]')).toEqual({
    ok: false,
    reason: '정규식 파일 1번째 항목: partial은 true 또는 false여야 합니다',
  })
})

test('loadPatterns: 경로가 비면 건너뛰고, 못 읽으면 경로와 함께 오류', async () => {
  const fail = { read: async () => Promise.reject(new Error('ENOENT')) }
  expect(await loadPatterns(fail, '')).toEqual({ ok: true, patterns: [] })
  expect(await loadPatterns(fail, '/tmp/p.json')).toEqual({ ok: false, reason: '정규식 파일을 읽을 수 없습니다 (/tmp/p.json)' })
  const ok = { read: async () => '[{"label":"사번","regex":"EMP\\\\d{6}"}]' }
  expect(await loadPatterns(ok, '/tmp/p.json')).toEqual({ ok: true, patterns: [{ label: '사번', source: 'EMP\\d{6}', partial: false }] })
})
```

`hooks/mask.test.ts`에 추가 (import에 `DEFAULT_CONFIG`를 `./config.ts`에서 가져온다):

```ts
import { DEFAULT_CONFIG } from './config.ts'

const withPatterns = (patterns: { label: string; source: string; partial: boolean }[]) => ({ ...DEFAULT_CONFIG, patterns })

test('사용자 정규식: 전체 가림 · 일부 노출', () => {
  const config = withPatterns([
    { label: '사번', source: 'EMP\\d{6}', partial: false },
    { label: '여권번호', source: '[A-Z]\\d{8}', partial: true },
  ])
  expect(maskText('emp EMP123456 / passport M12345678 / EMP123456', config).text).toBe(
    'emp [사번#1] / passport [여권번호#1] M1*****78 / [사번#1]',
  )
})

test('사용자 정규식: 이미 넣은 자리표시자 안은 건드리지 않는다', () => {
  expect(maskText('pw=abcdef 7', withPatterns([{ label: '숫자', source: '\\d+', partial: false }])).text).toBe(
    'pw=[pw#1] [숫자#1]',
  )
})

test('사용자 정규식: 빈 문자열에 매치되는 정규식은 원문 유지', () => {
  expect(maskText('aaa bbb', withPatterns([{ label: 'x', source: 'z*', partial: false }])).text).toBe('aaa bbb')
})

test('사용자 정규식: 제외 구간은 건드리지 않는다', () => {
  expect(maskText('###EMP123456### EMP123456', withPatterns([{ label: '사번', source: 'EMP\\d{6}', partial: false }])).text).toBe(
    'EMP123456 [사번#1]',
  )
})
```

`hooks/register.test.ts`:

```ts
const MISSING = { patterns_file: '/nonexistent/privacy-mask-patterns.json' }

test('설정 오류: 정규식 파일을 못 읽으면 전송을 막는다', { options: MISSING }, async $ => {
  const result = await $.prompt.submit({ text: 'hello' })
  expect(result.drop).toBe('privacy-mask: 정규식 파일을 읽을 수 없습니다 (/nonexistent/privacy-mask-patterns.json)')
})

test('설정 오류여도 전체를 ###로 감싸면 보낸다', { options: MISSING }, async ($, on) => {
  const [seen] = await submitAll($, on, ['###tel=010-1234-5678###'])
  expect(seen).toBe('tel=010-1234-5678')
})
```

- [ ] **Step 2: 실패 확인**

Run: `claude plugin test .`
Expected: 신규 테스트 FAIL (`parsePatterns`·`loadPatterns` 없음, 정규식 미적용, 차단 안 됨)

- [ ] **Step 3: config.ts**

추가:

```ts
export type UserPattern = { label: string; source: string; partial: boolean }

export type Loaded = { ok: true; patterns: UserPattern[] } | { ok: false; reason: string }
```

`MaskConfig`에 `patterns: readonly UserPattern[]`, `DEFAULT_CONFIG`에 `patterns: []`.

`configFromOptions`의 반환 타입과 본문:

```ts
export const configFromOptions = (options: PluginOptions): MaskConfig & { patternsFile: string } => ({
  …기존 필드…,
  patterns: [],
  patternsFile: typeof options.patterns_file === 'string' ? options.patterns_file.trim() : '',
})
```

파일 끝에 추가:

```ts
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
```

- [ ] **Step 4: mask.ts — 7단계 사용자 정규식**

import에 `keepEnds` 추가. `run(PII_RULES)` 다음에:

```ts
  // 사용자 정규식은 마지막. 자리표시자를 먼저 대안으로 두어, 그 자리에서는 자리표시자가 통째로 매치돼 그대로 남게 한다
  for (const p of config.patterns) {
    const re = new RegExp(`${PLACEHOLDER.source}|(?:${p.source})`, 'g')
    each(s =>
      s.replace(re, (m: string) => {
        if (!m || PLACEHOLDER_ONLY.test(m)) return m
        const ph = ctx.tag(p.label, m)
        return p.partial ? `${ph} ${keepEnds(m, config.partialKeep)}` : ph
      }),
    )
  }
```

`maskText` 위에 상수:

```ts
const PLACEHOLDER = /\[[^[\]\n]*#\d+\]/
const PLACEHOLDER_ONLY = new RegExp(`^${PLACEHOLDER.source}$`)
```

- [ ] **Step 5: register.ts — 설정 읽기와 차단**

```ts
import type { Register } from 'claude-code'
import { configFromOptions, loadPatterns } from './config.ts'
import { isAllBypass, joinSegments, maskText, splitBypass } from './mask.ts'

export const register: Register = (on, options) => {
  // 설정을 바꾸면 엔진이 모듈을 다시 불러 register가 새 options로 다시 돈다
  const { patternsFile, ...base } = configFromOptions(options)
  on('prompt.submit', async ($, e, next) => {
    // 전부 제외 구간이면 설정을 읽지 않는다 (설정 오류로 막힌 상황에서도 보낼 수 있게)
    const segments = splitBypass(e.text)
    if (isAllBypass(segments)) return next({ ...e, text: joinSegments(segments) })

    // 사용자 정의가 빠진 채 보내면 가장 민감한 값이 그대로 나가므로 막는다
    const loaded = await loadPatterns($.fs, patternsFile)
    if (!loaded.ok) return { drop: `privacy-mask: ${loaded.reason}` }

    const { text, counts } = maskText(e.text, { ...base, patterns: loaded.patterns })
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
```

`$.fs`를 넘길 때 타입이 맞지 않으면 `{ read: (p: string) => $.fs.read(p) }`로 감싼다.

- [ ] **Step 6: plugin.json**

```json
    "patterns_file": { "type": "file", "title": "사용자 정규식 파일", "description": "[{ \"label\": \"사번\", \"regex\": \"EMP\\\\d{6}\", \"partial\": false }] 형식의 JSON 파일 절대 경로. 비우면 사용 안 함. 읽을 수 없거나 형식이 틀리면 전송을 막는다" }
```

- [ ] **Step 7: 검증**

Run: `claude plugin validate . && claude plugin test .`
Expected: 테스트 44개 PASS

- [ ] **Step 8: 커밋 (사용자 확인 후)**

```bash
git add hooks/ .claude-plugin/plugin.json
git commit -m "feat: 사용자 정규식 파일과 설정 오류 시 전송 차단 추가"
```

---

### Task 9: README 갱신

**Files:**
- Modify: `README.md`, `.claude-plugin/plugin.json`(description만)

- [ ] **Step 1: README 본문 교체**

다음 절로 구성한다 (예시는 모두 직접 만든 값):

1. 한 줄 소개 + 예시 (`tel=010-1234-5678 db.password=abc123` → `tel=[전화번호#1] 010-****-5678 db.password=[db.password#1]`)
2. **마스킹 방식**: 전체 가림 / 일부 노출 표 (스펙 "마스킹 방식" 절과 같은 대상·예). 같은 값은 같은 번호, 프롬프트마다 1부터.
3. **마스킹 대상**: 개인정보 형식(주민·외국인등록번호, 운전면허, 전화, 이메일, 카드, 사업자번호, 계좌, IPv4), 개인정보 키(이름·생년월일·카드 부가정보), 비밀값(설정 id와 함께). 주소는 대상이 아니며 필요하면 `custom_keys`에 넣는다.
4. **마스킹 제외**: `###값###`. 안쪽 양 끝에 공백이 있거나 `#`이 4개 이상이면 구분자가 아님. 전체를 감싸면 설정 오류 상황에서도 전송됨.
5. **설정**: `/config`의 privacy-mask 항목(규칙 켜기/끄기, 최소 길이, 일부 노출 글자 수, 정규식 파일). `custom_keys`는 목록이라 `/config`에 보이지 않으므로 `settings.json` 예시:

   ```json
   { "pluginConfigs": { "privacy-mask": { "options": { "custom_keys": ["custName", "orderMemo"] } } } }
   ```

   이 JSON 모양(`options` 하위 여부)은 실행 시 실제 settings.json에 저장되는 형태를 보고 맞춘다.
6. **사용자 정규식 파일**: 형식, `partial`, 예시 3개(여권번호 `[A-Z]\d{8}`, 차량번호 `\d{2,3}[가-힣]\d{4}`, MAC `(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}`). 파일은 프롬프트마다 다시 읽음. 절대 경로 권장.
7. **주의**: 설정 오류 시 전송 차단, 매우 느린 정규식(`(a+)+$` 류)은 전송을 멈출 수 있음, `userName`은 기본 제외(실명이면 `custom_keys`에 추가), 공백이 낀 값은 다른 곳에서 전체 치환되지 않음, 직접 입력한 프롬프트만 대상.
8. 사용·개발 절은 기존 유지.

`plugin.json`의 `description`을 `"프롬프트 전송 전 로컬에서 개인정보·비밀값 마스킹 (항목별 설정, 사용자 키·정규식)"`으로 바꾼다.

- [ ] **Step 2: 검증**

Run: `claude plugin validate . && claude plugin test .`
Expected: validate 통과, 테스트 44개 PASS

- [ ] **Step 3: 커밋 (사용자 확인 후)**

```bash
git add README.md .claude-plugin/plugin.json
git commit -m "docs: README에 설정·제외 구간·사용자 정규식 안내 추가"
```
