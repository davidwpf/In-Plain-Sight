import test from 'node:test';
import assert from 'node:assert/strict';
import {roleLabel,roleWording} from '../lib/game/presentation.mjs';
test('saved role identifiers and the current name both display as Killer',()=>{
  assert.equal(roleLabel('traitor'),'Killer');assert.equal(roleLabel('killer'),'Killer');assert.equal(roleLabel('faithful'),'Innocent');
});
test('recorded scoring explanations use Killer wording without changing saved history',()=>{
  const saved=Object.freeze({role:'traitor',reason:'Completed the task on another traitor (−2) · No traitor caught (+2)',delta:4});
  assert.equal(roleWording(saved.reason),'Completed the task on another killer (−2) · No killer caught (+2)');
  assert.equal(saved.role,'traitor');assert.equal(saved.reason,'Completed the task on another traitor (−2) · No traitor caught (+2)');assert.equal(saved.delta,4);
});
test('headings, plurals and unchanged scoring text retain their case and values',()=>{
  assert.equal(roleWording('TRAITORS · Traitor scoring · two traitors'),'KILLERS · Killer scoring · two killers');
  assert.equal(roleWording('Faithful correctly identifies a killer (+4)'),'Innocent correctly identifies a killer (+4)');
  assert.equal(roleWording(null),'');
});

test('Innocent labels and articles work for saved results without rewriting names',()=>{
  assert.equal(roleLabel('innocent'),'Innocent');
  assert.equal(roleWording('Accused a faithful (−1) · Most accusations (−1)'), 'Accused an innocent (−1) · Most accusations (−1)');
  assert.equal(roleWording('No faithful votes; no bonus'), 'No innocent votes; no bonus');
  assert.equal(roleWording('FAITHFUL · Faithful scoring'), 'INNOCENT · Innocent scoring');
});
