import { expect, test } from 'claude-code/testing'
import { maskText } from './mask.ts'

test('maskText: 훅을 거치지 않고 직접 호출할 수 있다', () => {
  expect(maskText('tel=010-1234-5678').text).toBe('tel=[전화번호#1] 010-****-5678')
})
