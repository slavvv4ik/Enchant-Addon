// В @minecraft/server 2.x `Enchantment` — это только TS-интерфейс (plain object { type, level }),
// runtime-класса с таким именем нет, поэтому импортировать его нельзя.
import { world, system, ItemStack, EnchantmentTypes } from "@minecraft/server";

const MAX_MANA = 1000;
const MANA_KEY = "mana:value";
const REGEN_KEY = "mana:regen_ticks";
const ERROR_KEY = "mana:error";
const ERROR_TICKS_KEY = "mana:error_ticks";
const MACHINES_KEY = "mana:machines";
const DISPLAY_TAG = "mana_machine_display";
const ANCHOR_KEY = "mana:display_anchor";
const DISPLAY_MACHINE_KEY = "mana:display_machine";
const DISPLAY_SLOT_KEY = "mana:display_slot";
const DISPLAY_VERSION_KEY = "mana:display_version";
const DISPLAY_LAYOUT_VERSION = 2;
// Полоса маны в HUD (RP ui/hud_screen.json) не имеет доступа к скриптовым данным:
// единственный канал, который читает JSON UI — это строка заголовка
// (#hud_title_text_string). Значение передаём маркером "MM:<0..1000>",
// при активном восстановлении прибавляем MANA_BAR_REGEN_OFFSET.
// Сам заголовок скрываем в RP, если строка начинается с маркера.
const MANA_BAR_MARK = "MM:";
const MANA_BAR_REGEN_OFFSET = 10000;
const MANA_BAR_STAY_TICKS = 72000;
const MANA_BAR_HEARTBEAT = 60;
const MACHINE_IDS = new Set(["mana:condenser", "mana:anvil", "mana:fusion"]);
const MACHINE_COMPONENT_ID = "mana:machine_interaction";
const FULL_STONE = "mana:full_manastone";
const BASE_STONE = "mana:manastone";
const STONE_LEVEL_KEY = "mana:level";
const ROMAN_LEVELS = ["", "I", "II", "III", "IV", "V"];
const DROP_RECIPE = ["minecraft:lapis_lazuli", "minecraft:gold_nugget", "minecraft:stone"];
const DROP_RECIPE_IDS = new Set(DROP_RECIPE);
const DROP_SCAN_RADIUS = 10;
const DROP_CLUSTER_RADIUS = 2;
const DROP_CLUSTER_VERTICAL_RADIUS = 1;
const DROP_SCAN_INTERVAL = 10;
// Координаты моделей в пикселях (16 px = 1 блок). X модели инвертирован к мировому X.
// У слияния используем pivot item_slot_left/right; у остальных — центр чаши/сигила.
const DISPLAY_SEATS = {
  condenser: { x: 0, y: 8.85, z: 0 },
  anvil: { x: 0, y: 16.5, z: 0 },
  fusion_left: { x: -5, y: 11, z: 0 },
  fusion_right: { x: 5, y: 11, z: 0 }
};

const stones = {
  "mana:stone_aqua_affinity": { enchant: "aqua_affinity", max: 1, modifier: ["minecraft:turtle_helmet"], name: "Подводник" },
  "mana:stone_bane_of_arthropods": { enchant: "bane_of_arthropods", max: 5, modifier: ["minecraft:spider_eye"], name: "Бич членистоногих" },
  "mana:stone_blast_protection": { enchant: "blast_protection", max: 4, modifier: ["minecraft:gunpowder"], name: "Взрывоустойчивость" },
  "mana:stone_depth_strider": { enchant: "depth_strider", max: 3, modifier: ["minecraft:nautilus_shell"], name: "Подводная ходьба" },
  "mana:stone_efficiency": { enchant: "efficiency", max: 5, modifier: ["minecraft:iron_block"], name: "Эффективность" },
  "mana:stone_feather_falling": { enchant: "feather_falling", max: 4, modifier: ["minecraft:feather"], name: "Невесомость" },
  "mana:stone_fire_aspect": { enchant: "fire_aspect", max: 2, modifier: ["minecraft:flint_and_steel"], name: "Заговор огня" },
  "mana:stone_fire_protection": { enchant: "fire_protection", max: 4, modifier: ["minecraft:water_bucket"], name: "Огнеупорность" },
  "mana:stone_flame": { enchant: "flame", max: 1, modifier: ["minecraft:magma_cream"], name: "Воспламенение" },
  "mana:stone_fortune": { enchant: "fortune", max: 3, modifier: ["minecraft:rabbit_foot"], name: "Удача" },
  "mana:stone_frost_walker": { enchant: "frost_walker", max: 2, modifier: ["minecraft:packed_ice"], name: "Ледоход" },
  "mana:stone_infinity": { enchant: "infinity", max: 1, modifier: ["minecraft:flint"], name: "Бесконечность" },
  "mana:stone_knockback": { enchant: "knockback", max: 2, modifier: ["minecraft:slime"], name: "Отбрасывание" },
  "mana:stone_looting": { enchant: "looting", max: 3, modifier: ["minecraft:leather"], name: "Добыча" },
  "mana:stone_luck_of_the_sea": { enchant: "luck_of_the_sea", max: 3, modifier: ["minecraft:pufferfish"], name: "Везучий рыбак" },
  "mana:stone_lure": { enchant: "lure", max: 3, modifier: ["minecraft:salmon"], name: "Приманка" },
  "mana:stone_mending": { enchant: "mending", max: 1, modifier: ["minecraft:experience_bottle"], name: "Починка" },
  "mana:stone_multishot": { enchant: "multishot", max: 1, modifier: ["minecraft:arrow"], name: "Тройной выстрел" },
  "mana:stone_power": { enchant: "power", max: 5, modifier: ["minecraft:cobweb"], name: "Сила" },
  "mana:stone_projectile_protection": { enchant: "projectile_protection", max: 4, modifier: ["minecraft:shield"], name: "Защита от снарядов" },
  "mana:stone_protection": { enchant: "protection", max: 4, modifier: ["minecraft:netherite_scrap"], name: "Защита" },
  "mana:stone_punch": { enchant: "punch", max: 2, modifier: ["minecraft:piston"], name: "Откидывание" },
  "mana:stone_quick_charge": { enchant: "quick_charge", max: 3, modifier: ["minecraft:bow"], name: "Быстрая перезарядка" },
  "mana:stone_respiration": { enchant: "respiration", max: 3, modifier: ["minecraft:conduit"], name: "Подводное дыхание" },
  "mana:stone_sharpness": { enchant: "sharpness", max: 5, modifier: ["minecraft:diamond_sword"], name: "Острота" },
  "mana:stone_silk_touch": { enchant: "silk_touch", max: 1, modifier: ["minecraft:white_wool", "minecraft:wool"], name: "Шёлковое касание" },
  "mana:stone_smite": { enchant: "smite", max: 5, modifier: ["minecraft:trident"], name: "Небесная кара" },
  "mana:stone_swift_sneak": { enchant: "swift_sneak", max: 3, modifier: ["minecraft:gold_block"], name: "Проворство" },
  "mana:stone_thorns": { enchant: "thorns", max: 3, modifier: ["minecraft:iron_bars"], name: "Шипы" },
  "mana:stone_unbreaking": { enchant: "unbreaking", max: 3, modifier: ["minecraft:obsidian"], name: "Прочность" }
};

const stoneIds = new Set(Object.keys(stones));
let machines = {};
let machinesLoaded = false;
let lootSeen = new Set();
let lootSeenLoaded = false;
const pendingDropChecks = new Set();
const manaBarPublished = new Map();
const interactionCooldowns = new Map();

function loadMachines() {
  if (machinesLoaded) return;
  machinesLoaded = true;
  try {
    const raw = world.getDynamicProperty(MACHINES_KEY);
    machines = raw ? JSON.parse(String(raw)) : {};
  } catch {
    machines = {};
  }
}

function saveMachines() {
  try {
    world.setDynamicProperty(MACHINES_KEY, JSON.stringify(machines));
  } catch {
    // A very large world may exceed the dynamic-property byte limit.
  }
}

function loadLootSeen() {
  if (lootSeenLoaded) return;
  lootSeenLoaded = true;
  try {
    const raw = world.getDynamicProperty("mana:loot_seen");
    lootSeen = new Set(raw ? JSON.parse(String(raw)) : []);
  } catch {
    lootSeen = new Set();
  }
}

function saveLootSeen() {
  try {
    world.setDynamicProperty("mana:loot_seen", JSON.stringify([...lootSeen].slice(-20000)));
  } catch {}
}

function dimensionKey(dimension) {
  return dimension.id.replace(/[^a-z0-9_]/gi, "_");
}

function machineKey(dimension, location) {
  return `${dimensionKey(dimension)}|${Math.floor(location.x)}|${Math.floor(location.y)}|${Math.floor(location.z)}`;
}

function machineLocation(key) {
  const parts = key.split("|");
  return { x: Number(parts[1]), y: Number(parts[2]), z: Number(parts[3]) };
}

function getMachine(dimension, location, typeId) {
  loadMachines();
  const key = machineKey(dimension, location);
  if (!machines[key]) {
    machines[key] = typeId === "mana:condenser"
      ? { kind: "condenser", slot: "empty", charge: 0 }
      : typeId === "mana:anvil"
        ? { kind: "anvil", slot: null }
        : { kind: "fusion", left: null, right: null };
    saveMachines();
  }
  return { key, data: machines[key] };
}

function setMachine(key, data) {
  machines[key] = data;
  saveMachines();
}

function clearMachine(key) {
  delete machines[key];
  saveMachines();
}

function itemInHand(player) {
  const inventory = player.getComponent("minecraft:inventory");
  return inventory?.container?.getItem(player.selectedSlotIndex);
}

function takeOneFromHand(player, expectedId) {
  const inventory = player.getComponent("minecraft:inventory")?.container;
  if (!inventory) return false;
  const slot = player.selectedSlotIndex;
  const stack = inventory.getItem(slot);
  if (!stack || stack.typeId !== expectedId || stack.amount < 1) return false;
  if (stack.amount === 1) inventory.setItem(slot, undefined);
  else {
    const rest = stack.clone();
    rest.amount -= 1;
    inventory.setItem(slot, rest);
  }
  return true;
}

function giveItem(player, stack) {
  if (!stack) return;
  const inventory = player.getComponent("minecraft:inventory")?.container;
  if (!inventory) return;
  const remainder = inventory.addItem(stack);
  if (remainder) player.dimension.spawnItem(remainder, player.location);
}

function stoneMaxLevel(id) {
  const info = stones[id];
  if (!info) return 1;
  const type = enchantmentType(info.enchant);
  const apiMax = type?.maxLevel;
  // Не превышаем ни ванильный предел таблицы, ни предел установленного реестра игры.
  return Number.isInteger(apiMax) && apiMax > 0 ? Math.min(info.max, apiMax) : info.max;
}

function normalizeStoneLevel(id, value) {
  const level = Number(value);
  return Number.isFinite(level) && level >= 1
    ? Math.max(1, Math.min(stoneMaxLevel(id), Math.floor(level)))
    : 1;
}

function makeStone(id, level = 1) {
  const data = stones[id];
  if (!data) throw new Error(`Unknown mana stone: ${id}`);
  level = normalizeStoneLevel(id, level);
  const stack = new ItemStack(id, 1);
  // Все stone_*.json обязаны иметь max_stack_size: 1. На стаковом предмете API
  // бросает исключение; раньше пустой catch превращал любой такой камень в уровень I.
  // Ошибку сохранения больше не скрываем. Её ловит строгий регрессионный тест.
  stack.setDynamicProperty(STONE_LEVEL_KEY, level);
  stack.nameTag = `§bМанакамень (${data.name}) ${roman(level)}`;
  try { stack.setLore([`§7Уровень: ${roman(level)} / ${roman(stoneMaxLevel(id))}`]); }
  catch (error) { console.warn(`[Mana Machines] Не удалось добавить описание манакамня: ${error}`); }
  return stack;
}

function roman(value) {
  return ROMAN_LEVELS[Math.max(0, Math.min(5, Math.floor(value)))] || String(value);
}

// ID зачарований в Bedrock могут прийти как с префиксом "minecraft:", так и без него.
// Нормализуем и пробуем оба варианта, чтобы сравнения и поиск типа работали стабильно.
function normalizeEnchantId(id) {
  return typeof id === "string" ? id.replace(/^minecraft:/, "") : undefined;
}

function enchantmentType(id) {
  const bare = normalizeEnchantId(id);
  if (!bare) return undefined;
  // В разных версиях Bedrock ID может быть с префиксом или без; get() также может бросить исключение.
  for (const candidate of [`minecraft:${bare}`, bare]) {
    try {
      const type = EnchantmentTypes.get(candidate);
      if (type) return type;
    } catch {}
  }
  return undefined;
}

function stackLevel(stack) {
  if (!stack || !stoneIds.has(stack.typeId)) return 1;
  let stored;
  try { stored = stack.getDynamicProperty(STONE_LEVEL_KEY); } catch {}
  const level = Number(stored);
  if (Number.isFinite(level) && level >= 1) return normalizeStoneLevel(stack.typeId, level);
  // Совместимость с камнями v1.0.4: уровень есть в названии, но не сохранился в DP.
  // Если разные названия оказались в одном старом стаке, данные одного предмета
  // восстановить нельзя — не создаём несколько камней из одного предмета.
  const prefix = `§bМанакамень (${stones[stack.typeId].name}) `;
  if (typeof stack.nameTag === "string" && stack.nameTag.startsWith(prefix)) {
    const index = ROMAN_LEVELS.indexOf(stack.nameTag.slice(prefix.length));
    if (index > 0) return normalizeStoneLevel(stack.typeId, index);
  }
  return 1;
}

function getMana(player) {
  const value = Number(player.getDynamicProperty(MANA_KEY));
  return Number.isFinite(value) ? Math.max(0, Math.min(MAX_MANA, Math.floor(value))) : MAX_MANA;
}

function setMana(player, value) {
  player.setDynamicProperty(MANA_KEY, Math.max(0, Math.min(MAX_MANA, Math.floor(value))));
}

function showError(player, message) {
  player.setDynamicProperty(ERROR_KEY, message);
  player.setDynamicProperty(ERROR_TICKS_KEY, 40);
  player.playSound("note.bass");
}

// Значение для полоски маны: 0..1000 — доля маны, +10000 — идёт ускоренное
// восстановление (полоса рисуется другой текстурой).
function manaBarValue(player) {
  const ratio = Math.round((getMana(player) / MAX_MANA) * 1000);
  const regen = Number(player.getDynamicProperty(REGEN_KEY) || 0) > 0 ? MANA_BAR_REGEN_OFFSET : 0;
  return Math.max(0, Math.min(1000, ratio)) + regen;
}

function publishManaBar(player, force = false) {
  const value = manaBarValue(player);
  if (!force && manaBarPublished.get(player.id) === value) return;
  // Карта растёт только от числа разных значений, но всё равно подчищаем её.
  if (manaBarPublished.size > 256) manaBarPublished.clear();
  manaBarPublished.set(player.id, value);
  try {
    player.onScreenDisplay.setTitle(`${MANA_BAR_MARK}${value}`, {
      fadeInDuration: 0, stayDuration: MANA_BAR_STAY_TICKS, fadeOutDuration: 0
    });
  } catch (error) {
    console.warn(`[Mana Machines] Не удалось обновить полосу маны: ${error}`);
  }
}

function showSuccess(player) {
  player.playSound("random.levelup");
  try { player.dimension.spawnParticle("minecraft:enchanting_table_particle", player.location); } catch {}
}

function isEmptyHand(player) {
  const stack = itemInHand(player);
  return !stack || stack.amount < 1;
}

function displayAnchor(location, seatName) {
  const seat = DISPLAY_SEATS[seatName];
  if (!seat) return undefined;
  // Это якорь рендера, а не опора физической коллизии. Компенсируем подъём
  // спрайта примерно на 2 px; ванильное покачивание/вращение остаётся клиентским.
  return {
    x: location.x + 0.5 - seat.x / 16,
    y: location.y + seat.y / 16 + 0.125,
    z: location.z + 0.5 + seat.z / 16
  };
}

function clearDisplayEntities(dimension, location) {
  const key = machineKey(dimension, location);
  let entities;
  try {
    // Старые витрины без machine key тоже найдём, чтобы обновление не оставило дубликаты.
    entities = dimension.getEntities({
      type: "minecraft:item", tags: [DISPLAY_TAG],
      location: { x: location.x + 0.5, y: location.y + 0.75, z: location.z + 0.5 }, maxDistance: 2.5
    });
  } catch { return; }
  for (const entity of entities) {
    try {
      const owner = entity.getDynamicProperty(DISPLAY_MACHINE_KEY);
      const anchor = entity.getDynamicProperty(ANCHOR_KEY);
      const legacyNearby = owner === undefined && anchor && typeof anchor === "object" &&
        Math.abs(anchor.x - (location.x + 0.5)) <= 0.8 &&
        Math.abs(anchor.y - (location.y + 1.25)) <= 0.1 &&
        Math.abs(anchor.z - (location.z + 0.5)) <= 0.8;
      if (owner === key || legacyNearby) entity.remove();
    } catch {}
  }
}

function spawnDisplay(dimension, location, slot, seatName) {
  if (!slot?.id) return false;
  const anchor = displayAnchor(location, seatName);
  if (!anchor) return false;
  let entity;
  try {
    const stack = deserializeStack(slot);
    if (!stack) return false;
    entity = dimension.spawnItem(stack, anchor);
    entity.addTag(DISPLAY_TAG);
    // pickup_delay / physics у item-энтити через этот API не настраиваются.
    // Подбор отменяется в beforeEvents, положение удерживается stabilizeDisplays.
    entity.setDynamicProperty(ANCHOR_KEY, anchor);
    entity.setDynamicProperty(DISPLAY_MACHINE_KEY, machineKey(dimension, location));
    entity.setDynamicProperty(DISPLAY_SLOT_KEY, seatName);
    entity.setDynamicProperty(DISPLAY_VERSION_KEY, DISPLAY_LAYOUT_VERSION);
    return true;
  } catch (error) {
    // Ошибка витрины не должна стирать предмет из состояния машины или создавать дубликат.
    try { entity?.remove(); } catch {}
    console.warn(`[Mana Machines] Ошибка витрины ${slot.id}: ${error}`);
    return false;
  }
}

function refreshMachineDisplay(dimension, location, data) {
  clearDisplayEntities(dimension, location);
  if (data.kind === "condenser" && data.slot === "manastone") spawnDisplay(dimension, location, { id: BASE_STONE }, "condenser");
  if (data.kind === "condenser" && data.slot === "full") spawnDisplay(dimension, location, { id: FULL_STONE }, "condenser");
  if (data.kind === "anvil" && data.slot) spawnDisplay(dimension, location, data.slot, "anvil");
  if (data.kind === "fusion") {
    if (data.left) spawnDisplay(dimension, location, data.left, "fusion_left");
    if (data.right) spawnDisplay(dimension, location, data.right, "fusion_right");
  }
}

function serializeStack(stack) {
  if (!stack) return null;
  const result = { id: stack.typeId, amount: 1 };
  if (stoneIds.has(stack.typeId)) {
    result.level = stackLevel(stack);
    result.nameTag = `§bМанакамень (${stones[stack.typeId].name}) ${roman(result.level)}`;
  } else {
    try { result.nameTag = stack.nameTag || undefined; } catch {}
  }
  try {
    const enchantable = stack.getComponent("minecraft:enchantable");
    if (enchantable) {
      result.enchants = enchantable.getEnchantments().map((entry) => ({ id: normalizeEnchantId(entry.type.id), level: entry.level }));
    }
  } catch {}
  return result;
}

function deserializeStack(data) {
  if (!data?.id) return null;
  const stack = stoneIds.has(data.id) ? makeStone(data.id, data.level || 1) : new ItemStack(data.id, data.amount || 1);
  if (data.nameTag && !stoneIds.has(data.id)) stack.nameTag = data.nameTag;
  if (Array.isArray(data.enchants)) {
    try {
      const enchantable = stack.getComponent("minecraft:enchantable");
      for (const entry of data.enchants) {
        const type = enchantmentType(entry.id);
        if (type && enchantable) enchantable.addEnchantment({ type, level: entry.level });
      }
    } catch {}
  }
  return stack;
}

function checkAnvil(player, dimension, location, data) {
  const hand = itemInHand(player);
  if (!data.slot) {
    if (hand?.typeId === FULL_STONE && takeOneFromHand(player, FULL_STONE)) {
      data.slot = { id: FULL_STONE };
      setMachine(machineKey(dimension, location), data);
      refreshMachineDisplay(dimension, location, data);
    }
    return;
  }
  if (isEmptyHand(player) && player.isSneaking) {
    giveItem(player, deserializeStack(data.slot));
    data.slot = null;
    setMachine(machineKey(dimension, location), data);
    refreshMachineDisplay(dimension, location, data);
    return;
  }
  if (!hand) return;
  const recipe = Object.values(stones).find((entry) => entry.modifier.includes(hand.typeId));
  const stoneId = Object.keys(stones).find((id) => stones[id] === recipe);
  if (!recipe || !stoneId) return;
  if (player.level < 5) {
    showError(player, "Недостаточно опыта, необходим 5 уровень");
    return;
  }
  if (!takeOneFromHand(player, hand.typeId)) return;
  player.addLevels(-5);
  giveItem(player, makeStone(stoneId, 1));
  data.slot = null;
  setMachine(machineKey(dimension, location), data);
  refreshMachineDisplay(dimension, location, data);
  showSuccess(player);
}

function isEnchantableTarget(stack) {
  if (!stack || stack.typeId.startsWith("mana:")) return false;
  try { return Boolean(stack.getComponent("minecraft:enchantable")); } catch { return false; }
}

function fusionError(player, message) {
  showError(player, message);
}

function readEnchantments(stack) {
  try {
    const component = stack.getComponent("minecraft:enchantable");
    return component ? component.getEnchantments().map((entry) => ({ id: normalizeEnchantId(entry.type.id), level: entry.level })) : [];
  } catch { return []; }
}

function applyStoneToItem(item, stoneId, stoneLevel) {
  const stone = stones[stoneId];
  const output = item.clone();
  const enchantable = output.getComponent("minecraft:enchantable");
  if (!enchantable) return null;
  const current = readEnchantments(output).find((entry) => entry.id === stone.enchant);
  let level = stoneLevel;
  if (current) {
    if (current.level === stoneLevel && stoneLevel < stoneMaxLevel(stoneId)) level = stoneLevel + 1;
    else level = Math.max(current.level, stoneLevel);
    try { enchantable.removeEnchantment(enchantmentType(stone.enchant) ?? stone.enchant); } catch { return null; }
  }
  if (level > stoneMaxLevel(stoneId)) return null;
  try {
    const type = enchantmentType(stone.enchant);
    if (!type) return null;
    if (!enchantable.canAddEnchantment({ type, level })) return null;
    enchantable.addEnchantment({ type, level });
    return output;
  } catch { return null; }
}

function completeFusion(player, dimension, location, data) {
  if (!data.left || !data.right) return false;
  const leftStone = stoneIds.has(data.left.id);
  const rightStone = stoneIds.has(data.right.id);
  let result = null;
  if (leftStone && rightStone) {
    if (data.left.id !== data.right.id || (data.left.level || 1) !== (data.right.level || 1)) {
      fusionError(player, "Для повышения уровня нужны два одинаковых манакамня");
      return false;
    }
    const max = stoneMaxLevel(data.left.id);
    const leftLevel = normalizeStoneLevel(data.left.id, data.left.level);
    const next = leftLevel + 1;
    if (leftLevel >= max || next > max) {
      fusionError(player, `Максимальный уровень этого зачарования: ${roman(max)}`);
      return false;
    }
    result = makeStone(data.left.id, next);
  } else if (leftStone || rightStone) {
    const stoneSlot = leftStone ? data.left : data.right;
    const itemSlot = leftStone ? data.right : data.left;
    const item = deserializeStack(itemSlot);
    if (!item) return false;
    result = applyStoneToItem(item, stoneSlot.id, normalizeStoneLevel(stoneSlot.id, stoneSlot.level));
    if (!result) {
      fusionError(player, "Это зачарование нельзя применить к данному предмету");
      return false;
    }
  } else {
    fusionError(player, "Нужен сформированный манакамень");
    return false;
  }
  if (player.level < 5) {
    fusionError(player, "Недостаточно опыта, необходим 5 уровень");
    return false;
  }
  if (getMana(player) < 50) {
    fusionError(player, "Недостаточно маны, необходимо 50");
    return false;
  }
  player.addLevels(-5);
  setMana(player, getMana(player) - 50);
  giveItem(player, result);
  data.left = null;
  data.right = null;
  setMachine(machineKey(dimension, location), data);
  refreshMachineDisplay(dimension, location, data);
  showSuccess(player);
  return true;
}

function checkFusion(player, dimension, location, data) {
  const hand = itemInHand(player);
  if (!data.left && isEmptyHand(player) && player.isSneaking) return;
  if (!data.left && hand && (stoneIds.has(hand.typeId) || isEnchantableTarget(hand))) {
    if (!takeOneFromHand(player, hand.typeId)) return;
    data.left = serializeStack(hand);
    setMachine(machineKey(dimension, location), data);
    refreshMachineDisplay(dimension, location, data);
    return;
  }
  if (data.left && !data.right && isEmptyHand(player) && player.isSneaking) {
    giveItem(player, deserializeStack(data.left));
    data.left = null;
    setMachine(machineKey(dimension, location), data);
    refreshMachineDisplay(dimension, location, data);
    return;
  }
  if (data.left && !data.right && hand && (stoneIds.has(hand.typeId) || isEnchantableTarget(hand))) {
    if (!takeOneFromHand(player, hand.typeId)) return;
    data.right = serializeStack(hand);
    setMachine(machineKey(dimension, location), data);
    refreshMachineDisplay(dimension, location, data);
    completeFusion(player, dimension, location, data);
    return;
  }
  if (data.left && data.right && isEmptyHand(player) && player.isSneaking) {
    giveItem(player, deserializeStack(data.left));
    giveItem(player, deserializeStack(data.right));
    data.left = null;
    data.right = null;
    setMachine(machineKey(dimension, location), data);
    refreshMachineDisplay(dimension, location, data);
  }
}

function checkCondenser(player, dimension, location, data) {
  const hand = itemInHand(player);
  if (data.slot === "empty" && hand?.typeId === BASE_STONE && takeOneFromHand(player, BASE_STONE)) {
    data.slot = "manastone";
    data.charge = 0;
    setMachine(machineKey(dimension, location), data);
    refreshMachineDisplay(dimension, location, data);
    return;
  }
  if (data.slot === "full" && isEmptyHand(player)) {
    giveItem(player, new ItemStack(FULL_STONE, 1));
    data.slot = "empty";
    data.charge = 0;
    setMachine(machineKey(dimension, location), data);
    refreshMachineDisplay(dimension, location, data);
    return;
  }
  if (data.slot === "manastone" && isEmptyHand(player) && player.isSneaking) {
    giveItem(player, new ItemStack(BASE_STONE, 1));
    data.slot = "empty";
    data.charge = 0;
    setMachine(machineKey(dimension, location), data);
    refreshMachineDisplay(dimension, location, data);
  }
}

function interactWithMachine(player, dimension, location, typeId) {
  if (!player || !MACHINE_IDS.has(typeId)) return;
  const key = machineKey(dimension, location);
  const cooldownKey = `${player.id}|${key}`;
  const now = system.currentTick;
  const last = interactionCooldowns.get(cooldownKey);
  // Одно нажатие может прийти и из custom component, и из world.beforeEvents/afterEvents.
  // Не даём одному нажатию дважды вставить/забрать предмет.
  if (last !== undefined && now - last < 5) return;
  interactionCooldowns.set(cooldownKey, now);
  const { data } = getMachine(dimension, location, typeId);
  if (data.kind === "fusion") {
    let migrated = false;
    for (const slot of [data.left, data.right]) {
      if (!slot || !stoneIds.has(slot.id)) continue;
      const level = stackLevel(deserializeStack(slot));
      if (slot.level !== level) { slot.level = level; migrated = true; }
    }
    if (migrated) setMachine(key, data);
  }
  if (typeId === "mana:condenser") checkCondenser(player, dimension, location, data);
  else if (typeId === "mana:anvil") checkAnvil(player, dimension, location, data);
  else checkFusion(player, dimension, location, data);
}

function handleMachineInteraction(event) {
  if (event.isFirstEvent === false) return;
  const player = event.player;
  const block = event.block;
  if (!player || !block) return;
  interactWithMachine(player, block.dimension, block.location, block.typeId);
}

function initializePlacedMachine(event) {
  const block = event.block;
  if (!block || !MACHINE_IDS.has(block.typeId)) return;
  getMachine(block.dimension, block.location, block.typeId);
}

function nearbyBlockPlayers(dimension, location, maxDistance) {
  return world.getPlayers({ location, maxDistance }).filter((player) => player.dimension.id === dimension.id);
}

function chargeCondensers() {
  loadMachines();
  const processed = new Set();
  for (const player of world.getAllPlayers()) {
    const base = { x: Math.floor(player.location.x), y: Math.floor(player.location.y), z: Math.floor(player.location.z) };
    for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) for (let dz = -3; dz <= 3; dz++) {
      if (dx * dx + dy * dy + dz * dz > 9) continue;
      let block;
      try { block = player.dimension.getBlock({ x: base.x + dx, y: base.y + dy, z: base.z + dz }); } catch { continue; }
      if (!block || block.typeId !== "mana:condenser") continue;
      const key = machineKey(player.dimension, block.location);
      if (processed.has(key)) continue;
      processed.add(key);
      const record = machines[key];
      if (!record || record.slot !== "manastone" || record.charge >= 200) continue;
      const amount = Math.min(25, getMana(player), 200 - record.charge);
      if (amount <= 0) continue;
      setMana(player, getMana(player) - amount);
      record.charge += amount;
      if (record.charge >= 200) {
        record.slot = "full";
        record.charge = 0;
        refreshMachineDisplay(player.dimension, block.location, record);
        player.playSound("random.levelup");
      }
      saveMachines();
    }
  }
}

function tickPlayers() {
  for (const player of world.getAllPlayers()) {
    if (player.getDynamicProperty(MANA_KEY) === undefined) player.setDynamicProperty(MANA_KEY, MAX_MANA);
    let regenTicks = Number(player.getDynamicProperty(REGEN_KEY) || 0);
    if (regenTicks > 0) regenTicks -= 1;
    player.setDynamicProperty(REGEN_KEY, Math.max(0, regenTicks));
    if (system.currentTick % 40 === 0 && getMana(player) < MAX_MANA) {
      setMana(player, getMana(player) + (regenTicks > 0 ? 5 : 1));
    }
    let errorTicks = Number(player.getDynamicProperty(ERROR_TICKS_KEY) || 0);
    if (errorTicks > 0) {
      errorTicks -= 1;
      player.setDynamicProperty(ERROR_TICKS_KEY, errorTicks);
      player.onScreenDisplay.setActionBar(`§c${player.getDynamicProperty(ERROR_KEY) || "Ошибка"}`);
    } else {
      const indicator = regenTicks > 0 ? " §d✦" : "";
      player.onScreenDisplay.setActionBar(`§b${getMana(player)}/${MAX_MANA}${indicator}`);
    }
    // Значение публикуем только при изменении; раз в MANA_BAR_HEARTBEAT тиков
    // шлём принудительно, если движок успел очистить строку заголовка.
    publishManaBar(player, system.currentTick % MANA_BAR_HEARTBEAT === 0);
  }
}

function completePotion(event) {
  const player = event.source;
  if (!player || player.typeId !== "minecraft:player") return;
  if (event.itemStack.typeId === "mana:mana_potion") setMana(player, MAX_MANA);
  if (event.itemStack.typeId === "mana:mana_regen_potion") player.setDynamicProperty(REGEN_KEY, 3600);
}

function itemEntityStack(entity) {
  try { return entity.getComponent("minecraft:item")?.itemStack; } catch { return null; }
}

function distanceSquared(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
}

function droppedRecipeCandidates(dimension, center) {
  let entities;
  try {
    entities = dimension.getEntities({
      type: "minecraft:item", excludeTags: [DISPLAY_TAG], location: center, maxDistance: DROP_CLUSTER_RADIUS
    });
  } catch { return []; }
  const candidates = [];
  for (const entity of entities) {
    try {
      if (!entity.isValid || entity.hasTag(DISPLAY_TAG)) continue;
      const p = entity.location;
      if (Math.abs(p.y - center.y) > DROP_CLUSTER_VERTICAL_RADIUS) continue;
      const stack = itemEntityStack(entity);
      if (stack && DROP_RECIPE_IDS.has(stack.typeId) && stack.amount >= 1) {
        candidates.push({ entity, id: stack.typeId, amount: stack.amount, location: { x: p.x, y: p.y, z: p.z } });
      }
    } catch {}
  }
  return candidates;
}

function combineDroppedIngredients(dimension, anchor) {
  if (!anchor?.isValid) return false;
  const center = { x: anchor.location.x, y: anchor.location.y, z: anchor.location.z };
  const candidates = droppedRecipeCandidates(dimension, center);
  const groups = DROP_RECIPE.map((id) => candidates.filter((entry) => entry.id === id));
  // Сначала проверяем ВСЕ ингредиенты. Неполный набор никогда не потребляется.
  if (groups.some((group) => group.length === 0)) return false;
  const selected = groups.map((group) => group[0]);
  // Проверяем расстояние между ингредиентами, а не совпадение целых координат клетки.
  if (selected.some((entry) => selected.some((other) =>
    distanceSquared(entry.location, other.location) > DROP_CLUSTER_RADIUS ** 2))) return false;
  for (const entry of selected) {
    try {
      if (!entry.entity.isValid || itemEntityStack(entry.entity)?.typeId !== entry.id) return false;
    } catch { return false; }
  }
  const removed = [];
  try {
    for (const entry of selected) {
      // kill() возвращает false для item entity. remove() действительно удаляет дроп.
      entry.entity.remove();
      removed.push(entry);
    }
  } catch (error) {
    // При сбое удаления возвращаем уже списанное; результат не выдаём.
    for (const entry of removed) {
      try { dimension.spawnItem(new ItemStack(entry.id, entry.amount), entry.location); }
      catch (rollbackError) { console.warn(`[Mana Machines] Не удалось вернуть ингредиент: ${rollbackError}`); }
    }
    console.warn(`[Mana Machines] Крафт на земле отменён: ${error}`);
    return false;
  }
  for (const entry of selected) {
    if (entry.amount <= 1) continue;
    try { dimension.spawnItem(new ItemStack(entry.id, entry.amount - 1), entry.location); }
    catch (error) { console.warn(`[Mana Machines] Не удалось вернуть остаток ингредиентов: ${error}`); }
  }
  try {
    dimension.spawnItem(new ItemStack(BASE_STONE, 1), center);
  } catch (error) {
    // При ошибке результата возвращаем потреблённые единицы (остатки уже возвращены).
    for (const entry of selected) {
      try { dimension.spawnItem(new ItemStack(entry.id, 1), entry.location); } catch {}
    }
    console.warn(`[Mana Machines] Не удалось создать манакамень: ${error}`);
    return false;
  }
  try {
    dimension.playSound("random.orb", center);
    dimension.spawnParticle("minecraft:enchanting_table_particle", { x: center.x, y: center.y + 0.2, z: center.z });
  } catch {}
  return true;
}

function scanDroppedRecipes() {
  const checked = new Set();
  for (const player of world.getAllPlayers()) {
    let entities;
    try {
      entities = player.dimension.getEntities({
        type: "minecraft:item", excludeTags: [DISPLAY_TAG], location: player.location, maxDistance: DROP_SCAN_RADIUS
      });
    } catch { continue; }
    for (const entity of entities) {
      try {
        if (!entity.isValid || checked.has(entity.id) || entity.hasTag(DISPLAY_TAG)) continue;
        const stack = itemEntityStack(entity);
        if (!stack || !DROP_RECIPE_IDS.has(stack.typeId)) continue;
        // Один крафт на набор за проход. Остатки стаков — новые энтити, которых
        // нет в снимке entities; они будут обработаны следующим сканом через 10 тиков.
        for (const nearby of droppedRecipeCandidates(player.dimension, entity.location)) checked.add(nearby.entity.id);
        combineDroppedIngredients(player.dimension, entity);
      } catch {}
    }
  }
}

function scheduleDropCheck(entity) {
  let id;
  try {
    if (!entity?.isValid || entity.typeId !== "minecraft:item" || entity.hasTag(DISPLAY_TAG)) return;
    id = entity.id;
    if (pendingDropChecks.has(id)) return;
    pendingDropChecks.add(id);
    // Не читаем компонент в момент entitySpawn и не привязываемся к клетке.
    // Через два тика предмет существует; периодический скан подстрахует пропущенное событие.
    system.runTimeout(() => {
      pendingDropChecks.delete(id);
      try { combineDroppedIngredients(entity.dimension, entity); } catch {}
    }, 2);
  } catch {
    if (id !== undefined) pendingDropChecks.delete(id);
  }
}

function injectPotionLoot(event, container) {
  // BlockContainerOpenedAfterEvent не содержит player/container:
  // источник лежит в openSource.entity, а контейнер берём из компонента блока.
  const player = event.openSource?.entity;
  if (!player || player.typeId !== "minecraft:player") return;
  const block = event.block;
  const allowed = new Set(["minecraft:chest", "minecraft:trapped_chest", "minecraft:barrel", "minecraft:shulker_box"]);
  if (!block || !allowed.has(block.typeId)) return;
  loadLootSeen();
  const key = machineKey(block.dimension, block.location);
  if (lootSeen.has(key)) return;
  lootSeen.add(key);
  saveLootSeen();
  const roll = Math.random();
  try {
    if (roll < 0.01) container.addItem(new ItemStack("mana:mana_potion", 1));
    else if (roll < 0.06) container.addItem(new ItemStack("mana:mana_regen_potion", 1));
  } catch {}
}

function sanitizeContainer(event) {
  let container;
  try { container = event.block?.getComponent("minecraft:inventory")?.container; } catch { return; }
  if (!container) return;
  for (let slot = 0; slot < container.size; slot++) {
    const item = container.getItem(slot);
    if (item?.typeId === "minecraft:enchanted_book") container.setItem(slot, undefined);
  }
  injectPotionLoot(event, container);
}

function removeStoredMachineDrops(dimension, location, blockType) {
  loadMachines();
  const key = machineKey(dimension, location);
  const data = machines[key];
  if (!data) return;
  if (data.kind === "condenser") {
    if (data.slot === "manastone") dimension.spawnItem(new ItemStack(BASE_STONE, 1), { x: location.x + 0.5, y: location.y + 1, z: location.z + 0.5 });
    if (data.slot === "full") dimension.spawnItem(new ItemStack(FULL_STONE, 1), { x: location.x + 0.5, y: location.y + 1, z: location.z + 0.5 });
  } else if (data.kind === "anvil") {
    const stack = deserializeStack(data.slot);
    if (stack) dimension.spawnItem(stack, { x: location.x + 0.5, y: location.y + 1, z: location.z + 0.5 });
  } else {
    for (const slot of [data.left, data.right]) {
      const stack = deserializeStack(slot);
      if (stack) dimension.spawnItem(stack, { x: location.x + 0.5, y: location.y + 1, z: location.z + 0.5 });
    }
  }
  clearDisplayEntities(dimension, location);
  clearMachine(key);
}

// Обычные кастомные блоки без interact-компонента не вызывают playerInteractWithBlock.
// Регистрируем Custom Component V2, чтобы блоки машин стали интерактивными.
system.beforeEvents.startup.subscribe((event) => {
  event.blockComponentRegistry.registerCustomComponent(MACHINE_COMPONENT_ID, {
    onPlayerInteract({ block, dimension, player }) {
      if (!player) return;
      interactWithMachine(player, dimension, block.location, block.typeId);
    },
    onPlace({ block, dimension }) {
      getMachine(dimension, block.location, block.typeId);
    }
  });
});

world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
  const block = event.block;
  const player = event.player;
  if (!player || !block || !MACHINE_IDS.has(block.typeId)) return;
  // Отменяем стандартное использование предмета (например, установку блока или ведро воды),
  // чтобы клик по машине всегда обрабатывался как взаимодействие с машиной.
  event.cancel = true;
  if (event.isFirstEvent === false) return;
  const dimension = block.dimension;
  const location = { x: block.location.x, y: block.location.y, z: block.location.z };
  const typeId = block.typeId;
  system.run(() => interactWithMachine(player, dimension, location, typeId));
});
world.afterEvents.playerInteractWithBlock.subscribe(handleMachineInteraction);
world.afterEvents.playerPlaceBlock.subscribe(initializePlacedMachine);
world.afterEvents.itemCompleteUse.subscribe(completePotion);
world.afterEvents.blockContainerOpened.subscribe(sanitizeContainer);
world.afterEvents.playerBreakBlock.subscribe((event) => {
  const typeId = event.brokenBlockPermutation?.type?.id;
  if (MACHINE_IDS.has(typeId)) removeStoredMachineDrops(event.dimension, event.block.location, typeId);
});
// BlockExplodeAfterEvent приходит на каждый затронутый блок и не содержит массива blocks:
// тип разрушенного блока лежит в explodedBlockPermutation, координаты — в event.block.
world.afterEvents.blockExplode.subscribe((event) => {
  const typeId = event.explodedBlockPermutation?.type?.id;
  if (MACHINE_IDS.has(typeId)) removeStoredMachineDrops(event.dimension, event.block.location, typeId);
});

// Витринные предметы нельзя подбирать (аналог pickup_delay, которого нет в Script API).
world.beforeEvents.entityItemPickup.subscribe((event) => {
  try {
    const item = event.item;
    if (!item?.isValid) return;
    if (item.hasTag(DISPLAY_TAG)) {
      event.cancel = true;
      return;
    }
  } catch {}
});

// У предметных сущностей нет управляемой гравитации через API, поэтому возвращаем
// витринные предметы к якорю, если они начали падать/дрейфовать.
function stabilizeDisplays() {
  const processed = new Set();
  for (const player of world.getAllPlayers()) {
    let entities;
    try {
      entities = player.dimension.getEntities({ type: "minecraft:item", tags: [DISPLAY_TAG], location: player.location, maxDistance: 24 });
    } catch { continue; }
    for (const entity of entities) {
      if (processed.has(entity.id)) continue;
      processed.add(entity.id);
      try {
        if (!entity.isValid) continue;
        let anchor = entity.getDynamicProperty(ANCHOR_KEY);
        // Переносим витрины с сохранённым владельцем/слотом на актуальные координаты.
        // Совсем старые витрины v1.0.4 заменяются при следующем взаимодействии с машиной.
        if (entity.getDynamicProperty(DISPLAY_VERSION_KEY) !== DISPLAY_LAYOUT_VERSION) {
          const owner = entity.getDynamicProperty(DISPLAY_MACHINE_KEY);
          const seat = entity.getDynamicProperty(DISPLAY_SLOT_KEY);
          if (typeof owner === "string" && typeof seat === "string" && DISPLAY_SEATS[seat]) {
            const location = machineLocation(owner);
            anchor = displayAnchor(location, seat);
            if (anchor) entity.setDynamicProperty(ANCHOR_KEY, anchor);
          }
          entity.setDynamicProperty(DISPLAY_VERSION_KEY, DISPLAY_LAYOUT_VERSION);
        }
        if (!anchor || typeof anchor !== "object") continue;
        const p = entity.location;
        if (Math.abs(p.x - anchor.x) + Math.abs(p.y - anchor.y) + Math.abs(p.z - anchor.z) < 0.05) continue;
        entity.teleport(anchor);
        entity.clearVelocity();
      } catch {}
    }
  }
}
world.afterEvents.entitySpawn.subscribe((event) => {
  const item = itemEntityStack(event.entity);
  if (item?.typeId === "minecraft:enchanted_book") {
    try { event.entity.remove(); } catch {}
    return;
  }
  if (DROP_RECIPE_IDS.has(item?.typeId)) scheduleDropCheck(event.entity);
});

system.runInterval(() => {
  tickPlayers();
  if (system.currentTick % 2 === 0) stabilizeDisplays();
  if (system.currentTick % DROP_SCAN_INTERVAL === 0) scanDroppedRecipes();
  if (system.currentTick % 20 === 0) chargeCondensers();
  if (system.currentTick % 100 === 0) {
    for (const [key, tick] of interactionCooldowns) {
      if (system.currentTick - tick > 20) interactionCooldowns.delete(key);
    }
  }
}, 1);
