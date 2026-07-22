import { describe, expect, it } from 'vitest'
import { entityContextMenuItems, parseImports, toJsonl, validateSpan } from './shared'
describe('dataset helpers', () => {
  it('rejects invalid and overlapping spans', () => { expect(validateSpan('hello', {start: 2, end: 2})).toBeTruthy(); expect(validateSpan('hello', {start: 1, end: 4}, [{start: 0,end:2}])).toBeTruthy() })
  it('creates portable JSONL records', () => { const output = toJsonl([{id:'d',text:'Ada',source:'x',status:'reviewed',createdAt:'',entities:[{id:'e',documentId:'d',start:0,end:3,labelId:'p'}]}], [{id:'p',name:'PERSON',color:'#000'}]); expect(JSON.parse(output).entities[0]).toEqual({start:0,end:3,label:'PERSON'}) })
  it('normalizes JSONL imports', () => { expect(parseImports('set.jsonl', '{"text":" A "}\n')).toEqual(['A']) })
  it('lists deletion before every replacement label in an entity context menu', () => {
    expect(entityContextMenuItems([{ id: 'person', name: 'PERSON', color: '#000' }, { id: 'org', name: 'ORG', color: '#111' }])).toEqual([
      { action: 'delete', hotkey: '0', labelId: undefined, name: 'Delete' },
      { action: 'label', hotkey: '1', labelId: 'person', name: 'PERSON' },
      { action: 'label', hotkey: '2', labelId: 'org', name: 'ORG' },
    ])
  })
})
