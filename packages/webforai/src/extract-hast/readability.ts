import type { Element, Nodes as Hast } from "hast";
import { select, selectAll } from "hast-util-select";
import { toString as hastToString } from "hast-util-to-string";
import { filter } from "unist-util-filter";
import { classnames, hasAncestors, isStrInclude, matchString } from "./utils";

const UNLIKELY_ROLES = ["menu", "menubar", "complementary", "navigation", "alert", "alertdialog", "dialog"];

const REGEXPS = {
	hidden: /hidden|invisible|fallback-image/i,
	byline: /byline|author|dateline|writtenby|p-author/i,
	specialUnlikelyCandidates: /frb-|uls-menu|language-link/i,
	unlikelyCandidates:
		/-ad-|ai2html|banner|breadcrumbs|combx|comment|community|cover-wrap|disqus|extra|footer|gdpr|header|legends|menu|related|remark|replies|rss|shoutbox|sidebar|skyscraper|social|sponsor|supplemental|ad-break|agegate|pagination|pager|popup|yom-remote|speechify-ignore/i,
	okMaybeItsaCandidate: /and|article|body|column|content|main|shadow|code/i,
};

const BODY_SELECTORS = ["article", "#article", ".article_body", ".article-body", "#content", ".entry", "main"];

const PARAGRAPH_TAGS = ["p", "div", "section", "article", "main", "ul", "ol", "li"];

const BASE_MINIMAL_LENGTH = {
	ja: 200,
	en: 500,
};

const tryGetLang = (node: Hast) => {
	if (node.type !== "element") {
		return;
	}
	const element = node as Element;
	if (element.tagName !== "html") {
		return;
	}

	const langAttr = element.properties.lang || element.properties["xml:lang"];
	if (langAttr) {
		return langAttr as string;
	}
};

const metadataFilter = (node: Hast) => !["comment", "doctype"].includes(node.type);

const universalElementFilter = (node: Hast) => {
	if (node.type !== "element") {
		return true;
	}
	const element = node as Element;

	// Remove blacklisted elements
	if (["script", "aside"].includes(element.tagName)) {
		return false;
	}

	// Remove elements with hidden properties
	if (["hidden", "aria-hidden"].some((key) => element.properties[key])) {
		return false;
	}
	if (classnames(element).some((classname) => REGEXPS.hidden.test(classname))) {
		return false;
	}

	// Remove dialog elements
	if (element.tagName === "dialog") {
		return false;
	}
	if (element.properties.role === "dialog" && element.properties["aria-modal"]) {
		return false;
	}

	// Remove byline elements
	if (element.properties.rel === "author" && isStrInclude(element.properties.itemprop, "author")) {
		return false;
	}
	if (REGEXPS.byline.test(matchString(element))) {
		return false;
	}

	// Remove unlikely roles
	if (element.properties.role && UNLIKELY_ROLES.includes(element.properties.role as string)) {
		return false;
	}

	return true;
};

const unlikelyElementFilter = (node: Hast) => {
	if (node.type !== "element") {
		return true;
	}
	const element = node as Element;

	// Skip main content elements
	if (["body", "article", "main", "section", "a"].includes(element.tagName)) {
		return true;
	}
	if (hasAncestors(element, ["table", "code"], 3)) {
		return true;
	}
	const match = matchString(element);

	if (REGEXPS.specialUnlikelyCandidates.test(match)) {
		return false;
	}

	// Remove unlikely candidates
	if (REGEXPS.unlikelyCandidates.test(match) && !REGEXPS.okMaybeItsaCandidate.test(match)) {
		return false;
	}

	return true;
};

const isImageLink = (element: Element) => {
	const a = select("a", element);
	const img = select("img", a);

	if (!(a && img)) {
		return false;
	}

	const imgFilename = img.properties.src?.toString().split("/").pop();
	const hrefFilename = a.properties.href?.toString().split("/").pop();

	return imgFilename === hrefFilename && imgFilename;
};

const removeEmptyFilter = (node: Hast) => {
	if (node.type !== "element") {
		return true;
	}
	const element = node as Element;

	if (!PARAGRAPH_TAGS.includes(element.tagName)) {
		return true;
	}

	if (isImageLink(element)) {
		return true;
	}

	const text = hastToString(element);
	if (text.length < 10) {
		return false;
	}

	return true;
};

export const readabilityExtractHast = (hast: Hast): Hast => {
	const lang = String(select("html", hast)?.properties.lang || tryGetLang(hast) || "en");
	const body = select("body", hast) ?? hast;
	const bodyText = hastToString(body);

	const baseFilterd = filter(body, (node) => {
		if (!metadataFilter(node as Hast)) {
			return false;
		}
		if (!universalElementFilter(node as Hast)) {
			return false;
		}
		return true;
	});

	if (!baseFilterd) {
		return { type: "root", children: [] };
	}

	const baseFilterdText = hastToString(baseFilterd);
	let [baseTree, baseText] =
		baseFilterdText.length > bodyText.length / 3 || baseFilterdText.length > 5000
			? ([baseFilterd as Hast, baseFilterdText] as const)
			: ([body as Hast, bodyText] as const);

	let minimalLength = lang in BASE_MINIMAL_LENGTH ? BASE_MINIMAL_LENGTH[lang as keyof typeof BASE_MINIMAL_LENGTH] : 500;
	if (baseText.length < minimalLength) {
		minimalLength = Math.max(0, baseText.length - 200);
	}

	for (const selector of BODY_SELECTORS) {
		const content = { type: "root" as const, children: selectAll(selector, baseFilterd) };
		const contentText = hastToString(content);

		if (contentText.length < 25) {
			continue;
		}

		const links = selectAll("a", content);
		const linkText = links.map((link) => hastToString(link)).join("");

		const linkDensity = linkText.length / bodyText.length;
		if (linkDensity > 0.4) {
			continue;
		}

		if (contentText.length > minimalLength) {
			baseTree = content;
			baseText = contentText;
			break;
		}
	}

	const finalFilteredTree = filter(baseTree, (node) => {
		if (!removeEmptyFilter(node as Hast)) {
			return false;
		}
		if (!unlikelyElementFilter(node as Hast)) {
			return false;
		}

		return true;
	}) as Hast;

	const finalTree = hastToString(finalFilteredTree).length > baseText.length / 3 ? finalFilteredTree : baseTree;
	return finalTree;
};
