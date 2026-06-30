import { load } from 'cheerio';
import type { HtmlSelector } from './parsers/index.js';

function wrapSelection(sel: ReturnType<ReturnType<typeof load>>): {
    text(): string;
    attr(name: string): string | undefined;
    first(): ReturnType<typeof wrapSelection>;
    length: number;
} {
    return {
        text: () => sel.text(),
        attr: (name: string) => sel.attr(name),
        first: () => wrapSelection(sel.first()),
        length: sel.length,
    };
}

export function loadHtmlSelector(html: string): HtmlSelector {
    const $ = load(html);
    return (selector: string) => wrapSelection($(selector));
}
