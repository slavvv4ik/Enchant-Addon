// Статический smoke-тест логики аддона без запуска Minecraft.
// Проверяет регистрацию custom component, обработку клика по конденсатору,
// защиту от двойного срабатывания и восстановление маны зельем.
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

class MockItemStack {
  constructor(typeId, amount = 1) {
    this.typeId = typeId;
    this.amount = amount;
    this.nameTag = undefined;
    this.props = new Map();
    // В реальной игре ванильные инструменты уже имеют компонент enchantable.
    if (typeId === "minecraft:diamond_sword") makeEnchantable(this);
  }
  clone() {
    const copy = new MockItemStack(this.typeId, this.amount);
    copy.nameTag = this.nameTag;
    copy.props = new Map(this.props);
    if (this.components) copy.components = new Map(this.components);
    return copy;
  }
  setDynamicProperty(key, value) { this.props.set(key, value); }
  getDynamicProperty(key) { return this.props.get(key); }
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

const dimension = {
  id: "minecraft:overworld",
  getEntities() { return []; },
  spawnItem(stack, location) {
    return {
      typeId: "minecraft:item",
      location,
      addTag() {},
      hasTag() { return false; },
      setDynamicProperty() {},
      kill() {},
      getComponent() { return undefined; }
    };
  },
  spawnParticle() {}
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
  getPlayers() { return [player]; }
};

const EnchantmentTypes = {
  get(id) {
    if (id.startsWith("minecraft:")) return { id, maxLevel: 5 };
    throw new Error(`Unknown enchantment id: ${id}`);
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

console.log("runtime-smoke: OK");
