import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewSave, validateSave, serializeSave, importSave as parseSave, commitSynthesis } from '../src/core/model.js';
import { buildSynthesisMessages, validateCardResult } from '../src/ai/protocol.js';
import { DEFAULT_SYNTHESIS_PROMPT, SYNTHESIS_OUTPUT_RULES, SYNTHESIS_PROMPT_LIMIT, getSynthesisPrompt } from '../src/ai/prompt.js';

const fresh = () => createNewSave({ id: 'save:prompt', now: '2026-11-11T00:00:00.000Z' });
const custom = '  用童话风格创作。\n\t简介像一句短诗。\r\n';

test('新档与缺少提示词的旧档使用默认，导入导出保留自定义原文和恢复默认标记', () => {
  const save = fresh();
  assert.equal(save.preferences.synthesisPrompt, '');
  delete save.preferences.synthesisPrompt;
  assert.equal(validateSave(save).preferences.synthesisPrompt, '');
  assert.equal(getSynthesisPrompt(validateSave(save).preferences.synthesisPrompt), DEFAULT_SYNTHESIS_PROMPT);
  save.preferences.synthesisPrompt = custom;
  assert.equal(parseSave(serializeSave(save)).preferences.synthesisPrompt, custom);
  save.preferences.synthesisPrompt = '';
  assert.equal(parseSave(serializeSave(save)).preferences.synthesisPrompt, '');
});

test('提示词限长按UTF-16计数，换行与制表保留，非法类型及控制符拒绝导入和请求', () => {
  const save = fresh();
  save.preferences.synthesisPrompt = '🌟'.repeat(SYNTHESIS_PROMPT_LIMIT / 2);
  assert.equal(validateSave(save).preferences.synthesisPrompt.length, SYNTHESIS_PROMPT_LIMIT);
  for (const value of [null, 42, {}, [], save.preferences.synthesisPrompt + 'x', '坏\0提示', '坏\v提示', '坏\u0085提示', '坏\u202e提示', '坏\u2067提示']) {
    save.preferences.synthesisPrompt = value;
    assert.throws(() => validateSave(save), { code: 'INVALID_SAVE', field: 'preferences.synthesisPrompt' });
    assert.throws(() => buildSynthesisMessages(save.cards.slice(0, 2), [], value), { code: 'INVALID_SAVE', field: 'preferences.synthesisPrompt' });
  }
});

test('自定义提示替换创作指导，固定协议仍追加，材料和重复数量保持原协议', () => {
  const save = fresh(), cards = [save.cards[2], save.cards[2], save.cards[3]];
  const messages = buildSynthesisMessages(cards, ['童话森林'], custom);
  assert.equal(messages[0].content, `${custom}\n\n${SYNTHESIS_OUTPUT_RULES}`);
  assert.equal(messages[0].content.includes(DEFAULT_SYNTHESIS_PROMPT), false);
  assert.equal(buildSynthesisMessages(cards)[0].content, `${DEFAULT_SYNTHESIS_PROMPT}\n\n${SYNTHESIS_OUTPUT_RULES}`);
  const input = JSON.parse(messages[1].content);
  assert.deepEqual(input.materials, cards.map(validateCardResult));
  assert.deepEqual(input.materials[0], input.materials[1]);
  assert.deepEqual(input.worldThemes, ['童话森林']);
  assert.deepEqual(Object.keys(input.materials[0]), ['name', 'emoji', 'category', 'description']);
});

test('默认创作长度指导不会收紧既有卡牌或存档的硬限制', () => {
  const save = fresh(), result = { name: '长'.repeat(32), emoji: '🌟', category: '自然', description: '长'.repeat(240) };
  const next = commitSynthesis(save, { operationId: 'long:existing', ingredientIds: ['base:fire', 'base:water'], result, now: save.createdAt }).save;
  assert.deepEqual(validateCardResult(result), result);
  assert.equal(parseSave(serializeSave(next)).cards.at(-1).description.length, 240);
});
