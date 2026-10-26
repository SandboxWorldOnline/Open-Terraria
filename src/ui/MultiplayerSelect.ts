// 联机面板 v3：中央服务器房间制（docs/multiplayer-design.md §房间）。
// lobby HTTP（:lobbyPort）= 房间列表/建房/码校验；WS（lobbyPort-1）/<房间码>?token=。
// 房主：选存档建房（勾选公开性 + 破坏保护 + 物品保护）→ 得 6 位房间码 → 进房。
// 其他玩家：房间列表点击加入，或输房间码进非公开房。
// 文案 = Mods.SandboxWorld.MP.*（自制联机 UI,原版无对应键）
import { Lang } from '../i18n/Lang';
const T = (k: string, ...a: (string | number)[]) => Lang.text(`Mods.SandboxWorld.MP.${k}`, ...a);
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export interface SaveEntry { id: number; name: string; json: string | null }

export interface MultiplayerSelectCallbacks {
  /** 连接原版(1.4.5.x)专用服（vanilla interop P0,2026-10-25）。
   *  target = host:port（原版服本体地址,浏览器经本地桥 vanillaBridge 转发接入） */
  onJoinVanilla: (target: string) => void;
  /** 加入房间（完整 ws URL：ws://host:wsPort/<房间码>[?token=...]）。
   *  worldId=建房链进房时传入的本机世界槽位 id（★BJ704-G7 件1:playedWorlds 绑定;
   *  码入房/房间列表进房不传=undefined） */
  onJoinRoom: (url: string, hostToken: string, worldId?: number) => void;
  /** 创建房间资产链(2026-08-25 用户要求,单人式流程):角色选择 → 世界列表 →
   *  then(saveJson, worldName, worldId?) 继续建房（worldId=选定世界槽位 id） */
  onCreateRoomFlow: (then: (worldJson: string, worldName: string, worldId?: number) => void) => void;
  /** 加入/创建前需要角色(2026-08-25 用户要求):跳转既有单人角色列表
   *  (CharSelectPanel 覆盖层,多人面板保持挂载)——选完 then() 继续动作 */
  onNeedCharacter: (then: () => void) => void;
  onBack: () => void;
}

export interface RoomListItem {
  code: string; name: string; online: number; maxPlayers: number; w: number; h: number;
  protectTiles: boolean; protectItems: boolean;
}

const DEFAULT_SERVER = '127.0.0.1:7778'; // lobby 端口（WS = lobby-1）

/** 地址 → { httpBase, wsBase }（lobby 端口约定：WS 在 lobby-1） */
function serverBase(addr: string): { httpBase: string; wsBase: string } | null {
  const a = addr.trim();
  if (!a) return null;
  const m = a.match(/^(\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::(\d+))?$/i);
  if (!m) return null;
  const lobbyPort = m[2] ? parseInt(m[2], 10) : 7778;
  return { httpBase: `http://${m[1]}:${lobbyPort}`, wsBase: `ws://${m[1]}:${lobbyPort - 1}` };
}

export class MultiplayerSelect {
  root: HTMLElement;
  private roomList = el('div');
  private codeInput: HTMLInputElement;
  private vanInput: HTMLInputElement;
  private createName: HTMLInputElement;
  private createPublic: HTMLInputElement;
  private createTiles: HTMLInputElement;
  private createItems: HTMLInputElement;
  private createPvp: HTMLInputElement;
  private createdInfo = el('div');
  private hostCode = '';
  private hostToken = '';
  private status = (elm: HTMLElement, text: string, color = '#8b98bd') => {
    elm.textContent = text;
    elm.style.color = color;
  };

  constructor(private cb: MultiplayerSelectCallbacks) {
    this.root = el('div', 'sw-panel');
    this.root.style.cssText =
      'position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); max-width:520px; width:min(520px,96vw); z-index:20; cursor:auto; max-height:92vh; overflow-y:auto;';
    this.root.appendChild(el('h2', undefined, T('Title')));

    // ---- 角色选择不再自造列表(2026-08-25 用户要求):加入/创建时经
    //      onNeedCharacter 跳转既有单人角色列表(CharSelectPanel) ----

    // ---- 加入：房间列表(2026-08-25 用户要求:刷新按钮在列表下方) ----
    const sJoin = el('div', undefined, T('JoinSection'));
    sJoin.style.cssText = 'margin:10px 0 6px; color:#c9d4ff;';
    this.root.appendChild(sJoin);
    this.roomList.style.cssText = 'min-height:60px; max-height:220px; overflow-y:auto; background:rgba(10,16,40,0.5); border-radius:4px; padding:4px; margin-bottom:8px;';
    this.root.appendChild(this.roomList);
    const srvRow = el('div');
    srvRow.style.cssText = 'display:flex; gap:8px; align-items:center; margin-bottom:10px;';
    const srvBtn = el('button', 'sw-btn', T('Refresh')) as HTMLButtonElement;
    srvBtn.style.cssText = 'width:auto; margin:0; padding:8px 12px; flex:none;';
    srvBtn.onclick = () => void this.refreshRooms();
    srvRow.appendChild(srvBtn);
    this.root.appendChild(srvRow);

    // 码加入（非公开房）
    const codeRow = el('div');
    codeRow.style.cssText = 'display:flex; gap:8px;';
    this.codeInput = el('input') as HTMLInputElement;
    this.codeInput.placeholder = T('RoomCodeHint');
    this.codeInput.style.cssText = 'flex:1; padding:8px; background:rgba(10,16,40,0.8); color:#fff; border:1px solid #4a5a9a; border-radius:4px;';
    const codeBtn = el('button', 'sw-btn', T('JoinByCode')) as HTMLButtonElement;
    codeBtn.style.cssText = 'width:auto; margin:0; padding:8px 14px; flex:none;';
    codeBtn.onclick = () => {
      const code = this.codeInput.value.trim();
      if (!/^\d{6}$/.test(code)) { this.status(this.roomList, T('BadCode'), '#ff6b6b'); return; }
      this.cb.onNeedCharacter(() => void this.joinByCode());
    };
    this.codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') codeBtn.click(); });
    codeRow.appendChild(this.codeInput);
    codeRow.appendChild(codeBtn);
    this.root.appendChild(codeRow);

    // ---- 连接原版服务器（vanilla interop 全功能:PvE/PvP 战斗/挖掘建造/箱子/物品/弹幕/液体均已接线,
    //      2026-10-25 战役收官;遗留债见 memory/vanilla-server-interop-scope）----
    const vanHr = el('hr');
    vanHr.style.cssText = 'border:none; border-top:1px solid rgba(90,120,220,0.3); margin:14px 0;';
    this.root.appendChild(vanHr);
    const sVanilla = el('div', undefined, T('VanillaSection'));
    sVanilla.style.cssText = 'margin:0 0 6px; color:#c9d4ff;';
    this.root.appendChild(sVanilla);
    const vanRow = el('div');
    vanRow.style.cssText = 'display:flex; gap:8px;';
    this.vanInput = el('input') as HTMLInputElement;
    this.vanInput.value = '127.0.0.1:7781';
    this.vanInput.placeholder = T('VanillaAddrHint');
    this.vanInput.style.cssText = 'flex:1; padding:8px; background:rgba(10,16,40,0.8); color:#fff; border:1px solid #4a5a9a; border-radius:4px;';
    const vanBtn = el('button', 'sw-btn', T('JoinVanilla')) as HTMLButtonElement;
    vanBtn.style.cssText = 'width:auto; margin:0; padding:8px 14px; flex:none;';
    vanBtn.onclick = () => {
      const target = this.vanInput.value.trim();
      if (!/^[\w.-]+:\d+$/.test(target)) { this.status(this.roomList, T('BadAddr'), '#ff6b6b'); return; }
      this.cb.onNeedCharacter(() => this.cb.onJoinVanilla(target));
    };
    this.vanInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') vanBtn.click(); });
    vanRow.appendChild(this.vanInput);
    vanRow.appendChild(vanBtn);
    this.root.appendChild(vanRow);
    const vanNote = el('div', undefined, T('VanillaBridgeNote'));
    vanNote.style.cssText = 'font-size:12px; color:#8b98bd; margin:4px 0 0;';
    this.root.appendChild(vanNote);

    // ---- 分隔 ----
    const hr = el('hr');
    hr.style.cssText = 'border:none; border-top:1px solid rgba(90,120,220,0.3); margin:14px 0;';
    this.root.appendChild(hr);

    // ---- 建房（房主） ----
    const sHost = el('div', undefined, T('HostSection'));
    sHost.style.cssText = 'margin:0 0 6px; color:#c9d4ff;';
    this.root.appendChild(sHost);

    // 存档选择器已移除(2026-08-25 用户要求):创建房间走 角色选择 → 世界列表
    // (onCreateRoomFlow,单人式流程),选中的世界 JSON 在链尾传入 createRoom

    this.createName = el('input') as HTMLInputElement;
    this.createName.placeholder = T('RoomNameHint');
    this.createName.style.cssText = 'width:100%; box-sizing:border-box; padding:6px; margin-bottom:6px; background:rgba(10,16,40,0.8); color:#fff; border:1px solid #4a5a9a; border-radius:4px;';
    this.root.appendChild(this.createName);

    const mkCheck = (label: string, checked: boolean): HTMLInputElement => {
      const wrap = el('label');
      wrap.style.cssText = 'display:flex; align-items:center; gap:6px; color:#c9d4ff; font-size:13px; margin:2px 0;';
      const box = el('input') as HTMLInputElement;
      box.type = 'checkbox';
      box.checked = checked;
      wrap.appendChild(box);
      wrap.appendChild(el('span', undefined, label));
      this.root.appendChild(wrap);
      return box;
    };
    this.createPublic = mkCheck(T('PublicRoom'), true);
    this.createTiles = mkCheck(T('TileProtect'), false);
    this.createItems = mkCheck(T('ItemProtect'), false);
    this.createPvp = mkCheck(T('PvpAllow'), false);

    const createBtn = el('button', 'sw-btn', T('Create')) as HTMLButtonElement;
    createBtn.style.margin = '8px 0 4px';
    createBtn.onclick = () => {
      // 单人式资产链:角色选择 → 世界列表 → 建房(2026-08-25 用户要求)
      this.cb.onCreateRoomFlow((worldJson, worldName, worldId) => void this.createRoom(createBtn, worldJson, worldName, worldId));
    };
    this.root.appendChild(createBtn);

    this.createdInfo.style.cssText = 'min-height:18px; font-size:13px; color:#8b98bd; word-break:break-all;';
    this.root.appendChild(this.createdInfo);

    const back = el('button', 'sw-btn', T('Back')) as HTMLButtonElement;
    back.style.marginTop = '14px';
    back.onclick = cb.onBack;
    this.root.appendChild(back);

    void this.refreshRooms();
  }

  // ================= 加入 =================

  private joinUrl(code: string, token = ''): string | null {
    const base = serverBase(DEFAULT_SERVER);
    if (!base) { this.status(this.roomList, T('BadAddr'), '#ff6b6b'); return null; }
    return token ? `${base.wsBase}/${code}?token=${encodeURIComponent(token)}` : `${base.wsBase}/${code}`;
  }

  private async refreshRooms() {
    const base = serverBase(DEFAULT_SERVER);
    if (!base) { this.status(this.roomList, T('BadAddr'), '#ff6b6b'); return; }
    this.status(this.roomList, T('Fetching'));
    try {
      const r = await fetch(`${base.httpBase}/rooms`);
      const data = await r.json() as { ok: boolean; rooms: RoomListItem[] };
      if (!data.ok) throw new Error('bad response');
      this.roomList.textContent = '';
      if (!data.rooms.length) {
        this.status(this.roomList, T('NoRooms'));
        return;
      }
      for (const rm of data.rooms) {
        const item = el('div');
        item.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:6px; border-bottom:1px solid rgba(90,120,220,0.2); cursor:pointer;';
        item.onmouseenter = () => { item.style.background = 'rgba(60,80,160,0.3)'; };
        item.onmouseleave = () => { item.style.background = ''; };
        const prot = [rm.protectTiles ? '🛡' + T('Shield') : '', rm.protectItems ? '📦' + T('Box') : ''].filter(Boolean).join(' ');
        const left = el('div', undefined, `${rm.name}  ${rm.w}×${rm.h}${prot ? '  ' + prot : ''}`);
        left.style.cssText = 'color:#e8ecf8; font-size:13px;';
        const right = el('div', undefined, `👤${rm.online}/${rm.maxPlayers ?? 255}  [${rm.code}]`);
        right.style.cssText = 'color:#8b98bd; font-size:12px;';
        item.appendChild(left);
        item.appendChild(right);
        item.onclick = () => {
          this.cb.onNeedCharacter(() => {
            const url = this.joinUrl(rm.code);
            if (url) this.cb.onJoinRoom(url, '');
          });
        };
        this.roomList.appendChild(item);
      }
    } catch {
      // ★连不上=列表为空(2026-08-25 用户要求:不报错不暴露服务器细节)
      this.status(this.roomList, T('NoRooms'));
    }
  }

  private async joinByCode() {
    const code = this.codeInput.value.trim();
    if (!/^\d{6}$/.test(code)) { this.status(this.roomList, T('BadCode'), '#ff6b6b'); return; }
    const base = serverBase(DEFAULT_SERVER);
    if (!base) { this.status(this.roomList, T('BadAddr'), '#ff6b6b'); return; }
    this.status(this.roomList, T('Checking', code));
    try {
      const r = await fetch(`${base.httpBase}/rooms/${code}`);
      if (!r.ok) throw new Error(await r.json().then((d: { error?: string }) => d.error ?? T('RoomNotFound')).catch(() => T('RoomNotFound')));
      const url = this.joinUrl(code);
      if (url) this.cb.onJoinRoom(url, '');
    } catch (e) {
      this.status(this.roomList, (e as Error).message, '#ff6b6b');
    }
  }

  // ================= 建房 =================

  private async createRoom(btn: HTMLButtonElement, worldJson: string, worldName: string, worldId?: number) {
    const base = serverBase(DEFAULT_SERVER);
    if (!base) { this.status(this.createdInfo, T('BadAddr'), '#ff6b6b'); return; }
    btn.disabled = true;
    this.status(this.createdInfo, T('Uploading'));
    try {
      const r = await fetch(`${base.httpBase}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: this.createName.value.trim() || worldName,
          public: this.createPublic.checked,
          protectTiles: this.createTiles.checked,
          protectItems: this.createItems.checked,
          pvpAllowed: this.createPvp.checked,
          save: worldJson,
        }),
      });
      const data = await r.json() as { ok: boolean; code?: string; hostToken?: string; error?: string };
      if (!data.ok || !data.code || !data.hostToken) throw new Error(data.error ?? T('CreateFail'));
      this.hostCode = data.code;
      this.hostToken = data.hostToken;
      this.status(this.createdInfo, T('RoomCreated', data.code) + (this.createPublic.checked ? '' : T('RoomPrivateNote')), '#7dff8a');
      const enter = el('button', 'sw-btn', T('EnterRoom', data.code)) as HTMLButtonElement;
      enter.style.cssText = 'width:auto; margin:6px 0 0; display:block;';
      enter.onclick = () => {
        const url = this.joinUrl(this.hostCode, this.hostToken);
        if (url) this.cb.onJoinRoom(url, this.hostToken, worldId);   // ★BJ704-G7 件1:建房世界槽位 id 随进房下传
      };
      this.createdInfo.appendChild(enter);
      // 建房成功后房间码所在房可能进列表（公开时）——轻刷一次
      void this.refreshRooms();
    } catch (e) {
      this.status(this.createdInfo, T('CreateFailDetail', (e as Error).message), '#ff6b6b');
    } finally {
      btn.disabled = false;
    }
  }
}
