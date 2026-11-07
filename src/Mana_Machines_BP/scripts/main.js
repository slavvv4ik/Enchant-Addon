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
const MACHINE_IDS = new Set(["mana:condenser", "mana:anvil", "mana:fusion"]);
const FULL_STONE = "mana:full_manastone";
const BASE_STONE = "mana:manastone";

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
const dropLocks = new Set();

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

function makeStone(id, level = 1) {
  const stack = new ItemStack(id, 1);
  try { stack.setDynamicProperty("mana:level", level); } catch {}
  const data = stones[id];
  stack.nameTag = `§bМанакамень (${data.name}) ${roman(level)}`;
  return stack;
}

function roman(value) {
  return ["", "I", "II", "III", "IV", "V"][Math.max(0, Math.min(5, value))] || String(value);
}

// ID зачарований в Bedrock могут прийти как с префиксом "minecraft:", так и без него.
// Нормализуем и пробуем оба варианта, чтобы сравнения и поиск типа работали стабильно.
function normalizeEnchantId(id) {
  return typeof id === "string" ? id.replace(/^minecraft:/, "") : undefined;
}

function enchantmentType(id) {
  const bare = normalizeEnchantId(id);
  if (!bare) return undefined;
  return EnchantmentTypes.get(bare) ?? EnchantmentTypes.get(`minecraft:${bare}`);
}

function stackLevel(stack) {
  if (!stack) return 1;
  const level = Number(stack.getDynamicProperty("mana:level"));
  return Number.isFinite(level) && level > 0 ? level : 1;
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

function showSuccess(player) {
  player.playSound("random.levelup");
  try { player.dimension.spawnParticle("minecraft:enchanting_table_particle", player.location); } catch {}
}

function isEmptyHand(player) {
  const stack = itemInHand(player);
  return !stack || stack.amount < 1;
}

function displayItemId(slot) {
  if (!slot) return null;
  return slot.id;
}

function clearDisplayEntities(dimension, location) {
  const entities = dimension.getEntities({ type: "minecraft:item", tags: [DISPLAY_TAG] });
  for (const entity of entities) {
    const p = entity.location;
    if (Math.abs(p.x - (location.x + 0.5)) < 1.2 && Math.abs(p.y - (location.y + 1.3)) < 1.4 && Math.abs(p.z - (location.z + 0.5)) < 1.2) {
      try { entity.kill(); } catch {}
    }
  }
}

function spawnDisplay(dimension, location, slot, offsetX = 0, offsetZ = 0) {
  if (!slot?.id) return;
  try {
    const stack = slot.id.startsWith("mana:stone_") ? makeStone(slot.id, slot.level || 1) : new ItemStack(slot.id, 1);
    const anchor = { x: location.x + 0.5 + offsetX, y: location.y + 1.25, z: location.z + 0.5 + offsetZ };
    const entity = dimension.spawnItem(stack, anchor);
    entity.addTag(DISPLAY_TAG);
    // Компонентов minecraft:pickup_delay / minecraft:physics в Script API нет.
    // Якорь храним в dynamic property, подбор запрещаем через beforeEvents.entityItemPickup,
    // а от гравитации защищаем периодическим teleport обратно к якорю (stabilizeDisplays).
    try { entity.setDynamicProperty(ANCHOR_KEY, anchor); } catch {}
  } catch {}
}

function refreshMachineDisplay(dimension, location, data) {
  clearDisplayEntities(dimension, location);
  if (data.kind === "condenser" && data.slot === "manastone") spawnDisplay(dimension, location, { id: BASE_STONE });
  if (data.kind === "condenser" && data.slot === "full") spawnDisplay(dimension, location, { id: FULL_STONE });
  if (data.kind === "anvil" && data.slot) spawnDisplay(dimension, location, data.slot);
  if (data.kind === "fusion") {
    if (data.left) spawnDisplay(dimension, location, data.left, -0.22, 0);
    if (data.right) spawnDisplay(dimension, location, data.right, 0.22, 0);
  }
}

function serializeStack(stack) {
  if (!stack) return null;
  const result = { id: stack.typeId, amount: 1 };
  if (stoneIds.has(stack.typeId)) result.level = stackLevel(stack);
  try { result.nameTag = stack.nameTag || undefined; } catch {}
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
    if (current.level === stoneLevel && stoneLevel < stone.max) level = stoneLevel + 1;
    else level = Math.max(current.level, stoneLevel);
    try { enchantable.removeEnchantment(enchantmentType(stone.enchant) ?? stone.enchant); } catch { return null; }
  }
  if (level > stone.max) return null;
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
    const info = stones[data.left.id];
    const next = (data.left.level || 1) + 1;
    if (next > info.max) {
      fusionError(player, "У этого зачарования уже максимальный уровень");
      return false;
    }
    result = makeStone(data.left.id, next);
  } else if (leftStone || rightStone) {
    const stoneSlot = leftStone ? data.left : data.right;
    const itemSlot = leftStone ? data.right : data.left;
    const item = deserializeStack(itemSlot);
    result = applyStoneToItem(item, stoneSlot.id, stoneSlot.level || 1);
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

function handleMachineInteraction(event) {
  if (!event.isFirstEvent) return;
  const player = event.player;
  const block = event.block;
  if (!player || !block || !MACHINE_IDS.has(block.typeId)) return;
  const { data } = getMachine(block.dimension, block.location, block.typeId);
  if (block.typeId === "mana:condenser") checkCondenser(player, block.dimension, block.location, data);
  else if (block.typeId === "mana:anvil") checkAnvil(player, block.dimension, block.location, data);
  else checkFusion(player, block.dimension, block.location, data);
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

function consumeEntityItem(entity, count) {
  const stack = itemEntityStack(entity);
  if (!stack || stack.amount < count) return;
  const remaining = stack.amount - count;
  const location = entity.location;
  const dimension = entity.dimension;
  try { entity.kill(); } catch {}
  if (remaining > 0) {
    const rest = new ItemStack(stack.typeId, remaining);
    dimension.spawnItem(rest, location);
  }
}

function combineDroppedStones(entity) {
  if (!entity || entity.typeId !== "minecraft:item" || entity.hasTag(DISPLAY_TAG)) return;
  const stack = itemEntityStack(entity);
  if (!stack || !["minecraft:lapis_lazuli", "minecraft:gold_nugget", "minecraft:stone"].includes(stack.typeId)) return;
  const lock = `${entity.dimension.id}|${Math.floor(entity.location.x)}|${Math.floor(entity.location.y)}|${Math.floor(entity.location.z)}`;
  if (dropLocks.has(lock)) return;
  dropLocks.add(lock);
  system.runTimeout(() => {
    try {
      const items = entity.dimension.getEntities({ type: "minecraft:item", location: entity.location, maxDistance: 1.5 }).filter((candidate) => !candidate.hasTag(DISPLAY_TAG));
      const byId = new Map();
      for (const candidate of items) {
        const item = itemEntityStack(candidate);
        if (item) byId.set(item.typeId, { entity: candidate, stack: item });
      }
      const required = ["minecraft:lapis_lazuli", "minecraft:gold_nugget", "minecraft:stone"];
      if (!required.every((id) => byId.get(id)?.stack.amount >= 1)) return;
      for (const id of required) consumeEntityItem(byId.get(id).entity, 1);
      entity.dimension.spawnItem(new ItemStack(BASE_STONE, 1), entity.location);
    } catch {
      // Предмет мог быть подобран/удалён за время таймаута — это не ошибка.
    } finally {
      dropLocks.delete(lock);
    }
  }, 1);
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
    if (event.item?.hasTag(DISPLAY_TAG)) event.cancel = true;
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
        const anchor = entity.getDynamicProperty(ANCHOR_KEY);
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
    try { event.entity.kill(); } catch {}
    return;
  }
  combineDroppedStones(event.entity);
});

system.runInterval(() => {
  tickPlayers();
  if (system.currentTick % 2 === 0) stabilizeDisplays();
  if (system.currentTick % 20 === 0) chargeCondensers();
}, 1);
