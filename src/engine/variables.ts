import { resolveRelativeDate } from './dates.js';

/**
 * Variable store and $reference resolution.
 *
 * - "$acme.Id" as a whole value resolves to the raw value (keeps numbers, objects, etc.)
 * - "WHERE Id = '$opp.Id'" interpolates the value into the string
 * - "$$" is a literal "$"
 * - Paths support dots and indexes: $result.records[0].Account.Name, or $result.records.0.Account.Name
 * - The dot form (.0) also works unquoted inside YAML flow mappings like { actual: ... }, where [ ] are reserved)
 * - A whole string like "+30d" or "today" becomes a YYYY-MM-DD date
 *
 * An unknown variable name is an error (catches typos). A missing path on a known
 * variable resolves to undefined, so assertions can report it clearly.
 */

const REFERENCE = /\$\$|\$([A-Za-z_]\w*)((?:\.[A-Za-z_]\w*|\.\d+|\[\d+\])*)/g;

export class VariableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'VariableError';
  }
}

export class Variables {
  private readonly values = new Map<string, unknown>();

  public constructor(private readonly now: () => Date = () => new Date()) {}

  public set(name: string, value: unknown): void {
    this.values.set(name, value);
  }

  public has(name: string): boolean {
    return this.values.has(name);
  }

  public get(name: string): unknown {
    return this.values.get(name);
  }

  public names(): string[] {
    return [...this.values.keys()];
  }

  /** Resolve every $reference and relative date inside a value (deeply). */
  public resolve(value: unknown): unknown {
    if (typeof value === 'string') return this.resolveString(value);
    if (Array.isArray(value)) return value.map((item) => this.resolve(item));
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.resolve(item)]));
    }
    return value;
  }

  public resolveString(text: string): unknown {
    const date = resolveRelativeDate(text, this.now());
    if (date !== undefined) return date;

    const matches = [...text.matchAll(REFERENCE)];
    if (matches.length === 0) return text;

    // Whole value is a single reference: return the raw value, not a string.
    if (matches.length === 1 && matches[0][0] === text && text !== '$$') {
      return this.lookup(matches[0][1], matches[0][2]);
    }

    return text.replace(REFERENCE, (match: string, name: string | undefined, path: string) => {
      if (match === '$$') return '$';
      const value = this.lookup(name as string, path);
      if (value === undefined || value === null) {
        throw new VariableError(`${match} has no value (used inside "${text}")`);
      }
      return typeof value === 'object' ? JSON.stringify(value) : (value as number).toString();
    });
  }

  private lookup(name: string, path: string): unknown {
    if (!this.values.has(name)) {
      const known = this.names();
      throw new VariableError(
        `Unknown variable $${name}. ${
          known.length ? `Defined so far: ${known.map((n) => '$' + n).join(', ')}` : 'No variables are defined yet.'
        }`
      );
    }
    return readPath(this.values.get(name), parsePath(path));
  }
}

function parsePath(path: string): Array<string | number> {
  const segments: Array<string | number> = [];
  for (const match of path.matchAll(/\.([A-Za-z_]\w*)|\.(\d+)|\[(\d+)\]/g)) {
    segments.push(match[1] ?? Number(match[2] ?? match[3]));
  }
  return segments;
}

/** Walk a path. Object keys fall back to a case-insensitive match, since Salesforce API names are case-insensitive. */
function readPath(root: unknown, segments: Array<string | number>): unknown {
  let current = root;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof segment === 'number') {
      current = Array.isArray(current) ? (current[segment] as unknown) : undefined;
      continue;
    }
    if (typeof current !== 'object') return undefined;
    const record = current as Record<string, unknown>;
    if (segment in record) {
      current = record[segment];
    } else {
      const key = Object.keys(record).find((k) => k.toLowerCase() === segment.toLowerCase());
      current = key === undefined ? undefined : record[key];
    }
  }
  return current;
}
