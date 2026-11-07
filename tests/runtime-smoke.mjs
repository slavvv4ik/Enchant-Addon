// Статический smoke-тест логики аддона без запуска Minecraft.
// Проверяет регистрацию custom component, обработку клика по конденсатору,
// защиту от двойного срабатывания, восстановление маны зельем,
// ограничение уровней ванильными максимумами, крафт из дропа на земле
// и посадочные места витринных предметов.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bp = path.join(root, "src", "Mana_Machines_BP");
const source = fs.readFileSync(path.join(bp, "scripts", "main.js"), "utf8");
const transformed = source.replace(
  /import\s*\{[^}]*\}\s*from\s*"@minecraft\/server";/,
  'const { world, system, ItemStack, EnchantmentTypes } = __api;'
);

function signal() {
  return {
    callbacks: [],
    subscribe(callback) {
      this.callbacks.push(callback);
      return callback;
    },
    unsubscribe(callback) {
      this.callbacks = this.callbacks.filter((entry) => entry !== callback);
    },
    emit(event) {
      for (const callback of this.callbacks) callback(event);
    }
  };
}

// Размер стака берём из JSON аддона: динамические свойства в Bedrock работают
// только на нестакуемых предметах. Если сформированный камень снова станет
// стакуемым, makeStone обязан упасть — это тот самый баг, из-за которого
// все камни v1.0.4 жили как уровень I.
const itemMaxStack = new Map();
for (const file of fs.readdirSync(path.join(bp, "items"))) {
  const item = JSON.parse(fs.readFileSync(path.join(bp, "items", file), "utf8"));
  const components = item["minecraft:item"]?.components ?? {};
  itemMaxStack.set(item["minecraft:item"].description.identifier, components["minecraft:max_stack_size"] ?? 64);
}

class MockItemStack {
  constructor(typeId, amount = 1) {
    this.typeId = typeId;
    this.amount = amount;
    this.nameTag = undefined;
    this.lore = [];
    this.props = new Map();
    this.maxAmount = itemMaxStack.get(typeId) ?? 64;
    // В реальной игре ванильные инструменты уже имеют компонент enchantable.
    if (typeId === "minecraft:diamond_sword") makeEnchantable(this);
  }
  clone() {
    const copy = new MockItemStack(this.typeId, this.amount);
    copy.nameTag = this.nameTag;
    copy.props = new Map(this.props);
    copy.lore = [...this.lore];
    if (this.components) copy.components = new Map(this.components);
    return copy;
  }
  setDynamicProperty(key, value) {
    if (this.maxAmount > 1) {
      throw new Error(`Dynamic properties are not supported on stackable item ${this.typeId}`);
    }
    this.props.set(key, value);
  }
  getDynamicProperty(key) { return this.props.get(key); }
  setLore(lore) { this.lore = lore ?? []; }
  getLore() { return this.lore; }
  getComponent(id) { return this.components?.get(id); }
}

function makeEnchantable(stack) {
  const enchantments = [];
  const component = {
    getEnchantments() { return enchantments; },
    canAddEnchantment() { return true; },
    addEnchantment(entry) { enchantments.push(entry); },
    removeEnchantment(type) {
      const id = typeof type === "string" ? type : type.id;
      const index = enchantments.findIndex((entry) => entry.type.id === id);
      if (index >= 0) enchantments.splice(index, 1);
    }
  };
  stack.components = new Map([["minecraft:enchantable", component]]);
  return stack;
}

const worldProps = new Map();
const afterEvents = Object.fromEntries([
  "playerInteractWithBlock", "playerPlaceBlock", "itemCompleteUse",
  "blockContainerOpened", "playerBreakBlock", "blockExplode", "entitySpawn"
].map((name) => [name, signal()]));
const beforeEvents = Object.fromEntries([
  "playerInteractWithBlock", "entityItemPickup"
].map((name) => [name, signal()]));
const startup = signal();
const intervals = [];
const timeouts = [];

const system = {
  currentTick: 100,
  beforeEvents: { startup },
  runInterval(callback) { intervals.push(callback); return intervals.length; },
  runTimeout(callback) { timeouts.push(callback); return timeouts.length; },
  run(callback) { callback(); }
};

const registeredComponents = new Map();
const blockComponentRegistry = {
  registerCustomComponent(name, component) { registeredComponents.set(name, component); }
};

const entities = [];
let nextEntityId = 1;

function spawnItemEntity(dimension, stack, location) {
  const entity = {
    id: `entity-${nextEntityId++}`,
    typeId: "minecraft:item",
    dimension,
    location: { x: location.x, y: location.y, z: location.z },
    tags: new Set(),
    props: new Map(),
    isValid: true,
    stack,
    addTag(tag) { this.tags.add(tag); },
    hasTag(tag) { return this.tags.has(tag); },
    remove() { this.isValid = false; },
    kill() { return false; },
    teleport(target) { this.location = { x: target.x, y: target.y, z: target.z }; },
    clearVelocity() {},
    getComponent(id) { return id === "minecraft:item" ? { itemStack: this.stack } : undefined; },
    getDynamicProperty(key) { return this.props.get(key); },
    setDynamicProperty(key, value) { this.props.set(key, value); }
  };
  entities.push(entity);
  return entity;
}

function matchesFilter(entity, filter) {
  if (!entity.isValid) return false;
  if (filter.type && entity.typeId !== filter.type) return false;
  if (filter.tags?.some((tag) => !entity.tags.has(tag))) return false;
  if (filter.excludeTags?.some((tag) => entity.tags.has(tag))) return false;
  if (filter.location && filter.maxDistance !== undefined) {
    const dx = entity.location.x - filter.location.x;
    const dy = entity.location.y - filter.location.y;
    const dz = entity.location.z - filter.location.z;
    if (Math.sqrt(dx * dx + dy * dy + dz * dz) > filter.maxDistance) return false;
  }
  return true;
}

const dimension = {
  id: "minecraft:overworld",
  getEntities(filter = {}) {
    return entities.filter((entity) => matchesFilter(entity, filter));
  },
  spawnItem(stack, location) { return spawnItemEntity(dimension, stack, location); },
  spawnParticle() {},
  playSound() {}
};

const inventorySlots = new Map();
const container = {
  size: 36,
  getItem(slot) { return inventorySlots.get(slot); },
  setItem(slot, stack) {
    if (stack === undefined) inventorySlots.delete(slot);
    else inventorySlots.set(slot, stack);
  },
  addItem(stack) {
    for (let slot = 0; slot < this.size; slot++) {
      if (!inventorySlots.has(slot)) { inventorySlots.set(slot, stack); return undefined; }
    }
    return stack;
  }
};

const playerProps = new Map();
const player = {
  id: "player-1",
  typeId: "minecraft:player",
  dimension,
  location: { x: 0, y: 64, z: 0 },
  selectedSlotIndex: 0,
  isSneaking: false,
  level: 10,
  getComponent(id) { return id === "minecraft:inventory" ? { container } : undefined; },
  getDynamicProperty(key) { return playerProps.get(key); },
  setDynamicProperty(key, value) { playerProps.set(key, value); },
  addLevels(amount) { this.level += amount; return this.level; },
  playSound() {},
  onScreenDisplay: { setActionBar() {} }
};

const world = {
  afterEvents,
  beforeEvents,
  getDynamicProperty(key) { return worldProps.get(key); },
  setDynamicProperty(key, value) { worldProps.set(key, value); },
  getAllPlayers() { return [player]; },
  getPlayers(options = {}) {
    const location = options.location ?? player.location;
    const maxDistance = options.maxDistance;
    if (maxDistance === undefined) return [player];
    const dx = player.location.x - location.x;
    const dy = player.location.y - location.y;
    const dz = player.location.z - location.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) > maxDistance ? [] : [player];
  }
};

// Ванильные максимумы зачарований Bedrock. Реестр игры — источник истины для уровней.
const VANILLA_MAX_LEVEL = {
  aqua_affinity: 1, bane_of_arthropods: 5, blast_protection: 4, depth_strider: 3,
  efficiency: 5, feather_falling: 4, fire_aspect: 2, fire_protection: 4, flame: 1,
  fortune: 3, frost_walker: 2, infinity: 1, knockback: 2, looting: 3, luck_of_the_sea: 3,
  lure: 3, mending: 1, multishot: 1, power: 5, projectile_protection: 4, protection: 4,
  punch: 2, quick_charge: 3, respiration: 3, sharpness: 5, silk_touch: 1, smite: 5,
  swift_sneak: 3, thorns: 3, unbreaking: 3
};

const EnchantmentTypes = {
  get(id) {
    const bare = id.replace(/^minecraft:/, "");
    const maxLevel = VANILLA_MAX_LEVEL[bare];
    if (!maxLevel) throw new Error(`Unknown enchantment id: ${id}`);
    return { id: `minecraft:${bare}`, maxLevel };
  },
  getAll() { return []; }
};

const context = vm.createContext({
  __api: { world, system, ItemStack: MockItemStack, EnchantmentTypes },
  console, Math, JSON, Set, Map, Number, String, Boolean, Object, Array, Error
});
vm.runInContext(transformed, context, { filename: "main.js" });

// Startup должен зарегистрировать компонент взаимодействия.
startup.emit({ blockComponentRegistry });
const component = registeredComponents.get("mana:machine_interaction");
assert.ok(component, "custom component mana:machine_interaction registered");
assert.equal(typeof component.onPlayerInteract, "function");
assert.ok(intervals.length > 0, "periodic tick loop registered");

// JSON блоков должен привязывать компонент в формате V2.
for (const name of ["anvil", "condenser", "fusion"]) {
  const block = JSON.parse(fs.readFileSync(path.join(bp, "blocks", `${name}.json`), "utf8"));
  assert.ok(block.format_version >= "1.21.90", `${name} format supports custom components V2`);
  assert.ok(block["minecraft:block"].components["mana:machine_interaction"], `${name} binds interaction component`);
}

// Клик по конденсатору с манакамнем в руке должен вставить камень.
inventorySlots.set(0, new MockItemStack("mana:manastone", 1));
const block = { typeId: "mana:condenser", location: { x: 1, y: 64, z: 1 }, dimension };
component.onPlayerInteract({ block, dimension, player });
assert.equal(inventorySlots.get(0), undefined, "condenser consumes manastone");
const machines = JSON.parse(worldProps.get("mana:machines"));
const key = "minecraft_overworld|1|64|1";
assert.equal(machines[key].slot, "manastone", "condenser stores inserted stone");

// Повторный клик в том же тике не должен вставить второй камень.
inventorySlots.set(0, new MockItemStack("mana:manastone", 1));
const beforeEvent = { block, player, isFirstEvent: true, cancel: false };
beforeEvents.playerInteractWithBlock.emit(beforeEvent);
assert.equal(beforeEvent.cancel, true, "default item use on machine is cancelled");
assert.ok(inventorySlots.get(0), "duplicate interaction in same tick is ignored");

// Зелье маны должно восстанавливать ману.
playerProps.set("mana:value", 0);
afterEvents.itemCompleteUse.emit({ source: player, itemStack: new MockItemStack("mana:mana_potion", 1) });
assert.equal(playerProps.get("mana:value"), 1000, "mana potion restores mana");

// Блок слияния должен применить манакамень к предмету и списать ману/опыт.
system.currentTick += 10;
inventorySlots.clear();
playerProps.set("mana:value", 1000);
player.level = 10;
const fusionBlock = { typeId: "mana:fusion", location: { x: 5, y: 64, z: 5 }, dimension };
const stone = new MockItemStack("mana:stone_sharpness", 1);
stone.setDynamicProperty("mana:level", 1);
inventorySlots.set(0, stone);
component.onPlayerInteract({ block: fusionBlock, dimension, player });
assert.equal(inventorySlots.get(0), undefined, "fusion consumes formed stone");
const sword = makeEnchantable(new MockItemStack("minecraft:diamond_sword", 1));
inventorySlots.set(0, sword);
system.currentTick += 10;
component.onPlayerInteract({ block: fusionBlock, dimension, player });
const result = inventorySlots.get(0);
assert.ok(result, "fusion returns enchanted item");
const enchants = result.getComponent("minecraft:enchantable").getEnchantments();
assert.equal(enchants.length, 1, "fusion applies one enchantment");
assert.equal(enchants[0].type.id, "minecraft:sharpness", "enchantment id resolves with minecraft: prefix");
assert.equal(enchants[0].level, 1);
assert.equal(playerProps.get("mana:value"), 950, "fusion spends 50 mana");
assert.equal(player.level, 5, "fusion spends 5 levels");

// Рецепты по-прежнему содержат unlock.
for (const name of ["anvil", "condenser", "fusion"]) {
  const recipe = JSON.parse(fs.readFileSync(path.join(bp, "recipes", `${name}.json`), "utf8"));
  assert.ok(recipe["minecraft:recipe_shaped"].unlock?.length, `${name} recipe has unlock`);
}

// --- Уровни камней ограничены ванильными максимумами ---
const { stoneMaxLevel, makeStone, stackLevel, displayAnchor } = context;

for (const file of fs.readdirSync(path.join(bp, "items")).filter((name) => name.startsWith("stone_"))) {
  const item = JSON.parse(fs.readFileSync(path.join(bp, "items", file), "utf8"));
  const id = item["minecraft:item"].description.identifier;
  assert.equal(item["minecraft:item"].components["minecraft:max_stack_size"], 1,
    `${id} must stay non-stackable, otherwise dynamic properties are dropped`);
}
assert.equal(stoneMaxLevel("mana:stone_sharpness"), 5, "sharpness caps at V");
assert.equal(stoneMaxLevel("mana:stone_protection"), 4, "protection caps at IV");
assert.equal(stoneMaxLevel("mana:stone_fire_aspect"), 2, "fire aspect caps at II");
assert.equal(stoneMaxLevel("mana:stone_flame"), 1, "flame caps at I");
// Уровень, превышающий максимум, обрезается, а не сохраняется как есть.
assert.equal(stackLevel(makeStone("mana:stone_fire_aspect", 9)), 2, "level is clamped to enchantment max");
// Совместимость: старый камень v1.0.4 без DP восстанавливает уровень из названия.
const legacy = new MockItemStack("mana:stone_sharpness", 1);
legacy.nameTag = "§bМанакамень (Острота) III";
assert.equal(stackLevel(legacy), 3, "legacy stone restores level from name tag");

function fusionOfStones(id, level) {
  const location = { x: 20, y: 64, z: 20 };
  const fusion = { typeId: "mana:fusion", location, dimension };
  const machine = context.getMachine(dimension, location, "mana:fusion").data;
  machine.left = null;
  machine.right = null;
  for (const side of ["left", "right"]) {
    const stack = makeStone(id, level);
    assert.equal(stackLevel(stack), level, `${id} keeps level ${level}`);
    machine[side] = { id, level: stackLevel(stack) };
  }
  player.level = 10;
  playerProps.set("mana:value", 1000);
  inventorySlots.clear();
  system.currentTick += 10;
  const produced = context.completeFusion(player, dimension, location, machine);
  const stored = machine;
  const leftover = inventorySlots.get(0);
  inventorySlots.clear();
  return { produced, stored, leftover };
}

let fusion = fusionOfStones("mana:stone_sharpness", 2);
assert.equal(fusion.produced, true, "II + II is a valid fusion");
assert.equal(stackLevel(fusion.leftover), 3, "II + II gives III");
fusion = fusionOfStones("mana:stone_sharpness", 4);
assert.equal(stackLevel(fusion.leftover), 5, "IV + IV gives V");
fusion = fusionOfStones("mana:stone_sharpness", 5);
assert.equal(fusion.produced, false, "V + V is refused: sharpness max is V");
assert.equal(fusion.leftover, undefined, "refused fusion produces nothing");
assert.ok(fusion.stored.left && fusion.stored.right, "refused fusion keeps both stones in the machine");
assert.equal(player.level, 10, "refused fusion does not spend levels");
fusion = fusionOfStones("mana:stone_fire_aspect", 2);
assert.equal(fusion.produced, false, "II + II is refused for fire aspect (max II)");
fusion = fusionOfStones("mana:stone_flame", 1);
assert.equal(fusion.produced, false, "I + I is refused for flame (max I)");

// --- Крафт пустого манакамня из дропа на земле ---
const RECIPE = ["minecraft:lapis_lazuli", "minecraft:gold_nugget", "minecraft:stone"];

function dropRecipe(positions, amounts = [1, 1, 1]) {
  entities.length = 0;
  player.location = { x: 0, y: 64, z: 0 };
  return positions.map((position, index) => {
    const id = RECIPE[index];
    return dimension.spawnItem(new MockItemStack(id, amounts[index]), position);
  });
}

function countValid(ids) {
  return entities.filter((entity) => entity.isValid && ids.includes(entity.stack.typeId)).length;
}

let dropped = dropRecipe([
  { x: 0.3, y: 64.1, z: 0.2 },
  { x: 0.5, y: 64.0, z: 0.1 },
  { x: 0.7, y: 64.2, z: 0.3 }
]);
context.scanDroppedRecipes();
assert.equal(countValid(RECIPE), 0, "all three ingredients are consumed");
assert.equal(countValid(["mana:manastone"]), 1, "dropped recipe produces one empty mana stone");

// Неполный набор не должен потребляться.
dropped = dropRecipe([
  { x: 0.3, y: 64.1, z: 0.2 },
  { x: 0.5, y: 64.0, z: 0.1 }
]);
context.scanDroppedRecipes();
assert.equal(countValid(RECIPE), 2, "incomplete set is never consumed");
assert.equal(countValid(["mana:manastone"]), 0, "incomplete set produces nothing");

// Ингредиенты дальше радиуса кластера не объединяются.
dropRecipe([{ x: 0.3, y: 64.1, z: 0.2 }, { x: 0.5, y: 64.0, z: 0.1 }]);
dimension.spawnItem(new MockItemStack("minecraft:stone", 1), { x: 5.5, y: 64.1, z: 0.1 });
context.scanDroppedRecipes();
assert.equal(countValid(["mana:manastone"]), 0, "ingredients too far apart are not combined");

// Из стака расходуется одна единица, остаток возвращается дропом.
dropRecipe([{ x: 0.3, y: 64.1, z: 0.2 }, { x: 0.5, y: 64.0, z: 0.1 }, { x: 0.7, y: 64.0, z: 0.3 }], [3, 1, 1]);
const produced = context.scanDroppedRecipes();
const lapisLeft = entities.filter((entity) => entity.isValid && entity.stack.typeId === "minecraft:lapis_lazuli");
assert.equal(lapisLeft.length, 1, "remainder of the stack is dropped back");
assert.equal(lapisLeft[0].stack.amount, 2, "remainder keeps the remaining 2 items");
assert.equal(countValid(["mana:manastone"]), 1, "stack recipe still produces one stone");

// Выброс ингредиента планирует отложенную проверку набора.
entities.length = 0;
const lapisEntity = dimension.spawnItem(new MockItemStack("minecraft:lapis_lazuli", 1), { x: 0.4, y: 64.1, z: 0.2 });
dimension.spawnItem(new MockItemStack("minecraft:gold_nugget", 1), { x: 0.5, y: 64.0, z: 0.2 });
dimension.spawnItem(new MockItemStack("minecraft:stone", 1), { x: 0.6, y: 64.1, z: 0.3 });
const pendingBefore = timeouts.length;
afterEvents.entitySpawn.emit({ entity: lapisEntity });
assert.equal(timeouts.length, pendingBefore + 1, "dropping an ingredient schedules a delayed check");
timeouts[timeouts.length - 1]();
assert.equal(countValid(["mana:manastone"]), 1, "delayed check crafts the set");

// --- Витринные предметы стоят на посадочных местах моделей ---
const leftAnchor = displayAnchor({ x: 5, y: 64, z: 5 }, "fusion_left");
const rightAnchor = displayAnchor({ x: 5, y: 64, z: 5 }, "fusion_right");
// X геометрии блока инвертирован к мировому X: левый слот модели x=-5 уходит на восток.
assert.ok(Math.abs(leftAnchor.x - 5.8125) < 1e-6, `left seat x = 5.8125, got ${leftAnchor.x}`);
assert.ok(Math.abs(rightAnchor.x - 5.1875) < 1e-6, `right seat x = 5.1875, got ${rightAnchor.x}`);
assert.ok(Math.abs(leftAnchor.y - 64.8125) < 1e-6, `fusion seat y = 64.8125, got ${leftAnchor.y}`);
assert.ok(Math.abs(displayAnchor({ x: 0, y: 64, z: 0 }, "condenser").y - 64.678125) < 1e-6, "condenser seat sits on the bowl rim");
assert.ok(Math.abs(displayAnchor({ x: 0, y: 64, z: 0 }, "anvil").y - 65.15625) < 1e-6, "anvil seat sits on the sigil");

entities.length = 0;
inventorySlots.clear();
player.isSneaking = false;
system.currentTick += 10;
const anvilBlock = { typeId: "mana:anvil", location: { x: 2, y: 64, z: 2 }, dimension };
inventorySlots.set(0, new MockItemStack("mana:full_manastone", 1));
component.onPlayerInteract({ block: anvilBlock, dimension, player });
const displays = dimension.getEntities({ type: "minecraft:item", tags: ["mana_machine_display"] });
assert.equal(displays.length, 1, "anvil shows exactly one display item");
const seat = displays[0].getDynamicProperty("mana:display_anchor");
assert.ok(Math.abs(seat.x - 2.5) < 1e-6 && Math.abs(seat.z - 2.5) < 1e-6, "anvil display is centered over the block");
assert.ok(Math.abs(seat.y - 65.15625) < 1e-6, "anvil display sits on the sigil, not above the block");
assert.equal(displays[0].getDynamicProperty("mana:display_machine"), "minecraft_overworld|2|64|2", "display is bound to its machine");
assert.equal(displays[0].getDynamicProperty("mana:display_version"), 2, "display layout version is recorded");

// Витринный предмет нельзя подобрать.
const pickupEvent = { item: displays[0], cancel: false };
beforeEvents.entityItemPickup.emit(pickupEvent);
assert.equal(pickupEvent.cancel, true, "display item cannot be picked up");

console.log("runtime-smoke: OK");
