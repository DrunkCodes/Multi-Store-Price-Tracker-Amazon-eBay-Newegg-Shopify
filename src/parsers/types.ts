import type { Platform, ProductSource } from '../types.js';

export interface CheerioSelection {
    text(): string;
    attr(name: string): string | undefined;
    first(): CheerioSelection;
    length: number;
}

export type HtmlSelector = (selector: string) => CheerioSelection;

export interface ParseContext {
    url: string;
    platform: Platform;
    html: string;
    $: HtmlSelector;
    source?: ProductSource;
    searchKeyword?: string | null;
}
