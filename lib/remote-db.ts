// A stand-in for the Supabase browser client when the Accounts portal is
// showing another institution (Grace Valley, PMSA). It supports the subset of
// the query builder the Accounts pages use — select / insert / update / delete
// with eq / gte / lte filters and order — and sends each query to
// app/api/admin/sites/[site]/route.ts, which runs it on that institution's own
// database with its server-only key, after checking the caller is a
// super-admin. Pages use it exactly like `supabase.from(...)`.

export type RemoteQuery = {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  columns?: string;
  payload?: unknown;
  filters?: { op: "eq" | "gte" | "lte"; column: string; value: unknown }[];
  order?: { column: string; ascending?: boolean }[];
};

type Result<T = unknown> = { data: T | null; error: { message: string } | null };

class RemoteQueryBuilder implements PromiseLike<Result> {
  constructor(private site: string, private q: RemoteQuery) {}

  private with(patch: Partial<RemoteQuery>) {
    return new RemoteQueryBuilder(this.site, { ...this.q, ...patch });
  }
  private filter(op: "eq" | "gte" | "lte", column: string, value: unknown) {
    return this.with({ filters: [...(this.q.filters ?? []), { op, column, value }] });
  }

  select(columns = "*") { return this.with({ op: "select", columns }); }
  insert(payload: unknown) { return this.with({ op: "insert", payload }); }
  update(payload: unknown) { return this.with({ op: "update", payload }); }
  delete() { return this.with({ op: "delete" }); }
  eq(column: string, value: unknown) { return this.filter("eq", column, value); }
  gte(column: string, value: unknown) { return this.filter("gte", column, value); }
  lte(column: string, value: unknown) { return this.filter("lte", column, value); }
  order(column: string, opts?: { ascending?: boolean }) {
    return this.with({ order: [...(this.q.order ?? []), { column, ascending: opts?.ascending ?? true }] });
  }

  private async run(): Promise<Result> {
    try {
      const res = await fetch(`/api/admin/sites/${this.site}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.q),
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { data: null, error: { message: body.error || `Request failed (${res.status})` } };
      return { data: body.data, error: null };
    } catch {
      return { data: null, error: { message: "Could not reach the server" } };
    }
  }

  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null
  ): PromiseLike<A | B> {
    return this.run().then(onfulfilled, onrejected);
  }
}

export function createRemoteClient(site: string) {
  return {
    from: (table: string) => new RemoteQueryBuilder(site, { table, op: "select", columns: "*" }),
  };
}
