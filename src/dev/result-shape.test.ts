import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { readDeclarations, resultShape, shapeFindings } from "./result-shape.js"

const targets = (text: string) => shapeFindings(text).map((finding) => finding.target)

describe("result-shape", () => {
  it("passes ListResult's shape, with extra facts beside it and a cursor source", () => {
    const text = `
export interface MessagesFound {
    items: FoundMessage[];
    hasMore: boolean;
    /** Skip this many next time. */
    nextOffset?: number;
    total?: Total;
    accounts: string[];
    meaningSkipped?: string;
}
export interface MeetingsPage {
    items: Meeting[];
    hasMore: boolean;
    nextCursor?: string;
}
export interface ChatsService {
    list(window: {
        limit: number;
        offset?: number;
    }): Promise<Page<Chat>>;
    search(query: string): Promise<ListResult<Hit>>;
}`
    expect(shapeFindings(text)).toEqual([])
  })

  it("names each fix for a snake_case page with hits", () => {
    const text = `
export interface EventsFound {
    query: string;
    hits: FoundEvent[];
    has_more: boolean;
    truncated?: true;
    next_offset?: number;
}`
    expect(shapeFindings(text)).toEqual([
      {
        target: "EventsFound",
        message:
          "name the rows `items` (now hits); rename `has_more` to `hasMore`; rename `next_offset` to `nextOffset`: return ListResult<T> from @wirecat/cli-base/standards (WC-OUT-25)",
      },
    ])
  })

  it("finds a page inline in a method's return type, but not in its parameters", () => {
    const text = `
export interface AttachmentsService {
    list(window: {
        limit: number;
        offset?: number;
        has_more: boolean;
        ids: string[];
    }): Promise<{
        items: AttachmentItem[];
        has_more: boolean;
    }>;
}
export declare const attachmentsService: (deps: ServiceDeps) => AttachmentsService;`
    expect(shapeFindings(text)).toEqual([
      {
        target: "AttachmentsService.list",
        message: "rename `has_more` to `hasMore`: return ListResult<T> from @wirecat/cli-base/standards (WC-OUT-25)",
      },
    ])
  })

  it("fails a paged list or search that returns a bare array, and passes one that returns everything", () => {
    const text = `
export interface DealsService {
    list(options: { limit?: number }): Promise<Deal[]>;
    searchDeals: (query: string, limit: number) => readonly Deal[];
    searchIndexHealth(store: Store): IndexHealth[];
    folders(): Promise<Folder[]>;
    listAccounts(): Account[];
    listing(limit: number): Deal[];
}
export declare function searchMemories(query: string, options: { offset: number }): Promise<Array<Memory>>;
export declare const listBusinesses: (store: Store, window: { offset: number }) => Promise<Business[]>;`
    expect(targets(text)).toEqual(["DealsService.list", "DealsService.searchDeals", "searchMemories", "listBusinesses"])
  })

  it("counts a limit inside a named options type, a page number and limit_reached", () => {
    const deals = "export interface DealSearch {\n    words: string[];\n    limit?: number;\n}\n"
    const text = `
export interface DealsStore {
    find: (search: DealSearch) => Promise<FoundDeal[]>;
    searchMemories(query: string): Promise<{
        items: Memory[];
        limit_reached: boolean;
    }>;
}
export declare const meetingsList: (store: MeetingStore, filter?: MeetingFilter, page?: number) => Promise<MeetingList>;`
    const pagingTypes = new Set<string>()
    expect(shapeFindings(deals, pagingTypes)).toEqual([])
    expect(shapeFindings(text, pagingTypes)).toEqual([
      {
        target: "DealsStore.find",
        message: "returns a bare array: return ListResult<T> from @wirecat/cli-base/standards (WC-OUT-25)",
      },
      {
        target: "DealsStore.searchMemories",
        message:
          "rename `limit_reached` to `hasMore`: return ListResult<T> from @wirecat/cli-base/standards (WC-OUT-25)",
      },
      {
        target: "meetingsList",
        message:
          "takes a page number; take `offset` and `limit`: return ListResult<T> from @wirecat/cli-base/standards (WC-OUT-25)",
      },
    ])
  })

  it("reads type aliases, nested results and one-line literals, and ignores strings and comments", () => {
    const text = `
import { type Note, Other } from "./notes.js";
export type NotesFound<T = Note> = { hits: T[]; has_more: boolean; label: "{ rows: X[]; has_more: boolean }" };
// export interface OldFound { hits: X[]; has_more: boolean }
export type ChatsPage = { rows: Row[]; hasMore: boolean } | Row[];`
    expect(targets(text)).toEqual(["NotesFound", "ChatsPage"])
  })

  it("checks only what is named like a page, and trusts what an interface inherits", () => {
    const text = `
export interface MailStats {
    rows: StatRow[];
    hasMore: boolean;
}
export interface Answer {
    context: { facts: Fact[]; has_more: boolean };
}
export interface SearchFound extends Page<FoundMessage> {
    nextOffset?: number;
    corrections: Correction[];
}
export interface CrmIdPage<T extends { id: string }> {
    ids: string[];
    nextPage?: string;
}`
    expect(shapeFindings(text)).toEqual([
      {
        target: "CrmIdPage",
        message:
          "name the rows `items` (now ids); rename `nextPage` to `nextCursor`; add `hasMore`: return ListResult<T> from @wirecat/cli-base/standards (WC-OUT-25)",
      },
    ])
  })

  it("leaves an envelope without a paging key alone", () => {
    expect(targets("export interface ListEnvelope<T> {\n    items: T[];\n    page: Page;\n    meta: Meta;\n}")).toEqual(
      [],
    )
  })

  it("reads the declarations a package publishes, through their relative imports, and names a missing one", () => {
    const root = mkdtempSync(join(tmpdir(), "result-shape-"))
    mkdirSync(join(root, "dist/services"), { recursive: true })
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        exports: {
          ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
          "./services": { types: "./dist/services/index.d.ts" },
          "./gone": { types: "./dist/gone.d.ts" },
          "./wild/*": { types: "./dist/wild/*.d.ts" },
        },
      }),
    )
    writeFileSync(join(root, "dist/index.d.ts"), 'export * from "./services/index.js";\n')
    writeFileSync(join(root, "dist/services/index.d.ts"), 'export { type Tasks } from "./tasks.js";\n')
    writeFileSync(
      join(root, "dist/services/tasks.d.ts"),
      "export interface Tasks {\n    search(query: string): Promise<{\n        items: Task[];\n        has_more: boolean;\n    }>;\n}\n",
    )
    writeFileSync(join(root, "dist/unreached.d.ts"), "export interface Lost { hits: X[]; has_more: boolean }\n")

    const declarations = readDeclarations(root)

    expect(declarations.files.map((file) => file.path)).toEqual([
      "dist/index.d.ts",
      "dist/services/index.d.ts",
      "dist/services/tasks.d.ts",
    ])
    expect(resultShape(declarations).map((finding) => finding.target)).toEqual([
      "./dist/gone.d.ts: not built",
      "dist/services/tasks.d.ts: Tasks.search",
    ])
  })

  it("finds nothing when none of the published types is built", () => {
    expect(resultShape({ files: [], missing: ["./dist/index.d.ts"] })).toEqual([])
  })

  it("reads nothing from a package that publishes no types", () => {
    const root = mkdtempSync(join(tmpdir(), "result-shape-"))
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "tool", bin: { tool: "dist/bin/tool.js" } }))
    expect(readDeclarations(root)).toEqual({ files: [], missing: [] })
  })
})
