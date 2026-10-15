const geometry = (page) =>
  page.locator('#viewport').evaluate((el) => ({
    top: el.scrollTop,
    gap: el.scrollHeight - el.clientHeight - el.scrollTop,
  }));
async function ready(page, count = process.argv.includes('--complex') ? 400 : 160) {
  await page.waitForFunction(
    (count) => document.querySelectorAll('[data-row],[data-message-id]').length === count,
    count,
  );
  await page.waitForTimeout(250);
}
async function reset(page) {
  await page.goto(
    `http://localhost:5198/benchmarks/transcript-scroll/?windows${process.argv.includes('--compact') ? '&compact' : ''}${process.argv.includes('--complex') ? '&complex' : ''}`,
  );
  await ready(page);
}
async function anchor(page) {
  return page.locator('#viewport').evaluate((el) => {
    const box = el.getBoundingClientRect();
    const range = document.caretRangeFromPoint(box.left + 30, box.top + 12);
    if (!range || range.startContainer.nodeType !== Node.TEXT_NODE) throw new Error('No visible text anchor');
    range.setEnd(range.startContainer, Math.min(range.startOffset + 1, range.startContainer.textContent.length));
    window.readingAnchor = range;
    return range.getBoundingClientRect().top - box.top;
  });
}

async function measureReopen(page) {
  await reset(page);
  const initialGapPx = (await geometry(page)).gap;
  await page.locator('#viewport').evaluate((el) => {
    el.scrollTop = 300;
  });
  await page.locator('#mount').click();
  await page.locator('#mount').click();
  await ready(page);
  const reopenGapPx = (await geometry(page)).gap;

  await page.locator('#loaded').click();
  await page.locator('#mount').click();
  await page.locator('#mount').click();
  await page.locator('#loaded').click();
  await ready(page);
  const delayedHistoryGapPx = (await geometry(page)).gap;
  return { initialGapPx, reopenGapPx, delayedHistoryGapPx };
}

async function measureSwitch(page) {
  await page.locator('#switch').click();
  await ready(page, 5);
  const shortGapPx = (await geometry(page)).gap;
  await page.locator('#switch').click();
  await ready(page);
  const switchGapPx = (await geometry(page)).gap;
  await page.locator('#viewport').evaluate((el) => {
    el.scrollTop = 300;
  });
  await page.waitForTimeout(50);
  await page.locator('#switch-long').click();
  await ready(page);
  const longSwitchGapPx = (await geometry(page)).gap;
  const box = await page.locator('#viewport').boundingBox();
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.wheel(0, -1500);
  await page.waitForTimeout(400);
  await page.locator('#switch-long').click();
  await ready(page);
  const wheelSwitchGapPx = (await geometry(page)).gap;
  return { shortGapPx, switchGapPx, longSwitchGapPx, wheelSwitchGapPx };
}

async function measureVisibility(page) {
  await page.locator('#viewport').evaluate((el) => {
    el.scrollTop = 300;
  });
  await page.waitForTimeout(50);
  await page.locator('#visible').click();
  await page.waitForTimeout(50);
  await page.locator('#visible').click();
  await ready(page);
  const hiddenReadingJumpPx = (await geometry(page)).top - 300;
  return { hiddenReadingJumpPx };
}

async function measureWidth(page) {
  await page.locator('#viewport').evaluate((el) => {
    el.scrollTop = 1000;
  });
  await page.waitForTimeout(50);
  const before = await anchor(page);
  await page.locator('#window').evaluate((el) => {
    el.style.width = '380px';
  });
  await ready(page);
  const widthAnchorShiftPx = await page
    .locator('#viewport')
    .evaluate(
      (el, offset) => window.readingAnchor.getBoundingClientRect().top - el.getBoundingClientRect().top - offset,
      before,
    );
  return { widthAnchorShiftPx };
}

export async function measureWindows(page) {
  return {
    ...(await measureReopen(page)),
    ...(await measureSwitch(page)),
    ...(await measureVisibility(page)),
    ...(await measureWidth(page)),
  };
}
