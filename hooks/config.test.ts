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
