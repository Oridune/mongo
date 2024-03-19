// deno-lint-ignore-file ban-ts-comment
// @ts-ignore
import EsHighlighter from "npm:highlight-es@1.0.3";

export const highligthEs = (content: string): string => EsHighlighter(content);

export * from "npm:mongodb@6.3.0";
