import english from './english.ts';
export type Locale = 'zh-CN' | 'en';
export const SOURCE_LOCALE: Locale = 'zh-CN';
export const LOCALES: readonly Locale[] = ['zh-CN', 'en'];
export const LOCALE_STORAGE_KEY = 'workshop.language';
/** Each language named in itself, for language switches. */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = { 'zh-CN': '中文', en: 'English' }; // i18n-ignore
/** Separates a tc() context from its source text inside a catalog key (gettext's EOT). */
export const CONTEXT_SEPARATOR = '\u0004';

/** Function values receive the interpolated values in source order (td(): the captured strings). */
export type CatalogFunction = (...values: never[]) => string;
export type CatalogValue = string | CatalogFunction;
export type Catalog = Readonly<Record<string, CatalogValue>>;

type Callable = (...values: unknown[]) => string;
type Pattern = { key: string; regex: RegExp; slots: number[]; weight: number };

let locale: Locale = SOURCE_LOCALE;
const catalogs = new Map<Locale, Map<string, CatalogValue>>();
let active: Map<string, CatalogValue> | undefined;
// Built on the first td() miss after a catalog change: [buckets by first character, keys starting with a placeholder].
let patterns: { buckets: Map<string, Pattern[]>; open: Pattern[] } | null = null;
const dynamicCache = new Map<string, string>();
const missing = new Set<string>();
const templateKeys = new WeakMap<TemplateStringsArray, string>();
const PLACEHOLDER = /\{(\d+)\}/g;

export function isLocale(value: unknown): value is Locale {
  return value === 'zh-CN' || value === 'en';
}
/** Any zh* tag is Chinese; every other non-empty tag is English (the only other language so far). */
export function normalizeLocale(value: unknown): Locale | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim().toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}
/** Resolution order: ?lang= → saved preference → browser language. index.html repeats this inline. */
export function resolveLocale(input: { query?: string | null; stored?: string | null; language?: string | null }): Locale {
  return normalizeLocale(input.query) ?? (isLocale(input.stored) ? input.stored : null) ?? normalizeLocale(input.language) ?? 'en';
}

export function getLocale(): Locale { return locale; }

/** Sets this realm's locale without persisting or reloading. Browser code reaches it only
 * through initI18n(); Node code (tests, server) may call it directly. */
export function applyLocale(next: Locale): void {
  locale = isLocale(next) ? next : SOURCE_LOCALE;
  active = catalogs.get(locale);
  invalidate();
}

/** Adds entries to a locale's table (several area files may install into one locale; later wins). */
export function installCatalog(target: Locale, entries: Catalog): void {
  let table = catalogs.get(target);
  if (!table) { table = new Map(); catalogs.set(target, table); }
  for (const key of Object.keys(entries)) table.set(key, entries[key]);
  if (target === locale) active = table;
  invalidate();
}

/** Tests only: forget every catalog and return to the source locale. */
export function resetI18n(): void {
  catalogs.clear(); missing.clear(); locale = SOURCE_LOCALE; active = undefined; invalidate();
}

/** Keys t/tc looked up this session without finding a translation (debugging aid, capped). */
export function missingKeys(): string[] { return [...missing]; }

function invalidate() { patterns = null; dynamicCache.clear(); }

function keyOf(strings: TemplateStringsArray): string {
  let key = templateKeys.get(strings);
  if (key === undefined) {
    key = (strings[0] ?? strings.raw[0]);
    for (let index = 1; index < strings.length; index++) key += `{${index - 1}}` + (strings[index] ?? strings.raw[index]);
    templateKeys.set(strings, key);
  }
  return key;
}
function source(strings: TemplateStringsArray, values: readonly unknown[]): string {
  let text = strings[0] ?? strings.raw[0];
  for (let index = 1; index < strings.length; index++) text += String(values[index - 1]) + (strings[index] ?? strings.raw[index]);
  return text;
}
function render(value: CatalogValue, values: readonly unknown[]): string {
  if (typeof value === 'function') return (value as unknown as Callable)(...values);
  return value.replace(PLACEHOLDER, (match, index: string) => Number(index) < values.length ? String(values[Number(index)]) : match);
}
function note(key: string) { if (missing.size < 500) missing.add(key); }
function lookup(key: string, strings: TemplateStringsArray, values: readonly unknown[]): string {
  if (!active) return source(strings, values);
  const value = active.get(key);
  // An empty value is an unfilled stub (pnpm i18n:extract prints them): fall back like a missing one.
  if (value === undefined || value === '') { if (locale !== SOURCE_LOCALE) note(key); return source(strings, values); }
  return render(value, values);
}

/** Tagged template for literal UI text: t`我的家`, t`还需 ${n} 湖币`. */
export function t(strings: TemplateStringsArray, ...values: unknown[]): string {
  return lookup(keyOf(strings), strings, values);
}
/** The same Chinese meaning different things: tc('音乐')`开` → "On", tc('门')`开` → "Open". */
export function tc(context: string): (strings: TemplateStringsArray, ...values: unknown[]) => string {
  return (strings, ...values) => lookup(context + CONTEXT_SEPARATOR + keyOf(strings), strings, values);
}

function compile(key: string): Pattern | null {
  const slots: number[] = [];
  let regex = '^', last = 0, weight = 0;
  for (const match of key.matchAll(PLACEHOLDER)) {
    const literal = key.slice(last, match.index!);
    regex += literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(.+?)';
    weight += literal.length; slots.push(Number(match[1])); last = match.index! + match[0].length;
  }
  const tail = key.slice(last);
  weight += tail.length;
  // A key made only of placeholders would match any text.
  if (!slots.length || weight === 0) return null;
  return { key, regex: new RegExp(regex + tail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 's'), slots, weight };
}
function patternTable() {
  if (patterns) return patterns;
  const buckets = new Map<string, Pattern[]>(), open: Pattern[] = [];
  for (const [key, value] of active ?? []) {
    if (value === '') continue;
    // A context key matches only td(text, context); its pattern is compiled from the text part.
    const separator = key.indexOf(CONTEXT_SEPARATOR);
    const text = separator < 0 ? key : key.slice(separator + 1);
    if (!text.includes('{')) continue;
    const pattern = compile(text);
    if (!pattern) continue;
    pattern.key = key;
    const first = text[0] === '{' && /^\{\d+\}/.test(text) ? '' : text[0];
    if (!first) open.push(pattern);
    else { const list = buckets.get(first) ?? []; list.push(pattern); buckets.set(first, list); }
  }
  // More fixed text first: "还需 {0} 湖币" wins over "还需 {0}".
  for (const list of buckets.values()) list.sort((a, b) => b.weight - a.weight);
  open.sort((a, b) => b.weight - a.weight);
  return patterns = { buckets, open };
}
function dynamic(text: string, context: string | undefined, depth: number): string {
  const prefix = context ? context + CONTEXT_SEPARATOR : '';
  const exact = active!.get(prefix + text);
  if (exact !== undefined && exact !== '') return render(exact, []);
  const trimmed = text.trim();
  if (trimmed !== text && trimmed) {
    const inner = dynamic(trimmed, context, depth);
    if (inner !== trimmed) { const start = text.indexOf(trimmed); return text.slice(0, start) + inner + text.slice(start + trimmed.length); }
    return text;
  }
  if (depth > 2 || text.length > 2000 || !text) return text;
  const table = patternTable();
  for (const list of [table.buckets.get(text[0]), table.open]) {
    for (const pattern of list ?? []) {
      if (!pattern.key.startsWith(prefix) || (!prefix && pattern.key.includes(CONTEXT_SEPARATOR))) continue;
      const match = pattern.regex.exec(text);
      if (!match) continue;
      const values: string[] = [];
      // Captured pieces are usually names (a hall, an item): translate them too, exactly or by pattern.
      pattern.slots.forEach((slot, index) => { values[slot] = dynamic(match[index + 1], undefined, depth + 1); });
      return render(active!.get(pattern.key)!, values);
    }
  }
  return text;
}
/** Runtime text (JSON names, server messages): exact lookup, then placeholder keys as patterns. */
export function td(text: string, context?: string): string {
  if (text === null || text === undefined) return '';
  const value = typeof text === 'string' ? text : String(text);
  if (!active || !value) return value;
  const cacheKey = (context ?? '') + CONTEXT_SEPARATOR + value;
  const cached = dynamicCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const result = dynamic(value, context, 0);
  if (dynamicCache.size > 5000) dynamicCache.clear();
  dynamicCache.set(cacheKey, result);
  return result;
}

const formatters = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat | Intl.ListFormat | Intl.PluralRules>();
export function intlLocale(): string { return locale; }
function cached<T extends Intl.NumberFormat | Intl.DateTimeFormat | Intl.ListFormat | Intl.PluralRules>(kind: string, options: object | undefined, create: (tag: string) => T): T {
  const id = kind + '|' + locale + '|' + (options ? JSON.stringify(options) : '');
  let formatter = formatters.get(id) as T | undefined;
  if (!formatter) { formatter = create(intlLocale()); formatters.set(id, formatter); }
  return formatter;
}
export function formatNumber(value: number | bigint, options?: Intl.NumberFormatOptions): string {
  return cached('number', options, tag => new Intl.NumberFormat(tag, options)).format(value);
}
export function formatDate(value: Date | number | string, options?: Intl.DateTimeFormatOptions): string {
  return cached('date', options, tag => new Intl.DateTimeFormat(tag, options)).format(typeof value === 'string' ? new Date(value) : value);
}
export function formatList(items: Iterable<string>, options?: Intl.ListFormatOptions): string {
  return cached('list', options, tag => new Intl.ListFormat(tag, options)).format(items);
}
/** A reusable date formatter whose locale is read at format time. */
export function dateFormatter(options?: Intl.DateTimeFormatOptions): { format(value: Date | number | string): string } {
  return { format: value => formatDate(value, options) };
}
/** Plural forms for catalog function values; "#" is replaced with the count as given.
 *   '{0} 件': n => plural(n, { one: '# item', other: '# items' })
 * Counts may arrive as strings ("1,234" from td() captures or pre-formatted numbers). */
export function plural(count: number | bigint | string, forms: { one: string; other: string; zero?: string }): string {
  const number = typeof count === 'string' ? Number(count.replace(/[,\s]/g, '')) : Number(count);
  const form = number === 0 && forms.zero !== undefined ? forms.zero
    : cached('plural', undefined, tag => new Intl.PluralRules(tag)).select(Number.isFinite(number) ? number : 0) === 'one' ? forms.one : forms.other;
  return form.replaceAll('#', String(count));
}

installCatalog('en', english);
if (typeof document !== 'undefined') applyLocale(document.documentElement.lang.startsWith('zh') ? 'zh-CN' : 'en');
