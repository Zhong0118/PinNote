async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 420, height: 560 } });
  const p = await context.newPage();
  const errors = [];
  p.on('pageerror', error => errors.push(error.message));
  await p.addInitScript(() => {
    const callbacks = new Map(), listeners = new Map();
    let sequence = 0;
    const note = { id: 'test', title: '回归测试', content: '原始内容', theme: 'paper', customColor: '#2d7d74', opacity: .96, alwaysOnTop: true, window: { width: 420, height: 560, x: 70, y: 90 }, createdAt: 1, updatedAt: 1, lastFocusedAt: 1 };
    const state = window.__test = {
      notes: { test: JSON.parse(sessionStorage.getItem('restart-note') || 'null') ?? note }, calls: [], failWrites: false, mainId: 'test', windows: ['main'], visible: true, position: {x:140,y:180}, size: {width:840,height:1120},
      emit(event, payload) { for (const [id, listener] of listeners) if (listener.event === event) callbacks.get(listener.handler)?.({ event, payload, id }); }
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
      transformCallback(fn) { const id = ++sequence; callbacks.set(id, fn); return id; },
      unregisterCallback(id) { callbacks.delete(id); },
      async invoke(cmd, args = {}) {
        state.calls.push({ cmd, args });
        if (cmd === 'load_notes') return JSON.stringify({ version: 1, notes: state.notes, lastActiveNoteId: Object.keys(state.notes)[0], lastClosedNoteId: Object.keys(state.notes)[0] });
        if (cmd === 'pending_quit') {
          const scenario = new URLSearchParams(location.search).get('update-test');
          if (scenario === 'cancelled') state.emit('quit-save-cancelled', 12);
          return scenario ? 12 : null;
        }
        if (['load_settings', 'load_templates'].includes(cmd)) return null;
        if (cmd === 'upsert_note') {
          if (state.failWrites) throw new Error('simulated disk full');
          const next = JSON.parse(args.json); state.notes[next.id] = next; return args.json;
        }
        if (cmd === 'patch_note') { Object.assign(state.notes[args.id], JSON.parse(args.json)); return JSON.stringify(state.notes[args.id]); }
        if (cmd === 'delete_note') { delete state.notes[args.id]; return; }
        if (cmd === 'main_note_id') return state.mainId;
        if (cmd === 'set_main_note_id') { state.mainId = args.id; return; }
        if (cmd === 'plugin:event|listen') { const id = ++sequence; listeners.set(id, args); return id; }
        if (cmd === 'plugin:event|unlisten') { listeners.delete(args.eventId); return; }
        if (cmd === 'plugin:event|emit_to') {
          const label = args.target.label;
          if (label === 'main') state.emit(args.event, args.payload);
          else if (args.event === 'window-visibility-request') {
            state.calls.push({cmd: args.payload.visible ? 'plugin:window|show' : 'plugin:window|hide', args:{label}});
            state.emit('window-visibility-complete',{requestId:args.payload.requestId,success:true});
          }
          return;
        }
        if (cmd === 'plugin:window|show') {state.visible = true; state.inertAtShow = document.body.inert; return;}
        if (cmd === 'plugin:window|hide') {state.visible = false; return;}
        if (cmd === 'plugin:event|emit') { state.emit(args.event, args.payload); return; }
        if (cmd === 'animate_note_window') {
          await new Promise(resolve => setTimeout(resolve, 120));
          state.position = {x:args.x*2,y:args.y*2}; state.size = {width:args.width*2,height:args.height*2}; return;
        }
        if (cmd === 'plugin:window|set_position') { const pos=args.value.position; const scale=pos.type === 'Logical' ? 2 : 1; state.position = {x:pos.x*scale,y:pos.y*scale}; return; }
        if (cmd === 'plugin:window|set_size') { const size = args.value.size; state.position.y += state.size.height - size.height*2; state.size = {width:size.width*2,height:size.height*2}; return; }
        if (cmd === 'plugin:window|outer_position') return state.position;
        if (cmd === 'plugin:window|inner_size') return state.size;
        if (cmd === 'plugin:window|scale_factor') return 2;
        if (cmd === 'plugin:window|is_visible') return state.visible;
        if (cmd === 'plugin:window|get_all_windows') return state.windows;
        if (cmd === 'plugin:window|available_monitors') return [{ name: 'test', position: { x: 0, y: 0 }, size: { width: 3024, height: 1964 }, scaleFactor: 2, workArea: { position: {x:0,y:0}, size: {width:3024,height:1964} } }];
        return null;
      }
    };
  });
  const passed = [];
  function check(condition, message) { if (!condition) throw new Error(message); passed.push(message); }
  async function fresh() { await p.goto('http://127.0.0.1:1420'); await p.locator('.milkdown .editor').waitFor(); await p.waitForFunction(() => !document.querySelector('main')?.inert); }
  try {
    await fresh();
    const restored = await p.evaluate(() => window.__test.calls.some(c => c.cmd === 'plugin:window|set_position'));
    check(restored, 'restores saved window geometry');
    // Simulate a real ProseMirror input and switch modes within the listener debounce window.
    await p.evaluate(async () => {
      document.querySelector('.milkdown .editor').focus();
      document.execCommand('selectAll'); document.execCommand('insertText', false, '即时输入应保留');
      await new Promise(requestAnimationFrame);
      window.dispatchEvent(new KeyboardEvent('keydown', {key:'/',ctrlKey:true,bubbles:true,cancelable:true}));
    });
    const source = p.getByRole('textbox', { name: 'Markdown 源码编辑' });
    check((await source.inputValue()).includes('即时输入应保留'), 'immediate mode switch preserves latest editor text');
    await source.fill('尚未落盘的新内容');
    await p.evaluate(() => window.__test.emit('note-settings-changed', { ...window.__test.notes.test, opacity: .8 }));
    check(await source.inputValue() === '尚未落盘的新内容', 'appearance sync preserves unsaved content');
    await source.fill('- 输入中文');
    const intercepted = await source.evaluate(el => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true });
      el.dispatchEvent(event); return event.defaultPrevented;
    });
    check(!intercepted, 'IME confirmation is not intercepted');
    const reads = await p.evaluate(async () => {
      window.__test.calls = [];
      for (let i = 0; i < 100; i++) window.__test.emit('tauri://move', { x: i, y: i });
      await new Promise(resolve => setTimeout(resolve, 250));
      return window.__test.calls.filter(c => ['plugin:window|outer_position', 'plugin:window|inner_size', 'plugin:window|scale_factor'].includes(c.cmd)).length;
    });
    check(reads === 3, '100 move events require only 3 geometry IPC queries');
    await p.evaluate(() => { window.__test.failWrites = true; });
    await source.fill('写入失败时仍保留的草稿');
    await p.waitForFunction(() => document.body.innerText.includes('保存失败'));
    await p.evaluate(() => { window.__test.calls = []; window.__test.emit('save-before-quit', 1); });
    await p.waitForFunction(() => window.__test.calls.some(c => c.cmd === 'quit_save_complete'));
    check(await p.evaluate(() => window.__test.calls.find(c => c.cmd === 'quit_save_complete').args.success === false && !document.body.inert), 'failed save rejects quit and keeps editor interactive');
    await p.evaluate(() => { window.__test.failWrites = false; window.__test.calls = []; window.__test.emit('save-before-quit', 2); });
    await p.waitForFunction(() => window.__test.calls.some(c => c.cmd === 'quit_save_complete'));
    check(await p.evaluate(() => window.__test.notes.test.content === '写入失败时仍保留的草稿' && window.__test.calls.find(c => c.cmd === 'quit_save_complete').args.success === true), 'retry saves latest draft before acknowledging quit');
    await fresh();
    await p.evaluate(async () => {
      document.querySelector('.milkdown .editor').focus();
      document.execCommand('selectAll'); document.execCommand('insertText', false, '退出前最后一行');
      await new Promise(requestAnimationFrame);
      window.__test.emit('save-before-quit', 3);
    });
    await p.waitForFunction(() => window.__test.calls.some(c => c.cmd === 'quit_save_complete'));
    check(await p.evaluate(() => window.__test.notes.test.content.includes('退出前最后一行')), 'immediate quit serializes live editor before save');
    await fresh();
    await p.keyboard.press('Control+/');
    await p.getByRole('textbox', { name: 'Markdown 源码编辑' }).fill('退出重试中的草稿');
    await p.evaluate(() => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      let first = true;
      window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
        if (cmd === 'upsert_note' && first) {
          first = false;
          return new Promise((_, reject) => { window.__test.rejectFirst = reject; });
        }
        return invoke(cmd, args);
      };
      window.__test.emit('save-before-quit', 10);
    });
    await p.waitForFunction(() => Boolean(window.__test.rejectFirst));
    await p.evaluate(() => {
      window.__test.emit('save-before-quit', 11);
      window.__test.rejectFirst(new Error('old attempt failed'));
    });
    await p.waitForFunction(() => window.__test.calls.some(c => c.cmd === 'quit_save_complete' && c.args.attempt === 11));
    await p.evaluate(() => window.__test.emit('quit-save-failed', 10));
    check(await p.evaluate(() => document.body.inert), 'stale quit failure cannot re-enable editing during a newer attempt');
    await fresh();
    await p.evaluate(() => {
      window.__test.notes.b = { ...window.__test.notes.test, id: 'b', title: '第二张便签' };
      window.__test.windows.push('note-b');
      window.__test.emit('delete-note-requested', { id: 'test' });
    });
    await p.waitForFunction(() => window.__test.mainId === null);
    await p.evaluate(() => { window.__test.visible = false; window.__test.calls = []; window.__test.emit('toggle-notes-visibility-requested'); });
    await p.waitForFunction(() => window.__test.calls.some(c => c.cmd === 'plugin:window|show'));
    check(await p.evaluate(() => window.__test.calls.filter(c => c.cmd === 'plugin:window|show').every(c => c.args.label === 'note-b')), 'deleted main does not impersonate another note window');
    await fresh();
    await p.getByRole('button', { name: '便签菜单', exact: true }).click();
    await p.getByRole('menu').waitFor();
    await p.waitForFunction(() => document.activeElement?.getAttribute('role') === 'menuitem');
    await p.keyboard.press('End');
    check(await p.getByRole('menuitem', {name:'删除便签'}).evaluate(el => el === document.activeElement), 'menu keyboard navigation reaches last action');
    await p.keyboard.press('Escape');
    await p.getByRole('menu').waitFor({state:'detached'});
    check(await p.getByRole('button', {name:'便签菜单',exact:true}).evaluate(el => el === document.activeElement), 'Escape closes menu and restores focus');
    await p.evaluate(async () => {
      document.querySelector('.milkdown .editor').focus();
      document.execCommand('selectAll'); document.execCommand('insertText',false,'胶囊前最后输入');
      await new Promise(requestAnimationFrame);
      document.querySelector('[aria-label="收起便签"]').click();
    });
    await p.waitForFunction(() => window.__test.notes.test.window.collapsed && !document.querySelector('.transitioning'));
    check(await p.evaluate(() => window.__test.size.width === 360 && window.__test.size.height === 80), 'capsule requests actual native 180 × 40 size');
    check(await p.evaluate(() => window.__test.position.y === 180), 'native bottom-anchored resize keeps the capsule top edge stable');
    check(await p.evaluate(() => window.__test.notes.test.content.includes('胶囊前最后输入') && window.__test.notes.test.window.width === 420), 'collapse saves live content without overwriting expanded width');
    await p.setViewportSize({width:180,height:40});
    check(await p.locator('.milkdown .editor').count() === 1 && !await p.locator('.milkdown .editor').isVisible(), 'capsule hides but preserves editor instance');
    await p.evaluate(() => { window.__test.position = {x:800,y:300}; window.__test.emit('tauri://move', {x:800,y:300}); });
    await p.waitForFunction(() => window.__test.notes.test.window.capsulePosition.x === 400);
    await p.getByRole('button', { name: '展开便签 回归测试' }).click();
    await p.waitForFunction(() => !window.__test.notes.test.window.collapsed && !document.querySelector('.transitioning'));
    await p.setViewportSize({width:420,height:560});
    check(await p.evaluate(() => window.__test.size.width === 840 && window.__test.size.height === 1120 && window.__test.position.x === 320 && window.__test.position.y === 300), 'expanding moved capsule restores size at new right-edge anchor');
    check((await p.locator('.milkdown .editor').innerText()).includes('胶囊前最后输入'), 'expansion preserves editor contents');
    await p.evaluate(() => { window.__test.failWrites = true; });
    await p.getByRole('button', {name:'收起便签'}).click();
    await p.waitForFunction(() => document.body.innerText.includes('窗口切换失败'));
    check(await p.locator('.milkdown .editor').isVisible() && await p.evaluate(() => window.__test.size.width === 840), 'failed pre-collapse save keeps expanded editor usable');
    await fresh();
    await p.getByRole('button', {name:'收起便签'}).focus();
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => document.activeElement?.hasAttribute('data-capsule-drag'));
    check(true, 'keyboard collapse focuses capsule');
    await p.setViewportSize({width:180,height:40});
    await p.evaluate(() => sessionStorage.setItem('restart-note', JSON.stringify(window.__test.notes.test)));
    await p.reload();
    await p.locator('[data-capsule-drag]').waitFor();
    await p.waitForFunction(() => window.__test.calls.some(c => c.cmd === 'plugin:window|show'));
    check(await p.evaluate(() => window.__test.size.width === 360 && window.__test.size.height === 80), 'startup restores collapsed native size before showing');
    await p.evaluate(() => sessionStorage.removeItem('restart-note'));
    await p.mouse.move(60,20); await p.mouse.down(); await p.mouse.move(80,20); await p.mouse.up();
    check(await p.evaluate(() => window.__test.calls.some(c => c.cmd === 'plugin:window|start_dragging') && window.__test.notes.test.window.collapsed), 'dragging capsule does not expand it');
    await p.evaluate(() => { window.__test.failWrites = true; });
    await p.locator('[data-capsule-drag]').focus();
    await p.keyboard.press('Enter');
    await p.getByRole('alert').waitFor({state:'attached'});
    check((await p.getByRole('alert').textContent()).includes('窗口切换失败'), 'collapsed save failure remains accessible');
    await p.evaluate(() => { window.__test.failWrites = false; });
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '收起便签');
    await p.setViewportSize({width:420,height:560});
    check(await p.locator('.milkdown .editor').isVisible(), 'keyboard expansion restores header focus and editor');
    await fresh();
    await p.evaluate(() => {
      const state = window.__test;
      state.notes.b = {...state.notes.test,id:'b',window:{width:710,height:610}};
      const invoke = window.__TAURI_INTERNALS__.invoke;
      let hold = true;
      window.__TAURI_INTERNALS__.invoke = async (cmd,args) => {
        if (['plugin:window|set_size','animate_note_window'].includes(cmd) && hold) {
          hold = false;
          await new Promise(resolve => { state.releaseSize = resolve; });
        }
        return invoke(cmd,args);
      };
    });
    await p.getByRole('button',{name:'收起便签'}).click();
    await p.waitForFunction(() => Boolean(window.__test.releaseSize));
    await p.evaluate(() => window.__test.emit('delete-note-requested', {id:'test'}));
    await p.waitForTimeout(50);
    check(await p.evaluate(() => !window.__test.calls.some(c => c.cmd === 'delete_note')), 'deletion waits for an in-flight capsule switch');
    await p.evaluate(() => window.__test.releaseSize());
    await p.waitForFunction(() => window.__test.mainId === 'b');
    check(await p.evaluate(() => window.__test.notes.b.window.width === 710 && !window.__test.notes.b.window.collapsed), 'completed deletion does not apply old capsule geometry to fallback note');
    await fresh();
    await p.getByRole('button',{name:'收起便签'}).click();
    await p.waitForFunction(() => window.__test.notes.test.window.collapsed && !document.querySelector('.transitioning'));
    check(await p.evaluate(() => window.__test.calls.filter(c => c.cmd === 'animate_note_window').length === 1), 'macOS switches mode with one native frame animation');
    await p.emulateMedia({reducedMotion:'reduce'});
    await p.locator('[data-capsule-drag]').click();
    await p.waitForFunction(() => !window.__test.notes.test.window.collapsed && !document.querySelector('.transitioning'));
    check(await p.evaluate(() => window.__test.calls.filter(c => c.cmd === 'animate_note_window').length === 1), 'reduced motion bypasses native animation');
    await fresh();
    await p.evaluate(() => {
      const state = window.__test;
      const original = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = async (cmd,args) => {
        if (cmd === 'upsert_note') await new Promise(resolve => setTimeout(resolve,80));
        return original(cmd,args);
      };
      state.emit('toggle-notes-visibility-requested');
      state.emit('toggle-notes-visibility-requested');
    });
    await p.waitForFunction(() => window.__test.calls.some(c=>c.cmd==='plugin:window|hide') && window.__test.visible);
    check(true, 'rapid tray toggles wait for saved hide then show');
    await p.evaluate(() => {window.__test.failWrites = true; window.__test.emit('toggle-notes-visibility-requested');});
    await p.waitForFunction(()=>document.body.innerText.includes('切换失败'));
    check(await p.evaluate(()=>window.__test.visible), 'failed tray save keeps note visible and reports failure');
    await fresh();
    await p.evaluate(() => { window.__test.position={x:-5000,y:300}; window.__test.visible=false; window.__test.emit('toggle-notes-visibility-requested'); });
    await p.waitForFunction(()=>window.__test.visible);
    check(await p.evaluate(()=>window.__test.position.x===0), 'tray reveal recovers note from disconnected display');
    await fresh();
    await p.evaluate(() => {
      const state=window.__test, original=window.__TAURI_INTERNALS__.invoke;
      let first=true;
      window.__TAURI_INTERNALS__.invoke=async(cmd,args)=>{
        if(cmd==='upsert_note'&&first){first=false;await new Promise(resolve=>state.releaseSave=resolve);}
        return original(cmd,args);
      };
      state.emit('toggle-notes-visibility-requested');
    });
    await p.waitForFunction(()=>Boolean(window.__test.releaseSave));
    await p.evaluate(()=>{const now=Date.now;Date.now=()=>now()+6000;window.__test.releaseSave();});
    await p.waitForFunction(()=>document.body.innerText.includes('切换失败'));
    check(await p.evaluate(()=>window.__test.visible), 'expired hide request saves content without hiding later');
    await fresh();
    await p.evaluate(() => {
      const state=window.__test, original=window.__TAURI_INTERNALS__.invoke;
      state.notes.b={...state.notes.test,id:'b'};state.windows.push('note-b');state.visible=false;state.calls=[];
      let first=true;
      window.__TAURI_INTERNALS__.invoke=async(cmd,args)=>{
        if(cmd==='plugin:window|outer_position'&&first){first=false;await new Promise(resolve=>state.releaseRead=resolve);}
        return original(cmd,args);
      };
      state.emit('toggle-notes-visibility-requested');
    });
    await p.waitForFunction(()=>Boolean(window.__test.releaseRead));
    await p.evaluate(()=>window.__test.emit('delete-note-requested',{id:'test'}));
    await p.waitForFunction(()=>window.__test.mainId===null);
    await p.evaluate(()=>window.__test.releaseRead());
    await p.waitForFunction(()=>document.body.innerText.includes('切换失败'));
    check(await p.evaluate(()=>!window.__test.calls.some(c=>c.cmd==='plugin:window|show'&&c.args.label==='main')), 'deleting main invalidates an older tray reveal');
    await p.goto('http://127.0.0.1:1420/?update-test=pending');
    await p.waitForFunction(() => window.__test.calls.some(c => c.cmd === 'quit_save_complete'));
    check(await p.evaluate(() => document.body.inert && window.__test.inertAtShow), 'late-created note is frozen before first reveal during update');
    await p.evaluate(() => window.__test.emit('quit-save-cancelled', 12));
    check(await p.evaluate(() => !document.body.inert), 'cancelled installation restores editor interaction');
    await p.goto('http://127.0.0.1:1420/?update-test=cancelled');
    await p.waitForFunction(() => window.__test.calls.some(c => c.cmd === 'plugin:window|show'));
    check(await p.evaluate(() => !document.body.inert && !window.__test.calls.some(c => c.cmd === 'quit_save_complete')), 'late pending reply cannot refreeze an already cancelled installation');
    check(errors.length === 0, `no page errors (${errors.join('; ')})`);
    return { passed: passed.length, checks: passed };
  } finally { await context.close(); }
}
