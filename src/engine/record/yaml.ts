import { Document, isMap, isScalar, isSeq, type YAMLMap } from 'yaml';
import type { DraftTest } from './convert.js';

/**
 * Write a draft test as YAML that reads well in a pull request: short argument maps on one
 * line ({ field: Industry, value: Banking }), longer ones as blocks, review notes as comments.
 */
export function toYaml(test: DraftTest, header: string[] = []): string {
  const body: Record<string, unknown> = { name: test.name, tags: test.tags };
  if (Object.keys(test.params).length > 0) body.params = test.params;
  body.steps = test.steps.map((step) => {
    const args = shorthand(step.type, step.args);
    return step.name ? { name: step.name, [step.type]: args } : { [step.type]: args };
  });

  const doc = new Document(body);
  if (header.length) doc.commentBefore = header.map((line) => ` ${line}`).join('\n');

  const tags = doc.get('tags', true);
  if (isSeq(tags)) tags.flow = true;

  const steps = doc.get('steps', true);
  if (isSeq(steps)) {
    steps.items.forEach((item, index) => {
      const comment = test.steps[index]?.comment;
      if (comment && isMap(item)) item.commentBefore = ` ${comment}`;
      if (!isMap(item)) return;
      for (const pair of item.items) {
        if (isMap(pair.value) && fitsOnOneLine(pair.value)) pair.value.flow = true;
      }
    });
  }
  return doc.toString({ lineWidth: 0, flowCollectionPadding: true });
}

/** Key order that reads naturally: what, then the value, then where. */
const KEY_ORDER = ['sobject', 'id', 'soql', 'actual', 'expected', 'value', 'contains', 'in', 'exact', 'timeout', 'as'];

function ordered(args: Record<string, unknown>): Record<string, unknown> {
  const rank = (key: string): number => {
    const index = KEY_ORDER.indexOf(key);
    return index < 0 ? -1 : index;
  };
  return Object.fromEntries(Object.entries(args).sort(([a], [b]) => rank(a) - rank(b)));
}

/** Single-argument steps use their shorthand: `- browser.goto: /lightning/...` */
function shorthand(type: string, unordered: Record<string, unknown>): unknown {
  const args = ordered(unordered);
  const keys = Object.keys(args);
  if (type === 'browser.goto' && keys.length === 1 && keys[0] === 'path') return args.path;
  if (type === 'browser.captureRecord' && keys.length === 1 && keys[0] === 'as') return args.as;
  return args;
}

function fitsOnOneLine(map: YAMLMap): boolean {
  let length = 0;
  for (const pair of map.items) {
    if (!isScalar(pair.value)) return false;
    length += String(pair.key).length + String(pair.value.value).length + 4;
  }
  return length <= 90;
}
