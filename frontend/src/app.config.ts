export default defineAppConfig({
  resizable: true,
  lazyCodeLoading: 'requiredComponents',
  pages: ['pages/index/index', 'pages/detail/index', 'pages/import/index'],
  window: { navigationStyle: 'custom', backgroundColor: '#f7f9f8', navigationBarTextStyle: 'black' },
})
