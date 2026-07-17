import { describe, expect, it } from 'vitest'
import { parseImports, toJsonl, validateSpan } from './shared'
describe('dataset helpers', () => {
  it('rejects invalid and overlapping spans', () => { expect(validateSpan('hello', {start: 2, end: 2})).toBeTruthy(); expect(validateSpan('hello', {start: 1, end: 4}, [{start: 0,end:2}])).toBeTruthy() })
  it('creates portable JSONL records', () => { const output = toJsonl([{id:'d',text:'Ada',source:'x',status:'reviewed',createdAt:'',entities:[{id:'e',documentId:'d',start:0,end:3,labelId:'p'}]}], [{id:'p',name:'PERSON',color:'#000'}]); expect(JSON.parse(output).entities[0]).toEqual({start:0,end:3,label:'PERSON'}) })
  it('normalizes JSONL imports', () => { expect(parseImports('set.jsonl', '{"text":" A "}\n')).toEqual(['A']) })
})
