# privacy_mask

Claude Code mod. 프롬프트를 보내기 전에 **로컬에서** 개인정보·비밀값을 자리표시자로 바꿔 모델에 원문이 가지 않게 합니다.

```
tel=010-1234-5678 db.password=abc123
→ tel=[전화번호#1] 010-****-5678 db.password=[db.password#1]
```

## 마스킹 대상

- 개인정보: 주민등록번호(외국인등록번호 포함) · 휴대폰·유선 전화번호 · 이메일 · 카드번호 · 계좌번호 · IPv4
- 비밀값: PEM 개인키 · JWT · 주요 서비스 토큰(AWS·GitHub·Anthropic·OpenAI·Slack) · Authorization/Bearer · 접속 문자열 비밀번호 · Jasypt `ENC(...)` · `password`·`token`·`secret` 등 키 이름에 붙은 값

같은 값은 한 프롬프트 안에서 같은 번호를 받습니다.

> 현재는 직접 입력한 프롬프트만 마스킹합니다. Claude가 도구로 읽은 파일·명령 출력은 아직 대상이 아닙니다.

## 사용

```bash
claude --plugin-dir /path/to/privacy_mask
```

## 개발

```bash
claude plugin validate .   # 매니페스트·모듈 검사
claude plugin test .       # hooks/*.test.ts 실행
```

설계 문서와 계획은 `docs/superpowers/`에 있습니다.
