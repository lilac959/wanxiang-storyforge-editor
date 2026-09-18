const { chromium } = require("C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright");
const assert = require("assert/strict");
(async () => {
  const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:4173/");
  await page.waitForSelector(".nodeitem");
  await page.evaluate(() => { selected = project.nodes[0].id; page = "story"; render(); });
  await page.locator("[data-add-cinema]").click();
  assert(await page.evaluate(() => current().cinemaMode && current().cinemaEnd === nodeDuration(current())));
  assert(await page.locator(".timeline-scroll").evaluate((element) => element.scrollWidth > element.clientWidth));
  await page.locator(".timeline-scroll").evaluate((element) => (element.scrollLeft = 120));
  assert(await page.locator(".timeline-scroll").evaluate((element) => element.scrollLeft > 0));
  assert(await page.evaluate(() => {
    const node = current();
    applyTimelineTime(node, "cinemaStart", 2);
    applyTimelineTime(node, "cinemaEnd", 8);
    const old = JSON.stringify(cinemaRange(node, nodeDuration(node)));
    applyTimelineTime(node, "start", 5);
    return old === JSON.stringify(cinemaRange(node, nodeDuration(node)));
  }));
  await page.evaluate(() => {
    renderArea();
    renderProperties();
    const node = current();
    syncCinema(document.querySelector("#editorArea .stage"), node, 4, nodeDuration(node));
  });
  assert(await page.locator(".cinema-bars").evaluate((element) => parseFloat(element.style.getPropertyValue("--cinema-height")) > 0));
  await page.locator("[data-cinema-clip]").click({ button: "right" });
  await page.locator("[data-delete-cinema]").click();
  assert.equal(await page.evaluate(() => current().cinemaMode), false);
  assert.equal(await page.locator("[data-cinema-clip]").count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS scrolling, cinema timing, independent QTE timing, playback bounds, right-click deletion");
  await browser.close();
})().catch((error) => { console.error(error); process.exit(1); });
