# privacy_mask

Claude Code mod. 프롬프트를 보내기 전에 **로컬에서** 개인정보·비밀값을 자리표시자로 바꿔 모델에 원문이 가지 않게 합니다.

```
tel=010-1234-5678 db.password=abc123
→ tel=[전화번호#1] 010-••••-5678 db.password=[db.password#1]
```

## 동작

이 mod는 훅 세 개를 등록합니다.

- `prompt.submit`: 프롬프트가 모델로 전송되기 직전에 실행되며, 직접 입력한 것뿐 아니라 이 이벤트를 거치는 모든 프롬프트를 처리합니다.
- `ui.render`(`AbovePrompt`): 마스킹 알림을 입력창 위에 한 줄로 그립니다.
- `session.start`: 모듈을 다시 불러올 때 남아 있던 알림을 지웁니다.

`prompt.submit`은 다음처럼 동작합니다.

- 프롬프트 텍스트에서 민감정보를 찾아 자리표시자로 바꾼 뒤 전송을 이어갑니다.
- `patterns_file`을 지정한 경우에만 그 파일을 읽습니다. 그 외에는 파일을 읽지 않습니다.
- 설정 파일 오류나 내부 오류가 나면 원문이 나가지 않도록 전송을 막고 이유를 표시합니다.
- 가린 항목이 있으면 항목별 개수만 입력창 위 알림으로 5초 동안 보여 줍니다.
- 네트워크 요청을 하지 않고, 프롬프트 내용을 저장하지 않습니다.

## 마스킹 방식

모든 결과는 `[라벨#번호]`로 시작합니다. 같은 값은 같은 번호를 받고, 번호는 프롬프트마다 1부터 셉니다.

| 방식 | 대상 | 예 |
|---|---|---|
| 전체 가림 | 주민·외국인등록번호, 운전면허번호, 모든 비밀값, 키로 찾은 값 | `[주민번호#1]` `[JWT#1]` `[db.password#1]` |
| 일부 노출 | 전화, IP, 카드, 계좌, 사업자번호, 이메일, 사용자 정규식(`partial`) | 아래 |

일부 노출 형식:

- 전화: 끝 4자리. `[전화번호#1] 010-••••-5678` (유선은 지역번호 + 끝 4자리)
- IP: 첫·끝 옥텟. `[IP#1] 10.•••.•••.5`
- 카드: 끝 4자리. `[카드번호#1] ••••-1111`
- 그 외는 구분자(`-` `.` 공백)를 남기고 앞뒤 `partial_keep`자(기본 2)만 보입니다. 글자 수가 `2 × partial_keep` 이하면 전부 `•`입니다.
  - 계좌: `[계좌번호#1] 11•-•••-••••89`
  - 사업자번호: `[사업자번호#1] 12•-••-•••91`
  - 이메일: 아이디에만 적용. `[이메일#1] gi•••••.••ng@test.co.kr`

## 마스킹 대상

괄호 안은 `/config`에서 켜고 끄는 설정 이름(`enable_<id>`)입니다. 기본값은 모두 켜짐입니다.

- **개인정보 형식**: 주민·외국인등록번호(`rrn`) · 운전면허번호(`driver_license`) · 휴대폰·유선 전화번호(`phone`) · 이메일(`email`) · 카드번호(`card`) · 사업자등록번호(`biz_no`, 체크섬 검증) · 계좌번호(`account`) · IPv4(`ip`, 127.0.0.1·0.0.0.0 제외)
- **개인정보 키**: 키 이름으로 찾은 값을 `[키이름#n]`으로 가립니다.
  - 이름(`name_key`): `custName` · `memberNm` · `성명` 등. `fileName`·`userName` 같은 이름은 제외
  - 생년월일(`birth_key`): `birth` · `birthDate` · `dob` · `생년월일`
  - 카드 부가정보(`card_extra_key`): `cvc` · `cvv` · `cardExpiry`
- **비밀값**
  - PEM 개인키(`private_key`) · JWT(`jwt`) · Jasypt `ENC(...)`(`jasypt`)
  - 서비스 토큰(`service_token`): AWS · GitHub · GitLab · Anthropic · OpenAI · Slack · Google · Stripe · npm, Slack·Discord 웹훅 URL
  - Authorization·Bearer 헤더(`auth_header`) · Cookie·Set-Cookie 헤더(`cookie`)
  - 접속 문자열 비밀번호(`connection_string`): `scheme://user:비밀번호@host`, `jdbc:oracle`, Azure `AccountKey`
  - 비밀값 키(`secret_key`): `password` · `token` · `secret` · `api_key` 등 키 이름에 붙은 값

키로 찾은 값은 키 없이 다른 곳(URL·다른 로그 줄)에 다시 나와도 같은 자리표시자로 바꿉니다.

주소는 대상이 아닙니다. 필요하면 주소 키 이름을 `custom_keys`에 넣으세요.

## 마스킹 제외

`###값###`으로 감싼 부분은 원문 그대로 보내고 `###`만 지웁니다. 여러 줄도 됩니다.

```
###db.password=abc123### tel=010-1234-5678
→ db.password=abc123 tel=[전화번호#1] 010-••••-5678
```

여는 `###`는 줄 처음이나 공백 뒤에 있어야 합니다. 그래서 `Ab###Cd###1` 같은 값 속의 `###`는 구분자가 아닙니다. `### 제목`처럼 안쪽 끝에 공백이 있거나, `####`·`##########`처럼 `#`이 4개 이상이어도 구분자로 보지 않습니다. 프롬프트 전체를 감싸면 설정 오류로 전송이 막힌 상황에서도 보낼 수 있습니다.

## 설정

`/config`의 privacy-mask 항목에서 바꿉니다.

| 설정 | 기본 | 뜻 |
|---|---|---|
| `enable_<id>` | 켜짐 | 위 마스킹 대상별 켜기/끄기 |
| `propagate_min` | 6 | 키로 찾은 비밀값·숫자 값을 다른 곳에서도 가리는 최소 길이 |
| `propagate_min_text` | 2 | 키로 찾은 개인정보 문자 값(이름 등)을 다른 곳에서도 가리는 최소 길이 |
| `partial_keep` | 2 | 일부 노출에서 앞뒤로 보여 줄 글자 수 |
| `patterns_file` | 없음 | 사용자 정규식 파일 경로 |

`custom_keys`(추가로 가릴 키 이름)는 목록이라 `/config`에 보이지 않습니다. `settings.json`에 직접 넣습니다. 대소문자·`_`·`-`는 무시하고, `order.orderMemo`처럼 `.`이 있으면 마지막 이름도 비교합니다.

```json
{ "pluginConfigs": { "privacy-mask": { "options": { "custom_keys": ["custName", "orderMemo"] } } } }
```

`--plugin-dir`로 띄운 경우 키가 `privacy-mask@inline`일 수 있습니다.

## 사용자 정규식 파일

`patterns_file`에 JSON 파일 경로(절대 경로 권장)를 넣습니다. 다른 규칙이 모두 끝난 뒤 마지막에 적용됩니다.

```json
[
  { "label": "여권번호", "regex": "[A-Z]\\d{8}", "partial": true },
  { "label": "차량번호", "regex": "\\d{2,3}[가-힣]\\d{4}" },
  { "label": "MAC", "regex": "(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}" }
]
```

- `label`: 자리표시자 라벨. `[` `]` `#` 줄바꿈은 쓸 수 없습니다.
- `regex`: JavaScript 정규식. JSON 안이라 `\`는 `\\`로 씁니다.
- `partial`: `true`면 앞뒤 `partial_keep`자를 보여 줍니다. 생략하면 전체 가림입니다.

파일은 프롬프트마다 다시 읽으므로 고친 내용이 바로 반영됩니다.

## 주의

- **설정 오류면 전송을 막습니다.** 정규식 파일을 읽을 수 없거나 형식·문법이 틀리면 원문이 나가지 않도록 차단하고 이유를 알립니다.
- 매우 느린 정규식(`(a+)+$` 류)은 전송을 멈추게 할 수 있습니다.
- `userName`은 계정 식별용이라 기본 제외입니다. 실명이 들어가면 `custom_keys`에 추가하세요.
- 공백이 낀 값은 다른 곳에서 전체 치환하지 않습니다.
- 키 값이 `null`·`true`·`false` 같은 리터럴이면 가리지 않습니다.
- `phone`을 꺼도 `010-1234-5678`처럼 하이픈이 있는 전화번호는 계좌번호 형식에 맞아 `[계좌번호#n]`으로 가려질 수 있습니다.
- 따옴표 없는 `Cookie:` 헤더는 줄 끝까지 가립니다.
- 직접 입력한 프롬프트만 마스킹합니다. Claude가 도구로 읽은 파일·명령 출력은 아직 대상이 아닙니다.

## 설치

```bash
claude plugin marketplace add wonhj12/privacy_mask@main
claude plugin install privacy-mask@wonhajin
```

새 버전은 `claude plugin update privacy-mask@wonhajin`으로 받습니다.

설치 없이 한 세션만 쓰려면:

```bash
claude --plugin-dir /path/to/privacy_mask
```

## 개발

```bash
claude plugin validate .   # 매니페스트·모듈 검사
claude plugin test .       # hooks/*.test.ts 실행
```

## 라이선스

MIT. 아이콘은 [Codicons](https://github.com/microsoft/vscode-codicons)의 `workspace-trusted`([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/))에 배경과 색을 입혀 만들었습니다.
