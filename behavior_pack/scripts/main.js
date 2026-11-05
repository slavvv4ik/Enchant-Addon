import { world, system, ItemStack } from "@minecraft/server";

/* ========================================================================
   Enchant-Addon — скриптовая часть (Minecraft Bedrock 1.21.x / «26.60»)
   - Система маны игрока (1000/1000, реген 1 ед. за 2 секунды)
   - Блок конденсации маны, блок формирования манакамня, блок слияния
   - Зелья маны, скриптовый статус «Регенерация маны»
   - Отображение маны в actionbar
   ======================================================================== */

const PREFIX = "enchant_addon:";
const MAX_MANA = 1000;
const REGEN_INTERVAL = 40;      // 2 секунды (20 тиков/с)
const CONDENSER_INTERVAL = 20;  // 1 секунда
const DRAIN_PER_SECOND = 25;
const CONDENSER_NEED = 200;
const XP_COST = 5;
const MANA_COST = 50;
const REGEN_POTION_TICKS = 90;  // 3 минуты через каждые 2 секунды

const MANA_KEY = PREFIX + "mana";
const REGEN_KEY = PREFIX + "regen";

const ENCHANTS = [
  { key: "aqua_affinity", ru: "Подводник", max: 1 },
  { key: "bane_of_arthropods", ru: "Бич членистоногих", max: 5 },
  { key: "blast_protection", ru: "Взрывоустойчивость", max: 4 },
  { key: "depth_strider", ru: "Подводная ходьба", max: 3 },
  { key: "efficiency", ru: "Эффективность", max: 5 },
  { key: "feather_falling", ru: "Невесомость", max: 4 },
  { key: "fire_aspect", ru: "Заговор огня", max: 2 },
  { key: "fire_protection", ru: "Огнеупорность", max: 4 },
  { key: "flame", ru: "Воспламенение", max: 1 },
  { key: "fortune", ru: "Удача", max: 3 },
  { key: "frost_walker", ru: "Ледоход", max: 2 },
  { key: "infinity", ru: "Бесконечность", max: 1 },
  { key: "knockback", ru: "Отбрасывание", max: 2 },
  { key: "looting", ru: "Добыча", max: 3 },
  { key: "luck_of_the_sea", ru: "Везучий рыбак", max: 3 },
  { key: "lure", ru: "Приманка", max: 3 },
  { key: "mending", ru: "Починка", max: 1 },
  { key: "multishot", ru: "Тройной выстрел", max: 1 },
  { key: "power", ru: "Сила", max: 5 },
  { key: "projectile_protection", ru: "Защита от снарядов", max: 4 },
  { key: "protection", ru: "Защита", max: 4 },
  { key: "punch", ru: "Откидывание", max: 2 },
  { key: "quick_charge", ru: "Быстрая перезарядка", max: 3 },
  { key: "respiration", ru: "Подводное дыхание", max: 3 },
  { key: "sharpness", ru: "Острота", max: 5 },
  { key: "silk_touch", ru: "Шёлковое касание", max: 1 },
  { key: "smite", ru: "Небесная кара", max: 5 },
  { key: "swift_sneak", ru: "Проворство", max: 3 },
  { key: "thorns", ru: "Шипы", max: 3 },
  { key: "unbreaking", ru: "Прочность", max: 3 }
];

const ENCHANT_BY_KEY = {};
const ITEM_KEY_BY_TYPE = {};
const ROMAN = { "I": 1, "II": 2, "III": 3, "IV": 4, "V": 5 };
for (const e of ENCHANTS) {
  ENCHANT_BY_KEY[e.key] = e;
  ITEM_KEY_BY_TYPE[`${PREFIX}ms_${e.key}`] = e.key;
}

function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
function sanitizeTag(s) {
  return String(s).replace(/[^a-zA-Z0-9_]/g, "_");
}

// --- динамические свойства игрока (мана сохраняется после смерти) ---
function dynProps(p) { return p.getDynamicProperties(); }
function getMana(p) {
  const v = dynProps(p)[MANA_KEY];
  return v === undefined ? MAX_MANA : Math.max(0, Math.min(MAX_MANA, parseFloat(v) || 0));
}
function setMana(p, v) {
  p.setDynamicProperty(MANA_KEY, String(Math.max(0, Math.min(MAX_MANA, v))));
}
function ensureMana(p) {
  if (dynProps(p)[MANA_KEY] === undefined) p.setDynamicProperty(MANA_KEY, String(MAX_MANA));
}
function getRegenTimer(p) {
  const v = dynProps(p)[REGEN_KEY];
  return v === undefined ? 0 : Math.max(0, parseInt(v) || 0);
}
function setRegenTimer(p, t) {
  if (t > 0) p.setDynamicProperty(REGEN_KEY, String(t));
  else p.deleteDynamicProperty(REGEN_KEY);
}

function actionbar(p, text) {
  try { p.runCommandAsync(`title @s actionbar ${text}`); } catch (_) {}
}
function sound(p, name) {
  try { p.runCommandAsync(`playsound ${name} @s ~ ~ ~ 1 1`); } catch (_) {}
}
function soundNear(dim, loc, name, radius) {
  try {
    for (const pl of dim.getPlayers()) {
      if (dist(pl.location, loc) <= radius) sound(pl, name);
    }
  } catch (_) {}
}
function spawnParticle(dim, loc, id) {
  try { dim.spawnParticle(id, loc); } catch (_) {}
}
function updateBar(p) {
  const mana = Math.floor(getMana(p));
  const timer = getRegenTimer(p);
  actionbar(p, `§b${mana}/${MAX_MANA}${timer > 0 ? " §a✦" : ""}`);
}

// Списывает уровни опыта от имени измерения (не требует прав оператора у игрока).
async function xpCost(player, amount) {
  const tag = `enchant_xp_${String(player.id).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  player.addTag(tag);
  try {
    const result = await player.dimension.runCommandAsync(`xp add @a[tag=${tag}] -${amount} levels`);
    return result.status === "success";
  } catch (_) {
    return false;
  } finally {
    player.removeTag(tag);
  }
}

// --- инвентарь ---
function getInventory(p) { return p.getComponent("minecraft:inventory"); }

// Возвращает ItemStack, который был изъят (или null), чтобы можно было прочитать nameTag/уровень.
function consumeOne(p, typeId) {
  try {
    const inv = getInventory(p);
    const contents = inv.getContents();
    for (let i = 0; i < contents.length; i++) {
      const s = contents[i];
      if (s && s.typeId === typeId && s.amount > 0) {
        if (s.amount > 1) inv.setItem(i, new ItemStack(typeId, s.amount - 1));
        else {
          try { inv.clear(i); } catch (_) {
            try { inv.setItem(i, new ItemStack(typeId, 0)); } catch (__) {}
          }
        }
        return s;
      }
    }
  } catch (_) {}
  return null;
}

function giveItem(p, typeId, amount, nameTag) {
  try {
    const stack = new ItemStack(typeId, amount);
    if (nameTag) {
      try { stack.nameTag = nameTag; } catch (_) {}
    }
    const inv = getInventory(p);
    const left = inv.addItem(stack);
    if (left && left.amount > 0) {
      const ent = p.dimension.spawnEntity("minecraft:item", p.location);
      const tag = PREFIX + "drop_" + sanitizeTag(String(Math.floor(Math.random() * 1000000)));
      ent.addTag(tag);
      p.dimension.runCommand(`data merge entity @e[tag=${tag},limit=1] {Item:{id:"${typeId}",Count:${Math.floor(left.amount)}}}`);
    }
    return true;
  } catch (_) {}
  return false;
}

// --- визуализация предметов на блоках (невидимые брондстойки с предметом в голове) ---
function visualPos(x, y, z, kind) {
  if (kind === "condenser") return { x: x + 0.5, y: y - 0.15, z: z + 0.5 };
  if (kind === "anvil") return { x: x + 0.5, y: y - 0.30, z: z + 0.5 };
  if (kind === "merge_left") return { x: x + 0.1875, y: y - 0.70, z: z + 0.5 };
  if (kind === "merge_right") return { x: x + 0.8125, y: y - 0.70, z: z + 0.5 };
  if (kind === "merge_result") return { x: x + 0.5, y: y - 0.50, z: z + 0.5 };
  return { x: x + 0.5, y: y + 0.5, z: z + 0.5 };
}

function spawnStand(dim, pos, typeId, tag, small) {
  const stand = dim.spawnEntity("minecraft:armor_stand", pos);
  stand.addTag(tag);
  const smallPart = small ? ",Small:1b" : "";
  try {
    dim.runCommand(`data merge entity @e[tag=${tag},limit=1] {Invisible:1,NoGravity:1${smallPart},ArmorItems:[{},{},{},{id:"${typeId}",Count:1}]}`);
  } catch (_) {}
  return stand;
}
function killStand(stand) {
  if (stand) { try { stand.kill(); } catch (_) {} }
}

// --- состояние блоков ---
const condensers = new Map(); // ключ -> {key, dim, x, y, z, hasStone, stored, charged, visual, visualTag}
const anvils = new Map();     // ключ -> {key, dim, x, y, z, placed, visual, visualTag}
const merges = new Map();     // ключ -> {key, dim, x, y, z, slot1, slot2, visual1, visual2}

function blockKey(block) {
  return `${block.dimension.id}:${Math.floor(block.location.x)}:${Math.floor(block.location.y)}:${Math.floor(block.location.z)}`;
}
function msKeyOf(typeId) { return ITEM_KEY_BY_TYPE[typeId]; }
function isFormedStone(typeId) { return ITEM_KEY_BY_TYPE[typeId] !== undefined; }
function stoneName(typeId) { return ENCHANT_BY_KEY[ITEM_KEY_BY_TYPE[typeId]].ru; }
function stoneLevel(stack) {
  try {
    const nt = stack.nameTag || "";
    const m = nt.match(/ (V|IV|III|II|I)$/);
    if (m) return ROMAN[m[1]];
  } catch (_) {}
  return 1;
}
function stoneNameTag(key, level) {
  const e = ENCHANT_BY_KEY[key];
  const suffix = level > 1 ? " " + (() => { for (const r in ROMAN) if (ROMAN[r] === level) return r; })() : "";
  return `Манакамень(${e.ru})${suffix}`;
}

function getCondenser(block) {
  const key = blockKey(block);
  let st = condensers.get(key);
  if (!st) {
    st = { key, dim: block.dimension.id, x: block.location.x, y: block.location.y, z: block.location.z,
           hasStone: false, stored: 0, charged: false, visual: null, visualTag: null };
    condensers.set(key, st);
  }
  return st;
}
function getAnvil(block) {
  const key = blockKey(block);
  let st = anvils.get(key);
  if (!st) {
    st = { key, dim: block.dimension.id, x: block.location.x, y: block.location.y, z: block.location.z,
           placed: false, visual: null, visualTag: null };
    anvils.set(key, st);
  }
  return st;
}
function getMerge(block) {
  const key = blockKey(block);
  let st = merges.get(key);
  if (!st) {
    st = { key, dim: block.dimension.id, x: block.location.x, y: block.location.y, z: block.location.z,
           slot1: null, slot2: null, visual1: null, visual2: null };
    merges.set(key, st);
  }
  return st;
}

function setVisualItem(st, typeId) {
  if (!st.visualTag) return;
  const dim = world.getDimension(st.dim);
  if (!dim) return;
  try {
    dim.runCommand(`data merge entity @e[tag=${st.visualTag},limit=1] {ArmorItems:[{},{},{},{id:"${typeId}",Count:1}]}`);
  } catch (_) {}
}

// ========================================================================
// Блок конденсации маны
// ========================================================================
function handleCondenser(ev) {
  const { block, player } = ev;
  const st = getCondenser(block);
  const held = ev.itemStack ? ev.itemStack.typeId : "";
  const manastone = `${PREFIX}manastone`;
  const fullstone = `${PREFIX}fullmanastone`;

  if (held === manastone) {
    if (st.hasStone) { actionbar(player, "§cНа блоке уже лежит манакамень"); return; }
    if (!consumeOne(player, manastone)) { actionbar(player, "§cНе удалось взять манакамень"); return; }
    st.hasStone = true; st.stored = 0; st.charged = false;
    const dim = world.getDimension(st.dim);
    const tag = PREFIX + "visual_" + sanitizeTag(st.key) + "_" + Math.floor(Math.random() * 1000000);
    st.visualTag = tag;
    st.visual = spawnStand(dim, visualPos(st.x, st.y, st.z, "condenser"), manastone, tag, true);
    actionbar(player, "§aМанакамень помещён на блок конденсации маны");
    return;
  }

  if (held === "" || held === "minecraft:air") {
    const dim = world.getDimension(st.dim);
    if (player.isSneaking) {
      if (st.hasStone && !st.charged) {
        giveItem(player, manastone, 1);
        killStand(st.visual);
        st.visual = null; st.visualTag = null;
        st.hasStone = false; st.stored = 0;
        actionbar(player, "§aМанакамень возвращён");
      } else {
        actionbar(player, "§cНечего забирать с блока");
      }
    } else {
      if (st.charged) {
        giveItem(player, fullstone, 1);
        killStand(st.visual);
        st.visual = null; st.visualTag = null;
        st.hasStone = false; st.charged = false; st.stored = 0;
        actionbar(player, "§aВы взяли наполненный манакамень");
        sound(player, "random.levelup");
      } else if (st.hasStone) {
        actionbar(player, "§cМанакамень ещё не заряжен");
      }
    }
  }
}

// ========================================================================
// Блок формирования манакамня
// ========================================================================
function handleAnvil(ev) {
  const { block, player } = ev;
  const st = getAnvil(block);
  const held = ev.itemStack ? ev.itemStack.typeId : "";
  const fullstone = `${PREFIX}fullmanastone`;

  if (held === fullstone) {
    if (st.placed) { actionbar(player, "§cНа блоке уже лежит наполненный манакамень"); return; }
    if (!consumeOne(player, fullstone)) { actionbar(player, "§cНе удалось взять предмет"); return; }
    st.placed = true;
    const dim = world.getDimension(st.dim);
    const tag = PREFIX + "visual_" + sanitizeTag(st.key) + "_" + Math.floor(Math.random() * 1000000);
    st.visualTag = tag;
    st.visual = spawnStand(dim, visualPos(st.x, st.y, st.z, "anvil"), fullstone, tag, false);
    actionbar(player, "§aНаполненный манакамень помещён на блок формирования манакамня");
    return;
  }

  const mk = msKeyOf(held);
  if (mk && st.placed) {
    const mana = getMana(player);
    if (mana < MANA_COST) { actionbar(player, "§cНедостаточно маны (нужно 50)"); sound(player, "random.deny"); return; }
    if (!(await xpCost(player, XP_COST))) {
      actionbar(player, "§cНедостаточно опыта, необходим 5 уровень");
      sound(player, "random.deny");
      return;
    }
    setMana(player, mana - MANA_COST);
    consumeOne(player, held);
    killStand(st.visual);
    st.visual = null; st.visualTag = null;
    st.placed = false;
    giveItem(player, `${PREFIX}ms_${mk}`, 1);
    actionbar(player, `§aСоздан ${stoneName(held)}`);
    sound(player, "random.levelup");
    spawnParticle(player.dimension, player.location, "minecraft:spell_instant");
    return;
  }

  if (held === "" || held === "minecraft:air") {
    if (player.isSneaking && st.placed) {
      giveItem(player, fullstone, 1);
      killStand(st.visual);
      st.visual = null; st.visualTag = null;
      st.placed = false;
      actionbar(player, "§aНаполненный манакамень возвращён");
    }
  }
}

// ========================================================================
// Блок слияния манакамня
// ========================================================================
async function processMerge(player, st) {
  const t1 = st.slot1.typeId;
  const t2 = st.slot2.typeId;
  const f1 = msKeyOf(t1);
  const f2 = msKeyOf(t2);

  function fail(msg) {
    actionbar(player, msg);
    sound(player, "random.deny");
    giveItem(player, t1, 1);
    giveItem(player, t2, 1);
    killStand(st.visual1); killStand(st.visual2);
    merges.delete(st.key);
  }

  let resultType = null; let resultKey = null; let resultLevel = 1; let enchantItem = null; let enchantLevel = 1;

  if (f1 && f2) {
    if (f1 !== f2) { fail("§cРазные зачарования"); return; }
    const e = ENCHANT_BY_KEY[f1];
    const l1 = st.slot1.level; const l2 = st.slot2.level;
    if (l1 !== l2) { fail("§cУровни манакамней должны совпадать"); return; }
    if (l1 >= e.max) { fail("§cДостигнут максимальный уровень зачарования"); return; }
    resultType = `${PREFIX}ms_${f1}`; resultKey = f1; resultLevel = l1 + 1;
  } else if (f1 && !f2) {
    enchantItem = t2; enchantLevel = st.slot1.level; resultKey = f1;
  } else if (!f1 && f2) {
    enchantItem = t1; enchantLevel = st.slot2.level; resultKey = f2;
  } else {
    fail("§cНеподходящие предметы для слияния");
    return;
  }

  const mana = getMana(player);
  if (mana < MANA_COST) { fail("§cНедостаточно маны (нужно 50)"); return; }
  if (!(await xpCost(player, XP_COST))) {
    fail("§cНедостаточно опыта, необходим 5 уровень");
    return;
  }
  setMana(player, mana - MANA_COST);

  const dim = player.dimension;
  const pos = { x: st.x + 0.5, y: st.y + 0.5, z: st.z + 0.5 };

  if (enchantItem) {
    const e = ENCHANT_BY_KEY[resultKey];
    let lvl = Math.min(enchantLevel, e.max);
    let ok = false;
    try {
      await player.runCommandAsync(`replaceitem entity @s slot.weapon 0 ${enchantItem} 1 0`);
      await player.runCommandAsync(`enchant @s selected ${e.key} ${lvl}`);
      ok = true;
    } catch (_) { ok = false; }
    killStand(st.visual1); killStand(st.visual2);
    merges.delete(st.key);
    if (ok) {
      actionbar(player, `§aПредмет зачарован: ${e.ru} ${lvl}`);
      sound(player, "random.levelup");
      spawnParticle(dim, pos, "minecraft:spell_instant");
    } else {
      actionbar(player, "§cЭто зачарование не подходит к предмету");
      sound(player, "random.deny");
      giveItem(player, enchantItem, 1);
    }
    return;
  }

  // слияние двух одинаковых манакамней -> результат в инвентарь
  killStand(st.visual1); killStand(st.visual2);
  merges.delete(st.key);
  giveItem(player, resultType, 1, stoneNameTag(resultKey, resultLevel));
  actionbar(player, `§aСоздан ${stoneNameTag(resultKey, resultLevel)}`);
  sound(player, "random.levelup");
  spawnParticle(dim, pos, "minecraft:spell_instant");
}

function handleMerge(ev) {
  const { block, player } = ev;
  const st = getMerge(block);
  const held = ev.itemStack ? ev.itemStack.typeId : "";

  if (!st.slot1) {
    if (held === "" || held === "minecraft:air") return;
    const stack = consumeOne(player, held);
    if (!stack) return;
    st.slot1 = { typeId: held, level: stoneLevel(stack) };
    const dim = world.getDimension(st.dim);
    const tag = PREFIX + "visual_" + sanitizeTag(st.key) + "_1_" + Math.floor(Math.random() * 1000000);
    st.visual1 = spawnStand(dim, visualPos(st.x, st.y, st.z, "merge_left"), held, tag, false);
    actionbar(player, "§aПервый предмет размещён на блоке слияния");
    return;
  }

  if (!st.slot2) {
    if (held === "" || held === "minecraft:air") return;
    const stack = consumeOne(player, held);
    if (!stack) return;
    st.slot2 = { typeId: held, level: stoneLevel(stack) };
    const dim = world.getDimension(st.dim);
    const tag = PREFIX + "visual_" + sanitizeTag(st.key) + "_2_" + Math.floor(Math.random() * 1000000);
    st.visual2 = spawnStand(dim, visualPos(st.x, st.y, st.z, "merge_right"), held, tag, false);
    actionbar(player, "§aВторой предмет размещён — слияние...");
    processMerge(player, st);
    return;
  }

  actionbar(player, "§cОба слота заняты. Разрушите блок, чтобы начать заново.");
}

// ========================================================================
// Зелья маны
// ========================================================================
function handleItemUse(ev) {
  const { player, itemStack } = ev;
  if (!itemStack) return;
  const typeId = itemStack.typeId;
  if (typeId === `${PREFIX}mana_potion`) {
    setMana(player, MAX_MANA);
    consumeOne(player, typeId);
    updateBar(player);
    sound(player, "random.levelup");
    spawnParticle(player.dimension, player.location, "minecraft:spell_instant");
    actionbar(player, "§aМана полностью восстановлена");
  } else if (typeId === `${PREFIX}mana_regen_potion`) {
    setRegenTimer(player, REGEN_POTION_TICKS);
    consumeOne(player, typeId);
    updateBar(player);
    sound(player, "random.levelup");
    spawnParticle(player.dimension, player.location, "minecraft:spell_instant");
    actionbar(player, "§aСтатус «Регенерация маны» на 3 минуты");
  }
}

// ========================================================================
// События
// ========================================================================
world.afterEvents.playerJoin.subscribe(ev => ensureMana(ev.player));
world.afterEvents.playerSpawn.subscribe(ev => ensureMana(ev.player));

world.afterEvents.itemUse.subscribe(handleItemUse);

world.afterEvents.itemUseOn.subscribe(ev => {
  try {
    const { block } = ev;
    const t = block.typeId;
    if (t === `${PREFIX}mana_condenser`) handleCondenser(ev);
    else if (t === `${PREFIX}mana_anvil`) handleAnvil(ev);
    else if (t === `${PREFIX}msmerge_block`) handleMerge(ev);
  } catch (_) {}
});

world.afterEvents.blockBreak.subscribe(ev => {
  try {
    const { block, player } = ev;
    const t = block.typeId;
    const key = blockKey(block);
    if (t === `${PREFIX}mana_condenser`) {
      const st = condensers.get(key);
      if (st) { killStand(st.visual); condensers.delete(key); }
    } else if (t === `${PREFIX}mana_anvil`) {
      const st = anvils.get(key);
      if (st) {
        killStand(st.visual);
        if (st.placed) giveItem(player, `${PREFIX}fullmanastone`, 1);
        anvils.delete(key);
      }
    } else if (t === `${PREFIX}msmerge_block`) {
      const st = merges.get(key);
      if (st) {
        killStand(st.visual1); killStand(st.visual2);
        if (st.slot1) giveItem(player, st.slot1.typeId, 1);
        if (st.slot2) giveItem(player, st.slot2.typeId, 1);
        merges.delete(key);
      }
    }
  } catch (_) {}
});

// --- регенерация маны (1 ед. за 2 сек; с баффом — 5 ед.) ---
system.runInterval(() => {
  try {
    for (const p of world.getAllPlayers()) {
      let mana = getMana(p);
      let timer = getRegenTimer(p);
      let regen = 1;
      if (timer > 0) { regen = 5; timer--; setRegenTimer(p, timer); }
      else { p.deleteDynamicProperty(REGEN_KEY); }
      if (mana < MAX_MANA) {
        mana = Math.min(MAX_MANA, mana + regen);
        setMana(p, mana);
      }
      updateBar(p);
    }
  } catch (_) {}
}, REGEN_INTERVAL);

// --- конденсация маны (вытяжка у игроков в радиусе 3 блока, 25 ед./с) ---
system.runInterval(() => {
  try {
    for (const [, st] of condensers) {
      if (!st.hasStone || st.charged) continue;
      const dim = world.getDimension(st.dim);
      if (!dim) continue;
      const loc = { x: st.x + 0.5, y: st.y + 0.5, z: st.z + 0.5 };
      let added = 0;
      for (const pl of dim.getPlayers()) {
        if (dist(pl.location, loc) > 3) continue;
        const m = getMana(pl);
        const take = Math.min(DRAIN_PER_SECOND, m);
        if (take <= 0) continue;
        setMana(pl, m - take);
        added += take;
        updateBar(pl);
      }
      if (added > 0) {
        st.stored = Math.min(CONDENSER_NEED, st.stored + added);
        if (st.stored >= CONDENSER_NEED && !st.charged) {
          st.charged = true;
          setVisualItem(st, `${PREFIX}fullmanastone`);
          soundNear(dim, loc, "random.levelup", 8);
          spawnParticle(dim, loc, "minecraft:spell_instant");
        }
      }
    }
  } catch (_) {}
}, CONDENSER_INTERVAL);
