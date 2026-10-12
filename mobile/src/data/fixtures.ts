/**
 * 构造公开测试样本，不含用户实际日志或角色信息。
 * @returns 带一条离线消息及电脑专属数据的旧格式备份。
 */
export function exampleBackup() {
  return {
    schemaVersion: 2,
    exportedAt: '2026-10-12T00:00:00.000Z',
    modules: [
      {
        id: 'm1',
        name: '示例模组',
        playStatus: 'running',
        kps: ['KP'],
        pairs: [],
        order: 0,
        collapsed: false,
        createdAt: '',
        updatedAt: ''
      }
    ],
    records: [
      {
        id: 'r1',
        moduleId: 'm1',
        name: '第一场',
        sequenceNo: 1,
        sourceType: 'online',
        status: 'valid',
        dateSource: 'none',
        order: 0,
        createdAt: '',
        updatedAt: '',
        link: 'https://log.weizaima.com/?key=public-example',
        rawContent: {
          parserVersion: 1,
          messages: [
            {
              id: 'msg1',
              order: 0,
              displayName: '测试',
              text: '离线正文',
              type: 'text',
              isDiceCommand: false,
              isOffTopic: false,
              images: []
            }
          ]
        }
      }
    ],
    characters: [],
    notes: [{ content: '电脑专属闲记' }],
    resources: [{ title: '电脑专属资料' }],
    archiveEntries: [],
    importMappings: [],
    settings: {
      theme: 'dark',
      archiveDirectory: 'C:\\old-path',
      filterPreset: {},
      autoBackup: { enabled: true, interval: 'daily', retention: 10 }
    }
  }
}
