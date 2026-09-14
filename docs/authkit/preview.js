// Before/after preview of the WorkOS AuthKit sign-in page with soft-clay.css.
// Usage: see docs/authkit/README.md. Needs Node 18+ and Playwright's Chromium.
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const fs = require("fs");
const S = process.env.S;
const css = fs.readFileSync(process.env.CSS, "utf8");
const cid = process.env.CID;
const url = `https://api.workos.com/user_management/authorize?client_id=${cid}&redirect_uri=http%3A%2F%2Flocalhost%3A3001%2Fcallback&response_type=code&provider=authkit`;

const wordmarkHtml = (ink, grape) => `<!doctype html><html><head>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fredoka:wdth,wght@75..125,300..700&display=swap">
<style>html,body{margin:0;background:transparent}
.w{display:inline-block;font-family:Fredoka;font-weight:700;font-variation-settings:'wdth' 110;font-size:96px;line-height:1;letter-spacing:-0.03em;padding:12px 16px}
.a{color:${ink}}.b{color:${grape}}</style></head>
<body><span class="w" id="w"><span class="a">rota</span><span class="b">.monster</span></span></body></html>`;

(async () => {
  // The dashboard's Font family setting (Outfit) is simulated by inlining the
  // Google Fonts stylesheet; the Chrome UA makes Google serve woff2.
  const outfitCss = await (await fetch(
    "https://fonts.googleapis.com/css2?family=Outfit:wght@400..700&display=swap",
    { headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36" } },
  )).text();
  const browser = await chromium.launch();

  // 1. Logo assets
  for (const [name, ink, grape] of [["wordmark-light", "#34244D", "#6334CB"], ["wordmark-dark", "#F4F0FA", "#B9A3F5"]]) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 300 }, deviceScaleFactor: 2 });
    await page.setContent(wordmarkHtml(ink, grape));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    const el = page.locator("#w");
    await el.screenshot({ path: `${S}/assets/${name}.png`, omitBackground: true });
    await page.close();
  }
  {
    const svg = fs.readFileSync(process.env.ICON, "utf8");
    const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
    await page.setContent(`<html><body style="margin:0;background:transparent"><div style="width:512px;height:512px">${svg.replace("<svg ", '<svg width="512" height="512" ')}</div></body></html>`);
    await page.locator("svg").screenshot({ path: `${S}/assets/icon-512.png`, omitBackground: true });
    await page.close();
  }
  const wmLight = fs.readFileSync(`${S}/assets/wordmark-light.png`).toString("base64");
  const wmDark = fs.readFileSync(`${S}/assets/wordmark-dark.png`).toString("base64");

  // 2. Before/after shots on the live hosted page
  const configs = [
    ["desktop", { width: 1440, height: 900 }],
    ["phone", { width: 390, height: 844 }],
  ];
  for (const scheme of ["light", "dark"]) {
    for (const [vp, viewport] of configs) {
      const ctx = await browser.newContext({ viewport, colorScheme: scheme, reducedMotion: "reduce", deviceScaleFactor: 2 });
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("[data-hak-page='sign-in']");
      // Assert the theme class WorkOS applied
      const cls = await page.evaluate(() => document.querySelector(".radix-themes")?.className || document.documentElement.className);
      console.log(scheme, vp, "theme classes:", cls);
      await page.screenshot({ path: `${S}/shots/before-${scheme}-${vp}.png` });
      // Simulate the dashboard settings that live outside CSS:
      //   Font family = Outfit; Logo = wordmark PNG in the header.
      // Let React hydrate before touching the DOM, or the injected wordmark
      // is thrown away by the client render.
      await page.waitForSelector("[data-hak-cta]");
      await page.waitForTimeout(1500);
      await page.evaluate((c) => { const st = document.createElement("style"); st.textContent = c; document.head.appendChild(st); }, outfitCss);
      if (scheme === "dark") await page.evaluate(() => document.querySelector(".radix-themes").classList.add("dark-theme"));
      await page.evaluate((c) => { const st = document.createElement("style"); st.textContent = c; document.head.appendChild(st); }, css);
      await page.evaluate(({ wmLight, wmDark, scheme }) => {
        const h = document.querySelector(".ak-Header");
        const img = document.createElement("img");
        img.src = "data:image/png;base64," + (scheme === "dark" ? wmDark : wmLight);
        img.alt = "rota.monster";
        h.prepend(img);
      }, { wmLight, wmDark, scheme });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(800);
      const wmShown = await page.evaluate(() => { const i = document.querySelector(".ak-Header img"); return !!i && i.complete && i.naturalWidth > 0 && i.getBoundingClientRect().height > 0; });
      const formShown = await page.evaluate(() => { const b = document.querySelector("[data-hak-cta]"); return !!b && b.getBoundingClientRect().height > 0; });
      console.log(scheme, vp, "wordmark:", wmShown, "form:", formShown);
      await page.screenshot({ path: `${S}/shots/after-${scheme}-${vp}.png` });
      // Overflow probe
      const over = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      const fonts = await page.evaluate(() => ({
        heading: getComputedStyle(document.querySelector(".ak-Heading")).fontFamily.slice(0, 40),
        button: getComputedStyle(document.querySelector(".ak-PrimaryButton")).fontFamily.slice(0, 40),
        body: getComputedStyle(document.querySelector(".ak-Label")).fontFamily.slice(0, 40),
        bg: getComputedStyle(document.querySelector(".ak-Background")).backgroundColor,
        card: getComputedStyle(document.querySelector(".ak-Card")).borderRadius,
        input: getComputedStyle(document.querySelector(".ak-TextField")).borderRadius,
        fredokaLoaded: document.fonts.check("600 16px 'Fredoka Clay'"),
      }));
      console.log(scheme, vp, "overflow:", over, JSON.stringify(fonts));
      await ctx.close();
    }
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
