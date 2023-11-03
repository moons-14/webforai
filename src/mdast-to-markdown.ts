import type { Nodes as Mdast, RootContent } from "mdast";

import { gfmToMarkdown } from "mdast-util-gfm";
import { mathToMarkdown } from "mdast-util-math";
import { toMarkdown } from "mdast-util-to-markdown";

import { linkReplacer } from "./link-replacer";
import { warpRoot } from "./utils/mdast-utils";

export const mdastToMarkdown = (mdast: Mdast | RootContent[], options?: { solveLinks?: string }): string => {
	let markdown = toMarkdown(warpRoot(mdast), {
		extensions: [gfmToMarkdown(), mathToMarkdown()],
	});

	if (options?.solveLinks) markdown = linkReplacer(markdown, options.solveLinks);

	return markdown;
};
