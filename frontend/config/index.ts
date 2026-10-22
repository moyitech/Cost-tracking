import { defineConfig } from '@tarojs/cli'

export default defineConfig({
  projectName: 'objet-ledger', date: '2026-10-19',
  designWidth: 390, deviceRatio: { 390: 750 / 390 },
  sourceRoot: 'src', outputRoot: `dist/${process.env.TARO_ENV}`,
  framework: 'react', compiler: 'vite',
  plugins: ['@tarojs/plugin-platform-h5', '@tarojs/plugin-platform-weapp'],
  defineConstants: {
    API_BASE_URL: JSON.stringify(process.env.TARO_APP_API_BASE_URL || 'http://localhost:8000/api/v1'),
    USE_MOCK: JSON.stringify(process.env.TARO_APP_USE_MOCK !== 'false'),
  },
  mini: { postcss: { pxtransform: { enable: false }, cssModules: { enable: false } } },
  h5: {
    publicPath: '/', router: { mode: 'hash' },
    devServer: { host: '127.0.0.1', port: 10086 },
    // Navigation targets keep their logical CSS-pixel size on narrow H5 windows.
    postcss: { pxtransform: { enable: true, config: { selectorBlackList: ['.tab-bar', '.tab-item'] } }, autoprefixer: { enable: true } },
  },
})
