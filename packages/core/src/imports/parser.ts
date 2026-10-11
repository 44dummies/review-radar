import { Parser, Language, Query } from 'web-tree-sitter';
import type { Lang } from '../types';
import { resolveAsset } from '../assets';

const GRAMMAR: Record<Lang, string> = {
  ts: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  js: 'tree-sitter-javascript.wasm',
  py: 'tree-sitter-python.wasm',
};

const JS_QUERY = `
(import_statement source: (string (string_fragment) @spec))
(export_statement source: (string (string_fragment) @spec))
(call_expression function: (identifier) @fn arguments: (arguments . (string (string_fragment) @spec)))
`;
const PY_QUERY = `
(import_statement name: (dotted_name) @spec)
(import_statement name: (aliased_import name: (dotted_name) @spec))
(import_from_statement module_name: (dotted_name) @spec)
(import_from_statement module_name: (relative_import) @spec)
`;

let init: Promise<void> | undefined;
const loaded = new Map<Lang, Promise<{ parser: Parser; query: Query }>>();

function load(lang: Lang) {
  let p = loaded.get(lang);
  if (!p) {
    p = (async () => {
      init ??= Parser.init({ locateFile: (f: string) => resolveAsset(f) });
      await init;
      const language = await Language.load(resolveAsset(GRAMMAR[lang]));
      const parser = new Parser();
      parser.setLanguage(language);
      return { parser, query: new Query(language, lang === 'py' ? PY_QUERY : JS_QUERY) };
    })();
    loaded.set(lang, p);
  }
  return p;
}

export async function extractSpecifiers(lang: Lang, source: string): Promise<string[]> {
  const { parser, query } = await load(lang);
  const tree = parser.parse(source);
  if (!tree) return [];
  try {
    const out: string[] = [];
    for (const m of query.matches(tree.rootNode)) {
      const fn = m.captures.find((c) => c.name === 'fn');
      if (fn && fn.node.text !== 'require') continue;
      const spec = m.captures.find((c) => c.name === 'spec');
      if (spec) out.push(spec.node.text);
    }
    return out;
  } finally {
    tree.delete();
  }
}
