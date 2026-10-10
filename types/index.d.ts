declare module 'claude-code' {
  interface PluginState {
    // 입력창 위에 잠깐 보여 줄 마스킹 집계 한 줄. 없으면 null
    'privacy-mask': { notice: string | null }
  }
}
