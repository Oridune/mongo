// deno-lint-ignore-file ban-ts-comment
import e, {
  ObjectValidator,
  type inferInput,
  type inferOutput,
} from "https://deno.land/x/oridune_validator@v0.2.20/mod.ts";

// @ts-ignore
import EsHighlighter from "npm:highlight-es@1.0.3";

export * from "npm:mongodb@6.2.0";
export { plural } from "https://deno.land/x/deno_plural@2.0.0/mod.ts";
export const highligthEs = (content: string): string => EsHighlighter(content);
export { e, ObjectValidator, type inferInput, type inferOutput };
