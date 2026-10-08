import { expect, test } from 'claude-code/testing'

// 각 텍스트를 차례로 제출하고, 플러그인을 거쳐 엔진에 닿은 텍스트를 돌려준다
const submitAll = async ($: any, on: any, texts: string[]) => {
  const seen: string[] = []
  on('prompt.submit', (_$: any, e: any) => {
    seen.push(e.text)
    return { text: e.text }
  })
  for (const text of texts) await $.prompt.submit({ text })
  return seen
}

test('개인정보: 주민번호는 전부, 나머지는 뒷자리만 남긴다', async ($, on) => {
  const [seen] = await submitAll($, on, [
    'rrn=900101-1234567 tel=010-1234-5678 mail=hong@test.co.kr card=4111-1111-1111-1111 acct=110-123-456789',
  ])
  expect(seen).toBe(
    'rrn=[주민번호#1] tel=[전화번호#1] 010-****-5678 mail=[이메일#1] ****@test.co.kr card=[카드번호#1] ****-1111 acct=[계좌번호#1] 11*-***-****89',
  )
})

test('같은 값은 같은 번호 (구분자 차이 무시), 번호는 프롬프트마다 1부터', async ($, on) => {
  const seen = await submitAll($, on, [
    'a=010-1234-5678 b=010-9999-0000 c=01012345678',
    'd=010-9999-0000',
  ])
  expect(seen).toEqual([
    'a=[전화번호#1] 010-****-5678 b=[전화번호#2] 010-****-0000 c=[전화번호#1] 010-****-5678',
    'd=[전화번호#1] 010-****-0000',
  ])
})

test('비밀값: 키 이름 key=value · key: "value", username류는 제외', async ($, on) => {
  const [seen] = await submitAll($, on, [
    'db.password=abc123 app.login.adminpw=x1 Db_Username=dbuser orderApiToken: "tok123" payment_client_id=cid username=hong',
  ])
  expect(seen).toBe(
    'db.password=[db.password#1] app.login.adminpw=[app.login.adminpw#1] Db_Username=dbuser orderApiToken: "[orderApiToken#1]" payment_client_id=[payment_client_id#1] username=hong',
  )
})

test('비밀값: 키로 찾은 값은 키 없이 다시 나와도 같은 라벨로 가리고, 짧은 값은 전체 치환하지 않는다', async ($, on) => {
  const [seen] = await submitAll($, on, [
    'API_TOKEN=abc123xyz url=/api/send?t=abc123xyz other_token=abc123xyz flag_pw=Y Y',
  ])
  expect(seen).toBe(
    'API_TOKEN=[API_TOKEN#1] url=/api/send?t=[API_TOKEN#1] other_token=[API_TOKEN#1] flag_pw=[flag_pw#1] Y',
  )
})

test('비밀값: 공백뿐인 값은 가리지 않고, 들여쓰기를 프롬프트 전체에서 치환하지 않는다', async ($, on) => {
  const text = '<entry key="password">\n        <value>pw</value>\n</entry>\n<bean>\n        <prop>x</prop>\n</bean>'
  const [seen] = await submitAll($, on, [text])
  expect(seen).toBe(text)
})

test('비밀값: 전체 치환은 다른 숫자·단어의 일부를 건드리지 않는다', async ($, on) => {
  const [seen] = await submitAll($, on, ['pw=123456 ts=1760123456000 q=123456&x=1'])
  expect(seen).toBe('pw=[pw#1] ts=1760123456000 q=[pw#1]&x=1')
})

test('비밀값: 전체 치환은 이미 넣은 자리표시자·키 이름·태그 이름을 건드리지 않는다', async ($, on) => {
  const [seen] = await submitAll($, on, [
    'password=password <password>x</password> "password": "q" log password',
  ])
  // XML 규칙이 key=value 보다 먼저 돌아 태그 안 값이 #1 이다
  expect(seen).toBe(
    'password=[password#2] <password>[password#1]</password> "password": "[password#3]" log [password#2]',
  )
})

test('비밀값: 전체 치환은 key="…" · name="…" 속성의 키 이름을 건드리지 않는다', async ($, on) => {
  const [seen] = await submitAll($, on, [
    'password=password <entry key="password">\n  <v/>\n</entry> <property name="password" value="password"/>',
  ])
  expect(seen).toBe(
    'password=[password#1] <entry key="password">\n  <v/>\n</entry> <property name="password" value="[password#1]"/>',
  )
})

test('비밀값: XML 설정 3형식', async ($, on) => {
  const [seen] = await submitAll($, on, [
    '<property name="password" value="pw1"/> <entry key="oauth_client_secret">sec</entry> <apiKey>chk</apiKey> <property name="url" value="u"/>',
  ])
  expect(seen).toBe(
    '<property name="password" value="[password#1]"/> <entry key="oauth_client_secret">[oauth_client_secret#1]</entry> <apiKey>[apiKey#1]</apiKey> <property name="url" value="u"/>',
  )
})

test('비밀값: Authorization 헤더 · JDBC 접속 문자열 · Jasypt ENC · JWT', async ($, on) => {
  const [seen] = await submitAll($, on, [
    'Authorization: Bearer abcdefghijklmnop.qrs jdbc:oracle:thin:scott/tiger@10.20.30.40:1521:ORCL pw=ENC(xyz123) jwt eyJhbGciOi.eyJzdWIiOi.sig',
  ])
  expect(seen).toBe(
    'Authorization: Bearer [인증토큰#1] jdbc:oracle:thin:scott/[접속비밀번호#1]@[IP#1] 10.***.***.40:1521:ORCL pw=[암호문#1] jwt [JWT#1]',
  )
})

test('IP는 첫·끝 옥텟만 남기고 localhost는 그대로', async ($, on) => {
  const [seen] = await submitAll($, on, ['from 192.168.0.1 to 127.0.0.1 at 2026-10-08'])
  expect(seen).toBe('from [IP#1] 192.***.***.1 to 127.0.0.1 at 2026-10-08')
})

test('로그의 날짜·시각·epoch ms·일반 숫자·코드는 그대로 둔다', async ($, on) => {
  const text = '2026-10-08 12:34:56.789 ts=1760000000000 seq=12345 ERR000123 ORA-01403 id=1234567812345678'
  const [seen] = await submitAll($, on, [text])
  expect(seen).toBe(text)
})

test('하이픈으로 이어지는 파일명·문서번호는 계좌로 보지 않는다', async ($, on) => {
  const text =
    'fileName: 10000-0001-0002-1-1-2026-report-final.pdf, doc-110-123-456789 acct=110-123-456789.'
  const [seen] = await submitAll($, on, [text])
  expect(seen).toBe(
    'fileName: 10000-0001-0002-1-1-2026-report-final.pdf, doc-110-123-456789 acct=[계좌번호#1] 11*-***-****89.',
  )
})

test('Luhn을 통과해도 카드사 대역(BIN)이 아니면 카드로 보지 않는다', async ($, on) => {
  const [seen] = await submitAll($, on, [
    'job-100-001-1:3100000000000003 / elapsed=34ms card=5555555555554444',
  ])
  expect(seen).toBe('job-100-001-1:3100000000000003 / elapsed=34ms card=[카드번호#1] ****-4444')
})

test('설정: 끈 항목은 가리지 않는다', { options: { enable_phone: false, enable_secret_key: false } }, async ($, on) => {
  const [seen] = await submitAll($, on, ['tel=01012345678 db.password=abc123 card=4111-1111-1111-1111'])
  expect(seen).toBe('tel=01012345678 db.password=abc123 card=[카드번호#1] ****-1111')
})

test('설정: 전체 치환 최소 길이를 바꿀 수 있다', { options: { propagate_min: 3 } }, async ($, on) => {
  const [seen] = await submitAll($, on, ['pw=abc url=/x?t=abc'])
  expect(seen).toBe('pw=[pw#1] url=/x?t=[pw#1]')
})

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
