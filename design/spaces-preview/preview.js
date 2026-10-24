/* Standalone design prototype. No network, storage, account or production modules. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const root = document.documentElement;
  const params = new URLSearchParams(location.search);
  const paths = {
    chevron: '<path d="m9 5 7 7-7 7"/>', down: '<path d="m6 9 6 6 6-6"/>', back: '<path d="m15 5-7 7 7 7"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>', check: '<path d="m5 12 4 4L19 6"/>',
    home: '<path d="m3 10 9-7 9 7M5 9v11h14V9M9 20v-7h6v7"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 15v2"/>',
    shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
    camera: '<path d="M8 6l2-3h4l2 3h4v14H4V6z"/><circle cx="12" cy="13" r="4"/>',
    photo: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.5"/><path d="m4 17 5-5 4 4 3-3 5 5"/>',
    refresh: '<path d="M20 9a8 8 0 0 0-14-3L3 9m0-6v6h6M4 15a8 8 0 0 0 14 3l3-3m0 6v-6h-6"/>',
    people: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v3"/>',
    invite: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 10-4m5-3v10m-5-5h10"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
    box: '<path d="M4 8h16v13H4zM3 3h18v5H3zM9 12h6"/>',
    chart: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 16v-4m5 4V7m5 9v-7"/>',
    history: '<path d="M4 6a9 9 0 1 1-1 10M3 3v6h6M12 7v6l4 2"/>',
    spaces: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M5 10h14M5 16h14M9 7h2m-2 6h2m-2 6h2"/>',
    plus: '<path d="M12 4v16M4 12h16"/>',
    scan: '<path d="M3 8V3h5m8 0h5v5m0 8v5h-5M8 21H3v-5M7 12h10M8 7h1m6 10h1"/>',
    edit: '<path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/>',
    link: '<path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 0)"/>',
    more: '<circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/>',
    circle: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor"/>',
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.box}</svg>`;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const roleName = { admin: '管理者', editor: '编辑者', viewer: '查看者' };
  const fixture = () => ({
    user: { avatar: null }, selected: 'personal', tab: 'spaces', nextId: 1, records: [],
    spaces: [
      { id: 'personal', name: '个人空间', kind: 'personal', role: 'admin', avatar: null, members: [],
        items: [{ name: 'MacBook Pro 14″', amount: 19999, note: '工作与创作', type: 'box' }, { name: 'Sony A7M4', amount: 14600, note: '记录日常', type: 'camera' }, { name: 'Dyson V12 吸尘器', amount: 3990, note: '在用', type: 'box' }, { name: 'iPhone 13 Pro', amount: 8319, note: '已出售', type: 'box' }],
        trash: [{ id: 'lamp', name: '床头小台灯', detail: '移除于昨天', amount: 199 }] },
      { id: 'family', name: '温暖的家', kind: 'family', role: 'admin', avatar: null,
        members: [{ id: 'me', name: '小林', role: 'admin' }, { id: 'partner', name: '阿禾', role: 'editor' }, { id: 'member', name: '妈妈', role: 'viewer' }],
        items: [{ name: '客厅吸尘器', amount: 2999, note: '全家一起用', type: 'box' }],
        trash: [{ id: 'kettle', name: '旧电热水壶', detail: '移除于 3 天前', amount: 159 }] },
      { id: 'parents', name: '爸妈的家', kind: 'family', role: 'viewer', avatar: null,
        members: [{ id: 'parent', name: '爸爸', role: 'admin' }, { id: 'me', name: '小林', role: 'viewer' }],
        items: [{ name: '家人的手机', amount: 2999, note: '在用', type: 'box' }],
        trash: [{ id: 'radio', name: '旧收音机', detail: '移除于上周', amount: 299 }] },
    ],
  });
  let state = fixture();
  let stack = [];
  let openerKey = '';
  let openerElement = null;
  let avatarDraft = null;
  let avatarError = '';
  let avatarLoading = false;
  let avatarTask = 0;
  let toastTimer;
  const space = () => state.spaces.find(item => item.id === state.selected);
  const top = () => stack.at(-1);
  const canEdit = target => target.role !== 'viewer';
  const isAdmin = target => target.role === 'admin';
  const brand = '<span class="brand" aria-label="用本">用<span>本</span></span>';

  function avatar(target, size = '', override = undefined) {
    const personal = target.kind === 'personal';
    const url = override !== undefined ? override : personal ? state.user.avatar : target.avatar;
    return `<span class="avatar ${personal ? '' : 'family'} ${size}" aria-hidden="true">${url ? `<img src="${esc(url)}" alt="">` : personal ? '我' : icon('home')}</span>`;
  }
  const personal = () => state.spaces[0];
  const end = text => `<span class="menu-end">${text || ''}${icon('chevron')}</span>`;
  function menuRow(action, symbol, title, caption = '', trailing = '', attrs = '') {
    return `<button type="button" class="menu-row" data-action="${action}" ${attrs}><span class="menu-icon">${icon(symbol)}</span><span class="menu-copy"><span class="menu-title">${title}</span>${caption ? `<span class="menu-caption">${caption}</span>` : ''}</span>${end(trailing)}</button>`;
  }
  function renderApp() {
    const current = space();
    $('#app-header').innerHTML = `${brand}<div class="header-actions"><button type="button" class="account-button" data-action="personal-avatar" data-focus-key="account" aria-label="更换个人头像">${avatar(personal(), 'small')}</button><div class="capsule" aria-hidden="true">${icon('more')}<span class="capsule-line"></span>${icon('circle')}</div></div>`;
    $('#scope-bar').innerHTML = `<button type="button" class="space-selector" data-action="spaces" data-focus-key="spaces" aria-label="${esc(current.name)}，展开全部空间" aria-haspopup="dialog" aria-expanded="${stack.some(entry => entry.name === 'spaces')}">${avatar(current, 'small')}<span class="selector-name">${esc(current.name)}</span>${icon('down')}</button><button type="button" class="icon-button refresh-button" data-action="refresh" aria-label="刷新当前空间">${icon('refresh')}</button>`;
    $('#tab-bar').innerHTML = [['items', '物品', 'box'], ['analysis', '分析', 'chart'], ['records', '记录', 'history'], ['spaces', '空间', 'spaces']].map(([id, title, symbol]) => `<button type="button" class="tab" data-tab="${id}" data-focus-key="tab-${id}" ${state.tab === id ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${title}</span></button>`).join('');
    $('#page-content').innerHTML = state.tab === 'spaces' ? spacePage(current) : otherPage(current);
    document.querySelectorAll('[data-scenario]').forEach(button => {
      const selected = button.dataset.scenario === (current.kind === 'personal' ? 'personal' : current.role);
      button.setAttribute('aria-pressed', String(selected));
    });
  }
  function spacePage(current) {
    const own = current.kind === 'personal';
    const editableAvatar = own || isAdmin(current);
    const image = editableAvatar ? `<button type="button" class="avatar-edit ${own ? '' : 'family'}" data-action="${own ? 'personal-avatar' : 'family-avatar'}" data-focus-key="space-avatar" aria-label="${own ? '更换个人头像' : '更换家庭空间头像'}">${avatar(current)}<span class="camera-badge">${icon('camera')}</span></button>` : avatar(current);
    const subtitle = own ? `${icon('lock')}<span>仅自己可见</span>` : `<span class="role-pill">${roleName[current.role]}</span><span>家庭共享空间</span>`;
    const stats = `<button type="button" class="space-stat" data-tab="items"><b>${current.items.length}</b><span>件物品</span></button>${own ? `<button type="button" class="space-stat text-link" data-tab="items">查看物品${icon('chevron')}</button>` : `<button type="button" class="space-stat" data-action="members" data-focus-key="member-count"><b>${current.members.length}</b><span>位成员</span>${icon('chevron')}</button>`}`;
    let rows = '';
    if (!own) rows += menuRow('members', 'people', '家庭成员与权限', '查看家人，管理自己的家庭昵称', `${current.members.length} 位`, 'data-focus-key="members"');
    if (!own && isAdmin(current)) rows += menuRow('invite', 'invite', '邀请成员', '邀请家人，一起整理日常物品', '', 'data-focus-key="invite"');
    rows += menuRow('trash', 'trash', '回收站', '找回暂时移除的物品', current.trash.length ? `<span class="count-badge">${current.trash.length}</span>` : '', 'data-focus-key="trash"');
    const privacy = own ? '个人物品不会自动共享到家庭' : current.role === 'viewer' ? '你可以查看物品与记录，暂不支持编辑' : '这里只共享家庭物品，个人空间依然私密';
    return `<h1 class="page-heading">空间</h1><section class="space-card" aria-label="当前空间名片"><div class="space-card-main">${image}<div class="space-identity"><h2 class="space-title">${esc(current.name)}</h2><div class="space-subtitle">${subtitle}</div></div></div><div class="space-card-stats">${stats}</div></section><h2 class="section-heading">空间管理</h2><div class="menu-card">${rows}</div><p class="privacy-note">${icon(own ? 'shield' : 'lock')}<span>${privacy}</span></p>`;
  }
  function otherPage(current) {
    if (state.tab === 'analysis') {
      const total = current.items.reduce((sum, item) => sum + item.amount, 0);
      return `<h1 class="page-heading">投入分析</h1><div class="analysis-card"><p>空间累计投入</p><strong>¥${total.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</strong><small>${current.items.length} 件物品在册</small></div><p class="privacy-note">${icon('box')}<span>当前统计范围：${esc(current.name)}</span></p>`;
    }
    if (state.tab === 'records') {
      const rows = state.records.filter(entry => entry.spaceId === current.id);
      return `<h1 class="page-heading">物品记录</h1>${rows.length ? rows.map(entry => `<article class="mini-card"><span class="menu-icon">${icon('history')}</span><div><h3>${esc(entry.title)}</h3><p>刚刚 · ${esc(current.name)}</p></div></article>`).join('') : `<div class="empty-state">${icon('history')}<h3>还没有新的记录</h3><p>恢复物品后，可以在这里查看记录。</p></div>`}`;
    }
    return `<h1 class="page-heading">物品</h1>${current.items.map(item => `<article class="mini-card"><span class="menu-icon">${icon(item.type || 'box')}</span><div><h3>${esc(item.name)}</h3><p>${esc(item.note || '在用')} · ¥${Number(item.amount).toLocaleString('zh-CN')}</p></div></article>`).join('') || `<div class="empty-state">${icon('box')}<h3>给物品一个有归属的家</h3><p>这个空间还没有物品。</p></div>`}<p class="privacy-note">${icon('lock')}<span>${esc(current.name)} · ${current.items.length} 件物品</span></p>`;
  }

  function toast(message) {
    clearTimeout(toastTimer);
    $('#toast').textContent = message;
    $('#toast').hidden = false;
    toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 2600);
  }
  function openSheet(name, props = {}) {
    if (!stack.length) {
      openerElement = document.activeElement;
      openerKey = openerElement?.dataset.focusKey || '';
    }
    if (name === 'avatar') {
      avatarTask++;
      avatarLoading = false;
      avatarError = '';
      avatarDraft = props.scope === 'personal' ? state.user.avatar : space().avatar;
    }
    stack.push({ name, ...props });
    $('#device-app').inert = true;
    $('.inspector').inert = true;
    $('#sheet-layer').hidden = false;
    updateExpanded();
    renderSheet();
  }
  function updateExpanded() {
    const selector = $('[data-action="spaces"]');
    if (selector) selector.setAttribute('aria-expanded', String(stack.some(entry => entry.name === 'spaces')));
  }
  function closeSheet() {
    avatarTask++;
    avatarLoading = false;
    stack = [];
    $('#sheet-layer').hidden = true;
    $('#device-app').inert = false;
    $('.inspector').inert = false;
    updateExpanded();
    const previous = openerKey ? document.querySelector(`[data-focus-key="${openerKey}"]`) : openerElement;
    const target = previous?.isConnected ? previous : $('[data-action="spaces"]');
    target?.focus({ preventScroll: true });
  }
  function backSheet() {
    if (stack.length <= 1) return closeSheet();
    const previous = top();
    stack.pop();
    renderSheet(previous.returnFocus || '');
  }
  function sheetLayout(title, body, footer = '', focusKey = '') {
    $('#sheet-header').innerHTML = `${stack.length > 1 ? `<button type="button" class="icon-button" data-action="back-sheet" aria-label="返回上一级">${icon('back')}</button>` : '<span></span>'}<h2 class="sheet-title" id="sheet-title">${title}</h2><button type="button" class="close-wrapper" data-action="close-sheet" aria-label="关闭面板"><span class="icon-button sheet-close">${icon('close')}</span></button>`;
    $('#sheet-body').innerHTML = body;
    $('#sheet-body').scrollTop = 0;
    $('#sheet-footer').innerHTML = footer;
    $('#sheet-footer').hidden = !footer;
    $('#sheet').dataset.view = top().name;
    const focusTarget = focusKey ? document.querySelector(`[data-sheet-focus="${focusKey}"]`) : $('#sheet');
    (focusTarget || $('#sheet')).focus({ preventScroll: true });
  }
  function renderSheet(focusKey = '') {
    const entry = top();
    const current = space();
    if (!entry) return;
    if (entry.name === 'spaces') {
      const options = state.spaces.map(target => `<button type="button" class="space-option" data-space="${target.id}" aria-label="${esc(target.name)}，${target.kind === 'personal' ? '个人空间' : roleName[target.role]}${target.id === state.selected ? '，当前空间' : ''}">${avatar(target, 'medium')}<span class="option-copy"><strong>${esc(target.name)}</strong><small>${target.kind === 'personal' ? '个人 · 仅自己可见' : `家庭 · ${roleName[target.role]}`} · ${target.items.length} 件物品</small></span>${target.id === state.selected ? `<span class="selected-check">${icon('check')}</span>` : ''}</button>`).join('');
      sheetLayout('全部空间', `<p class="sheet-hint">选一个空间，继续记录生活。</p><div class="space-list">${options}</div><div class="spaces-actions">${menuRow('create', 'plus', '创建家庭空间', '', '', 'data-sheet-focus="create"')}${menuRow('join', 'scan', '加入家庭', '', '', 'data-sheet-focus="join"')}</div><p class="sheet-footnote">个人与家庭的物品分开保存</p>`, '', focusKey);
    } else if (entry.name === 'create') {
      sheetLayout('创建家庭空间', `<p class="sheet-hint">为家里的物品留一个共同的地方。<br>创建后，你将成为这个家庭的管理者。</p><form id="create-form" novalidate><label class="form-field"><span>家庭名称</span><input name="familyName" maxlength="100" placeholder="例如：温暖的家" autocomplete="off" required aria-describedby="create-error"></label><label class="form-field"><span>我的家庭昵称</span><input name="nickname" maxlength="100" placeholder="家人会怎么称呼你" autocomplete="off" required aria-describedby="create-error"></label><p id="create-error" class="form-error" role="status"></p></form>`, `<button type="submit" class="primary" form="create-form">创建并进入</button><p class="sheet-footnote">仅创建演示空间，刷新后恢复</p>`, focusKey);
    } else if (entry.name === 'join') {
      sheetLayout('加入家庭', `<div class="invitation-illustration">${icon('scan')}</div><h3 class="center-title">从一份家人的邀请开始</h3><p class="center-copy">打开家人分享的邀请卡片，<br>或用微信扫一扫扫描邀请小程序码。</p><div class="info-box">${icon('shield')}<span>确认加入后才会进入家庭。<br>你的个人物品依然仅自己可见。</span></div>`, `<button type="button" class="primary" data-action="demo-invitation" data-sheet-focus="demo-invitation">体验一份演示邀请${icon('chevron')}</button><p class="sheet-footnote">邀请与扫码流程为演示，不连接微信</p>`, focusKey);
    } else if (entry.name === 'invitation-preview') {
      sheetLayout('家庭邀请', `<span class="demo-tag">演示邀请</span><div class="invitation-card">${avatar({ kind: 'family', avatar: null })}<h3>周末的小家</h3><p>阿禾邀请你一起记录家里的物品</p><div class="role-pill" style="margin-top:14px">以编辑者加入</div></div><form id="join-form" novalidate><label class="form-field"><span>我的家庭昵称</span><input name="nickname" maxlength="100" placeholder="填写家人熟悉的称呼" autocomplete="off" required aria-describedby="join-error"></label><p id="join-error" class="form-error" role="status"></p></form><div class="info-box">${icon('lock')}<span>只共享家庭物品，个人物品不会自动迁入。</span></div>`, `<button type="submit" class="primary" form="join-form">确认加入家庭</button><p class="sheet-footnote">仅加入演示家庭，刷新后恢复</p>`, focusKey);
    } else if (entry.name === 'avatar') {
      const own = entry.scope === 'personal';
      if (!own && !isAdmin(current)) { closeSheet(); return; }
      sheetLayout(own ? '更换个人头像' : '更换家庭头像', `<div class="avatar-preview" id="avatar-preview">${avatar(own ? personal() : current, 'large', avatarDraft)}</div><p class="avatar-scope">${own ? '用于顶部账户入口、个人空间<br>和家庭成员中的自己' : `用于「${esc(current.name)}」的空间名片<br>只有管理者可以更换`}</p><div class="avatar-choices">${menuRow('choose-avatar', 'photo', '从相册选择', '', '', 'data-sheet-focus="choose-avatar"')}${menuRow('default-avatar', 'refresh', '恢复默认头像')}</div><input class="avatar-file" id="avatar-file" type="file" accept="image/jpeg,image/png,image/webp" aria-label="选择头像图片"><p id="avatar-error" class="form-error" role="status">${esc(avatarError)}</p><p class="sheet-footnote">支持 JPG、PNG、WebP，最多 10 MB<br>图片仅在本地预览，不会上传</p>`, `<button type="button" class="primary" data-action="save-avatar" ${avatarLoading ? 'disabled' : ''}>${avatarLoading ? '正在读取图片…' : '保存头像'}</button><button type="button" class="text-action" data-action="close-sheet">取消</button>`, focusKey);
      $('#avatar-file').addEventListener('change', event => void readAvatar(event.target.files?.[0]));
    } else if (entry.name === 'members') {
      if (current.kind !== 'family') { closeSheet(); return; }
      const order = { admin: 0, editor: 1, viewer: 2 };
      const members = [...current.members].sort((a, b) => order[a.role] - order[b.role] || Number(b.id === 'me') - Number(a.id === 'me'));
      sheetLayout('家庭成员', `<p class="sheet-hint">${esc(current.name)} · ${members.length} 位成员</p><div class="member-list">${members.map(member => `<div class="member-row">${member.id === 'me' ? avatar(personal(), 'medium') : `<span class="member-symbol" aria-hidden="true">${esc(Array.from(member.name)[0])}</span>`}<div class="member-copy"><strong>${esc(member.name)}${member.id === 'me' ? '<span class="member-self">我</span>' : ''}</strong><small>${roleName[member.role]} · ${member.role === 'admin' ? '管理家庭与成员' : member.role === 'editor' ? '可添加和编辑物品' : '查看物品与记录'}</small></div>${member.id === 'me' ? `<button type="button" class="member-edit" data-action="nickname" data-sheet-focus="nickname" aria-label="修改我的家庭昵称">修改</button>` : ''}</div>`).join('')}</div><p class="sheet-footnote">家庭昵称仅在这个家庭显示<br>${isAdmin(current) ? '邀请更多家人，一起记好日常物品' : '成员权限由家庭管理者管理'}</p>`, '', focusKey);
    } else if (entry.name === 'nickname') {
      const member = current.members.find(member => member.id === 'me');
      sheetLayout('修改家庭昵称', `<p class="sheet-hint">家人会用这个名字认出你，<br>仅在「${esc(current.name)}」中显示。</p><form id="nickname-form" novalidate><label class="form-field"><span>我的家庭昵称</span><input name="nickname" value="${esc(member.name)}" maxlength="100" autocomplete="off" required aria-describedby="nickname-error"></label><p id="nickname-error" class="form-error" role="status"></p></form>`, '<button type="submit" class="primary" form="nickname-form">保存昵称</button>', focusKey);
    } else if (entry.name === 'invite') {
      if (!isAdmin(current) || current.kind !== 'family') { closeSheet(); return; }
      const chosen = entry.role || 'editor';
      sheetLayout('邀请成员', `<span class="demo-tag">演示分享</span><div class="invitation-card">${avatar(current)}<h3>${esc(current.name)}</h3><p>一起记好家里的每一件物品</p></div><h3 class="section-heading">家人加入后可以</h3><div class="role-options" aria-label="邀请权限">${[['editor', '编辑者', '添加、整理和编辑物品'], ['viewer', '查看者', '查看家庭物品与记录']].map(([role, title, description]) => `<button type="button" class="role-option" data-invite-role="${role}" aria-pressed="${chosen === role}"><span>${title} ${chosen === role ? '✓' : ''}</span><small>${description}</small></button>`).join('')}</div>`, `<button type="button" class="primary" data-action="share-demo">${icon('invite')}演示分享给家人</button><p class="sheet-footnote">本预览不生成真实邀请，也不会发送消息</p>`, focusKey);
    } else if (entry.name === 'trash') {
      const rows = current.trash.map(item => `<div class="trash-row"><span class="menu-icon">${icon('box')}</span><div class="trash-copy"><strong>${esc(item.name)}</strong><small>${esc(item.detail)}</small></div>${canEdit(current) ? `<button type="button" class="restore-button" data-restore="${item.id}" aria-label="恢复${esc(item.name)}">恢复</button>` : '<span class="menu-end">仅查看</span>'}</div>`).join('');
      sheetLayout('回收站', `<p class="sheet-hint">${esc(current.name)} · ${canEdit(current) ? '移除的物品，可以在这里找回。' : '你可以查看，恢复操作需要编辑权限。'}</p>${rows || `<div class="empty-state">${icon('trash')}<h3>回收站是空的</h3><p>暂时移除的物品，会在这里等你。</p></div>`}`, '', focusKey);
    }
  }

  async function readAvatar(file) {
    if (!file || top()?.name !== 'avatar') return;
    const task = ++avatarTask;
    const fail = message => {
      if (task !== avatarTask || top()?.name !== 'avatar') return;
      avatarLoading = false;
      avatarError = message;
      $('#avatar-error').textContent = message;
      const save = $('[data-action="save-avatar"]');
      save.disabled = false;
      save.textContent = '保存头像';
    };
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return fail('请选择 JPG、PNG 或 WebP 图片');
    if (file.size > 10 * 1024 * 1024) return fail('图片超过 10 MB，请换一张较小的图片');
    avatarLoading = true;
    $('#avatar-error').textContent = '';
    $('[data-action="save-avatar"]').disabled = true;
    $('[data-action="save-avatar"]').textContent = '正在读取图片…';
    let url;
    try {
      url = URL.createObjectURL(file);
      const image = new Image();
      image.src = url;
      await image.decode();
      if (task !== avatarTask || top()?.name !== 'avatar') return;
      if (!image.naturalWidth || !image.naturalHeight) throw new Error('image');
      // Keep even very large source images bounded in session memory. Center crop matches the preview mask.
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 512;
      const context = canvas.getContext('2d');
      const side = Math.min(image.naturalWidth, image.naturalHeight);
      context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 512, 512);
      avatarDraft = canvas.toDataURL('image/png');
      avatarLoading = false;
      avatarError = '';
      $('#avatar-preview').innerHTML = avatar(top().scope === 'personal' ? personal() : space(), 'large', avatarDraft);
      const save = $('[data-action="save-avatar"]');
      save.disabled = false;
      save.textContent = '保存头像';
    } catch { fail('这张图片无法读取，请重新选择'); }
    finally { if (url) URL.revokeObjectURL(url); }
  }

  function scenario(value) {
    state.tab = 'spaces';
    if (value === 'personal') state.selected = 'personal';
    else {
      state.selected = value === 'viewer' ? 'parents' : 'family';
      const current = space();
      current.role = value;
      if (current.id === 'family') {
        current.members.find(member => member.id === 'me').role = value;
        current.members.find(member => member.id === 'partner').role = value === 'admin' ? 'editor' : 'admin';
      }
    }
    renderApp();
    $('#page-scroll').scrollTop = 0;
  }
  function submitForm(form) {
    const values = new FormData(form);
    const nameInput = form.elements.namedItem('familyName');
    const nicknameInput = form.elements.namedItem('nickname');
    const errorId = form.id === 'create-form' ? '#create-error' : form.id === 'join-form' ? '#join-error' : '#nickname-error';
    if (nameInput && !String(values.get('familyName')).trim()) return invalid(nameInput, '请填写家庭名称', errorId);
    if (nicknameInput && !String(values.get('nickname')).trim()) return invalid(nicknameInput, '请填写家庭昵称', errorId);
    const nickname = String(values.get('nickname')).trim();
    if (form.id === 'nickname-form') {
      space().members.find(member => member.id === 'me').name = nickname;
      backSheet();
      toast('家庭昵称已更新');
      return;
    }
    const joining = form.id === 'join-form';
    const existing = joining && state.spaces.find(target => target.id === 'joined-demo');
    if (existing) {
      state.selected = existing.id;
    } else {
      const created = { id: joining ? 'joined-demo' : `created-${state.nextId++}`, name: joining ? '周末的小家' : String(values.get('familyName')).trim(), kind: 'family', role: joining ? 'editor' : 'admin', avatar: null,
        members: joining ? [{ id: 'host', name: '阿禾', role: 'admin' }, { id: 'me', name: nickname, role: 'editor' }] : [{ id: 'me', name: nickname, role: 'admin' }], items: [], trash: [] };
      state.spaces.push(created);
      state.selected = created.id;
    }
    state.tab = 'spaces';
    renderApp();
    closeSheet();
    $('#page-scroll').scrollTop = 0;
    toast(joining ? '已加入演示家庭' : '家庭空间已创建 · 仅演示');
  }
  function invalid(input, message, errorId) {
    input.setAttribute('aria-invalid', 'true');
    $(errorId).textContent = message;
    input.focus();
  }
  document.addEventListener('submit', event => {
    if (['create-form', 'join-form', 'nickname-form'].includes(event.target.id)) {
      event.preventDefault();
      submitForm(event.target);
    }
  });
  document.addEventListener('input', event => {
    if (event.target.matches('.form-field input')) {
      event.target.removeAttribute('aria-invalid');
      const error = event.target.form?.querySelector('.form-error');
      if (error) error.textContent = '';
    }
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) {
      if (event.target.matches('.scrim')) closeSheet();
      return;
    }
    if (button.dataset.scenario) return scenario(button.dataset.scenario);
    if (button.dataset.tab) {
      state.tab = button.dataset.tab;
      renderApp();
      $('#page-scroll').scrollTop = 0;
      $(`[data-focus-key="tab-${state.tab}"]`)?.focus({ preventScroll: true });
      return;
    }
    if (button.dataset.space) {
      state.selected = button.dataset.space;
      renderApp(); closeSheet(); $('#page-scroll').scrollTop = 0;
      return;
    }
    if (button.dataset.inviteRole && top()?.name === 'invite' && isAdmin(space())) {
      top().role = button.dataset.inviteRole;
      renderSheet();
      $(`[data-invite-role="${button.dataset.inviteRole}"]`).focus({ preventScroll: true });
      return;
    }
    if (button.dataset.restore && canEdit(space())) {
      const current = space();
      const index = current.trash.findIndex(item => item.id === button.dataset.restore);
      if (index === -1) return;
      const [restored] = current.trash.splice(index, 1);
      current.items.push({ name: restored.name, amount: restored.amount, note: '已恢复 · 在用', type: 'box' });
      state.records.unshift({ spaceId: current.id, title: `恢复了「${restored.name}」` });
      renderApp(); renderSheet(); toast('已恢复到当前空间');
      return;
    }
    const action = button.dataset.action;
    if (action === 'close-sheet') closeSheet();
    else if (action === 'back-sheet') backSheet();
    else if (action === 'spaces') openSheet('spaces');
    else if (action === 'create' && top()?.name === 'spaces') openSheet('create', { returnFocus: 'create' });
    else if (action === 'join' && top()?.name === 'spaces') openSheet('join', { returnFocus: 'join' });
    else if (action === 'demo-invitation') openSheet('invitation-preview', { returnFocus: 'demo-invitation' });
    else if (action === 'personal-avatar') openSheet('avatar', { scope: 'personal' });
    else if (action === 'family-avatar' && isAdmin(space())) openSheet('avatar', { scope: 'family' });
    else if (action === 'choose-avatar') $('#avatar-file')?.click();
    else if (action === 'default-avatar' && top()?.name === 'avatar') {
      avatarTask++; avatarLoading = false; avatarError = ''; avatarDraft = null;
      renderSheet('choose-avatar');
    } else if (action === 'save-avatar' && top()?.name === 'avatar' && !avatarLoading) {
      if (top().scope === 'personal') state.user.avatar = avatarDraft;
      else if (isAdmin(space())) space().avatar = avatarDraft;
      else return;
      renderApp(); closeSheet(); toast('头像已更新');
    } else if (action === 'members' && space().kind === 'family') openSheet('members');
    else if (action === 'nickname' && top()?.name === 'members') openSheet('nickname', { returnFocus: 'nickname' });
    else if (action === 'invite' && isAdmin(space()) && space().kind === 'family') openSheet('invite', { role: 'editor' });
    else if (action === 'share-demo') toast('演示邀请已就绪 · 未发送真实消息');
    else if (action === 'trash') openSheet('trash');
    else if (action === 'refresh') {
      button.classList.remove('refreshing');
      void button.offsetWidth;
      button.classList.add('refreshing');
      toast('当前空间已是最新 · 演示数据');
    }
  });
  document.addEventListener('keydown', event => {
    if (!stack.length) return;
    if (event.key === 'Escape') { event.preventDefault(); closeSheet(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...$('#sheet').querySelectorAll('button:not(:disabled), input:not([type="file"]):not(:disabled), select:not(:disabled), [tabindex="0"]')].filter(element => element.getClientRects().length);
    if (!controls.length) { event.preventDefault(); $('#sheet').focus(); return; }
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === $('#sheet'))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !$('#sheet').contains(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  });
  $('#preview-width').addEventListener('change', event => root.style.setProperty('--preview-width', `${event.target.value}px`));
  $('#preview-theme').addEventListener('change', event => {
    if (event.target.value === 'auto') delete root.dataset.theme;
    else root.dataset.theme = event.target.value;
  });
  $('#large-text').addEventListener('change', event => root.style.setProperty('--text-scale', event.target.checked ? '1.4' : '1'));
  $('#reset-preview').addEventListener('click', () => {
    state = fixture();
    renderApp();
    $('#page-scroll').scrollTop = 0;
    toast('已恢复初始预览');
  });
  if (params.get('mode') === 'screen') document.body.classList.add('screen-only');
  if (['light', 'dark'].includes(params.get('theme'))) { root.dataset.theme = params.get('theme'); $('#preview-theme').value = params.get('theme'); }
  if (['320', '390', '430'].includes(params.get('width'))) { root.style.setProperty('--preview-width', `${params.get('width')}px`); $('#preview-width').value = params.get('width'); }
  if (params.get('text') === 'large') { root.style.setProperty('--text-scale', '1.4'); $('#large-text').checked = true; }
  scenario(['personal', 'admin', 'editor', 'viewer'].includes(params.get('scenario')) ? params.get('scenario') : 'personal');
})();
