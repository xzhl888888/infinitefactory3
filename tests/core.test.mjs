import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE_CARDS, CATEGORIES } from '../src/content/catalog.js';
import { createNewSave, normalizeName, recipeKey, findRecipe, commitSynthesis, validateSave, serializeSave, importSave, SAVE_LIMITS } from '../src/core/model.js';
import { buildSynthesisMessages, parseCardResponse, validateCardResult } from '../src/ai/protocol.js';

const NOW = '2026-10-26T02:00:00.000Z';
const LATER = '2026-10-26T02:01:00.000Z';
const input = ['base:metal', 'base:wood'];
const result = { name: '工具', emoji: '🛠️', category: '科技', description: '让双手更有办法。' };
const fresh = () => createNewSave({ id: 'test-save', now: NOW });
const clone = value => JSON.parse(JSON.stringify(value));
const throwsCode = (run, code) => assert.throws(run, error => error.code === code);
const synthesize = (save = fresh(), overrides = {}) => commitSynthesis(save, { operationId: 'op-1', ingredientIds: input, result, now: LATER, ...overrides });

test('新档严格五本源、零配方零计数，互不共享可变状态', () => {
  const a = fresh(), b = fresh();
  assert.deepEqual(a.cards.map(card => card.name), ['金', '木', '水', '火', '土']);
  assert.equal(a.cards.length, 5);
  assert.ok(a.cards.every(card => card.isBase));
  assert.deepEqual(a.recipes, []);
  assert.equal(a.stats.synthesisCount, 0);
  assert.equal(a.operations.length, 0);
  a.cards[0].name = '改名';
  assert.equal(b.cards[0].name, '金');
  assert.equal(BASE_CARDS[0].name, '金');
});

test('配方顺序无关但保留重复，非法数量与标识拒绝', () => {
  assert.equal(recipeKey(input), recipeKey(input.toReversed()));
  assert.notEqual(recipeKey(['base:metal', 'base:metal']), recipeKey(input));
  assert.notEqual(recipeKey(['a', 'b:c']), recipeKey(['a:b', 'c']));
  throwsCode(() => recipeKey(['base:metal']), 'INVALID_INGREDIENT_COUNT');
  throwsCode(() => recipeKey(['a+b', 'c']), 'INVALID_ID');
  throwsCode(() => recipeKey(Array(5).fill('base:metal')), 'INVALID_INGREDIENT_COUNT');
});

test('名称规范化覆盖全半角、拉丁大小写与多余空白', () => {
  assert.equal(normalizeName('  ＡI　工具  '), normalizeName('ai 工具'));
  assert.notEqual(normalizeName('金木'), normalizeName('金 木'));
});

test('成功结果一次生成新卡、配方、操作和计数，不修改输入档案', () => {
  const save = fresh(), before = clone(save), out = synthesize(save);
  assert.deepEqual(save, before);
  assert.equal(out.save.cards.length, 6);
  assert.equal(out.save.recipes.length, 1);
  assert.equal(out.save.operations.length, 1);
  assert.equal(out.save.stats.synthesisCount, 1);
  assert.equal(out.save.revision, 1);
  assert.equal(out.save.updatedAt, LATER);
  assert.equal(out.card.id, 'card:op-1');
  assert.equal(out.recipe.resultId, out.card.id);
  assert.equal(out.isNewCard, true);
  assert.equal(out.isNewRecipe, true);
});

test('同操作重放幂等，改变材料或结果拒绝复用操作ID', () => {
  const first = synthesize();
  const repeat = synthesize(first.save, { ingredientIds: input.toReversed() });
  assert.equal(repeat.alreadyCommitted, true);
  assert.deepEqual(repeat.save, first.save);
  throwsCode(() => synthesize(first.save, { ingredientIds: ['base:fire', 'base:water'] }), 'OPERATION_CONFLICT');
  throwsCode(() => synthesize(first.save, { result: { ...result, name: '另一张卡' } }), 'OPERATION_CONFLICT');
});

test('新操作命中已知配方仍计数，不需AI结果且不能覆盖旧答案', () => {
  const first = synthesize();
  const cached = synthesize(first.save, { operationId: 'op-2', result: undefined });
  assert.equal(cached.card.id, first.card.id);
  assert.equal(cached.save.cards.length, 6);
  assert.equal(cached.save.recipes.length, 1);
  assert.equal(cached.save.stats.synthesisCount, 2);
  assert.equal(cached.isNewCard, false);
  assert.equal(cached.isNewRecipe, false);
  const differing = synthesize(cached.save, { operationId: 'op-3', result: { ...result, name: '新模型的不同答案' } });
  assert.equal(differing.card.id, first.card.id);
  assert.equal(differing.save.cards.length, 6);
  assert.equal(differing.save.stats.synthesisCount, 3);
  assert.deepEqual(findRecipe(differing.save, input.toReversed()), first.recipe);
});

test('不同配方同规范名称复用卡牌且保留初始描述和分类', () => {
  const first = synthesize(fresh(), { result: { ...result, name: 'ＡI工具' } });
  const next = synthesize(first.save, { operationId: 'op-2', ingredientIds: ['base:water', 'base:fire'], result: { name: 'ai工具', emoji: '🧠', category: '抽象', description: '不应覆盖首个结果。' } });
  assert.equal(next.card.id, first.card.id);
  assert.equal(next.save.cards.length, 6);
  assert.equal(next.save.recipes.length, 2);
  assert.equal(next.card.description, result.description);
  assert.equal(next.card.category, '科技');
});

test('结果是本源时复用本源，不新增第六张本源', () => {
  const out = synthesize(fresh(), { result: { name: ' 金 ', emoji: '✨', category: '抽象', description: '不会替换本源描述。' } });
  assert.equal(out.card.id, 'base:metal');
  assert.equal(out.card.description, BASE_CARDS[0].description);
  assert.equal(out.save.cards.length, 5);
  assert.equal(out.save.recipes.length, 1);
});

test('失败和未知材料不修改原档或计数', () => {
  const save = fresh(), before = clone(save);
  throwsCode(() => synthesize(save, { result: undefined }), 'RESULT_REQUIRED');
  throwsCode(() => synthesize(save, { result: { ...result, category: '全服唯一' } }), 'INVALID_CARD_RESULT');
  throwsCode(() => synthesize(save, { ingredientIds: ['base:metal', 'missing-card'] }), 'UNKNOWN_INGREDIENT');
  assert.deepEqual(save, before);
});

test('三四材料语义可用，重复材料确实保存', () => {
  for (const ingredientIds of [['base:metal', 'base:metal', 'base:wood'], ['base:metal', 'base:metal', 'base:wood', 'base:water']]) {
    const out = synthesize(fresh(), { ingredientIds });
    assert.equal(out.recipe.ingredientIds.filter(id => id === 'base:metal').length, 2);
    assert.equal(out.recipe.ingredientIds.length, ingredientIds.length);
  }
});

test('API检测用提示词与解析不会创建配方或改变档案', () => {
  const save = fresh(), before = clone(save);
  const messages = buildSynthesisMessages(save.cards.slice(0, 2));
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.deepEqual(JSON.parse(messages[1].content).materials.map(card => card.name), ['金', '木']);
  assert.deepEqual(parseCardResponse(JSON.stringify(result)), result);
  assert.deepEqual(save, before);
});

test('接受完整JSON和代码围栏，不吞掉额外解释、缺字段或错误类型', () => {
  assert.deepEqual(parseCardResponse('```json\n' + JSON.stringify(result) + '\n```'), result);
  for (const text of ['', '不是JSON', '解释 ' + JSON.stringify(result), JSON.stringify([result]), JSON.stringify({ ...result, name: '' }), JSON.stringify({ ...result, emoji: 1 }), JSON.stringify({ ...result, description: undefined })]) {
    assert.throws(() => parseCardResponse(text), error => ['INVALID_AI_RESPONSE', 'INVALID_CARD_RESULT'].includes(error.code));
  }
  throwsCode(() => parseCardResponse(' '.repeat(32769)), 'INVALID_AI_RESPONSE');
});

test('卡牌只接收白名单字段，AI不能伪造ID、运营身份或统计', () => {
  assert.deepEqual(validateCardResult({ ...result, id: 'evil', apiKey: 'test-secret', only: true, synthesisCount: 999 }), result);
  assert.equal(CATEGORIES.includes('星空'), false);
});

test('导出导入保持档案与有限偏好、收藏、布局', () => {
  const save = synthesize().save;
  save.preferences.skinId = 'sea';
  save.favorites = [{ id: 'default', name: '收藏', cardIds: ['card:op-1'] }];
  save.layout = [{ id: 'instance-1', cardId: 'card:op-1', x: 25.5, y: -20, pinned: true }];
  assert.deepEqual(importSave(serializeSave(save)), save);
});

test('额外Key字段不能通过顶层、卡牌、偏好、布局、操作或指纹流出', () => {
  const save = synthesize().save;
  const secret = 'NEVER_EXPORT_TEST_CREDENTIAL';
  save.apiKey = secret;
  save.stats.key = secret;
  save.cards[0].key = secret;
  save.preferences.apiKey = secret;
  save.preferences.provider = { key: secret };
  save.operations[0].authorization = secret;
  const fp = JSON.parse(save.operations[0].fingerprint);
  fp.apiKey = secret;
  fp.result.apiKey = secret;
  save.operations[0].fingerprint = JSON.stringify(fp);
  save.layout = [{ id: 'instance-1', cardId: 'base:metal', x: 0, y: 0, key: secret }];
  save.favorites = [{ id: 'default', name: '收藏', cardIds: ['base:metal'], key: secret }];
  const encoded = serializeSave(save);
  assert.equal(encoded.includes(secret), false);
  assert.equal(encoded.includes('apiKey'), false);
  assert.equal(importSave(encoded).stats.synthesisCount, 1);
});

test('未知格式/内容版本、重复卡牌ID或同名卡牌拒绝导入', () => {
  const mutations = [
    [save => { save.formatVersion = 99; }, 'UNSUPPORTED_SAVE_VERSION'],
    [save => { save.contentVersion = 2; }, 'UNSUPPORTED_CONTENT_VERSION'],
    [save => { save.cards.push({ ...save.cards[0] }); }, 'DUPLICATE_ID'],
    [save => { save.cards.push({ ...save.cards[0], id: 'new-card', isBase: false }); }, 'DUPLICATE_CARD_NAME'],
    [save => { save.cards[0].description = '伪造'; }, 'INVALID_BASE_CARDS'],
    [save => { save.cards[0].isBase = false; }, 'INVALID_BASE_CARDS'],
  ];
  for (const [mutate, code] of mutations) { const save = fresh(); mutate(save); throwsCode(() => importSave(JSON.stringify(save)), code); }
});

test('配方、操作、收藏和布局的悬空引用拒绝导入', () => {
  for (const mutate of [
    save => { save.recipes[0].resultId = 'missing'; },
    save => { save.operations[0].resultId = 'missing'; },
    save => { save.favorites = [{ id: 'default', name: '收藏', cardIds: ['missing'] }]; },
    save => { save.layout = [{ id: 'instance', cardId: 'missing', x: 0, y: 0 }]; },
  ]) { const save = synthesize().save; mutate(save); assert.throws(() => validateSave(save)); }
});

test('损坏配方键、重复操作、非整数统计和非法偏好拒绝导入', () => {
  const mutations = [
    [save => { save.recipes[0].key = 'wrong'; }, 'INVALID_RECIPE_KEY'],
    [save => { save.operations.push(clone(save.operations[0])); }, 'DUPLICATE_ID'],
    [save => { save.stats.synthesisCount = 1.2; }, 'INVALID_SAVE'],
    [save => { save.stats.synthesisCount = -1; }, 'INVALID_SAVE'],
    [save => { save.stats.synthesisCount = 999; }, 'INVALID_STATISTICS'],
    [save => { save.preferences.skinId = 'not-a-skin'; }, 'INVALID_SAVE'],
    [save => { save.preferences.zoom = Infinity; }, 'INVALID_SAVE'],
  ];
  for (const [mutate, code] of mutations) { const save = synthesize().save; mutate(save); throwsCode(() => validateSave(save), code); }
});

test('导入设备写版本可以低于历史合成数，时钟回拨不倒写时间', () => {
  const first = synthesize().save;
  const save = synthesize(first, { operationId: 'op-2', result: undefined }).save;
  save.revision = 1;
  assert.equal(validateSave(save).revision, 1);
  const next = synthesize(save, { operationId: 'op-3', result: undefined, now: NOW });
  assert.equal(next.save.updatedAt, LATER);
  assert.equal(next.save.revision, 2);
});

test('损坏和超限导入失败，错误不包含原始敏感输入', () => {
  throwsCode(() => importSave('{"apiKey":"PRIVATE_TEST_VALUE"'), 'INVALID_SAVE_JSON');
  throwsCode(() => importSave('x'.repeat(SAVE_LIMITS.bytes + 1)), 'SAVE_TOO_LARGE');
  try { parseCardResponse('PRIVATE_TEST_VALUE'); } catch (error) { assert.equal(String(error).includes('PRIVATE_TEST_VALUE'), false); }
});
