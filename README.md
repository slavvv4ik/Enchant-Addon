# Mana Machines — исправление ошибок запуска (Bedrock 1.26.x)

Исходники аддона лежат в `src/` (распакованы из исходного `.mcaddon`), сборка — `python3 build.py`.

## Что было сломано и что исправлено

### 1. `Could not find export 'Enchantment' in module '@minecraft/server'`

В `@minecraft/server` 2.x (у вас в манифесте `2.11.0`) **`Enchantment` — это только
TypeScript-интерфейс**, а не runtime-класс. Импортировать его как значение и делать
`new Enchantment(type, level)` нельзя — движок падает ещё до выполнения скрипта.

Исправлено в `src/Mana_Machines_BP/scripts/main.js`:

- убран `Enchantment` из импорта;
- все `new Enchantment(type, level)` заменены на обычный объект `{ type, level }`,
  который и принимает `ItemEnchantableComponent.addEnchantment()`;
- добавлен хелпер `enchantmentType(id)` — пробует ID и с префиксом `minecraft:`, и без
  него, а `normalizeEnchantId()` приводит ID к единому виду при сравнении;
- перед применением зачарования вызывается `canAddEnchantment()`.

### 2. `1.20+ Recipes require unlock data`

Начиная с формата рецептов 1.20.10 каждый рецепт обязан содержать поле `unlock`
(условие открытия в книге рецептов). В трёх рецептах его не было.

Исправлено в `recipes/anvil.json`, `recipes/condenser.json`, `recipes/fusion.json` —
добавлено:

```json
"unlock": [ { "item": "minecraft:obsidian" } ]
```

Рецепт появляется в книге, как только игрок получает обсидиан. Сам крафт работает
и без открытия, если не включён геймрул `doLimitedCrafting`.

### 3. Попутно исправленные скрытые ошибки API

- **`blockContainerOpened`**: событие не содержит `event.container` / `event.player`.
  Контейнер теперь берётся из `event.block.getComponent("minecraft:inventory").container`,
  а игрок — из `event.openSource.entity`.
- **`blockExplode`**: событие приходит на каждый блок и не содержит массива `event.blocks`.
  Тип разрушенного блока берётся из `event.explodedBlockPermutation.type.id`.
- **Витринные предметы**: компонентов `minecraft:pickup_delay` и `minecraft:physics`
  в Script API нет. Подбор запрещён через `beforeEvents.entityItemPickup`, а от падения
  предметы возвращаются к якорю (`stabilizeDisplays`).
- `playerBreakBlock`: убран несуществующий fallback `brokenBlockPermutation.typeId`.

### 4. v1.0.4: мана отображается, но машины не реагируют на клик

Причина: кастомные блоки без interact-компонента не вызывают
`playerInteractWithBlock`, поэтому обработчики машин никогда не запускались.

Исправлено:

- блоки переведены на формат `1.21.90` и получили Custom Component V2
  `mana:machine_interaction`;
- компонент регистрируется через `system.beforeEvents.startup` и обрабатывает
  `onPlayerInteract` / `onPlace`;
- добавлена защита от двойного срабатывания одного клика;
- стандартное использование предмета по машине отменяется, чтобы ведро воды или
  блок в руке не срабатывали вместо взаимодействия;
- зелья маны получили `minecraft:use_animation: drink`, чтобы корректно завершать
  использование и восстанавливать ману;
- поиск типа зачарования стал устойчивее к ID с префиксом `minecraft:` и без него.

## Сборка и установка

```bash
python3 build.py
```

Полученный `Mana_Machines_v1.0.4.mcaddon` откройте в Minecraft (двойной клик или
«Открыть с помощью Minecraft»). Старую версию пака перед импортом лучше удалить,
чтобы не было конфликта UUID. После обновления мира пере-поставьте блоки машин,
если они были поставлены старой версией без interact-компонента.

## Проверка

- `node --check src/Mana_Machines_BP/scripts/main.js` — синтаксис JS.
- Скрипт проходит `tsc --checkJs` против официальных типов `@minecraft/server@2.11.0`.
- `node tests/runtime-smoke.mjs` — smoke-тест регистрации компонента, конденсатора,
  блока слияния и зелья маны.
- Все JSON-файлы валидны.
