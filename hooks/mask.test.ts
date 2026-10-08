import { expect, test } from 'claude-code/testing'
import { isAllBypass, maskText, splitBypass } from './mask.ts'

test('maskText: 훅을 거치지 않고 직접 호출할 수 있다', () => {
  expect(maskText('tel=010-1234-5678').text).toBe('tel=[전화번호#1] 010-****-5678')
})

test('isAllBypass: 구간 밖이 공백뿐이면 전체 제외', () => {
  expect(isAllBypass(splitBypass('  ###a=1###\n'))).toBe(true)
  expect(isAllBypass(splitBypass('###a=1### b'))).toBe(false)
  expect(isAllBypass(splitBypass('plain'))).toBe(false)
})
