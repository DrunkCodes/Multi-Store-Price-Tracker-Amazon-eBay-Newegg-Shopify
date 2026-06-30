import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadHtmlSelector } from '../src/htmlUtils.js';
import { parseProduct } from '../src/parsers/index.js';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

const cases = [
    {
        url: 'https://www.bestbuy.com/site/apple-airpods-pro-2nd-generation-with-magic-charging-case-usb-c-white/6447382.p',
        fixture: 'fixtures/bestbuy-airpods.html',
    },
    {
        url: 'https://www.bestbuy.com/site/logitech-mx-master-3s-wireless-performance-mouse-with-ultrafast-scrolling/6509717.p',
        fixture: 'fixtures/bestbuy-logitech.html',
    },
];

const results = cases.map(({ url, fixture }) => {
    const html = readFileSync(resolve(ROOT, fixture), 'utf-8');
    const product = parseProduct({
        url,
        platform: 'bestbuy',
        html,
        $: loadHtmlSelector(html),
        source: 'direct_url',
        searchKeyword: null,
    });
    return {
        url,
        title: product.title,
        currentPrice: product.currentPrice,
        inStock: product.inStock,
        productId: product.productId,
        brand: product.brand,
    };
});

console.log(JSON.stringify(results, null, 2));
mkdirSync(resolve(ROOT, 'output'), { recursive: true });
writeFileSync(resolve(ROOT, 'output/bestbuy_parser_fixture_results.json'), JSON.stringify(results, null, 2));

const pass = results.filter((r) => r.title && r.currentPrice != null && r.inStock != null).length;
console.log(`Fixture parser: ${pass}/${results.length} passed`);
process.exit(pass >= 2 ? 0 : 1);
