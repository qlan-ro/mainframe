// GitHub tour, segment E — session tabs and two threads side by side.
// Boot: MF_DEMO_RECORDING_KEY=tool-group .agents/demo-env.sh up
async page => {
  const APP_URL = 'http://localhost:5183';
  const OUT = '/tmp/mainframe-demo/out/tour-e.webm';
  // 1920 wide: the transcript is a fixed-width centred column, so the floating
  // session panels only clear it once there is real margin to the right.
  const SIZE = { width: 1920, height: 1080 };

  // Chapter cards are off for the shipped cut. Flip CHAPTERS to true to get the
  // full-screen title cards back; the pause keeps the pacing either way.
  const CHAPTERS = false;
  const chapter = (title, opts) =>
    CHAPTERS ? page.screencast.showChapter(title, opts) : page.waitForTimeout(700);

  const PROMPT = 'Where is greeting defined?';

  const label = (b, text) => `
    <div style="position:absolute; top:${b.y - 3}px; left:${b.x - 3}px;
      width:${b.width + 6}px; height:${b.height + 6}px;
      border:2px solid #3b82f6; border-radius:8px;"></div>
    <div style="position:absolute; top:${b.y + b.height + 10}px;
      left:${b.x + b.width / 2}px; transform:translateX(-50%);
      padding:6px 12px; background:rgba(0,0,0,.75); border-radius:8px;
      font:13px -apple-system,system-ui; color:#fff; white-space:nowrap;">${text}</div>`;

  await page.setViewportSize(SIZE);
  await page.addInitScript((v) => localStorage.setItem('mf:tutorial', v), '{"state":{"completed":true,"step":4},"version":0}');
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: /acme-web/ }).first().click();
  await page.waitForTimeout(600);

  // Off-camera: one finished session, then a second one open as a draft, so the
  // tab strip has two entries and there is something to put in the other pane.
  await page.getByTestId('sessions-new-button').click();
  const composer = page.getByTestId('chat-composer-input');
  await composer.waitFor({ timeout: 15000 });
  await page.waitForTimeout(1200);
  await composer.click();
  await composer.fill(PROMPT);
  await composer.press('Enter');
  const landed = await page.getByText(PROMPT, { exact: true }).waitFor({ timeout: 5000 }).then(() => true, () => false);
  if (!landed) {
    await composer.click();
    await composer.fill(PROMPT);
    await composer.press('Enter');
  }
  await page.getByText(/Found it:/).waitFor({ timeout: 30000 });
  await page.waitForTimeout(1000);
  // A second tab, so the strip has two entries and there is a thread to split with.
  await page.getByTestId('session-tabs-new').click();
  await page.waitForTimeout(1800);

  await page.screencast.stop().catch(() => {});
  await page.screencast.start({ path: OUT, size: SIZE });

  await chapter('Several sessions at once', {
    description: 'Tabs across the top — or two threads side by side.',
    duration: 1900,
  });

  const tabs = page.getByTestId('session-tabs');
  const tabsMark = await page.screencast.showOverlay(label(await tabs.boundingBox(), 'Every open session, one strip'));
  await page.waitForTimeout(1900);
  await tabsMark.dispose();
  await page.waitForTimeout(500);

  // Split from the TAB context menu: under a project filter the sidebar list can
  // be empty even when sessions exist, but the tab strip always has them.
  const firstTab = page.locator('[data-testid^=session-tab-]:not([data-testid*=close]):not([data-testid*=pin]):not([data-testid=session-tabs-new])').first();
  await firstTab.click({ button: 'right' });
  await page.waitForTimeout(1000);
  await page.getByTestId('session-tab-ctx-open-split').click();
  await page.waitForTimeout(3200);
  await page.mouse.move(640, 250);
  await page.waitForTimeout(1500);

  await page.screencast.stop();
  return OUT;
}
