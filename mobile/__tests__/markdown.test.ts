import { parseInline, parseMarkdown, plainInline } from "../src/lib/markdown";

describe("markdown", () => {
  it("reads inline marks and safe links only", () => {
    expect(parseInline("a **b** *c* `d` ~~e~~")).toEqual([
      { t: "text", v: "a " }, { t: "b", c: [{ t: "text", v: "b" }] }, { t: "text", v: " " }, { t: "i", c: [{ t: "text", v: "c" }] },
      { t: "text", v: " " }, { t: "code", v: "d" }, { t: "text", v: " " }, { t: "s", c: [{ t: "text", v: "e" }] },
    ]);
    expect(parseInline("[site](https://x.fr) [bad](javascript:alert(1))")[0]).toEqual({ t: "link", href: "https://x.fr", c: [{ t: "text", v: "site" }] });
    expect(parseInline("[bad](javascript:alert(1))").some((n) => n.t === "link")).toBe(false);
    expect(parseInline("see https://x.fr/a.")[1]).toEqual({ t: "link", href: "https://x.fr/a", c: [{ t: "text", v: "https://x.fr/a" }] });
    expect(plainInline(parseInline("snake_case_name stays"))).toBe("snake_case_name stays");
  });
  it("reads blocks: headings, lists, tasks, quotes, code, tables, rules", () => {
    const md = "# Title\n\nPara line 1\nline 2\n\n- one\n- [x] two\n  - nested\n\n1. a\n2. b\n\n> quoted\n\n```ts\nconst x = 1;\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n---";
    const blocks = parseMarkdown(md);
    expect(blocks.map((b) => b.t)).toEqual(["h", "p", "list", "list", "quote", "code", "table", "hr"]);
    const ul = blocks[2] as Extract<(typeof blocks)[number], { t: "list" }>;
    expect(ul.items[1].checked).toBe(true);
    expect(ul.items[1].sub[0].t).toBe("list");
    expect((blocks[1] as { c: { v?: string }[] }).c[0].v).toBe("Para line 1\nline 2");
    expect((blocks[5] as { v: string }).v).toBe("const x = 1;");
    expect((blocks[6] as { rows: unknown[] }).rows).toHaveLength(1);
  });
  it("keeps an unterminated code fence as code", () => {
    expect(parseMarkdown("```\nstreaming…")).toEqual([{ t: "code", lang: "", v: "streaming…" }]);
  });
});
